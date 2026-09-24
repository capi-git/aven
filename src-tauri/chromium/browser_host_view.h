#pragma once
#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#include <algorithm>
#include <cmath>

namespace supermono {

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

inline bool ApplyBrowserBottomCornerMask(NSView* clip, NSRect browser_frame,
                                         double radius,
                                         BrowserCornerMaskState& previous) {
  const double scale = std::max(1.0, clip.window.backingScaleFactor);
  // A mask path assignment invalidates Core Animation's mask even if the path
  // describes the same pixels. Retain it through redundant layouts; invalidate
  // on real geometry, zoom, display-scale, or host/mask changes.
  const bool same_mask = radius <= 0 ? clip.layer.mask == nil
      : previous.mask != nil && previous.mask == clip.layer.mask;
  if (previous.clip == clip && same_mask &&
      NSEqualRects(previous.bounds, clip.bounds) &&
      NSEqualRects(previous.browser_frame, browser_frame) &&
      previous.radius == radius && previous.scale == scale &&
      previous.flipped == static_cast<bool>(clip.flipped)) return false;
  clip.wantsLayer = YES;
  clip.clipsToBounds = YES;
  [CATransaction begin];
  [CATransaction setDisableActions:YES];
  if (radius <= 0) {
    clip.layer.mask = nil;
  } else {
    CAShapeLayer* mask = [clip.layer.mask isKindOfClass:CAShapeLayer.class]
        ? (CAShapeLayer*)clip.layer.mask : [CAShapeLayer layer];
    mask.frame = clip.bounds;
    mask.contentsScale = scale;
    mask.fillColor = NSColor.blackColor.CGColor;
    CGPathRef path = CreateBrowserBottomCornerPath(browser_frame, radius, clip.flipped);
    mask.path = path;
    CGPathRelease(path);
    clip.layer.mask = mask;
  }
  [CATransaction commit];
  previous.clip = clip;
  previous.mask = clip.layer.mask;
  previous.bounds = clip.bounds;
  previous.browser_frame = browser_frame;
  previous.radius = radius;
  previous.scale = scale;
  previous.flipped = clip.flipped;
  return true;
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
