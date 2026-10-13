#include "browser_agent_marker_geometry.h"
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Agent marker geometry check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
  ++checks; \
} while (false)

using namespace supermono;
static int checks = 0;
static bool Near(double a, double b) { return std::abs(a - b) < 1e-9; }

int main() {
  AgentMarkerPane pane{800, 600, 0, 0, true};
  // 100% zoom: CSS pixels are view points.
  auto point = AgentMarkerFromPage(100, 50, 40, 20, 800, 600, pane);
  CHECK(point && Near(point->x, 120) && Near(point->y, 60));
  // 200% zoom: the page lays out 400x300 CSS pixels into the same 800x600 view.
  point = AgentMarkerFromPage(100, 50, 40, 20, 400, 300, pane);
  CHECK(point && Near(point->x, 240) && Near(point->y, 120));
  // 50% zoom: 1600x1200 CSS pixels.
  point = AgentMarkerFromPage(100, 50, 40, 20, 1600, 1200, pane);
  CHECK(point && Near(point->x, 60) && Near(point->y, 30));
  // Hidden pane, minimized window or locked screen: never draw.
  AgentMarkerPane hidden = pane; hidden.shown = false;
  CHECK(!AgentMarkerFromPage(100, 50, 40, 20, 800, 600, hidden));
  CHECK(!AgentMarkerPaneCentre(hidden));
  // A hovering sidebar covers the left 200 points: no pointer under it.
  AgentMarkerPane clipped = pane; clipped.clip_left = 200;
  CHECK(!AgentMarkerFromPage(100, 50, 40, 20, 800, 600, clipped));
  CHECK(AgentMarkerFromPage(300, 50, 40, 20, 800, 600, clipped));
  clipped.clip_left = 0; clipped.clip_right = 300;
  CHECK(!AgentMarkerFromPage(600, 50, 40, 20, 800, 600, clipped));
  // Fully covered pane.
  AgentMarkerPane covered = pane; covered.clip_left = 400; covered.clip_right = 400;
  CHECK(!AgentMarkerFromPage(390, 50, 40, 20, 800, 600, covered));
  CHECK(!AgentMarkerPaneCentre(covered));
  // Outside the viewport (scrolled away, or a fixed element off screen).
  CHECK(!AgentMarkerFromPage(100, -80, 40, 20, 800, 600, pane));
  CHECK(!AgentMarkerFromPage(100, 900, 40, 20, 800, 600, pane));
  // Invalid page data.
  const double nan = std::numeric_limits<double>::quiet_NaN();
  const double inf = std::numeric_limits<double>::infinity();
  CHECK(!AgentMarkerFromPage(nan, 50, 40, 20, 800, 600, pane));
  CHECK(!AgentMarkerFromPage(100, 50, inf, 20, 800, 600, pane));
  CHECK(!AgentMarkerFromPage(100, 50, 40, 20, 0, 600, pane));
  CHECK(!AgentMarkerFromPage(100, 50, -4, 20, 800, 600, pane));
  // Pane centre uses only the exposed region.
  auto centre = AgentMarkerPaneCentre(pane);
  CHECK(centre && Near(centre->x, 400) && Near(centre->y, 300));
  AgentMarkerPane side = pane; side.clip_left = 200;
  centre = AgentMarkerPaneCentre(side);
  CHECK(centre && Near(centre->x, 500) && Near(centre->y, 300));
  // Glide timing: short hops brisk, long ones capped.
  CHECK(Near(AgentMarkerTravelSeconds(0), .16));
  CHECK(Near(AgentMarkerTravelSeconds(500), .21));
  CHECK(Near(AgentMarkerTravelSeconds(1e6), .28));
  CHECK(Near(AgentMarkerTravelSeconds(nan), .16));
  // The name tag flips to stay inside the pane.
  auto tag = AgentMarkerTagPlacement({100, 100}, 60, 20, 800, 600, 0);
  CHECK(tag.right && tag.below);
  tag = AgentMarkerTagPlacement({780, 590}, 60, 20, 800, 600, 0);
  CHECK(!tag.right && !tag.below);
  tag = AgentMarkerTagPlacement({600, 100}, 60, 20, 800, 600, 150);
  CHECK(!tag.right && tag.below);
  // Tag text stays legible: WCAG AA (7:1 with Increase Contrast).
  const AgentMarkerRgb claude{.851, .467, .341}, light{.86, .86, .88};
  for (const auto& colour : {claude, light, AgentMarkerRgb{.478, .616, 1.0}}) {
    const auto normal = AgentMarkerTagPalette(colour, false);
    CHECK(AgentMarkerContrast(normal.fill, normal.ink) >= 4.5);
    const auto high = AgentMarkerTagPalette(colour, true);
    CHECK(AgentMarkerContrast(high.fill, high.ink) >= 7.0 - 1e-9);
  }
  CHECK(AgentMarkerTagPalette(light, false).ink.r < .5);
  CHECK(AgentMarkerValidColor(claude));
  CHECK(!AgentMarkerValidColor({nan, 0, 0}));
  CHECK(!AgentMarkerValidColor({1.2, 0, 0}));
  std::printf("%d agent marker geometry checks passed\n", checks);
}
