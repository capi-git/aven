// Aven's iPhone pane: the live simulator framebuffer in a native layer, and
// touch, keyboard and button input through SimulatorKit's IndigoHID path.
//
// PRIVATE API. Recovered on Xcode 27.1 (CoreSimulator 1174.9.2, SimulatorKit
// 1005.3); any Xcode release may change it. Nothing links against the
// frameworks: they are loaded with dlopen and every class, selector and
// symbol is checked by aven_sim_probe before use. Aven falls back to its
// basic mode (simctl screenshots, XCUITest input) when the check fails.
//
// Only two IndigoHID targets are ever sent: 0x32 (the touch screen) and 0x33
// (hardware buttons). Any other target trips an assertion in the guest's
// backboardd and restarts the simulator's home screen.
#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <IOSurface/IOSurface.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>
#import <objc/message.h>
#import <objc/runtime.h>
#import <stdatomic.h>

#include "ios_simulator.h"

#pragma mark - Private interfaces (declarations only; resolved at runtime)

@protocol AvenSimServiceContext <NSObject>
- (nullable id)defaultDeviceSetWithError:(NSError **)error;
@end
@protocol AvenSimDeviceSet <NSObject>
- (NSArray *)devices;
@end
@protocol AvenSimIO <NSObject>
- (NSArray *)ioPorts;
@end
@protocol AvenSimDevice <NSObject>
- (NSUUID *)UDID;
- (NSString *)stateString;
- (id<AvenSimIO>)io;
@end
@protocol AvenSimDescriptorState <NSObject>
- (unsigned short)displayClass;
@end
@protocol AvenSimScreenMode <NSObject>
- (double)preferredUIScale;
@end
@protocol AvenSimScreenProperties <NSObject>
- (unsigned int)uiOrientation;
- (id<AvenSimScreenMode>)currentMode;
@end
@protocol AvenSimDisplay <NSObject>
- (nullable IOSurface *)framebufferSurface;
- (void)registerCallbackWithUUID:(NSUUID *)uuid damageRectanglesCallback:(void (^)(NSArray *rects))callback;
- (void)unregisterDamageRectanglesCallbackWithUUID:(NSUUID *)uuid;
- (void)registerCallbackWithUUID:(NSUUID *)uuid
        ioSurfacesChangeCallback:(void (^)(IOSurface *framebuffer, IOSurface *masked))callback;
- (void)unregisterIOSurfacesChangeCallbackWithUUID:(NSUUID *)uuid;
- (void)registerScreenCallbacksWithUUID:(NSUUID *)uuid
                          callbackQueue:(dispatch_queue_t)queue
                          frameCallback:(void (^)(void))frame
                surfacesChangedCallback:(void (^)(IOSurface *framebuffer, IOSurface *masked))surfaces
              propertiesChangedCallback:(void (^)(id properties))properties;
- (void)unregisterScreenCallbacksWithUUID:(NSUUID *)uuid;
- (id<AvenSimScreenProperties>)screenProperties;
@end
@protocol AvenSimHIDClient <NSObject>
- (void)sendWithMessage:(void *)message
           freeWhenDone:(BOOL)freeWhenDone
        completionQueue:(dispatch_queue_t)queue
             completion:(void (^)(NSError *error))completion;
@end

@interface CALayer (AvenSimPrivate)
- (void)setContentsChanged;
@end

// Aven's browser agent pointer (Chromium builds); looked up by name.
@protocol AvenAgentMarker <NSObject>
- (BOOL)setActorName:(NSString *)name red:(double)red green:(double)green blue:(double)blue;
- (void)placeAboveBrowser:(NSView *)browser frame:(NSRect)frame;
- (BOOL)showAction:(NSInteger)action at:(NSPoint)point;
- (void)clear;
@end

typedef void *(*IndigoMouseFn)(CGPoint *point0, CGPoint *point1, uint32_t target, uint64_t eventType, CGSize size,
                               uint64_t edge);
typedef void *(*IndigoButtonFn)(uint32_t source, uint32_t direction, uint32_t target);
typedef void *(*IndigoKeyFn)(uint32_t usage, uint32_t direction);

static const uint32_t kTouchTarget = 0x32;
static const uint32_t kButtonTarget = 0x33;
static NSString *const kHIDClientClass = @"_TtC12SimulatorKit24SimDeviceLegacyHIDClient";
static NSString *const kCoreSimulator = @"/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator";
static NSString *const kFloatingSidebarIdentifier = @"aven.floating-sidebar";

// Implemented in Rust (ios_sim_geometry.rs, ios_sim_keys.rs).
typedef struct { double x, y, width, height; } AvenSimRect;
typedef struct { double x, y; bool inside; } AvenSimPoint;
extern AvenSimRect aven_ios_sim_content_rect(double, double, double, double, uint32_t);
extern AvenSimPoint aven_ios_sim_view_to_device(double, double, double, double, uint32_t, double, double);
extern AvenSimPoint aven_ios_sim_device_to_view(double, double, double, double, uint32_t, double, double);
extern uint32_t aven_ios_sim_quarter_turns(uint32_t);
extern uint32_t aven_ios_sim_key_for_mac_keycode(uint16_t);

static IndigoMouseFn gMouse;
static IndigoButtonFn gButton;
static IndigoKeyFn gKey;
static NSString *gDeveloperDir;
static BOOL gReady;
static AvenSimEventCallback gEventCallback;
static void *gEventContext;

static void SetError(char *error, size_t len, NSString *message) {
  if (!error || !len) return;
  const char *utf8 = message.UTF8String ?: "unknown error";
  strlcpy(error, utf8, len);
}

static void Emit(NSDictionary *event) {
  AvenSimEventCallback callback = gEventCallback;
  if (!callback) return;
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  if (!data) return;
  NSString *json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  callback(json.UTF8String, gEventContext);
}

static id Send0(id target, NSString *selector) {
  SEL sel = NSSelectorFromString(selector);
  if (!target || ![target respondsToSelector:sel]) return nil;
  return ((id(*)(id, SEL))objc_msgSend)(target, sel);
}

#pragma mark - Probe

static BOOL ProtocolHas(Protocol *protocol, SEL selector) {
  if (!protocol) return NO;
  struct objc_method_description d = protocol_getMethodDescription(protocol, selector, YES, YES);
  if (d.name) return YES;
  d = protocol_getMethodDescription(protocol, selector, NO, YES);
  return d.name != NULL;
}

int aven_sim_probe(const char *developer_dir, char *error, size_t error_len) {
  @autoreleasepool {
    if (getenv("AVEN_IOS_SIM_FORCE_BASIC")) {
      SetError(error, error_len, @"Basic mode was requested (AVEN_IOS_SIM_FORCE_BASIC)");
      return 1;
    }
    if (!developer_dir || !*developer_dir) {
      SetError(error, error_len, @"Xcode is not selected");
      return 1;
    }
    NSString *dir = @(developer_dir);
    if (!dlopen(kCoreSimulator.UTF8String, RTLD_NOW | RTLD_GLOBAL)) {
      SetError(error, error_len, [NSString stringWithFormat:@"CoreSimulator did not load: %s", dlerror() ?: ""]);
      return 1;
    }
    NSString *kitPath = [[dir stringByDeletingLastPathComponent]
        stringByAppendingPathComponent:@"SharedFrameworks/SimulatorKit.framework/SimulatorKit"];
    void *kit = dlopen(kitPath.fileSystemRepresentation, RTLD_NOW | RTLD_GLOBAL);
    if (!kit) {
      SetError(error, error_len, [NSString stringWithFormat:@"SimulatorKit did not load: %s", dlerror() ?: ""]);
      return 1;
    }
    IndigoMouseFn mouse = (IndigoMouseFn)dlsym(kit, "IndigoHIDMessageForMouseNSEvent");
    IndigoButtonFn button = (IndigoButtonFn)dlsym(kit, "IndigoHIDMessageForButton");
    IndigoKeyFn key = (IndigoKeyFn)dlsym(kit, "IndigoHIDMessageForKeyboardArbitrary");
    if (!mouse || !button || !key) {
      SetError(error, error_len, @"SimulatorKit's IndigoHID functions are missing");
      return 1;
    }
    Class context = NSClassFromString(@"SimServiceContext");
    Class hid = NSClassFromString(kHIDClientClass);
    if (!context || !hid) {
      SetError(error, error_len, @"CoreSimulator or SimulatorKit classes are missing");
      return 1;
    }
    struct {
      Class cls;
      SEL sel;
      BOOL meta;
    } methods[] = {
        {context, @selector(sharedServiceContextForDeveloperDir:error:), YES},
        {context, @selector(defaultDeviceSetWithError:), NO},
        {hid, @selector(initWithDevice:error:), NO},
        {hid, @selector(sendWithMessage:freeWhenDone:completionQueue:completion:), NO},
    };
    for (size_t i = 0; i < sizeof methods / sizeof methods[0]; i++) {
      BOOL found = methods[i].meta ? [methods[i].cls respondsToSelector:methods[i].sel]
                                   : [methods[i].cls instancesRespondToSelector:methods[i].sel];
      if (!found) {
        SetError(error, error_len,
                 [NSString stringWithFormat:@"%@ lacks %@", methods[i].cls, NSStringFromSelector(methods[i].sel)]);
        return 1;
      }
    }
    Protocol *surface = NSProtocolFromString(@"SimDisplayIOSurfaceRenderable");
    Protocol *renderable = NSProtocolFromString(@"SimDisplayRenderable");
    Protocol *screen = NSProtocolFromString(@"SimScreen");
    Protocol *properties = NSProtocolFromString(@"SimScreenProperties");
    if (!ProtocolHas(surface, @selector(framebufferSurface)) ||
        !ProtocolHas(surface, @selector(registerCallbackWithUUID:ioSurfacesChangeCallback:)) ||
        !ProtocolHas(renderable, @selector(registerCallbackWithUUID:damageRectanglesCallback:)) ||
        !ProtocolHas(renderable, @selector(unregisterDamageRectanglesCallbackWithUUID:)) ||
        !ProtocolHas(screen, @selector(screenProperties)) ||
        !ProtocolHas(screen, @selector(registerScreenCallbacksWithUUID:
                                                      callbackQueue:frameCallback:surfacesChangedCallback
                                                                   :propertiesChangedCallback:)) ||
        !ProtocolHas(properties, @selector(uiOrientation))) {
      SetError(error, error_len, @"The simulator display interfaces changed");
      return 1;
    }
    @synchronized([NSObject class]) {
      gMouse = mouse;
      gButton = button;
      gKey = key;
      gDeveloperDir = [dir copy];
      gReady = YES;
    }
    return 0;
  }
}

#pragma mark - Devices, displays and HID clients

@interface AvenSimDevice : NSObject
@property(nonatomic, strong) id<AvenSimDevice> device;
@property(nonatomic, strong) id<AvenSimDisplay> display;
@property(nonatomic, strong) id<AvenSimHIDClient> hid;
@property(nonatomic, strong) dispatch_queue_t queue;
@end
@implementation AvenSimDevice
@end

static NSMutableDictionary<NSString *, AvenSimDevice *> *gDevices;
static id<AvenSimServiceContext> gServiceContext;

static id<AvenSimServiceContext> ServiceContext(NSString **message) {
  @synchronized([AvenSimDevice class]) {
    if (gServiceContext) return gServiceContext;
    NSError *error = nil;
    id context = ((id(*)(Class, SEL, NSString *, NSError **))objc_msgSend)(
        NSClassFromString(@"SimServiceContext"), @selector(sharedServiceContextForDeveloperDir:error:), gDeveloperDir,
        &error);
    if (!context && message) *message = error.localizedDescription ?: @"CoreSimulator is unavailable";
    gServiceContext = context;
    return context;
  }
}

static AvenSimDevice *DeviceRecord(NSString *udid, NSString **message) {
  if (!gReady) {
    if (message) *message = @"The live simulator view is unavailable";
    return nil;
  }
  @synchronized([AvenSimDevice class]) {
    if (!gDevices) gDevices = [NSMutableDictionary dictionary];
    AvenSimDevice *record = gDevices[udid.uppercaseString];
    if (record) return record;
  }
  id<AvenSimServiceContext> context = ServiceContext(message);
  if (!context) return nil;
  NSError *error = nil;
  id<AvenSimDeviceSet> set = [context defaultDeviceSetWithError:&error];
  if (!set) {
    if (message) *message = error.localizedDescription ?: @"No simulator device set";
    return nil;
  }
  for (id<AvenSimDevice> device in [set devices]) {
    if ([[device UDID].UUIDString caseInsensitiveCompare:udid] != NSOrderedSame) continue;
    AvenSimDevice *record = [AvenSimDevice new];
    record.device = device;
    record.queue = dispatch_queue_create("aven.ios-sim.hid", DISPATCH_QUEUE_SERIAL);
    @synchronized([AvenSimDevice class]) {
      AvenSimDevice *existing = gDevices[udid.uppercaseString];
      if (existing) return existing;
      gDevices[udid.uppercaseString] = record;
    }
    return record;
  }
  if (message) *message = @"That simulator no longer exists";
  return nil;
}

// The device's main display: the framebuffer port whose display class is 0.
static id<AvenSimDisplay> MainDisplay(AvenSimDevice *record, NSString **message) {
  @synchronized(record) {
    if (record.display && [record.display framebufferSurface]) return record.display;
    record.display = nil;
  }
  if (![[record.device stateString] isEqualToString:@"Booted"]) {
    if (message) *message = @"The simulator is not running";
    return nil;
  }
  Protocol *surface = NSProtocolFromString(@"SimDisplayIOSurfaceRenderable");
  Protocol *screen = NSProtocolFromString(@"SimScreen");
  id<AvenSimDisplay> found = nil;
  for (id port in [[record.device io] ioPorts]) {
    id<AvenSimDisplay> descriptor = Send0(port, @"descriptor");
    if (!descriptor || ![descriptor conformsToProtocol:surface] || ![descriptor conformsToProtocol:screen]) continue;
    id<AvenSimDescriptorState> state = Send0(descriptor, @"state");
    unsigned short displayClass = [state respondsToSelector:@selector(displayClass)] ? [state displayClass] : 0xffff;
    if (displayClass != 0 || ![descriptor framebufferSurface]) continue;
    found = descriptor;
    break;
  }
  if (!found) {
    if (message) *message = @"The simulator has no screen yet";
    return nil;
  }
  @synchronized(record) {
    record.display = found;
  }
  return found;
}

static BOOL DisplayInfo(id<AvenSimDisplay> display, AvenSimDisplayInfo *info) {
  IOSurface *fb = [display framebufferSurface];
  id<AvenSimScreenProperties> properties = [display screenProperties];
  double scale = [[properties currentMode] preferredUIScale];
  if (!fb || fb.width <= 0 || fb.height <= 0) return NO;
  if (!(scale > 0)) scale = fb.width > 1000 ? 3 : 2;
  info->scale = scale;
  info->width = fb.width / scale;
  info->height = fb.height / scale;
  unsigned int orientation = [properties respondsToSelector:@selector(uiOrientation)] ? [properties uiOrientation] : 1;
  info->orientation = orientation ?: 1;
  return YES;
}

static id<AvenSimHIDClient> HIDClient(AvenSimDevice *record, NSString **message) {
  @synchronized(record) {
    if (record.hid) return record.hid;
  }
  NSError *error = nil;
  id client = ((id(*)(id, SEL, id, NSError **))objc_msgSend)([NSClassFromString(kHIDClientClass) alloc],
                                                             @selector(initWithDevice:error:), record.device, &error);
  if (!client) {
    if (message) *message = error.localizedDescription ?: @"Could not connect to the simulator's input";
    return nil;
  }
  @synchronized(record) {
    if (!record.hid) record.hid = client;
    return record.hid;
  }
}

// Sends one IndigoHID message, waiting for SimulatorKit's completion.
static BOOL SendMessage(AvenSimDevice *record, void *message, NSString **failure) {
  if (!message) return NO;
  id<AvenSimHIDClient> client = HIDClient(record, failure);
  if (!client) {
    free(message);
    return NO;
  }
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  __block NSError *sendError = nil;
  [client sendWithMessage:message
             freeWhenDone:YES
          completionQueue:record.queue
               completion:^(NSError *error) {
                 sendError = error;
                 dispatch_semaphore_signal(done);
               }];
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC))) {
    if (failure) *failure = @"The simulator did not take the input in time";
    return NO;
  }
  if (sendError) {
    @synchronized(record) {
      record.hid = nil;
    }
    if (failure) *failure = sendError.localizedDescription;
    return NO;
  }
  return YES;
}

int aven_sim_display_info(const char *udid, AvenSimDisplayInfo *info, char *error, size_t error_len) {
  @autoreleasepool {
    NSString *message = nil;
    AvenSimDevice *record = udid ? DeviceRecord(@(udid), &message) : nil;
    id<AvenSimDisplay> display = record ? MainDisplay(record, &message) : nil;
    if (!display || !info || !DisplayInfo(display, info)) {
      SetError(error, error_len, message ?: @"The simulator's screen is unavailable");
      return 1;
    }
    return 0;
  }
}

int aven_sim_screenshot_png(const char *udid, uint32_t quarter_turns, uint8_t **png, size_t *png_len, char *error,
                            size_t error_len) {
  @autoreleasepool {
    NSString *message = nil;
    AvenSimDevice *record = udid ? DeviceRecord(@(udid), &message) : nil;
    id<AvenSimDisplay> display = record ? MainDisplay(record, &message) : nil;
    IOSurface *surface = [display framebufferSurface];
    if (!surface || !png || !png_len) {
      SetError(error, error_len, message ?: @"The simulator's screen is unavailable");
      return 1;
    }
    CIImage *image = [CIImage imageWithIOSurface:(__bridge IOSurfaceRef)surface];
    // Counterclockwise turns shown upright (EXIF orientation semantics).
    static const CGImagePropertyOrientation turns[] = {
        kCGImagePropertyOrientationUp, kCGImagePropertyOrientationLeft, kCGImagePropertyOrientationDown,
        kCGImagePropertyOrientationRight};
    image = [image imageByApplyingCGOrientation:turns[quarter_turns % 4]];
    static CIContext *context;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates : @NO}];
    });
    CGImageRef cg = [context createCGImage:image fromRect:image.extent];
    if (!cg) {
      SetError(error, error_len, @"Could not read the simulator's screen");
      return 1;
    }
    NSMutableData *data = [NSMutableData data];
    CGImageDestinationRef destination =
        CGImageDestinationCreateWithData((__bridge CFMutableDataRef)data, CFSTR("public.png"), 1, NULL);
    BOOL ok = NO;
    if (destination) {
      CGImageDestinationAddImage(destination, cg, NULL);
      ok = CGImageDestinationFinalize(destination);
      CFRelease(destination);
    }
    CGImageRelease(cg);
    if (!ok) {
      SetError(error, error_len, @"Could not encode the screenshot");
      return 1;
    }
    uint8_t *bytes = malloc(data.length);
    if (!bytes) {
      SetError(error, error_len, @"Out of memory");
      return 1;
    }
    memcpy(bytes, data.bytes, data.length);
    *png = bytes;
    *png_len = data.length;
    return 0;
  }
}

void aven_sim_free(void *pointer) { free(pointer); }

int aven_sim_touch(const char *udid, int phase, double x, double y, char *error, size_t error_len) {
  @autoreleasepool {
    if (phase != 1 && phase != 2 && phase != 6) {
      SetError(error, error_len, @"Unknown touch phase");
      return -1;
    }
    NSString *message = nil;
    AvenSimDevice *record = udid ? DeviceRecord(@(udid), &message) : nil;
    id<AvenSimDisplay> display = record ? MainDisplay(record, &message) : nil;
    AvenSimDisplayInfo info = {0};
    if (!display || !DisplayInfo(display, &info)) {
      SetError(error, error_len, message ?: @"The simulator's screen is unavailable");
      return -1;
    }
    if (!isfinite(x) || !isfinite(y)) {
      SetError(error, error_len, @"Invalid touch point");
      return -1;
    }
    CGPoint point = CGPointMake(fmin(fmax(x, 0), info.width), fmin(fmax(y, 0), info.height));
    void *built = gMouse(&point, NULL, kTouchTarget, (uint64_t)phase, CGSizeMake(info.width, info.height), 0);
    if (!built) return phase == 6 ? 1 : -1;
    if (!SendMessage(record, built, &message)) {
      SetError(error, error_len, message ?: @"The touch was not delivered");
      return -1;
    }
    return 0;
  }
}

int aven_sim_button(const char *udid, int button, int phase, char *error, size_t error_len) {
  @autoreleasepool {
    if ((button != 0 && button != 1) || (phase != 1 && phase != 2)) {
      SetError(error, error_len, @"Unknown button");
      return 1;
    }
    NSString *message = nil;
    AvenSimDevice *record = udid ? DeviceRecord(@(udid), &message) : nil;
    if (!record || !SendMessage(record, gButton((uint32_t)button, (uint32_t)phase, kButtonTarget), &message)) {
      SetError(error, error_len, message ?: @"The button press was not delivered");
      return 1;
    }
    return 0;
  }
}

int aven_sim_key(const char *udid, uint32_t usage, int phase, char *error, size_t error_len) {
  @autoreleasepool {
    if (usage == 0 || usage > 0xE7 || (phase != 1 && phase != 2)) {
      SetError(error, error_len, @"Unknown key");
      return 1;
    }
    NSString *message = nil;
    AvenSimDevice *record = udid ? DeviceRecord(@(udid), &message) : nil;
    if (!record || !SendMessage(record, gKey(usage, (uint32_t)phase), &message)) {
      SetError(error, error_len, message ?: @"The key was not delivered");
      return 1;
    }
    return 0;
  }
}

void aven_sim_reset(const char *udid) {
  if (!udid) return;
  @synchronized([AvenSimDevice class]) {
    [gDevices removeObjectForKey:@(udid).uppercaseString];
  }
}

void aven_sim_set_event_callback(AvenSimEventCallback callback, void *context) {
  gEventContext = context;
  gEventCallback = callback;
}

int aven_sim_copy_png(const uint8_t *png, size_t png_len, char *error, size_t error_len) {
  @autoreleasepool {
    if (!png || !png_len) {
      SetError(error, error_len, @"Nothing to copy");
      return 1;
    }
    NSData *data = [NSData dataWithBytes:png length:png_len];
    NSPasteboard *board = NSPasteboard.generalPasteboard;
    [board clearContents];
    if (![board setData:data forType:NSPasteboardTypePNG]) {
      SetError(error, error_len, @"Could not copy the screenshot");
      return 1;
    }
    return 0;
  }
}

#pragma mark - The pane's live view

// Hosts the framebuffer layer; above it sits the agent's ring.
@interface AvenSimScreenView : NSView
@end
@implementation AvenSimScreenView
- (BOOL)isFlipped {
  return YES;
}
- (NSView *)hitTest:(NSPoint)point {
  return nil;
}
@end

@interface AvenSimView : NSView
@property(nonatomic, copy) NSString *viewId;
@property(nonatomic, copy) NSString *udid;
@property(nonatomic, weak) NSView *webview;
@property(nonatomic, strong) AvenSimScreenView *screenView;
@property(nonatomic, strong) CALayer *screenLayer;
@property(nonatomic, strong) CAShapeLayer *maskLayer;
@property(nonatomic, strong) NSView<AvenAgentMarker> *marker;
@property(nonatomic, strong) NSUUID *callbackId;
@property(nonatomic, strong) id<AvenSimDisplay> display;
@property(nonatomic) AvenSimDisplayInfo info;
@property(nonatomic) BOOL live;
@property(nonatomic) BOOL shown;
// The last screen state reported (-1 none yet, 0 no screen, 1 live).
@property(nonatomic) NSInteger reportedScreen;
@property(nonatomic) NSRect content;
@property(nonatomic, copy) NSArray<NSValue *> *holes;
@property(nonatomic) double clipLeft;
@property(nonatomic) double clipRight;
// Scrolling: a virtual finger on the screen.
@property(nonatomic) BOOL scrolling;
@property(nonatomic) CGPoint scrollStart;
@property(nonatomic) CGPoint scrollPoint;
@property(nonatomic, strong) NSTimer *scrollEnd;
@end

static NSMutableDictionary<NSString *, AvenSimView *> *gViews;

@implementation AvenSimView {
  _Atomic(BOOL) _framePending;
}

- (instancetype)initWithFrame:(NSRect)frame {
  if (!(self = [super initWithFrame:frame])) return nil;
  self.wantsLayer = YES;
  self.layer.masksToBounds = YES;
  self.hidden = YES;
  _screenView = [[AvenSimScreenView alloc] initWithFrame:self.bounds];
  _screenView.wantsLayer = YES;
  _screenView.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [self addSubview:_screenView];
  _screenLayer = [CALayer layer];
  _screenLayer.contentsGravity = kCAGravityResize;
  _screenLayer.masksToBounds = YES;
  _screenLayer.backgroundColor = NSColor.blackColor.CGColor;
  _screenLayer.actions = @{@"contents" : [NSNull null], @"bounds" : [NSNull null], @"position" : [NSNull null],
                           @"transform" : [NSNull null], @"cornerRadius" : [NSNull null]};
  [_screenView.layer addSublayer:_screenLayer];
  _maskLayer = [CAShapeLayer layer];
  _maskLayer.fillRule = kCAFillRuleEvenOdd;
  _reportedScreen = -1;
  return self;
}

- (BOOL)isFlipped {
  return YES;
}
- (BOOL)acceptsFirstResponder {
  return self.udid != nil;
}
- (BOOL)acceptsFirstMouse:(NSEvent *)event {
  return YES;
}
- (BOOL)mouseDownCanMoveWindow {
  return NO;
}

- (BOOL)inHole:(NSPoint)local {
  if (local.x < self.clipLeft || local.x > self.bounds.size.width - self.clipRight) return YES;
  for (NSValue *value in self.holes) {
    if (NSPointInRect(local, value.rectValue)) return YES;
  }
  return NO;
}

// Only the device's screen takes the pointer; the letterbox, cut-outs and the
// sidebar's edge pass clicks to the workspace beneath.
- (NSView *)hitTest:(NSPoint)point {
  if (self.hidden || !self.udid) return nil;
  NSPoint local = [self convertPoint:point fromView:self.superview];
  if (!NSPointInRect(local, self.bounds) || [self inHole:local] || !NSPointInRect(local, self.content)) return nil;
  return self;
}

- (CGPoint)devicePoint:(NSPoint)local inside:(BOOL *)inside {
  AvenSimDisplayInfo info = self.info;
  AvenSimPoint p = aven_ios_sim_view_to_device(self.bounds.size.width, self.bounds.size.height, info.width,
                                               info.height, aven_ios_sim_quarter_turns(info.orientation), local.x,
                                               local.y);
  if (inside) *inside = p.inside;
  return CGPointMake(p.x, p.y);
}

- (void)touch:(int)phase at:(CGPoint)point {
  if (!self.udid) return;
  char error[256] = {0};
  aven_sim_touch(self.udid.UTF8String, phase, point.x, point.y, error, sizeof error);
}

- (void)mouseDown:(NSEvent *)event {
  [self.window makeFirstResponder:self];
  [self endScroll];
  NSPoint local = [self convertPoint:event.locationInWindow fromView:nil];
  [self touch:1 at:[self devicePoint:local inside:NULL]];
}
- (void)mouseDragged:(NSEvent *)event {
  NSPoint local = [self convertPoint:event.locationInWindow fromView:nil];
  [self touch:6 at:[self devicePoint:local inside:NULL]];
}
- (void)mouseUp:(NSEvent *)event {
  NSPoint local = [self convertPoint:event.locationInWindow fromView:nil];
  [self touch:2 at:[self devicePoint:local inside:NULL]];
}
- (void)rightMouseDown:(NSEvent *)event {
}

// Scrolling drags a virtual finger from the pointer: trackpad phases map to
// touch down, moves and up (iOS adds its own momentum); a mouse wheel's
// burst becomes one short swipe.
- (void)scrollWheel:(NSEvent *)event {
  if (!self.udid || self.info.width <= 0) return;
  if (event.momentumPhase != NSEventPhaseNone) return;
  // The finger moves as far on screen as the scroll would move the pane.
  double dx = event.scrollingDeltaX * (event.hasPreciseScrollingDeltas ? 1 : 12);
  double dy = event.scrollingDeltaY * (event.hasPreciseScrollingDeltas ? 1 : 12);
  NSPoint local = [self convertPoint:event.locationInWindow fromView:nil];
  BOOL began = event.phase == NSEventPhaseBegan || (event.phase == NSEventPhaseNone && !self.scrolling);
  if (event.phase == NSEventPhaseMayBegin) return;
  if (began && !self.scrolling) {
    self.scrolling = YES;
    self.scrollStart = local;
    self.scrollPoint = local;
    [self touch:1 at:[self devicePoint:local inside:NULL]];
  }
  if (!self.scrolling) return;
  if (event.phase == NSEventPhaseEnded || event.phase == NSEventPhaseCancelled) {
    [self endScroll];
    return;
  }
  NSPoint next = NSMakePoint(self.scrollPoint.x + dx, self.scrollPoint.y + dy);
  if (!NSPointInRect(next, NSInsetRect(self.content, 2, 2))) {
    // The finger reached the screen's edge: lift it and start again.
    [self touch:2 at:[self devicePoint:self.scrollPoint inside:NULL]];
    self.scrollPoint = self.scrollStart;
    [self touch:1 at:[self devicePoint:self.scrollStart inside:NULL]];
    next = NSMakePoint(self.scrollStart.x + dx, self.scrollStart.y + dy);
  }
  self.scrollPoint = next;
  [self touch:6 at:[self devicePoint:next inside:NULL]];
  if (event.phase == NSEventPhaseNone) {
    [self.scrollEnd invalidate];
    __weak AvenSimView *weakSelf = self;
    self.scrollEnd = [NSTimer scheduledTimerWithTimeInterval:0.12
                                                     repeats:NO
                                                       block:^(NSTimer *timer) {
                                                         [weakSelf endScroll];
                                                       }];
  }
}

- (void)endScroll {
  [self.scrollEnd invalidate];
  self.scrollEnd = nil;
  if (!self.scrolling) return;
  self.scrolling = NO;
  [self touch:2 at:[self devicePoint:self.scrollPoint inside:NULL]];
}

// Presses a key with its modifiers held, like a USB keyboard would.
- (void)sendKey:(uint32_t)usage modifiers:(NSEventModifierFlags)flags {
  if (!self.udid || !usage) return;
  const char *udid = self.udid.UTF8String;
  char error[256] = {0};
  const struct {
    NSEventModifierFlags flag;
    uint32_t usage;
  } modifiers[] = {{NSEventModifierFlagControl, 0xE0},
                   {NSEventModifierFlagShift, 0xE1},
                   {NSEventModifierFlagOption, 0xE2},
                   {NSEventModifierFlagCommand, 0xE3}};
  const size_t count = sizeof modifiers / sizeof modifiers[0];
  for (size_t i = 0; i < count; i++)
    if (flags & modifiers[i].flag) aven_sim_key(udid, modifiers[i].usage, 1, error, sizeof error);
  aven_sim_key(udid, usage, 1, error, sizeof error);
  aven_sim_key(udid, usage, 2, error, sizeof error);
  for (size_t i = count; i-- > 0;)
    if (flags & modifiers[i].flag) aven_sim_key(udid, modifiers[i].usage, 2, error, sizeof error);
}

// Keys travel by position with their modifiers, so iOS composes characters
// itself (Option-E then E types é). Keys a US keyboard lacks type their
// characters through the device's pasteboard instead.
- (void)keyDown:(NSEvent *)event {
  if (!self.udid) return;
  uint32_t usage = aven_ios_sim_key_for_mac_keycode(event.keyCode);
  if (usage) {
    [self sendKey:usage modifiers:event.modifierFlags];
    return;
  }
  NSString *text = event.characters;
  if (text.length && !(event.modifierFlags & NSEventModifierFlagCommand))
    Emit(@{@"type" : @"text", @"view" : self.viewId, @"udid" : self.udid, @"text" : text});
}

- (void)flagsChanged:(NSEvent *)event {
}

// Edit menu commands while the device has the keyboard.
- (void)paste:(id)sender {
  if (self.udid) Emit(@{@"type" : @"paste", @"view" : self.viewId, @"udid" : self.udid});
}
- (void)copy:(id)sender {
  [self sendKey:6 modifiers:NSEventModifierFlagCommand];
}
- (void)cut:(id)sender {
  [self sendKey:27 modifiers:NSEventModifierFlagCommand];
}
- (void)selectAll:(id)sender {
  [self sendKey:4 modifiers:NSEventModifierFlagCommand];
}
- (void)undo:(id)sender {
  [self sendKey:29 modifiers:NSEventModifierFlagCommand];
}
- (BOOL)validateMenuItem:(NSMenuItem *)item {
  SEL action = item.action;
  if (action == @selector(paste:) || action == @selector(copy:) || action == @selector(cut:) ||
      action == @selector(selectAll:) || action == @selector(undo:))
    return self.udid != nil;
  return NO;
}

- (BOOL)becomeFirstResponder {
  Emit(@{@"type" : @"focus", @"view" : self.viewId, @"focused" : @YES});
  return YES;
}
- (BOOL)resignFirstResponder {
  [self endScroll];
  Emit(@{@"type" : @"focus", @"view" : self.viewId, @"focused" : @NO});
  return YES;
}

#pragma mark Frames

- (void)frameArrived {
  // Damage callbacks arrive per presented frame on CoreSimulator's queue;
  // post at most one main-thread update at a time.
  BOOL expected = NO;
  if (!atomic_compare_exchange_strong(&_framePending, &expected, YES)) return;
  __weak AvenSimView *weakSelf = self;
  dispatch_async(dispatch_get_main_queue(), ^{
    AvenSimView *view = weakSelf;
    if (!view) return;
    atomic_store(&view->_framePending, NO);
    if (!view.live) return;
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    [view.screenLayer setContentsChanged];
    [CATransaction commit];
  });
}

- (void)stopFrames {
  if (self.display && self.callbackId) {
    @try {
      [self.display unregisterDamageRectanglesCallbackWithUUID:self.callbackId];
      [self.display unregisterIOSurfacesChangeCallbackWithUUID:self.callbackId];
      [self.display unregisterScreenCallbacksWithUUID:self.callbackId];
    } @catch (NSException *exception) {
    }
  }
  self.callbackId = nil;
  self.display = nil;
  self.live = NO;
}

- (void)startFrames {
  if (self.live || !self.udid || !self.shown) return;
  NSString *message = nil;
  AvenSimDevice *record = DeviceRecord(self.udid, &message);
  id<AvenSimDisplay> display = record ? MainDisplay(record, &message) : nil;
  AvenSimDisplayInfo info = {0};
  if (!display || !DisplayInfo(display, &info)) {
    if (self.reportedScreen != 0) {
      self.reportedScreen = 0;
      Emit(@{@"type" : @"screen", @"view" : self.viewId, @"ok" : @NO, @"error" : message ?: @"No screen"});
    }
    // The device may still be starting; try again shortly.
    __weak AvenSimView *weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(NSEC_PER_SEC / 2)), dispatch_get_main_queue(), ^{
      AvenSimView *view = weakSelf;
      if (view && view.shown && !view.live) [view startFrames];
    });
    return;
  }
  self.display = display;
  self.info = info;
  self.callbackId = [NSUUID UUID];
  self.live = YES;
  __weak AvenSimView *weakSelf = self;
  [display registerCallbackWithUUID:self.callbackId
           damageRectanglesCallback:^(NSArray *rects) {
             [weakSelf frameArrived];
           }];
  [display registerCallbackWithUUID:self.callbackId
           ioSurfacesChangeCallback:^(IOSurface *framebuffer, IOSurface *masked) {
             dispatch_async(dispatch_get_main_queue(), ^{
               AvenSimView *view = weakSelf;
               if (!view || !view.live || !framebuffer) return;
               [view refreshDisplay];
             });
           }];
  [display registerScreenCallbacksWithUUID:self.callbackId
                             callbackQueue:dispatch_get_main_queue()
                             frameCallback:^{
                             }
                   surfacesChangedCallback:^(IOSurface *framebuffer, IOSurface *masked) {
                   }
                 propertiesChangedCallback:^(id properties) {
                   AvenSimView *view = weakSelf;
                   if (view && view.live) [view refreshDisplay];
                 }];
  [self refreshDisplay];
  self.reportedScreen = 1;
  Emit(@{@"type" : @"screen", @"view" : self.viewId, @"ok" : @YES});
}

// Reads the screen's size, scale and orientation and places the layer.
- (void)refreshDisplay {
  if (!self.display) return;
  AvenSimDisplayInfo info = self.info;
  uint32_t previous = info.orientation;
  if (DisplayInfo(self.display, &info)) self.info = info;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.screenLayer.contents = [self.display framebufferSurface];
  [CATransaction commit];
  [self placeScreen];
  if (previous != info.orientation)
    Emit(@{@"type" : @"orientation", @"view" : self.viewId, @"orientation" : @(info.orientation)});
}

- (void)placeScreen {
  AvenSimDisplayInfo info = self.info;
  NSSize size = self.bounds.size;
  if (info.width <= 0 || size.width <= 0 || size.height <= 0) {
    self.content = NSZeroRect;
    return;
  }
  uint32_t turns = aven_ios_sim_quarter_turns(info.orientation);
  AvenSimRect rect = aven_ios_sim_content_rect(size.width, size.height, info.width, info.height, turns);
  self.content = NSMakeRect(rect.x, rect.y, rect.width, rect.height);
  // The layer keeps the portrait framebuffer's shape and turns about its
  // centre; the view is flipped, so a counterclockwise turn on screen is a
  // negative angle here.
  double scale = (turns % 2 ? rect.width / info.height : rect.width / info.width);
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  self.screenLayer.bounds = CGRectMake(0, 0, info.width * scale, info.height * scale);
  self.screenLayer.position = CGPointMake(rect.x + rect.width / 2, rect.y + rect.height / 2);
  self.screenLayer.transform = CATransform3DMakeRotation(-M_PI_2 * turns, 0, 0, 1);
  // A device's screen corners: phones round them, iPads only slightly.
  double radius = info.width < 600 ? info.width * 0.135 : 18;
  self.screenLayer.cornerRadius = radius * scale;
  [CATransaction commit];
}

- (void)layout {
  [super layout];
  [self placeScreen];
}

- (void)applyMask {
  NSSize size = self.bounds.size;
  if (!self.holes.count && self.clipLeft <= 0 && self.clipRight <= 0) {
    self.layer.mask = nil;
    return;
  }
  CGMutablePathRef path = CGPathCreateMutable();
  CGPathAddRect(path, NULL, CGRectMake(self.clipLeft, 0, MAX(0, size.width - self.clipLeft - self.clipRight),
                                       size.height));
  for (NSValue *value in self.holes) CGPathAddRect(path, NULL, NSRectToCGRect(value.rectValue));
  self.maskLayer.frame = CGRectMake(0, 0, size.width, size.height);
  self.maskLayer.path = path;
  CGPathRelease(path);
  self.layer.mask = self.maskLayer;
}

- (void)setDevice:(NSString *)udid {
  if ((udid == self.udid) || [udid isEqualToString:self.udid]) return;
  [self stopFrames];
  [self.marker clear];
  self.udid = udid;
  self.reportedScreen = -1;
  self.info = (AvenSimDisplayInfo){0};
  self.screenLayer.contents = nil;
  if (!udid && self.window.firstResponder == self && self.webview) [self.window makeFirstResponder:self.webview];
  [self startFrames];
}

- (void)setShown:(BOOL)shown {
  if (_shown == shown) return;
  _shown = shown;
  self.hidden = !shown;
  if (shown) {
    [self startFrames];
  } else {
    [self stopFrames];
    [self endScroll];
    [self.marker clear];
    // A hidden pane must not keep the keyboard.
    if (self.window.firstResponder == self && self.webview) [self.window makeFirstResponder:self.webview];
  }
}

- (void)dealloc {
  [self stopFrames];
}
@end

static AvenSimView *ViewFor(const char *view_id) {
  if (!view_id) return nil;
  return gViews[@(view_id)];
}

// Keeps the view directly above the workspace webview's branch of the content
// view and below the floating sidebar, which stays above every live page.
static void PlaceInHierarchy(AvenSimView *view, NSView *parent, NSView *webview) {
  NSView *sidebar = nil;
  for (NSView *child in parent.subviews)
    if ([child.identifier isEqualToString:kFloatingSidebarIdentifier]) sidebar = child;
  NSView *peer = webview;
  while (peer && peer != parent && peer.superview != parent) peer = peer.superview;
  if (view.superview != parent) {
    [view removeFromSuperview];
    if (peer && peer.superview == parent)
      [parent addSubview:view positioned:NSWindowAbove relativeTo:peer];
    else if (sidebar)
      [parent addSubview:view positioned:NSWindowBelow relativeTo:sidebar];
    else
      [parent addSubview:view];
  }
  NSArray *siblings = parent.subviews;
  NSUInteger mine = [siblings indexOfObjectIdenticalTo:view];
  if (peer && peer.superview == parent && mine < [siblings indexOfObjectIdenticalTo:peer])
    [parent addSubview:view positioned:NSWindowAbove relativeTo:peer];
  if (sidebar && [parent.subviews indexOfObjectIdenticalTo:view] > [parent.subviews indexOfObjectIdenticalTo:sidebar])
    [parent addSubview:view positioned:NSWindowBelow relativeTo:sidebar];
}

int aven_sim_view_attach(const char *view_id, void *content_view, void *webview, char *error, size_t error_len) {
  @autoreleasepool {
    NSView *parent = (__bridge NSView *)content_view;
    NSView *web = (__bridge NSView *)webview;
    if (!view_id || !parent || !web) {
      SetError(error, error_len, @"No window to show the simulator in");
      return 1;
    }
    if (!gViews) gViews = [NSMutableDictionary dictionary];
    AvenSimView *view = gViews[@(view_id)];
    if (!view) {
      view = [[AvenSimView alloc] initWithFrame:NSZeroRect];
      view.viewId = @(view_id);
      gViews[view.viewId] = view;
    }
    view.webview = web;
    parent.wantsLayer = YES;
    PlaceInHierarchy(view, parent, web);
    return 0;
  }
}

int aven_sim_view_set_device(const char *view_id, const char *udid, char *error, size_t error_len) {
  AvenSimView *view = ViewFor(view_id);
  if (!view) {
    SetError(error, error_len, @"The iPhone pane is not attached");
    return 1;
  }
  if (udid && !gReady) {
    SetError(error, error_len, @"The live simulator view is unavailable");
    return 1;
  }
  [view setDevice:udid ? @(udid) : nil];
  return 0;
}

int aven_sim_view_layout(const char *view_id, double x, double y, double width, double height, int visible,
                         double viewport_height, double clip_left, double clip_right, const double *holes,
                         int hole_count, char *error, size_t error_len) {
  @autoreleasepool {
    AvenSimView *view = ViewFor(view_id);
    if (!view || !view.superview) {
      SetError(error, error_len, @"The iPhone pane is not attached");
      return 1;
    }
    NSView *web = view.webview;
    if (!web) {
      SetError(error, error_len, @"The workspace is gone");
      return 1;
    }
    PlaceInHierarchy(view, view.superview, web);
    if (visible && width >= 1 && height >= 1) {
      // WebKit's DOM viewport can be shorter than its native frame.
      NSRect bounds = web.bounds;
      double viewportHeight = viewport_height > 0 ? MIN(bounds.size.height, viewport_height) : bounds.size.height;
      double originY = web.isFlipped ? bounds.origin.y + (bounds.size.height - viewportHeight)
                                     : bounds.origin.y + viewportHeight - y - height;
      NSRect inWeb = web.isFlipped ? NSMakeRect(bounds.origin.x + x, originY + y, width, height)
                                   : NSMakeRect(bounds.origin.x + x, originY, width, height);
      NSRect frame = [web convertRect:inWeb toView:view.superview];
      frame = [view.superview backingAlignedRect:frame options:NSAlignAllEdgesNearest];
      [CATransaction begin];
      [CATransaction setDisableActions:YES];
      view.frame = frame;
      NSMutableArray *cuts = [NSMutableArray array];
      for (int i = 0; holes && i < hole_count && i < 8; i++) {
        const double *h = holes + i * 5;
        [cuts addObject:[NSValue valueWithRect:NSMakeRect(h[0], h[1], h[2], h[3])]];
      }
      view.holes = cuts;
      view.clipLeft = MAX(0, clip_left);
      view.clipRight = MAX(0, clip_right);
      [view applyMask];
      [view placeScreen];
      [CATransaction commit];
    }
    view.shown = visible && width >= 1 && height >= 1;
    return 0;
  }
}

int aven_sim_view_marker(const char *view_id, double x, double y, const char *name, double red, double green,
                         double blue, int action) {
  @autoreleasepool {
    AvenSimView *view = ViewFor(view_id);
    if (!view || !view.shown || !view.live) return 1;
    if (!view.marker) {
      Class markerClass = NSClassFromString(@"SMBrowserAgentMarker");
      if (!markerClass) return 1;
      view.marker = [[markerClass alloc] initWithFrame:view.bounds];
    }
    if (name && *name) [view.marker setActorName:@(name) red:red green:green blue:blue];
    [view.marker placeAboveBrowser:view.screenView frame:view.screenView.frame];
    AvenSimDisplayInfo info = view.info;
    AvenSimPoint p = aven_ios_sim_device_to_view(view.bounds.size.width, view.bounds.size.height, info.width,
                                                 info.height, aven_ios_sim_quarter_turns(info.orientation), x, y);
    return [view.marker showAction:action at:NSMakePoint(p.x, p.y)] ? 0 : 1;
  }
}

int aven_sim_view_focus(const char *view_id) {
  AvenSimView *view = ViewFor(view_id);
  if (!view || !view.shown || !view.udid || !view.window) return 1;
  return [view.window makeFirstResponder:view] ? 0 : 1;
}

int aven_sim_view_debug_click(const char *view_id, double x, double y) {
  @autoreleasepool {
    AvenSimView *view = ViewFor(view_id);
    if (!view || !view.shown || !view.live || !view.window) return 1;
    AvenSimDisplayInfo info = view.info;
    AvenSimPoint p = aven_ios_sim_device_to_view(view.bounds.size.width, view.bounds.size.height, info.width,
                                                 info.height, aven_ios_sim_quarter_turns(info.orientation), x, y);
    NSPoint local = NSMakePoint(p.x, p.y);
    // The click must reach this view through hit testing, as a person's would.
    NSPoint inParent = [view convertPoint:local toView:view.superview];
    if ([view hitTest:inParent] != view) return 2;
    NSPoint inWindow = [view convertPoint:local toView:nil];
    NSEvent *(^mouse)(NSEventType) = ^NSEvent *(NSEventType type) {
      return [NSEvent mouseEventWithType:type
                                location:inWindow
                           modifierFlags:0
                               timestamp:NSProcessInfo.processInfo.systemUptime
                            windowNumber:view.window.windowNumber
                                 context:nil
                             eventNumber:0
                              clickCount:1
                                pressure:type == NSEventTypeLeftMouseDown ? 1 : 0];
    };
    [view mouseDown:mouse(NSEventTypeLeftMouseDown)];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
      [view mouseUp:mouse(NSEventTypeLeftMouseUp)];
    });
    return 0;
  }
}

int aven_sim_view_debug_key(const char *view_id, unsigned short key_code, const char *characters,
                            unsigned long modifiers) {
  @autoreleasepool {
    AvenSimView *view = ViewFor(view_id);
    if (!view || !view.shown || !view.udid || !view.window) return 1;
    NSString *text = characters ? @(characters) : @"";
    NSEvent *event = [NSEvent keyEventWithType:NSEventTypeKeyDown
                                      location:NSZeroPoint
                                 modifierFlags:(NSEventModifierFlags)modifiers
                                     timestamp:NSProcessInfo.processInfo.systemUptime
                                  windowNumber:view.window.windowNumber
                                       context:nil
                                    characters:text
                   charactersIgnoringModifiers:text
                                     isARepeat:NO
                                       keyCode:key_code];
    [view keyDown:event];
    return 0;
  }
}

void aven_sim_view_detach(const char *view_id) {
  @autoreleasepool {
    AvenSimView *view = ViewFor(view_id);
    if (!view) return;
    [gViews removeObjectForKey:view.viewId];
    view.shown = NO;
    [view setDevice:nil];
    [view.marker clear];
    if (view.window.firstResponder == view && view.webview) [view.window makeFirstResponder:view.webview];
    [view removeFromSuperview];
  }
}
