#include <cstdio>
#include <cstdlib>
#include <limits>
#include "browser_edit_capture.h"
#include "browser_tab_zoom.h"

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Browser tab zoom check failed at line %d: %s\n", \
                 __LINE__, #condition); \
    std::abort(); \
  } \
} while (false)

int main() {
  supermono::BrowserTabZoom first, second;
  CHECK(!first.pending());
  CHECK(first.Request(1.2));
  CHECK(first.pending());
  CHECK(first.Begin() == 1.2);
  CHECK(first.pending());
  CHECK(second.factor() == 1.0 && !second.Begin());

  // Repeated clicks queue only the newest target while the old command waits.
  CHECK(first.Request(1.44) && first.Request(1.728));
  CHECK(!first.Begin());
  first.Complete(true);
  CHECK(first.pending());
  CHECK(first.factor() == 1.728 && first.Begin() == 1.728);
  first.Complete(true);
  CHECK(!first.pending());
  CHECK(first.factor() == 1.728 && !first.Begin());

  CHECK(second.Request(.8) && second.Begin() == .8);
  second.Complete(true);
  CHECK(first.factor() == 1.728 && second.factor() == .8);

  // A failed old renderer request must not discard a navigation reapply.
  CHECK(first.Request(2) && first.Begin() == 2);
  CHECK(first.Request(2));
  first.Complete(false);
  CHECK(first.factor() == 2 && first.Begin() == 2);
  first.Complete(true);
  CHECK(first.factor() == 2);

  // Failure without newer work restores the last successful factor only.
  CHECK(first.Request(3) && first.Begin() == 3);
  first.Complete(false);
  CHECK(first.factor() == 2 && !first.Begin());
  CHECK(second.factor() == .8);
  CHECK(first.Request(1) && first.Begin() == 1);
  first.Complete(true);
  CHECK(first.factor() == 1 && second.factor() == .8);

  CHECK(!first.Request(std::numeric_limits<double>::quiet_NaN()));
  CHECK(!first.Request(std::numeric_limits<double>::infinity()));
  CHECK(first.factor() == 1 && !first.Begin());
  CHECK(first.Request(100) && first.Begin() == 5);
  first.Complete(true);
  CHECK(first.Request(0) && first.Begin() == .25);
  first.Complete(true);
  CHECK(first.factor() == .25);

  // Display moves queue one update without interrupting a zoom already in
  // flight. Repeated layouts at the same density must not keep applying zoom.
  supermono::BrowserTabZoom moving;
  CHECK(!moving.SetBackingScale(1) && !moving.pending());
  CHECK(moving.Request(.5) && moving.Begin() == .5);
  CHECK(moving.device_scale_factor() == .5);
  CHECK(moving.SetBackingScale(2));
  CHECK(!moving.SetBackingScale(2) && !moving.Begin());
  moving.Complete(true);
  CHECK(moving.factor() == .5 && moving.Begin() == .5);
  CHECK(moving.device_scale_factor() == 1);
  moving.Complete(true);
  CHECK(!moving.pending() && !moving.SetBackingScale(2));
  CHECK(moving.SetBackingScale(1) && moving.Begin() == .5);
  moving.Complete(true);
  CHECK(moving.device_scale_factor() == .5 && !moving.pending());
  for (const double invalid : {0., -1., 9., std::numeric_limits<double>::infinity(),
                              std::numeric_limits<double>::quiet_NaN()}) {
    CHECK(!moving.SetBackingScale(invalid) && !moving.pending());
    CHECK(moving.device_scale_factor() == .5);
  }

  // A DPR-sized canvas and a full CDP capture should match the physical view
  // at every zoom, not grow by 1/zoom in each dimension. Annotation crops use
  // fractions of that full view, independent of the exposed pixel density.
  const auto near=[](double actual,double expected) {
    return std::abs(actual-expected) < 1e-8;
  };
  for (const double backing : {1., 2.}) {
    for (const double factor : {.25, .5, 1./1.2, 1., 1.2, 2., 5.}) {
      supermono::BrowserTabZoom geometry;
      geometry.SetBackingScale(backing);
      CHECK(geometry.Request(factor) && geometry.Begin() == factor);
      const double css_width=1000/factor, css_height=600/factor;
      const double dpr=geometry.device_scale_factor();
      CHECK(near(css_width*dpr,1000*backing));
      CHECK(near(css_height*dpr,600*backing));
      const auto crop=supermono::ElementCaptureClip(
        {css_width*.25,css_height*.2,css_width*.3,css_height*.25},
        {0,0,css_width,css_height},0,0,dpr);
      CHECK(crop && near(crop->target.x,.25) && near(crop->target.y,.2));
      CHECK(near(crop->target.width,.3) && near(crop->target.height,.25));
      CHECK(near(crop->clip.width*dpr,300*backing));
      CHECK(near(crop->clip.height*dpr,150*backing));
      geometry.Complete(true);
      CHECK(!geometry.pending());
    }
  }
  std::puts("Browser per-tab zoom, display-density and capture geometry checks passed");
}
