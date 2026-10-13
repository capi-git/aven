#pragma once
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>
#include <vector>

// Where the pointer is relative to the live page. The workspace webview
// beneath sees nothing while the pointer is over the page.
typedef NS_ENUM(NSInteger, SMBrowserPointerRegion) {
  // Off the page: workspace content beside it, a menu cut out of it, or
  // outside the window.
  SMBrowserPointerRegionAway = 0,
  SMBrowserPointerRegionPage,
  // On the page within the workspace's hover edge, where a hidden sidebar
  // peeks out.
  SMBrowserPointerRegionEdge,
};

// The clipping host of a live browser. In-app menus drawn by the workspace
// webview beneath it are cut out of the page's mask; pointer events in those
// cut-outs must reach that webview rather than the page.
@interface SMBrowserClipView : NSView
// Cut-outs in this view's coordinates, or NULL. The view retains the path.
- (void)setHolePath:(CGPathRef)path;
- (BOOL)holeContainsPoint:(NSPoint)point;
// Called whenever the pointer moves between regions, including onto the page
// while a slide uncovers it. A hover panel beside the page would otherwise
// stay open, and the hover edge under the page would never reveal it.
@property(nonatomic, copy) void (^pointerRegionChanged)(SMBrowserPointerRegion region);
// The workspace's hover edge over this page, in this view's coordinates, or
// empty. The page keeps its clicks there; only resting the pointer counts.
@property(nonatomic) NSRect hoverEdge;
// Slides the page's visible leading edge, in this view's coordinates, on the
// same springs as the workspace hover sidebar (--aven-peek-in/out in
// personal-shell.css). The caller keeps the uncropped frame meanwhile and
// applies its final crop in `completion`, which a cancelled slide never runs.
// `start` is the CACurrentMediaTime() at which the sidebar's own slide
// begins, or 0 for now; a past start catches up. `duration` is that slide's
// length, or 0 for the CSS default; a shortened (reversed) slide plays the
// same spring faster.
- (void)slideLeadingEdgeFrom:(CGFloat)from
                          to:(CGFloat)to
                  startingAt:(CFTimeInterval)start
                    duration:(CFTimeInterval)duration
                  completion:(void (^)(void))completion;
- (void)cancelLeadingEdgeSlide;
@property(nonatomic, readonly) BOOL slidingLeadingEdge;
@property(nonatomic, readonly) CGFloat slideTarget;
// Where the page currently starts on screen during a slide, else 0.
@property(nonatomic, readonly) CGFloat visibleLeadingEdge;
@end

@implementation SMBrowserClipView {
  CGPathRef _holes;
  NSTrackingArea* _tracking;
  CALayer* _slideMask;
  NSUInteger _slideToken;
  CGFloat _slideTarget;
  SMBrowserPointerRegion _pointerRegion;
}
- (BOOL)slidingLeadingEdge {
  return _slideMask != nil;
}
- (CGFloat)slideTarget {
  return _slideTarget;
}
- (CGFloat)visibleLeadingEdge {
  if (!_slideMask) return 0;
  CALayer* shown = _slideMask.presentationLayer ?: _slideMask;
  return shown.position.x;
}
- (void)slideLeadingEdgeFrom:(CGFloat)from
                          to:(CGFloat)to
                  startingAt:(CFTimeInterval)start
                    duration:(CFTimeInterval)duration
                  completion:(void (^)(void))completion {
  [self cancelLeadingEdgeSlide];
  self.wantsLayer = YES;
  const BOOL opening = to > from;
  const CGSize size = self.layer.bounds.size;
  CALayer* mask = [CALayer layer];
  CASpringAnimation* spring =
      [CASpringAnimation animationWithKeyPath:@"position.x"];
  const double response = opening ? 0.3 : 0.2;
  const double damping = opening ? 0.88 : 1.0;
  spring.mass = 1;
  spring.stiffness = std::pow(2 * M_PI / response, 2);
  spring.damping = 4 * M_PI * damping / response;
  spring.fromValue = @(from);
  spring.toValue = @(to);
  // The CSS curves are sampled over these durations.
  spring.duration = opening ? 0.37 : 0.24;
  if (std::isfinite(duration) && duration > 0)
    spring.speed = std::clamp(spring.duration / duration, 0.25, 8.0);
  if (std::isfinite(start) && start > 0) {
    spring.beginTime = [self.layer convertTime:start fromLayer:nil];
    // Hold the starting edge until then; the model value is the final one.
    spring.fillMode = kCAFillModeBackwards;
  }
  _slideMask = mask;
  _slideTarget = to;
  const NSUInteger token = ++_slideToken;
  __weak SMBrowserClipView* weak = self;
  void (^done)(void) = [completion copy];
  // Install the mask, its final value and the animation in one transaction.
  // Committing the mask first would render its end position for a frame.
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  [CATransaction setCompletionBlock:^{
    SMBrowserClipView* view = weak;
    if (!view || view->_slideToken != token) return;
    // Lift the mask and apply the final crop in one commit, or the uncropped
    // page covers the panel for a frame.
    [CATransaction begin];
    [CATransaction setDisableActions:YES];
    [view cancelLeadingEdgeSlide];
    if (done) done();
    [CATransaction commit];
  }];
  mask.backgroundColor = NSColor.blackColor.CGColor;
  mask.anchorPoint = CGPointZero;
  // The slide can start or finish left of this page's origin when the page
  // sits in a split pane. Keep the mask past its right edge throughout, or
  // moving the leading edge left also blanks the page's trailing strip.
  const CGFloat trailing = std::max<CGFloat>(0, -std::min(from, to));
  mask.bounds = CGRectMake(0, 0, size.width + trailing, size.height);
  mask.position = CGPointMake(to, 0);
  [mask addAnimation:spring forKey:@"slide"];
  self.layer.mask = mask;
  [CATransaction commit];
}
- (void)cancelLeadingEdgeSlide {
  ++_slideToken;
  if (!_slideMask) return;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (self.layer.mask == _slideMask) self.layer.mask = nil;
  [CATransaction commit];
  _slideMask = nil;
}
- (void)updateTrackingAreas {
  [super updateTrackingAreas];
  if (_tracking) [self removeTrackingArea:_tracking];
  // Moves too: the region under the pointer changes within this view when it
  // crosses the hover edge or a sliding leading edge. Only changes report.
  _tracking = [[NSTrackingArea alloc]
      initWithRect:NSZeroRect
           options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved |
                   NSTrackingActiveAlways | NSTrackingInVisibleRect
             owner:self
          userInfo:nil];
  [self addTrackingArea:_tracking];
}
- (SMBrowserPointerRegion)pointerRegionAt:(NSPoint)point {
  // A menu cut out of the page, or the part a slide has not uncovered, still
  // belongs to the workspace webview.
  if (!NSPointInRect(point, self.bounds) || [self holeContainsPoint:point] ||
      point.x < [self visibleLeadingEdge])
    return SMBrowserPointerRegionAway;
  return NSPointInRect(point, _hoverEdge) ? SMBrowserPointerRegionEdge
                                          : SMBrowserPointerRegionPage;
}
- (void)reportPointerRegion:(SMBrowserPointerRegion)region {
  if (region == _pointerRegion) return;
  _pointerRegion = region;
  if (self.pointerRegionChanged) self.pointerRegionChanged(region);
}
- (void)reportPointer:(NSEvent*)event {
  [self reportPointerRegion:[self pointerRegionAt:[self convertPoint:event.locationInWindow
                                                             fromView:nil]]];
}
- (void)mouseEntered:(NSEvent*)event {
  [self reportPointer:event];
}
- (void)mouseMoved:(NSEvent*)event {
  [self reportPointer:event];
}
- (void)mouseExited:(NSEvent*)event {
  [self reportPointerRegion:SMBrowserPointerRegionAway];
}
// A hidden or detached page no longer holds the pointer.
- (void)viewDidHide {
  [super viewDidHide];
  [self reportPointerRegion:SMBrowserPointerRegionAway];
}
- (void)viewDidMoveToWindow {
  [super viewDidMoveToWindow];
  if (!self.window) [self reportPointerRegion:SMBrowserPointerRegionAway];
}
- (void)dealloc {
  if (_holes) CGPathRelease(_holes);
}
- (void)setHolePath:(CGPathRef)path {
  if (path == _holes) return;
  if (_holes) CGPathRelease(_holes);
  _holes = path ? CGPathRetain(path) : nullptr;
}
- (BOOL)holeContainsPoint:(NSPoint)point {
  return _holes && CGPathContainsPoint(_holes, nullptr, NSPointToCGPoint(point), false);
}
- (NSView*)hitTest:(NSPoint)point {
  // AppKit passes the point in the superview's coordinate system. Returning
  // nil lets the window continue to the workspace webview under the menu.
  if (self.superview) {
    const NSPoint local = [self convertPoint:point fromView:self.superview];
    if ((_holes && [self holeContainsPoint:local]) ||
        local.x < [self visibleLeadingEdge])
      return nil;
  }
  return [super hitTest:point];
}
@end

namespace supermono {

// A rounded cut-out in native points, relative to the page's top-left corner.
struct BrowserHole {
  double x = 0, y = 0, width = 0, height = 0, radius = 0;
  bool operator==(const BrowserHole&) const = default;
};

struct BrowserHostFrames {
  NSRect clip;
  NSRect browser;
};

// Native layout arrives from several shell observers. Avoid telling Chromium
// that its viewport changed when those observers report the same rectangles.
// Keep autoresizing disabled while changing the clip, so a live PiP return
// does not transiently resize the document before its final frame is applied.
inline bool ApplyBrowserHostFrames(NSView* clip, NSView* browser,
                                  const BrowserHostFrames& frames,
                                  bool auto_resize) {
  const bool clip_changed = !NSEqualRects(clip.frame, frames.clip);
  const bool browser_changed = !NSEqualRects(browser.frame, frames.browser);
  if ((clip_changed || browser_changed) &&
      browser.autoresizingMask != NSViewNotSizable)
    browser.autoresizingMask = NSViewNotSizable;
  if (clip_changed) clip.frame = frames.clip;
  if (!NSEqualRects(browser.frame, frames.browser)) browser.frame = frames.browser;
  const NSAutoresizingMaskOptions resizing = auto_resize
      ? NSViewWidthSizable | NSViewHeightSizable : NSViewNotSizable;
  if (clip.autoresizingMask != resizing) clip.autoresizingMask = resizing;
  if (browser.autoresizingMask != resizing) browser.autoresizingMask = resizing;
  return clip_changed || browser_changed;
}

inline void ApplyBrowserHostVisibility(NSView* clip, NSView* browser,
                                       bool visible) {
  // WebContentsViewCocoa forwards AppKit hide/unhide to Chromium's normal page
  // visibility lifecycle. Preserve it rather than using windowless WasHidden,
  // freezing JavaScript, or detaching the loaded browser from its window.
  const BOOL hidden = !visible;
  if (clip.hidden != hidden) clip.hidden = hidden;
  if (browser.hidden != hidden) browser.hidden = hidden;
}

struct BrowserCornerMaskState {
  __weak NSView* clip = nil;
  __weak CALayer* mask = nil;
  NSRect bounds = NSZeroRect;
  NSRect browser_frame = NSZeroRect;
  double radius = -1;
  double scale = 0;
  bool flipped = false;
  std::vector<BrowserHole> holes;
};

// Round only the document's bottom corners; its top edge meets the HTML
// toolbar. The path follows the full page within the clipping host, so a hover
// sidebar crops an existing curve rather than creating a new rounded edge.
inline CGPathRef CreateBrowserBottomCornerPath(NSRect frame, double radius,
                                               bool flipped) {
  CGMutablePathRef path = CGPathCreateMutable();
  const double r = std::isfinite(radius)
      ? std::clamp(radius, 0.0, std::max(0.0, std::min(frame.size.width, frame.size.height) / 2))
      : 0;
  const double left = NSMinX(frame), right = NSMaxX(frame);
  const double bottom = NSMinY(frame), top = NSMaxY(frame);
  if (r <= 0) {
    CGPathAddRect(path, nullptr, NSRectToCGRect(frame));
    return path;
  }
  CGPathMoveToPoint(path, nullptr, left, top);
  CGPathAddLineToPoint(path, nullptr, right, top);
  CGPathAddLineToPoint(path, nullptr, right, bottom + r);
  CGPathAddArcToPoint(path, nullptr, right, bottom, right - r, bottom, r);
  CGPathAddLineToPoint(path, nullptr, left + r, bottom);
  CGPathAddArcToPoint(path, nullptr, left, bottom, left, bottom + r, r);
  CGPathCloseSubpath(path);
  if (!flipped) return path;
  const CGAffineTransform reflect = CGAffineTransformMake(1, 0, 0, -1, 0, bottom + top);
  CGPathRef reflected = CGPathCreateCopyByTransformingPath(path, &reflect);
  CGPathRelease(path);
  return reflected;
}

// A rectangle given relative to the page's top-left corner, in the clipping
// host's coordinates. The page's top edge is the browser frame's top edge in
// either AppKit orientation. Empty for a missing or invalid rectangle.
inline NSRect BrowserPageRect(NSRect browser_frame, const BrowserHole& rect,
                              bool flipped) {
  if (!std::isfinite(rect.x) || !std::isfinite(rect.y) ||
      !std::isfinite(rect.width) || !std::isfinite(rect.height) ||
      rect.width <= 0 || rect.height <= 0) return NSZeroRect;
  const double y = flipped ? NSMinY(browser_frame) + rect.y
                           : NSMaxY(browser_frame) - rect.y - rect.height;
  return NSMakeRect(NSMinX(browser_frame) + rect.x, y, rect.width, rect.height);
}

// Menu cut-outs in the clipping host's coordinates. All rounded rectangles
// share one winding direction, so overlaps form a union.
inline CGPathRef CreateBrowserHolesPath(NSRect browser_frame,
                                        const std::vector<BrowserHole>& holes,
                                        bool flipped) {
  CGMutablePathRef path = CGPathCreateMutable();
  for (const auto& hole : holes) {
    const NSRect frame = BrowserPageRect(browser_frame, hole, flipped);
    if (NSIsEmptyRect(frame)) continue;
    const CGRect rect = NSRectToCGRect(frame);
    const double r = std::isfinite(hole.radius)
        ? std::clamp(hole.radius, 0.0, std::min(hole.width, hole.height) / 2)
        : 0;
    if (r > 0) CGPathAddRoundedRect(path, nullptr, rect, r, r);
    else CGPathAddRect(path, nullptr, rect);
  }
  return path;
}

// The visible page: its rounded bottom corners, minus every menu cut-out.
// Exact subtraction (macOS 13+): overlapping menus and a menu crossing a
// rounded corner never re-expose the page.
inline CGPathRef CreateBrowserMaskPath(NSRect browser_frame, double radius,
                                       const std::vector<BrowserHole>& holes,
                                       bool flipped) {
  CGPathRef page = CreateBrowserBottomCornerPath(browser_frame, std::max(0.0, radius), flipped);
  if (holes.empty()) return page;
  // The pinned CEF framework itself requires macOS 13; CEF's build files
  // still compile this wrapper for an older deployment target.
  if (@available(macOS 13.0, *)) {
    CGPathRef cut = CreateBrowserHolesPath(browser_frame, holes, flipped);
    CGPathRef result = CGPathCreateCopyBySubtractingPath(page, cut, false);
    CGPathRelease(cut);
    if (!result) return page;
    CGPathRelease(page);
    return result;
  }
  return page;
}

inline bool ApplyBrowserMask(NSView* clip, NSRect browser_frame, double radius,
                             const std::vector<BrowserHole>& holes,
                             BrowserCornerMaskState& previous) {
  const double scale = std::max(1.0, clip.window.backingScaleFactor);
  const bool masked = radius > 0 || !holes.empty();
  // A mask path assignment invalidates Core Animation's mask even if the path
  // describes the same pixels. Retain it through redundant layouts; invalidate
  // on real geometry, zoom, display-scale, cut-out, or host/mask changes.
  const bool same_mask = !masked ? clip.layer.mask == nil
      : previous.mask != nil && previous.mask == clip.layer.mask;
  if (previous.clip == clip && same_mask &&
      NSEqualRects(previous.bounds, clip.bounds) &&
      NSEqualRects(previous.browser_frame, browser_frame) &&
      previous.radius == radius && previous.scale == scale &&
      previous.flipped == static_cast<bool>(clip.flipped) &&
      previous.holes == holes) return false;
  clip.wantsLayer = YES;
  clip.clipsToBounds = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  CGPathRef hit = nullptr;
  if (!masked) {
    clip.layer.mask = nil;
  } else {
    CAShapeLayer* mask = [clip.layer.mask isKindOfClass:CAShapeLayer.class]
        ? (CAShapeLayer*)clip.layer.mask : [CAShapeLayer layer];
    mask.frame = clip.bounds;
    mask.contentsScale = scale;
    mask.fillColor = NSColor.blackColor.CGColor;
    CGPathRef path = CreateBrowserMaskPath(browser_frame, radius, holes, clip.flipped);
    mask.fillRule = kCAFillRuleNonZero;
    mask.path = path;
    CGPathRelease(path);
    clip.layer.mask = mask;
    if (!holes.empty()) hit = CreateBrowserHolesPath(browser_frame, holes, clip.flipped);
  }
  [CATransaction commit];
  if ([clip isKindOfClass:SMBrowserClipView.class])
    [(SMBrowserClipView*)clip setHolePath:hit];
  if (hit) CGPathRelease(hit);
  previous.clip = clip;
  previous.mask = clip.layer.mask;
  previous.bounds = clip.bounds;
  previous.browser_frame = browser_frame;
  previous.radius = radius;
  previous.scale = scale;
  previous.flipped = clip.flipped;
  previous.holes = holes;
  return true;
}

inline bool ApplyBrowserBottomCornerMask(NSView* clip, NSRect browser_frame,
                                         double radius,
                                         BrowserCornerMaskState& previous) {
  return ApplyBrowserMask(clip, browser_frame, radius, {}, previous);
}

// Hiding a native child must not leave keyboard events in that invisible page.
// A different browser, toolbar, or window retains its existing first responder.
inline bool ReturnHiddenBrowserFocus(NSView* clip, NSView* workspace) {
  NSWindow* window = clip.window;
  NSResponder* responder = window.firstResponder;
  if (!window || !workspace || workspace.window != window ||
      workspace.hiddenOrHasHiddenAncestor ||
      ![responder isKindOfClass:NSView.class] ||
      ![(NSView*)responder isDescendantOf:clip]) return false;
  return [window makeFirstResponder:workspace];
}

inline NSRect AlignBrowserBackingRect(NSView* parent, NSRect frame) {
  const NSRect backing = [parent convertRectToBacking:frame];
  // Match the DOM's Math.round in top-down backing coordinates, including
  // half-pixel ties. An unflipped AppKit Y axis runs in the opposite direction,
  // so its ties must go down before converting back to the parent's space.
  // This policy is invariant under integer backing-pixel WK/chrome offsets;
  // UI zoom is already represented in frame and the actual backing transform.
  // Fractional host offsets still stay aligned to the display's pixel grid.
  const auto round_pixel = [](double value) { return std::floor(value + .5); };
  const auto round_y = [flipped = parent.flipped, round_pixel](double value) {
    return flipped ? round_pixel(value) : std::ceil(value - .5);
  };
  const double left = round_pixel(NSMinX(backing));
  const double bottom = round_y(NSMinY(backing));
  const double right = round_pixel(NSMaxX(backing));
  const double top = round_y(NSMaxY(backing));
  return [parent convertRectFromBacking:
      NSMakeRect(left, bottom, right - left, top - bottom)];
}

// DOM zoom and split ratios can leave native frames between display pixels.
// Align both rectangles in the host's actual backing space, then derive the
// browser's offset from them. Clipping must not shift its text off that grid.
inline BrowserHostFrames AlignedBrowserHostFrames(NSView* parent,
                                                  NSRect browser_frame,
                                                  NSRect clip_frame) {
  const NSRect browser = AlignBrowserBackingRect(parent, browser_frame);
  const NSRect clip = AlignBrowserBackingRect(parent, clip_frame);
  return {clip, NSMakeRect(browser.origin.x - clip.origin.x,
                           browser.origin.y - clip.origin.y,
                           browser.size.width, browser.size.height)};
}

// Keep the live browser and its native descendants attached through their own
// AppKit move callbacks. Moving only an outer clip can leave the renderer's
// window/visibility bookkeeping behind during a cross-window transfer.
inline void EnsureBrowserHost(NSView* parent, NSView* clip, NSView* browser,
                              NSView* workspace_view) {
  if (clip.superview != parent || browser.superview != clip ||
      browser.window != parent.window) {
    // CefBrowserHostView deallocation destroys its browser. Retain the actual
    // view across removal; reparenting must preserve the loaded page and state.
    NSView* __strong retained_browser = browser;
    [retained_browser removeFromSuperview];
    if (clip.superview != parent) {
      [clip removeFromSuperview];
      [parent addSubview:clip];
    }
    [clip addSubview:retained_browser];
  }

  // A new Tauri window can finish inserting WK after the transferred browser
  // arrived. Restore this clip above WK without touching a healthy hierarchy
  // on ordinary resizes. WK can be nested inside another native container.
  NSView* workspace_peer = workspace_view;
  while (workspace_peer && workspace_peer != parent &&
         workspace_peer.superview != parent)
    workspace_peer = workspace_peer.superview;
  if (!workspace_peer || workspace_peer == parent || workspace_peer == clip)
    return;
  const auto siblings = parent.subviews;
  const NSUInteger browser_index = [siblings indexOfObjectIdenticalTo:clip];
  const NSUInteger workspace_index =
      [siblings indexOfObjectIdenticalTo:workspace_peer];
  if (browser_index != NSNotFound && workspace_index != NSNotFound &&
      browser_index < workspace_index)
    [parent addSubview:clip positioned:NSWindowAbove relativeTo:workspace_peer];
}

}  // namespace supermono
