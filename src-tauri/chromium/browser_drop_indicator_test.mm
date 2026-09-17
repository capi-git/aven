#import <Cocoa/Cocoa.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

#import "browser_drop_indicator.h"

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Drop indicator check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

@interface SMDropBrowserProbe : NSView
@property(nonatomic) int detachments;
@end
@implementation SMDropBrowserProbe
- (void)viewWillMoveToSuperview:(NSView *)next {
  if (!next) ++_detachments;
  [super viewWillMoveToSuperview:next];
}
@end

static void ValidationAndLabels() {
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc]
      initWithFrame:NSMakeRect(0, 0, 800, 600)];
  CHECK(view.hidden && !view.active && view.isFlipped && !view.isOpaque);
  CHECK(!view.acceptsFirstResponder && !view.isAccessibilityElement);
  const NSRect target = NSMakeRect(.25, 0, .5, 1);
  CHECK([view updateTarget:target edge:@"left" kind:@"tab" title:@"Docs"]);
  CHECK(view.active && !view.hidden);
  CHECK([view.outcome isEqualToString:@"Split left"]);
  CHECK([view.moveLabel isEqualToString:@"Move tab"]);
  CHECK([view hitTest:NSMakePoint(400, 300)] == nil);
  CHECK(NSEqualRects(view.targetRect, NSMakeRect(200, 0, 400, 600)));
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  const NSRect invalid[] = {
    NSMakeRect(nan, 0, .5, 1), NSMakeRect(0, inf, .5, 1),
    NSMakeRect(0, 0, nan, 1), NSMakeRect(0, 0, .5, inf),
    NSMakeRect(-.1, 0, .5, 1), NSMakeRect(0, -.1, .5, 1),
    NSMakeRect(0, 0, 0, 1), NSMakeRect(0, 0, .5, -1),
    NSMakeRect(.6, 0, .5, 1), NSMakeRect(0, .6, .5, .5),
    NSMakeRect(1, 0, 1e-7, 1), NSMakeRect(0, 1, 1, 1e-7),
  };
  for (const auto rect : invalid)
    CHECK(![view updateTarget:rect edge:@"left" kind:@"tab" title:@"Docs"]);
  CHECK(![view updateTarget:target edge:@"script" kind:@"tab" title:@"Docs"]);
  CHECK(![view updateTarget:target edge:@"left" kind:@"unknown" title:@"Docs"]);
  CHECK(![view updateTarget:target edge:@"left" kind:@"tab" title:nil]);
  CHECK(![view updateTarget:target edge:@"left" kind:@"tab"
      title:[@"a" stringByPaddingToLength:161 withString:@"a" startingAtIndex:0]]);
  CHECK(NSEqualRects(view.normalizedTarget, target));
  CHECK([view updateTarget:NSMakeRect(.5, .5, .50000001, .50000001)
      edge:@"right" kind:@"group" title:@"Title\nline"]);
  CHECK(NSEqualRects(view.normalizedTarget, NSMakeRect(.5, .5, .5, .5)));
  CHECK([view.title isEqualToString:@"Title line"]);
  CHECK([view.moveLabel isEqualToString:@"Move group"]);
  NSDictionary *labels = @{@"tab":@"Join group", @"left":@"Split left",
      @"right":@"Split right", @"up":@"Split above", @"down":@"Split below"};
  for (NSString *edge in labels) {
    CHECK([view updateTarget:target edge:edge kind:@"group" title:@""]);
    CHECK([view.outcome isEqualToString:labels[edge]]);
  }
  view.needsDisplay = NO;
  CHECK([view updateTarget:target edge:@"down" kind:@"group" title:@""]);
  view.needsDisplay = NO;
  CHECK([view updateTarget:target edge:@"down" kind:@"group" title:@""]);
  CHECK(!view.needsDisplay);
  [view clear];
  CHECK(view.hidden && !view.active && NSIsEmptyRect(view.targetRect));
  CHECK(view.title == nil && view.outcome == nil);
}

static void HierarchyClippingAndResize() {
  NSView *clip = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 600, 600)];
  clip.wantsLayer = YES;
  clip.clipsToBounds = YES;
  SMDropBrowserProbe *browser = [[SMDropBrowserProbe alloc]
      initWithFrame:NSMakeRect(-100, 0, 800, 600)];
  [clip addSubview:browser];
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc] initWithFrame:NSZeroRect];
  [view placeAboveBrowser:browser frame:browser.frame];
  CHECK(view.superview == clip && clip.subviews.lastObject == view);
  CHECK(NSEqualRects(view.frame, browser.frame));
  CHECK([view updateTarget:NSMakeRect(0, 0, .5, 1) edge:@"left" kind:@"tab" title:@"Documentation"]);
  CHECK(NSMinX(view.labelRect) >= 100);
  CHECK(NSMaxX(view.labelRect) <= 400);
  CHECK([clip hitTest:NSMakePoint(200, 200)] == browser);
  browser.frame = NSMakeRect(-80, 0, 640, 400);
  [view placeAboveBrowser:browser frame:browser.frame];
  CHECK(NSEqualRects(view.targetRect, NSMakeRect(0, 0, 320, 400)));
  CHECK(browser.detachments == 0 && view.active);
  // The clipping container's own Y axis is unflipped; normalized targets
  // nevertheless remain measured down from the native viewport's top.
  CHECK([view updateTarget:NSMakeRect(0, 0, 1, .5) edge:@"up" kind:@"tab" title:@""]);
  CHECK(NSEqualRects(view.targetRect, NSMakeRect(0, 0, 640, 200)));
  CHECK([view updateTarget:NSMakeRect(0, .5, 1, .5) edge:@"down" kind:@"tab" title:@""]);
  CHECK(NSEqualRects(view.targetRect, NSMakeRect(0, 200, 640, 200)));
  // If CEF's host is reinserted above its sibling, only the indicator moves.
  [clip addSubview:browser positioned:NSWindowAbove relativeTo:view];
  const int before = browser.detachments;
  [view placeAboveBrowser:browser frame:browser.frame];
  CHECK(clip.subviews.lastObject == view && browser.detachments == before);
  [browser removeFromSuperview];
  [view placeAboveBrowser:browser frame:browser.frame];
  CHECK(!view.active && view.hidden && view.superview == nil);
}

static void TransferClears() {
  NSWindow *first = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,500,400)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  NSWindow *second = [[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,500,400)
      styleMask:NSWindowStyleMaskBorderless backing:NSBackingStoreBuffered defer:NO];
  first.releasedWhenClosed = second.releasedWhenClosed = NO;
  NSView *clip = [[NSView alloc] initWithFrame:NSMakeRect(0,0,500,400)];
  NSView *browser = [[NSView alloc] initWithFrame:clip.bounds];
  [first.contentView addSubview:clip];
  [clip addSubview:browser];
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc] initWithFrame:NSZeroRect];
  [view placeAboveBrowser:browser frame:browser.frame];
  CHECK([view updateTarget:NSMakeRect(0,0,1,1) edge:@"tab" kind:@"group" title:@"Group"]);
  [clip removeFromSuperview];
  [second.contentView addSubview:clip];
  CHECK(!view.active && view.hidden && view.window == second);
  CHECK([view updateTarget:NSMakeRect(0,0,1,1) edge:@"tab" kind:@"group" title:@"Group"]);
  [view clear];
  CHECK(view.hidden && !view.active);
  [first close]; [second close];
}

static void OpaqueLabelOnLightAndDarkPages() {
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc]
      initWithFrame:NSMakeRect(0, 0, 400, 300)];
  CHECK([view updateTarget:NSMakeRect(.1,.1,.8,.8) edge:@"right" kind:@"tab" title:@"Docs"]);
  for (NSColor *background in @[NSColor.whiteColor, NSColor.blackColor]) {
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
        pixelsWide:400 pixelsHigh:300 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES
        isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    [background setFill];
    NSRectFill(view.bounds);
    [view drawRect:view.bounds];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];
    NSRect card = view.labelRect;
    NSColor *pixel = [[bitmap colorAtX:(NSInteger)NSMinX(card)+4 y:(NSInteger)NSMidY(card)]
        colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    CHECK(pixel.alphaComponent > .99);
    CHECK(pixel.redComponent < .2 && pixel.greenComponent < .2 && pixel.blueComponent < .2);
  }
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    ValidationAndLabels();
    HierarchyClippingAndResize();
    TransferClears();
    OpaqueLabelOnLightAndDarkPages();
    std::puts("Browser drop indicator: 4 AppKit checks passed");
  }
  return 0;
}
