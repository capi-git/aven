#pragma once
#import <Cocoa/Cocoa.h>
#include <cmath>

namespace supermono {

struct BrowserHostFrames {
  NSRect clip;
  NSRect browser;
};

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
