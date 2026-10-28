#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
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

@interface SMDropPaintProbe : SMBrowserDropIndicator
@property(nonatomic) int displayRequests;
@end
@implementation SMDropPaintProbe
- (void)setNeedsDisplay:(BOOL)value {
  if (value) ++_displayRequests;
  [super setNeedsDisplay:value];
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

static void GreyOutlineOnLightAndDarkPages() {
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc]
      initWithFrame:NSMakeRect(0, 0, 400, 300)];
  view.animates = NO;
  CHECK([view updateTarget:NSMakeRect(.1,.1,.8,.8) edge:@"right" kind:@"tab" title:@"Docs"]);
  for (NSColor *background in @[NSColor.whiteColor, NSColor.blackColor]) {
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
        pixelsWide:800 pixelsHigh:600 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES
        isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    bitmap = [bitmap bitmapImageRepByConvertingToColorSpace:NSColorSpace.sRGBColorSpace
        renderingIntent:NSColorRenderingIntentDefault];
    NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:context];
    CGContextScaleCTM(context.CGContext, 2, 2);
    [background setFill];
    NSRectFill(view.bounds);
    [view.layer renderInContext:context.CGContext];
    [context flushGraphics];
    [NSGraphicsContext restoreGraphicsState];
    const CGFloat base = [background colorUsingColorSpace:NSColorSpace.sRGBColorSpace].redComponent;
    // The edge runs along the target's own left edge, as the HTML preview's
    // border does: no inset of its own.
    NSRect outline = view.targetRect;
    NSColor *edge = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline)) y:(NSInteger)(2 * NSMidY(outline))]
        colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    CHECK(std::fabs(edge.redComponent - base) > .2);
    CHECK(std::fabs(edge.redComponent - edge.greenComponent) < .02 &&
        std::fabs(edge.greenComponent - edge.blueComponent) < .02);
    // No label card: the middle is the page with only a faint grey wash.
    NSColor *middle = [[bitmap colorAtX:400 y:300]
        colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
    CHECK(std::fabs(middle.redComponent - base) < .1);
  }
}

static void ThemedFeedbackAndPaletteValidation() {
  SMDropPaintProbe *view = [[SMDropPaintProbe alloc]
      initWithFrame:NSMakeRect(0, 0, 400, 300)];
  view.animates = NO;
  const NSRect target = NSMakeRect(.1,.1,.8,.8);
  const SMBrowserDropPalette palettes[] = {
    {{.84,.86,.9,.55}, {.65,.7,.8,.06}, {.04,.05,.07,.9}}, // Dark workspace
    {{.16,.2,.28,.55}, {.15,.2,.3,.06}, {.97,.98,1,.9}},  // Light workspace
    {{.2,.7,.4,.55}, {.1,.7,.3,.06}, {.025,.06,.035,.9}}, // Custom green
  };
  for (const auto& palette : palettes) {
    CHECK([view updateTarget:target edge:@"tab" kind:@"tab" title:@"Docs" palette:&palette]);
    const int unchangedRequests = view.displayRequests;
    CHECK([view updateTarget:target edge:@"tab" kind:@"tab" title:@"Docs" palette:&palette]);
    CHECK(view.displayRequests == unchangedRequests);
    for (NSColor *background in @[NSColor.whiteColor, NSColor.blackColor]) {
      NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
          pixelsWide:800 pixelsHigh:600 bitsPerSample:8 samplesPerPixel:4 hasAlpha:YES
          isPlanar:NO colorSpaceName:NSCalibratedRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
      bitmap = [bitmap bitmapImageRepByConvertingToColorSpace:NSColorSpace.sRGBColorSpace
          renderingIntent:NSColorRenderingIntentDefault];
      NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
      [NSGraphicsContext saveGraphicsState];
      [NSGraphicsContext setCurrentContext:context];
      CGContextScaleCTM(context.CGContext, 2, 2);
      [background setFill]; NSRectFill(view.bounds);
      [view.layer renderInContext:context.CGContext];
      // Reference swatches use the same bitmap color space and source-over
      // compositing as AppKit; generic-RGB contexts do not blend in sRGB math.
      const auto swatch = [&](double x, std::initializer_list<const double *> colors) {
        const NSRect rect = NSMakeRect(x, 145, 4, 10);
        for (const double *color : colors) {
          [[NSColor colorWithSRGBRed:color[0] green:color[1] blue:color[2] alpha:color[3]] setFill];
          NSRectFillUsingOperation(rect, NSCompositingOperationSourceOver);
        }
      };
      // The wash; the outline alone outside the box; the edge over the wash.
      swatch(5, {palette.fill}); swatch(15, {palette.halo});
      swatch(25, {palette.fill, palette.stroke});
      [context flushGraphics];
      [NSGraphicsContext restoreGraphicsState];
      NSRect outline = view.targetRect;
      NSColor *edge = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline)) y:(NSInteger)(2 * NSMidY(outline))]
          colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      const CGFloat base = [background colorUsingColorSpace:NSColorSpace.sRGBColorSpace].redComponent;
      NSColor *fill = [[bitmap colorAtX:12 y:300] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      NSColor *halo = [[bitmap colorAtX:32 y:300] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      NSColor *stroke = [[bitmap colorAtX:52 y:300] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(edge.redComponent - stroke.redComponent) < .03);
      CHECK(std::fabs(edge.greenComponent - stroke.greenComponent) < .03);
      CHECK(std::fabs(edge.blueComponent - stroke.blueComponent) < .03);
      NSColor *middle = [[bitmap colorAtX:400 y:300] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(middle.redComponent - fill.redComponent) < .03);
      CHECK(std::fabs(middle.greenComponent - fill.greenComponent) < .03);
      CHECK(std::fabs(middle.blueComponent - fill.blueComponent) < .03);
      // At 2x scale, the 1px edge is two pixels inside the box, the 0.5px
      // outline the one pixel outside it, and the page shows beyond that.
      NSColor *innerEdge = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline) + 1)
          y:(NSInteger)(2 * NSMidY(outline))] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(innerEdge.redComponent - stroke.redComponent) < .03);
      NSColor *inside = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline) + 3)
          y:(NSInteger)(2 * NSMidY(outline))] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(inside.redComponent - fill.redComponent) < .03);
      NSColor *insideHalo = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline) - 1)
          y:(NSInteger)(2 * NSMidY(outline))] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(insideHalo.redComponent - halo.redComponent) < .03);
      CHECK(std::fabs(insideHalo.greenComponent - halo.greenComponent) < .03);
      CHECK(std::fabs(insideHalo.blueComponent - halo.blueComponent) < .03);
      NSColor *outside = [[bitmap colorAtX:(NSInteger)(2 * NSMinX(outline) - 3)
          y:(NSInteger)(2 * NSMidY(outline))] colorUsingColorSpace:NSColorSpace.sRGBColorSpace];
      CHECK(std::fabs(outside.redComponent - base) < .01);
      CHECK(std::fabs(outside.greenComponent - base) < .01);
      CHECK(std::fabs(outside.blueComponent - base) < .01);
    }
  }
  const int previousRequests = view.displayRequests;
  CHECK([view updateTarget:target edge:@"tab" kind:@"tab" title:@"Docs" palette:&palettes[0]]);
  CHECK(view.displayRequests > previousRequests); // Palette-only changes repaint.
  const double invalid[] = {-0.001, 1.001, std::numeric_limits<double>::quiet_NaN(),
      std::numeric_limits<double>::infinity()};
  for (int member=0; member<3; ++member) for (int channel=0; channel<4; ++channel)
    for (double value : invalid) {
      auto palette = palettes[0];
      double *color = member==0 ? palette.stroke : member==1 ? palette.fill : palette.halo;
      color[channel]=value;
      CHECK(![view updateTarget:target edge:@"tab" kind:@"tab" title:@"Docs" palette:&palette]);
    }
  // An older caller resets the palette to the supported neutral fallback.
  CHECK([view updateTarget:target edge:@"tab" kind:@"tab" title:@"Docs"]);
}

static void ShapeMotionAndFade() {
  SMBrowserDropIndicator *view = [[SMBrowserDropIndicator alloc]
      initWithFrame:NSMakeRect(0, 0, 400, 300)];
  // The HTML preview's 6px corner at 100%, and at 80% interface zoom.
  CHECK([view updateTarget:NSMakeRect(.5, 0, .5, 1) edge:@"right" kind:@"tab" title:@""]);
  CHECK(std::fabs(view.cornerRadius - 6) < 1e-9 && std::fabs(view.edgeWidth - 1) < 1e-9);
  const SMBrowserDropShape small = {6, .8};
  CHECK([view updateTarget:NSMakeRect(.5, 0, .5, 1) edge:@"right" kind:@"tab" title:@""
      palette:nullptr shape:&small]);
  CHECK(std::fabs(view.cornerRadius - 4.8) < 1e-9 && std::fabs(view.edgeWidth - .8) < 1e-9);
  for (const SMBrowserDropShape bad : {SMBrowserDropShape{-1, 1}, SMBrowserDropShape{65, 1},
      SMBrowserDropShape{6, .4}, SMBrowserDropShape{6, 2.1},
      SMBrowserDropShape{std::numeric_limits<double>::quiet_NaN(), 1}})
    CHECK(![view updateTarget:NSMakeRect(.5, 0, .5, 1) edge:@"right" kind:@"tab" title:@""
        palette:nullptr shape:&bad]);
  // In from its side: fading in and growing about its right edge.
  [view clear];
  CHECK([view updateTarget:NSMakeRect(.5, 0, .5, 1) edge:@"right" kind:@"tab" title:@""]);
  CALayer *preview = view.layer.sublayers.firstObject;
  CHECK([preview animationForKey:@"fade"] && [preview animationForKey:@"grow"]);
  CALayer *box = preview.sublayers.lastObject;
  // Top-left, as the view: the right half's box is in its right half.
  CHECK(std::fabs(box.position.x - 300) < 1e-9 && std::fabs(box.position.y - 150) < 1e-9);
  CHECK(![box animationForKey:@"glide-position"]);
  // To another zone it glides on a spring from where it is drawn.
  CHECK([view updateTarget:NSMakeRect(0, 0, 1, .5) edge:@"up" kind:@"tab" title:@""]);
  CASpringAnimation *glide = (CASpringAnimation *)[box animationForKey:@"glide-position"];
  CHECK([glide isKindOfClass:CASpringAnimation.class]);
  // TAB_SPRING.move: 0.22 s response, critically damped.
  const double omega = 2 * M_PI / .22;
  CHECK(std::fabs(glide.stiffness - omega * omega) < 1e-6);
  CHECK(std::fabs(glide.damping - 2 * omega) < 1e-6);
  CHECK(std::fabs(box.position.x - 200) < 1e-9 && std::fabs(box.position.y - 75) < 1e-9);
  // The drag leaves: it fades where it is and is no longer a target.
  [view fadeOut];
  CHECK(!view.active && !view.hidden && preview.opacity == 0);
  CHECK([preview animationForKey:@"fade"]);
  // Off, it is at once in place, with nothing animating.
  view.animates = NO;
  [view clear];
  CHECK(view.hidden && !view.active);
  CHECK([view updateTarget:NSMakeRect(0, 0, 1, .5) edge:@"up" kind:@"tab" title:@""]);
  CHECK(!preview.animationKeys.count && preview.opacity == 1);
  [view fadeOut];
  CHECK(view.hidden && !view.active);
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    ValidationAndLabels();
    HierarchyClippingAndResize();
    TransferClears();
    GreyOutlineOnLightAndDarkPages();
    ThemedFeedbackAndPaletteValidation();
    ShapeMotionAndFade();
    std::puts("Browser drop indicator: 6 AppKit checks passed");
  }
  return 0;
}
