#pragma once
#include <algorithm>

namespace supermono {
struct BrowserRect { double x, y, width, height; };

// DOM height is converted from CSS pixels to native points by the caller.
// A zero height means an older caller that did not send viewport metadata.
inline BrowserRect BrowserViewport(BrowserRect bounds,double dom_height,bool flipped) {
  if (dom_height<=0) return bounds;
  const double height=std::min(bounds.height,dom_height);
  return {bounds.x,bounds.y+(flipped ? bounds.height-height : 0),bounds.width,height};
}

inline BrowserRect BrowserViewportFrame(BrowserRect viewport,bool flipped,
                                       double x,double y,double width,double height) {
  return {viewport.x+x,
          flipped ? viewport.y+y : viewport.y+viewport.height-y-height,
          width,height};
}
}
