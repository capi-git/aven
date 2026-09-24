#import <Cocoa/Cocoa.h>
#include <cstdio>
#include <cstdlib>

#include "browser_host_view.h"

static int destroyed_probes = 0;

@interface SMBrowserHostProbe : NSView
@property(nonatomic) int detachments;
@property(nonatomic) int window_changes;
@property(nonatomic) int frame_updates;
@property(nonatomic) int visibility_updates;
@property(nonatomic) int resizing_updates;
@property(nonatomic, strong) NSString* page_state;
@end

@implementation SMBrowserHostProbe
- (BOOL)acceptsFirstResponder { return YES; }
- (void)setFrame:(NSRect)frame {
  ++_frame_updates;
  [super setFrame:frame];
}
- (void)setHidden:(BOOL)hidden {
  ++_visibility_updates;
  [super setHidden:hidden];
}
- (void)setAutoresizingMask:(NSAutoresizingMaskOptions)mask {
  ++_resizing_updates;
  [super setAutoresizingMask:mask];
}
- (void)viewWillMoveToSuperview:(NSView*)newSuperview {
  if (!newSuperview) ++_detachments;
  [super viewWillMoveToSuperview:newSuperview];
}
- (void)viewDidMoveToWindow {
  ++_window_changes;
  [super viewDidMoveToWindow];
}
- (void)dealloc { ++destroyed_probes; }
@end

// Controlled display transforms exercise 1x and Retina without requiring a
// particular attached monitor. Production uses NSView's backing conversion.
@interface SMBrowserPixelHost : NSView
@property(nonatomic) double display_scale;
@property(nonatomic) BOOL pixel_flipped;
@end

@implementation SMBrowserPixelHost
- (BOOL)isFlipped { return _pixel_flipped; }
- (NSRect)convertRectToBacking:(NSRect)rect {
  return NSMakeRect(rect.origin.x * _display_scale, rect.origin.y * _display_scale,
                    rect.size.width * _display_scale, rect.size.height * _display_scale);
}
- (NSRect)convertRectFromBacking:(NSRect)rect {
  return NSMakeRect(rect.origin.x / _display_scale, rect.origin.y / _display_scale,
                    rect.size.width / _display_scale, rect.size.height / _display_scale);
}
@end

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Browser host check failed at line %d: %s\n", \
                 __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

static void CheckCanonicalBackingTies() {
  SMBrowserPixelHost* host = [[SMBrowserPixelHost alloc]
      initWithFrame:NSMakeRect(0, 0, 1000, 1000)];
  host.display_scale = 2;
  // A Retina WK viewport starts 49 backing pixels below the host's top. At
  // 80% shell zoom, CSS top100.3125/height624.9375 becomes native top80.25/
  // height499.95. Relative DOM pixel edges160.5/1160.4 must align to161/1160,
  // regardless of the host's Y orientation or this nonzero WK/chrome offset.
  const double shell_zoom = .8;
  const double viewport_top = 24.5;
  const double css_top = 100.3125;
  const double css_height = 624.9375;
  const double native_top = viewport_top + css_top * shell_zoom;
  const double native_height = css_height * shell_zoom;
  for (int orientation = 0; orientation < 2; ++orientation) {
    const BOOL flipped = orientation != 0;
    host.pixel_flipped = flipped;
    const NSRect frame = NSMakeRect(10.25,
        flipped ? native_top : host.bounds.size.height - native_top - native_height,
        200.125, native_height);
    const auto aligned = supermono::AlignedBrowserHostFrames(host, frame, frame);
    const double aligned_top = flipped ? NSMinY(aligned.clip)
        : host.bounds.size.height - NSMaxY(aligned.clip);
    CHECK(std::abs((aligned_top - viewport_top) * 2 - 161) < .00001);
    CHECK(aligned.clip.size.height * 2 == 999);
    CHECK(NSEqualSizes(aligned.browser.size, aligned.clip.size));
    CHECK(NSEqualPoints(aligned.browser.origin, NSZeroPoint));

    // Cover a bottom-edge tie independently: DOM pixel edges161.4/1160.5
    // round to161/1161, so reflection cannot shrink the viewport by a pixel.
    const double other_top = viewport_top + 161.4 / 2;
    const double other_height = (1160.5 - 161.4) / 2;
    const NSRect other = NSMakeRect(-.25,
        flipped ? other_top : host.bounds.size.height - other_top - other_height,
        200.5, other_height);
    const auto bottom_tie = supermono::AlignedBrowserHostFrames(host, other, other);
    const double bottom_top = flipped ? NSMinY(bottom_tie.clip)
        : host.bounds.size.height - NSMaxY(bottom_tie.clip);
    CHECK(std::abs((bottom_top - viewport_top) * 2 - 161) < .00001);
    CHECK(bottom_tie.clip.size.height * 2 == 1000);
    // Math.round(-0.5) is zero; C++ round(-0.5) would shift the page left.
    CHECK(bottom_tie.clip.origin.x == 0);
  }
  std::puts("Browser top-down backing tie checks passed");
}

static void CheckBackingAlignment() {
  SMBrowserPixelHost* host = [[SMBrowserPixelHost alloc] initWithFrame:NSZeroRect];
  host.display_scale = 1;
  auto aligned = supermono::AlignedBrowserHostFrames(
      host, NSMakeRect(10.2, 20.6, 600.6, 400.2),
      NSMakeRect(30.7, 20.6, 550.4, 400.2));
  CHECK(NSEqualRects(aligned.clip, NSMakeRect(31, 21, 550, 400)));
  CHECK(NSEqualRects(aligned.browser, NSMakeRect(-21, 0, 601, 400)));

  host.display_scale = 2;
  aligned = supermono::AlignedBrowserHostFrames(
      host, NSMakeRect(10.3, 20.6, 600.3, 400.3),
      NSMakeRect(30.6, 20.6, 569.6, 400.3));
  CHECK(NSEqualRects(aligned.clip, NSMakeRect(30.5, 20.5, 569.5, 400.5)));
  CHECK(NSEqualRects(aligned.browser, NSMakeRect(-20, 0, 600, 400.5)));

  // Native points after an 80% shell zoom; browser page zoom stays independent.
  const NSRect full = NSMakeRect(127.5 * .8, 25.75 * .8, 801.2 * .8, 503.4 * .8);
  const NSRect clipped = NSMakeRect(full.origin.x + 40.7 * .8, full.origin.y,
      full.size.width - (40.7 + 13.2) * .8, full.size.height);
  aligned = supermono::AlignedBrowserHostFrames(host, full, clipped);
  CHECK(NSEqualRects(aligned.clip, NSMakeRect(134.5, 20.5, 598, 403)));
  CHECK(NSEqualRects(aligned.browser, NSMakeRect(-32.5, 0, 641, 403)));
  const auto unclipped = supermono::AlignedBrowserHostFrames(host, full, full);
  CHECK(unclipped.browser.origin.x == 0 && unclipped.browser.origin.y == 0);
  CHECK(NSEqualSizes(aligned.browser.size, unclipped.browser.size));
  CHECK(aligned.clip.origin.x + aligned.browser.origin.x == unclipped.clip.origin.x);

  const auto covered = supermono::AlignedBrowserHostFrames(
      host, full, NSMakeRect(NSMaxX(full), full.origin.y, 0, full.size.height));
  CHECK(covered.clip.size.width == 0);
  CHECK(NSEqualSizes(covered.browser.size, unclipped.browser.size));
  CHECK(covered.clip.origin.x + covered.browser.origin.x == unclipped.clip.origin.x);

  // Returning to a 1x monitor recalculates its grid, not a cached 2x scale.
  host.display_scale = 1;
  aligned = supermono::AlignedBrowserHostFrames(host, full, clipped);
  CHECK(NSEqualRects(aligned.clip, NSMakeRect(135, 21, 597, 402)));
  CHECK(NSEqualRects(aligned.browser, NSMakeRect(-33, 0, 641, 402)));
  std::puts("Browser backing-pixel alignment checks passed");
}

static bool Contains(CGPathRef path, double x, double y) {
  return CGPathContainsPoint(path, nullptr, CGPointMake(x, y), false);
}

static void CheckBottomCornerClipping() {
  for (const bool flipped : {false, true}) {
    CGPathRef path = supermono::CreateBrowserBottomCornerPath(
        NSMakeRect(0, 0, 600, 400), 8, flipped);
    const double bottom = flipped ? 399.5 : .5;
    const double top = flipped ? .5 : 399.5;
    CHECK(!Contains(path, .5, bottom) && !Contains(path, 599.5, bottom));
    CHECK(Contains(path, .5, top) && Contains(path, 599.5, top));
    CHECK(Contains(path, 8, bottom) && Contains(path, 592, bottom));
    CHECK(Contains(path, 300, 200));
    CGPathRelease(path);

    // Sidebars crop the full page. The newly exposed edge must stay square,
    // and the page's viewport/origin must remain exactly where it was.
    path = supermono::CreateBrowserBottomCornerPath(
        NSMakeRect(-40, 0, 600, 400), 8, flipped);
    CHECK(Contains(path, .5, bottom));
    CHECK(Contains(path, 539.5, bottom));
    CHECK(!Contains(path, 559.5, bottom));
    CGPathRelease(path);
  }
  CGPathRef square = supermono::CreateBrowserBottomCornerPath(
      NSMakeRect(0, 0, 100, 40), 0, false);
  CHECK(Contains(square, .5, .5));
  CGPathRelease(square);
  CGPathRef clamped = supermono::CreateBrowserBottomCornerPath(
      NSMakeRect(0, 0, 100, 40), 200, false);
  CHECK(Contains(clamped, 50, .5));
  CHECK(!Contains(clamped, .5, .5));
  CGPathRelease(clamped);

  SMBrowserPixelHost* clip = [[SMBrowserPixelHost alloc]
      initWithFrame:NSMakeRect(0, 0, 540, 400)];
  NSView* browser = [[NSView alloc] initWithFrame:NSMakeRect(-40, 0, 600, 400)];
  [clip addSubview:browser];
  const NSRect original = browser.frame;
  supermono::BrowserCornerMaskState previous;
  CHECK(supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 8, previous));
  CAShapeLayer* mask = (CAShapeLayer*)clip.layer.mask;
  CGPathRef original_path = CGPathRetain(mask.path);
  for (int i = 0; i < 100; ++i) {
    CHECK(!supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 8, previous));
    CHECK(mask.path == original_path);
  }
  CGPathRelease(original_path);
  CHECK(mask && NSEqualRects(mask.frame, clip.bounds));
  CHECK(CGRectEqualToRect(CGPathGetPathBoundingBox(mask.path), NSRectToCGRect(original)));
  CHECK(Contains(mask.path, .5, .5));
  CHECK(NSEqualRects(browser.frame, original) && browser.superview == clip);
  clip.frame = NSMakeRect(0, 0, 400, 300);
  browser.frame = NSMakeRect(-40, 0, 450, 300);
  CHECK(supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 6.4, previous));
  CHECK(clip.layer.mask == mask && NSEqualRects(mask.frame, clip.bounds));
  CHECK(!Contains(mask.path, 409.5, .5));
  CHECK(Contains(mask.path, 409.5, 299.5));
  // A replacement mask must not be mistaken for the cached one.
  clip.layer.mask = [CAShapeLayer layer];
  CHECK(supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 6.4, previous));
  CHECK(CGRectEqualToRect(CGPathGetPathBoundingBox(((CAShapeLayer*)clip.layer.mask).path),
                         NSRectToCGRect(browser.frame)));
  // Weak cache references become nil when a layer is discarded. A missing
  // positive-radius mask must still be rebuilt, even with unchanged geometry.
  clip.layer.mask = nil;
  CHECK(supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 6.4, previous));
  CHECK(clip.layer.mask != nil);
  CHECK(supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 0, previous));
  CHECK(clip.layer.mask == nil);
  CHECK(!supermono::ApplyBrowserBottomCornerMask(clip, browser.frame, 0, previous));
  CHECK(browser.superview == clip);
  std::puts("Browser bottom-corner clipping checks passed");
}

static void CheckRepeatedBrowserLayout() {
  NSWindow* window = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 640, 480)
                styleMask:NSWindowStyleMaskTitled
                  backing:NSBackingStoreBuffered defer:NO];
  SMBrowserHostProbe* clip = [[SMBrowserHostProbe alloc] initWithFrame:NSZeroRect];
  SMBrowserHostProbe* browser = [[SMBrowserHostProbe alloc] initWithFrame:NSZeroRect];
  [window.contentView addSubview:clip];
  [clip addSubview:browser];
  browser.page_state = @"Retained document, media and agent context";
  const supermono::BrowserHostFrames frames = {
      NSMakeRect(0, 0, 640, 480), NSMakeRect(0, 0, 640, 480)};
  CHECK(supermono::ApplyBrowserHostFrames(clip, browser, frames, false));
  supermono::ApplyBrowserHostVisibility(clip, browser, true);
  clip.frame_updates = browser.frame_updates = 0;
  clip.visibility_updates = browser.visibility_updates = 0;
  clip.resizing_updates = browser.resizing_updates = 0;
  const int moves = browser.window_changes;
  const int detachments = browser.detachments;
  for (int i = 0; i < 100; ++i) {
    CHECK(!supermono::ApplyBrowserHostFrames(clip, browser, frames, false));
    supermono::ApplyBrowserHostVisibility(clip, browser, true);
  }
  CHECK(clip.frame_updates == 0 && browser.frame_updates == 0);
  CHECK(clip.visibility_updates == 0 && browser.visibility_updates == 0);
  CHECK(clip.resizing_updates == 0 && browser.resizing_updates == 0);
  supermono::ApplyBrowserHostVisibility(clip, browser, false);
  CHECK(clip.hidden && browser.hidden && browser.hiddenOrHasHiddenAncestor);
  CHECK(clip.visibility_updates == 1 && browser.visibility_updates == 1);
  for (int i = 0; i < 100; ++i) {
    CHECK(!supermono::ApplyBrowserHostFrames(clip, browser, frames, false));
    supermono::ApplyBrowserHostVisibility(clip, browser, false);
  }
  CHECK(clip.frame_updates == 0 && browser.frame_updates == 0);
  CHECK(clip.visibility_updates == 1 && browser.visibility_updates == 1);
  supermono::ApplyBrowserHostVisibility(clip, browser, true);
  CHECK(!clip.hidden && !browser.hidden && !browser.hiddenOrHasHiddenAncestor);
  CHECK(browser.window == window && browser.window_changes == moves);
  CHECK(browser.detachments == detachments);
  CHECK([browser.page_state isEqualToString:@"Retained document, media and agent context"]);

  // PiP/autoresize still follows its window. Returning to a docked viewport
  // disables autoresize before changing the clip and restores exact bounds.
  CHECK(!supermono::ApplyBrowserHostFrames(clip, browser, frames, true));
  CHECK(browser.autoresizingMask == (NSViewWidthSizable | NSViewHeightSizable));
  const supermono::BrowserHostFrames docked = {
      NSMakeRect(40, 20, 460, 300), NSMakeRect(-40, 0, 540, 300)};
  CHECK(supermono::ApplyBrowserHostFrames(clip, browser, docked, false));
  CHECK(NSEqualRects(clip.frame, docked.clip) && NSEqualRects(browser.frame, docked.browser));
  CHECK(clip.autoresizingMask == NSViewNotSizable && browser.autoresizingMask == NSViewNotSizable);
  CHECK(browser.window == window && browser.detachments == detachments);
  CHECK(!window.visible);
  std::puts("Repeated browser layouts preserve state without native mutations");
}

static void CheckHiddenBrowserFocus() {
  NSWindow* window = [[NSWindow alloc]
      initWithContentRect:NSMakeRect(0, 0, 640, 480)
                styleMask:NSWindowStyleMaskTitled
                  backing:NSBackingStoreBuffered defer:NO];
  NSView* parent = window.contentView;
  NSView* clip = [[NSView alloc] initWithFrame:parent.bounds];
  SMBrowserHostProbe* browser = [[SMBrowserHostProbe alloc] initWithFrame:clip.bounds];
  SMBrowserHostProbe* input = [[SMBrowserHostProbe alloc] initWithFrame:browser.bounds];
  SMBrowserHostProbe* workspace = [[SMBrowserHostProbe alloc] initWithFrame:parent.bounds];
  SMBrowserHostProbe* other = [[SMBrowserHostProbe alloc] initWithFrame:parent.bounds];
  [parent addSubview:workspace];
  [parent addSubview:clip];
  [clip addSubview:browser];
  [browser addSubview:input];
  [parent addSubview:other];
  CHECK([window makeFirstResponder:input]);
  CHECK(supermono::ReturnHiddenBrowserFocus(clip, workspace));
  CHECK(window.firstResponder == workspace);
  CHECK(!supermono::ReturnHiddenBrowserFocus(clip, workspace));
  CHECK([window makeFirstResponder:other]);
  CHECK(!supermono::ReturnHiddenBrowserFocus(clip, workspace));
  CHECK(window.firstResponder == other);
  CHECK([window makeFirstResponder:input]);
  workspace.hidden = YES;
  CHECK(!supermono::ReturnHiddenBrowserFocus(clip, workspace));
  CHECK(window.firstResponder == input);
  workspace.hidden = NO;
  CHECK(!supermono::ReturnHiddenBrowserFocus(clip, nil));
  CHECK(window.firstResponder == input);
  CHECK(!window.visible);
  std::puts("Hidden browser responder checks passed");
}

int main() {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    CheckBackingAlignment();
    CheckCanonicalBackingTies();
    CheckBottomCornerClipping();
    CheckRepeatedBrowserLayout();
    CheckHiddenBrowserFocus();
    destroyed_probes = 0;
    NSWindow* owner = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 640, 480)
                  styleMask:NSWindowStyleMaskTitled
                    backing:NSBackingStoreBuffered defer:NO];
    NSWindow* destination = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 480, 360)
                  styleMask:NSWindowStyleMaskTitled
                    backing:NSBackingStoreBuffered defer:NO];
    // Both windows stay hidden; this checks AppKit hosting without opening CEF.
    NSView* source = owner.contentView;
    NSView* target = destination.contentView;
    NSView* clip = [[NSView alloc] initWithFrame:source.bounds];
    [source addSubview:clip];
    SMBrowserHostProbe* browser = [[SMBrowserHostProbe alloc] initWithFrame:clip.bounds];
    browser.page_state = @"Typed text and click count survive";
    SMBrowserHostProbe* descendant = [[SMBrowserHostProbe alloc] initWithFrame:browser.bounds];
    [browser addSubview:descendant];
    [clip addSubview:browser];
    __weak SMBrowserHostProbe* page = browser;
    browser = nil;
    const int original_moves = page.window_changes;
    const int original_descendant_moves = descendant.window_changes;

    supermono::EnsureBrowserHost(target, clip, page, nil);
    CHECK(page && destroyed_probes == 0);
    CHECK(clip.superview == target && page.superview == clip);
    CHECK(page.window == destination && descendant.window == destination);
    CHECK(page.window_changes > original_moves);
    CHECK(descendant.window_changes > original_descendant_moves);
    CHECK([page.page_state isEqualToString:@"Typed text and click count survive"]);

    const int stable_moves = page.window_changes;
    const int stable_detachments = page.detachments;
    for (int i = 0; i < 3; ++i) {
      clip.frame = NSMakeRect(10, 15, 300 + i * 20, 220);
      supermono::EnsureBrowserHost(target, clip, page, nil);
    }
    CHECK(page.window_changes == stable_moves && page.detachments == stable_detachments);

    // Simulate WK finishing its host insertion after a browser transferred.
    NSView* workspace_container = [[NSView alloc] initWithFrame:target.bounds];
    NSView* workspace = [[NSView alloc] initWithFrame:workspace_container.bounds];
    [workspace_container addSubview:workspace];
    [target addSubview:workspace_container];
    CHECK(target.subviews.lastObject == workspace_container);
    supermono::EnsureBrowserHost(target, clip, page, workspace);
    CHECK(target.subviews.lastObject == clip);
    CHECK(page.superview == clip && page.window == destination);
    CHECK(page.detachments == stable_detachments);
    const int settled_moves = page.window_changes;
    supermono::EnsureBrowserHost(target, clip, page, workspace);
    CHECK(page.window_changes == settled_moves && page.detachments == stable_detachments);

    supermono::EnsureBrowserHost(source, clip, page, nil);
    CHECK(page && page.window == owner && descendant.window == owner);
    CHECK(page.window_changes > settled_moves && destroyed_probes == 0);
    CHECK([page.page_state isEqualToString:@"Typed text and click count survive"]);
    CHECK(!owner.visible && !destination.visible);
    std::puts("Browser host reparent checks passed");
  }
  return 0;
}
