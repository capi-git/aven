#include "browser_edit_capture.h"
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <iostream>
#include <limits>

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Element screenshot check failed at line %d: %s\n", \
                 __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

int main() {
  using supermono::ElementCaptureClip;
  auto cropped = ElementCaptureClip({-20, 50, 200, 600}, {0, 0, 800, 500}, 30, 1200, 2);
  CHECK(cropped && cropped->clip.x == 30 && cropped->clip.y == 1250 &&
         cropped->clip.width == 180 && cropped->clip.height == 450 && cropped->scale == 1);
  // The CSS viewport contracts at page zoom; the selected bounds remain CSS
  // coordinates, and Retina changes output density only.
  auto zoomed = ElementCaptureClip({70.5, 20.25, 120.5, 40.75}, {0, 0, 400, 250}, 5, 100, 2);
  CHECK(zoomed && zoomed->clip.x == 75.5 && zoomed->clip.y == 120.25 &&
         zoomed->clip.width == 120.5 && zoomed->scale == 1);
  CHECK(zoomed->target.x == 70.5 / 400 && zoomed->target.y == 20.25 / 250 &&
        zoomed->target.width == 120.5 / 400 && zoomed->target.height == 40.75 / 250);
  auto occluded = ElementCaptureClip({0, 0, 800, 500}, {0, 0, 800, 500}, 0, 0, 1, .25, .125);
  CHECK(occluded && occluded->clip.x == 200 && occluded->clip.width == 500);
  CHECK(occluded->target.x == .25 && occluded->target.width == .625);
  auto panned = ElementCaptureClip({100, 30, 500, 250}, {120, 40, 300, 150}, 50, 60, 2);
  CHECK(panned && panned->clip.x == 170 && panned->clip.y == 100 &&
         panned->clip.width == 300 && panned->clip.height == 150);
  CHECK(panned->target.x == 0 && panned->target.y == 0 &&
        panned->target.width == 1 && panned->target.height == 1);
  // A native screenshot includes classic scrollbar gutters. Dividing by the
  // narrower visual viewport would move the crop right/down in that bitmap.
  auto scrollbar = ElementCaptureClip({1200, 900, 500, 100}, {0, 0, 2032, 1185},
      0, 0, 2, 0, 0, 2047, 1200);
  CHECK(scrollbar && scrollbar->target.x == 1200.0 / 2047 &&
        scrollbar->target.y == .75 && scrollbar->target.width == 500.0 / 2047);
  CHECK(std::abs(scrollbar->target.x * 4094 - 2400) < 1e-6);
  auto gutter = ElementCaptureClip({2000, 1170, 100, 100}, {0, 0, 2032, 1185},
      0, 0, 1, 0, 0, 2047, 1200);
  CHECK(gutter && gutter->clip.width == 32 && gutter->clip.height == 15);
  CHECK(gutter->target.x + gutter->target.width < 1 &&
        gutter->target.y + gutter->target.height < 1);
  // Pan offsets remain CSS coordinates; pinch scale is accounted for in the
  // raster extent, so neither density nor zoom is multiplied into the target.
  auto scrollbar_panned = ElementCaptureClip({220, 100, 400, 80},
      {120, 40, 1016, 592.5}, 50, 60, 2, 0, 0, 1023.5, 600);
  CHECK(scrollbar_panned && scrollbar_panned->clip.x == 270 &&
        scrollbar_panned->target.x == 100.0 / 1023.5 && scrollbar_panned->target.y == .1);
  auto scrollbar_clipped = ElementCaptureClip({0, 0, 2047, 1200},
      {0, 0, 2032, 1185}, 0, 0, 1, .25, .125, 2047, 1200);
  CHECK(scrollbar_clipped && scrollbar_clipped->clip.x == 2047 * .25 &&
        scrollbar_clipped->target.x == .25 && scrollbar_clipped->target.width == .625);
  for (const auto bad : {-1.0, 262145.0, std::numeric_limits<double>::infinity(),
                         std::numeric_limits<double>::quiet_NaN()}) {
    CHECK(!ElementCaptureClip({0,0,100,50}, {0,0,800,500}, 0,0,1,0,0,bad,500));
    CHECK(!ElementCaptureClip({0,0,100,50}, {0,0,800,500}, 0,0,1,0,0,800,bad));
  }
  auto large = ElementCaptureClip({0, 0, 4000, 3000}, {0, 0, 4000, 3000}, 0, 0, 2);
  CHECK(large && large->scale < 1 &&
         8000 * large->scale <= 4096 &&
         8000 * 6000 * large->scale * large->scale <= supermono::kEditCaptureMaxPixels + 1);
  for (const auto bad : {0.0, -1.0, std::numeric_limits<double>::infinity(), std::numeric_limits<double>::quiet_NaN()})
    CHECK(!ElementCaptureClip({0, 0, 100, 50}, {0, 0, 800, 500}, 0, 0, bad));
  CHECK(!ElementCaptureClip({900, 0, 100, 50}, {0, 0, 800, 500}, 0, 0, 2));
  CHECK(!ElementCaptureClip({0, 0, .1, 50}, {0, 0, 800, 500}, 0, 0, 2));
  CHECK(!ElementCaptureClip({0, 0, 100, 50}, {0, 0, 800, 500}, 0, 0, 2, .5, .5));
  unsigned char header[]{137,80,78,71,13,10,26,10,0,0,0,13,'I','H','D','R',0,0,0,240,0,0,0,81};
  uint32_t width = 0, height = 0;
  CHECK(supermono::EditCapturePngDimensions(header, sizeof(header), width, height));
  CHECK(width == 240 && height == 81);
  header[16] = 1;
  CHECK(!supermono::EditCapturePngDimensions(header, sizeof(header), width, height));
  header[16] = 0; header[0] = 0;
  CHECK(!supermono::EditCapturePngDimensions(header, sizeof(header), width, height));
  CHECK(!supermono::EditCapturePngDimensions(header, 20, width, height));
  std::cout << "Element screenshot geometry, bounds and PNG dimensions passed\n";
}
