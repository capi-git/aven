#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>
#include <initializer_list>
#include <map>
#include <string>
#include <vector>

#include "floating_sidebar.h"

// The sidebar used to slide in beneath native browser pages while each page
// slid its own edge out of the way. Those two motions ran in different
// processes and drifted apart. Here the card, the workspace cut-out and every
// page edge start in one Core Animation commit on the same springs.

namespace {

// --aven-peek-in/out in personal-shell.css and SMBrowserClipView's edge slide.
struct Spring {
  double response, damping, duration;
};
constexpr Spring kOpening{0.3, 0.88, 0.37};
constexpr Spring kClosing{0.2, 1.0, 0.24};

CASpringAnimation *SpringAnimation(NSString *key, const Spring &spring, double from, double to) {
  CASpringAnimation *animation = [CASpringAnimation animationWithKeyPath:key];
  animation.mass = 1;
  animation.stiffness = std::pow(2 * M_PI / spring.response, 2);
  animation.damping = 4 * M_PI * spring.damping / spring.response;
  animation.fromValue = @(from);
  animation.toValue = @(to);
  animation.duration = spring.duration;
  if (@available(macOS 12.0, *))
    animation.preferredFrameRateRange = CAFrameRateRangeMake(80, 120, 120);
  return animation;
}

bool Finite(std::initializer_list<double> values) {
  return std::all_of(values.begin(), values.end(),
                     [](double value) { return std::isfinite(value) && std::abs(value) <= 262144; });
}
}  // namespace

@interface AvenFloatingSidebarHost : NSView
- (instancetype)initWithOwner:(const char *)owner
                     callback:(sm_sidebar_event_cb)callback
                      context:(void *)context;
- (BOOL)attachWorkspace:(NSView *)workspace overlay:(NSView *)overlay;
- (void)setCoverTop:(double)top bottom:(double)bottom edge:(NSRect)edge enabled:(BOOL)enabled;
- (void)setCard:(NSRect)card regions:(std::vector<NSRect>)regions;
- (void)setOpen:(BOOL)open animated:(BOOL)animated;
- (void)focusWorkspace;
- (void)detach;
@end

@implementation AvenFloatingSidebarHost {
  std::string _owner;
  sm_sidebar_event_cb _callback;
  void *_context;
  __weak NSView *_workspace;
  __weak NSView *_overlay;
  NSView *_slider;
  // The workspace webview's mask while the card is out. Its edge band moves
  // with the card so the window's own glass shows through, as before.
  CALayer *_cover;
  CALayer *_coverEdge;
  id _monitor;
  NSTrackingArea *_tracking;
  // Host points, top-left origin.
  double _coverTop, _coverBottom;
  NSRect _edge;
  NSRect _card;
  std::vector<NSRect> _regions;
  BOOL _enabled, _open, _shown;
  BOOL _pointerInside, _pointerEdge, _edgePressed;
  // The last pointer position this window reported, in host points.
  NSPoint _pointer;
  BOOL _hasPointer;
  NSUInteger _token;
}

- (instancetype)initWithOwner:(const char *)owner
                     callback:(sm_sidebar_event_cb)callback
                      context:(void *)context {
  if (!(self = [super initWithFrame:NSZeroRect])) return nil;
  _owner = owner;
  _callback = callback;
  _context = context;
  self.identifier = supermono::kFloatingSidebarHostIdentifier;
  self.wantsLayer = YES;
  self.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _slider = [[NSView alloc] initWithFrame:NSZeroRect];
  _slider.wantsLayer = YES;
  _slider.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  _slider.hidden = YES;
  [self addSubview:_slider];
  return self;
}

- (BOOL)isFlipped {
  return YES;
}

- (BOOL)attachWorkspace:(NSView *)workspace overlay:(NSView *)overlay {
  NSView *parent = workspace.superview;
  if (!parent || !overlay) return NO;
  _workspace = workspace;
  _overlay = overlay;
  self.frame = parent.bounds;
  _slider.frame = self.bounds;
  if (overlay.superview != _slider) {
    NSView *__strong retained = overlay;
    [retained removeFromSuperview];
    [_slider addSubview:retained];
  }
  overlay.frame = _slider.bounds;
  overlay.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  if (self.superview != parent) {
    [self removeFromSuperview];
    [parent addSubview:self positioned:NSWindowAbove relativeTo:nil];
  }
  if (!_monitor) {
    __weak AvenFloatingSidebarHost *weak = self;
    _monitor = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskMouseMoved | NSEventMaskLeftMouseDragged
                                     handler:^NSEvent *(NSEvent *event) {
                                       [weak trackEvent:event];
                                       return event;
                                     }];
  }
  return YES;
}

- (void)detach {
  if (_monitor) [NSEvent removeMonitor:_monitor];
  _monitor = nil;
  [self removeCover];
  [self removeFromSuperview];
}

// Pointer events reach the card and its menus while it is out, and the reveal
// edge while the sidebar is unpinned. Everything else belongs to the
// workspace and the pages beneath.
- (NSView *)hitTest:(NSPoint)point {
  if (self.hidden || !_enabled || !self.superview) return nil;
  const NSPoint local = [self convertPoint:point fromView:self.superview];
  if (_open)
    for (const NSRect &region : _regions)
      if (NSPointInRect(local, region)) return [super hitTest:point];
  return NSPointInRect(local, _edge) ? self : nil;
}

- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  // Entered/exited only: moves come from the event monitor, so this view never
  // competes with the workspace or a page for mouse-moved delivery.
  _tracking = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingActiveInKeyWindow |
                   NSTrackingInVisibleRect
             owner:self
          userInfo:nil];
  [self addTrackingArea:_tracking];
}

- (void)mouseExited:(NSEvent *)event {
  _hasPointer = NO;
  [self pointerInside:NO edge:NO];
}

- (void)mouseDown:(NSEvent *)event {
  _edgePressed = NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], _edge);
}

- (void)mouseUp:(NSEvent *)event {
  const BOOL pressed = _edgePressed;
  _edgePressed = NO;
  if (pressed && NSPointInRect([self convertPoint:event.locationInWindow fromView:nil], _edge))
    [self emit:"edge-click" json:@"{}"];
}

- (void)trackEvent:(NSEvent *)event {
  if (event.window != self.window || !self.superview) return;
  _pointer = [self convertPoint:event.locationInWindow fromView:nil];
  _hasPointer = YES;
  [self refreshPointer];
}

// Regions change under a still pointer too: a menu closing, the card opening
// beneath it, or a resize. Re-evaluate the last position without waiting for
// the next move.
- (void)refreshPointer {
  if (!_hasPointer) return;
  BOOL inside = NO;
  if (_open)
    for (const NSRect &region : _regions)
      if (NSPointInRect(_pointer, region)) inside = YES;
  [self pointerInside:inside edge:_enabled && NSPointInRect(_pointer, _edge)];
}

- (void)pointerInside:(BOOL)inside edge:(BOOL)edge {
  if (inside == _pointerInside && edge == _pointerEdge) return;
  _pointerInside = inside;
  _pointerEdge = edge;
  [self warm:edge && !_open];
  [self emit:"pointer"
        json:[NSString stringWithFormat:@"{\"inside\":%s,\"edge\":%s}", inside ? "true" : "false",
                                        edge ? "true" : "false"]];
}

- (void)emit:(const char *)event json:(NSString *)json {
  if (_callback) _callback(_owner.c_str(), event, json.UTF8String, _context);
}

- (void)setCoverTop:(double)top bottom:(double)bottom edge:(NSRect)edge enabled:(BOOL)enabled {
  _coverTop = top;
  _coverBottom = std::max(top, bottom);
  _edge = edge;
  if (!enabled && _open) [self setOpen:NO animated:NO];
  _enabled = enabled;
  self.hidden = !enabled;
  if (!enabled) [self pointerInside:NO edge:NO];
  else [self refreshPointer];
  if (_cover) [self layoutCoverAt:[self coverEdge]];
}

// Where the workspace cut-out rests: the card's edge while out, else none.
- (double)coverEdge {
  return _open ? NSMaxX(_card) : 0;
}

- (void)setCard:(NSRect)card regions:(std::vector<NSRect>)regions {
  const BOOL moved = NSMaxX(card) != NSMaxX(_card);
  _card = card;
  _regions = std::move(regions);
  [self refreshPointer];
  if (!_open || !moved) return;
  // A resize while out moves the cut-outs at once, like the old crop did.
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [self layoutCoverAt:[self coverEdge]];
  SMSetFloatingSidebarEdge(self.superview, NSMaxX(_card), false);
  [CATransaction commit];
}

// Resting on the edge reveals the card shortly. Show the overlay past the
// window edge now, so its first frames are rendered before it moves.
- (void)warm:(BOOL)warm {
  if (_open || _shown == warm || NSMaxX(_card) <= 0) return;
  // A closing card finishes its slide; finishTransition settles warmth.
  if (!warm && [_slider.layer animationForKey:@"slide"]) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (warm) {
    [self raiseAboveSiblings];
    _slider.layer.sublayerTransform = CATransform3DMakeTranslation(-NSMaxX(_card), 0, 0);
  }
  _slider.hidden = !warm;
  _shown = warm;
  [CATransaction commit];
}

- (void)raiseAboveSiblings {
  NSView *parent = self.superview;
  if (parent && parent.subviews.lastObject != self)
    [parent addSubview:self positioned:NSWindowAbove relativeTo:nil];
}

- (void)setOpen:(BOOL)open animated:(BOOL)animated {
  if (open && (!_enabled || NSMaxX(_card) <= 0)) return;
  if (open == _open) return;
  _open = open;
  const NSUInteger token = ++_token;
  const double distance = NSMaxX(_card);
  const BOOL motion = animated && !NSWorkspace.sharedWorkspace.accessibilityDisplayShouldReduceMotion;
  const Spring &spring = open ? kOpening : kClosing;
  if (open) [self raiseAboveSiblings];
  CALayer *slide = _slider.layer;
  // Reversing mid-slide continues from where the card is on screen.
  double from = open ? -distance : 0;
  if (_shown) {
    CALayer *shown = slide.presentationLayer ?: slide;
    from = [[shown valueForKeyPath:@"sublayerTransform.translation.x"] doubleValue];
  }
  const double to = open ? 0 : -distance;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  __weak AvenFloatingSidebarHost *weak = self;
  [CATransaction setCompletionBlock:^{
    [weak finishTransition:token];
  }];
  _slider.hidden = NO;
  _shown = YES;
  [slide removeAnimationForKey:@"slide"];
  slide.sublayerTransform = CATransform3DMakeTranslation(to, 0, 0);
  if (motion)
    [slide addAnimation:SpringAnimation(@"sublayerTransform.translation.x", spring, from, to)
                 forKey:@"slide"];
  [self coverFrom:from + distance to:to + distance spring:motion ? &spring : nullptr];
  SMSetFloatingSidebarEdge(self.superview, open ? distance : 0, motion);
  [CATransaction commit];
  if (!open) [self returnFocus];
  [self refreshPointer];
}

- (void)finishTransition:(NSUInteger)token {
  if (token != _token || _open) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  // Still on the edge: stay warm for the next reveal.
  _slider.hidden = !_pointerEdge;
  _shown = _pointerEdge;
  [self removeCover];
  [CATransaction commit];
  [self emit:"closed" json:@"{}"];
}

// The workspace webview keeps everything outside the band the card covers;
// inside it, only what lies right of the card's moving edge.
- (void)coverFrom:(double)from to:(double)to spring:(const Spring *)spring {
  NSView *workspace = _workspace;
  if (!workspace) return;
  workspace.wantsLayer = YES;
  CALayer *layer = workspace.layer;
  if (!_cover) {
    _cover = [CALayer layer];
    _coverEdge = [CALayer layer];
    _coverEdge.anchorPoint = CGPointZero;
    for (CALayer *band in @[ [CALayer layer], [CALayer layer], _coverEdge ]) {
      band.backgroundColor = NSColor.blackColor.CGColor;
      [_cover addSublayer:band];
    }
  }
  if (_shown && layer.mask == _cover) {
    CALayer *shown = _coverEdge.presentationLayer ?: _coverEdge;
    from = shown.position.x;
  }
  [_coverEdge removeAnimationForKey:@"slide"];
  layer.mask = _cover;
  [self layoutCoverAt:to];
  if (spring)
    [_coverEdge addAnimation:SpringAnimation(@"position.x", *spring, from, to) forKey:@"slide"];
}

- (void)layoutCoverAt:(double)edge {
  NSView *workspace = _workspace;
  if (!workspace || !_cover) return;
  const NSRect bounds = workspace.bounds;
  const double width = bounds.size.width, height = bounds.size.height;
  const double top = std::clamp(_coverTop, 0.0, height);
  const double bottom = std::clamp(_coverBottom, top, height);
  // Mask geometry follows the masked view's orientation.
  const auto rect = [&](double y, double h) {
    return workspace.flipped ? NSMakeRect(0, y, width, h) : NSMakeRect(0, height - y - h, width, h);
  };
  NSArray<CALayer *> *bands = _cover.sublayers;
  _cover.frame = bounds;
  bands[0].frame = rect(0, top);
  bands[1].frame = rect(bottom, height - bottom);
  const NSRect band = rect(top, bottom - top);
  _coverEdge.bounds = CGRectMake(0, 0, width, band.size.height);
  _coverEdge.position = CGPointMake(edge, band.origin.y);
}

- (void)removeCover {
  NSView *workspace = _workspace;
  [_coverEdge removeAnimationForKey:@"slide"];
  if (workspace && workspace.layer.mask == _cover) workspace.layer.mask = nil;
}

// A closed sidebar must not keep the keyboard.
- (void)returnFocus {
  NSWindow *window = self.window;
  NSResponder *responder = window.firstResponder;
  if (_workspace && [responder isKindOfClass:NSView.class] &&
      [(NSView *)responder isDescendantOf:_slider])
    [window makeFirstResponder:_workspace];
}

- (void)focusWorkspace {
  NSView *workspace = _workspace;
  if (workspace && workspace.window) [workspace.window makeFirstResponder:workspace];
}
@end

namespace {
std::map<std::string, AvenFloatingSidebarHost *> hosts;

AvenFloatingSidebarHost *Host(const char *owner) {
  if (!owner || ![NSThread isMainThread]) return nil;
  auto found = hosts.find(owner);
  return found == hosts.end() ? nil : found->second;
}

// CSS pixels to host points: DOM coordinates scale by devicePixelRatio over
// the display's backing scale, and a viewport shorter than its view is
// anchored at the bottom (see browser_viewport.h).
struct Mapping {
  double ratio = 0, inset = 0;
  NSRect Rect(double x, double y, double w, double h) const {
    return NSMakeRect(x * ratio, inset + y * ratio, w * ratio, h * ratio);
  }
};

bool MapViewport(AvenFloatingSidebarHost *host, double dpr, double width, double height,
                 Mapping &mapping) {
  const double scale = host.window ? host.window.backingScaleFactor : 2;
  if (!Finite({dpr, width, height}) || dpr <= 0 || width <= 0 || height <= 0 || scale <= 0)
    return false;
  mapping.ratio = dpr / scale;
  mapping.inset = std::max(0.0, host.bounds.size.height - height * mapping.ratio);
  return true;
}
}  // namespace

extern "C" int sm_sidebar_attach(const char *owner, void *workspace_webview, void *overlay_webview,
                                 sm_sidebar_event_cb cb, void *context) {
  @autoreleasepool {
    if (!owner || !workspace_webview || !overlay_webview || ![NSThread isMainThread]) return 0;
    AvenFloatingSidebarHost *host = Host(owner);
    if (!host) {
      host = [[AvenFloatingSidebarHost alloc] initWithOwner:owner callback:cb context:context];
      hosts[owner] = host;
    }
    return [host attachWorkspace:(__bridge NSView *)workspace_webview
                         overlay:(__bridge NSView *)overlay_webview]
               ? 1
               : 0;
  }
}

extern "C" int sm_sidebar_workspace(const char *owner, double dpr, double viewport_width,
                                    double viewport_height, double cover_top, double cover_bottom,
                                    double edge_top, double edge_bottom, int enabled) {
  @autoreleasepool {
    AvenFloatingSidebarHost *host = Host(owner);
    Mapping map;
    if (!host || !MapViewport(host, dpr, viewport_width, viewport_height, map) ||
        !Finite({cover_top, cover_bottom, edge_top, edge_bottom}))
      return 0;
    const NSRect cover = map.Rect(0, cover_top, 0, std::max(0.0, cover_bottom - cover_top));
    // The reveal strip matches the 10px .personal-panel-edge-left target.
    const NSRect edge = map.Rect(0, edge_top, 10, std::max(0.0, edge_bottom - edge_top));
    [host setCoverTop:NSMinY(cover) bottom:NSMaxY(cover) edge:edge enabled:enabled != 0];
    return 1;
  }
}

extern "C" int sm_sidebar_regions(const char *owner, double dpr, double viewport_width,
                                  double viewport_height, double card_x, double card_y,
                                  double card_width, double card_height, const double *regions,
                                  int region_count) {
  @autoreleasepool {
    AvenFloatingSidebarHost *host = Host(owner);
    Mapping map;
    if (!host || !MapViewport(host, dpr, viewport_width, viewport_height, map) ||
        !Finite({card_x, card_y, card_width, card_height}) || region_count < 0 ||
        region_count > 64 || (region_count > 0 && !regions))
      return 0;
    std::vector<NSRect> rects;
    for (int i = 0; i < region_count; ++i) {
      const double *v = regions + i * 4;
      if (!Finite({v[0], v[1], v[2], v[3]}) || v[2] <= 0 || v[3] <= 0) continue;
      rects.push_back(map.Rect(v[0], v[1], v[2], v[3]));
    }
    [host setCard:map.Rect(card_x, card_y, std::max(0.0, card_width), std::max(0.0, card_height))
          regions:std::move(rects)];
    return 1;
  }
}

extern "C" int sm_sidebar_set_open(const char *owner, int open, int animated) {
  @autoreleasepool {
    AvenFloatingSidebarHost *host = Host(owner);
    if (!host) return 0;
    [host setOpen:open != 0 animated:animated != 0];
    return 1;
  }
}

extern "C" int sm_sidebar_focus_workspace(const char *owner) {
  @autoreleasepool {
    AvenFloatingSidebarHost *host = Host(owner);
    if (!host) return 0;
    [host focusWorkspace];
    return 1;
  }
}

extern "C" void sm_sidebar_detach(const char *owner) {
  @autoreleasepool {
    AvenFloatingSidebarHost *host = Host(owner);
    if (!host) return;
    [host detach];
    hosts.erase(owner);
  }
}
