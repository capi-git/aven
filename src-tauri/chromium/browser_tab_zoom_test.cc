#include <cstdio>
#include <cstdlib>
#include <limits>
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
  std::puts("Browser per-tab zoom isolation and command ordering checks passed");
}
