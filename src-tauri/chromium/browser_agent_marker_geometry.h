#pragma once
#include <algorithm>
#include <cmath>
#include <optional>

namespace supermono {

// Where Aven's in-pane agent pointer goes, in the browser view's own points
// (top-left origin, the full page viewport, before the host's edge clipping).
struct AgentMarkerPoint {
  double x = 0;
  double y = 0;
};

struct AgentMarkerPane {
  double width = 0;   // browser view width in points (full viewport)
  double height = 0;  // browser view height in points
  double clip_left = 0;   // points hidden behind a hovering sidebar
  double clip_right = 0;
  bool shown = false;  // pane visible, attached, window on screen
};

inline bool AgentMarkerFinite(double value) { return std::isfinite(value); }

// The page reports CSS pixels of its layout viewport. Per-tab zoom is device
// emulation: the page's innerWidth CSS pixels fill the view's width, so a plain
// ratio converts both zoomed and unzoomed pages without knowing the factor.
inline std::optional<AgentMarkerPoint> AgentMarkerFromPage(
    double x, double y, double width, double height,
    double viewport_width, double viewport_height, const AgentMarkerPane& pane) {
  if (!pane.shown) return std::nullopt;
  for (const double value : {x, y, width, height, viewport_width, viewport_height,
                             pane.width, pane.height, pane.clip_left, pane.clip_right})
    if (!AgentMarkerFinite(value)) return std::nullopt;
  if (viewport_width < 1 || viewport_height < 1 || pane.width < 1 || pane.height < 1 ||
      width < 0 || height < 0 || pane.clip_left < 0 || pane.clip_right < 0)
    return std::nullopt;
  const double sx = pane.width / viewport_width, sy = pane.height / viewport_height;
  const AgentMarkerPoint point{(x + width / 2) * sx, (y + height / 2) * sy};
  // Never point at something the user cannot see: outside the page, or under
  // the part of the pane covered by a hovering sidebar.
  const double left = pane.clip_left, right = pane.width - pane.clip_right;
  if (right - left < 1) return std::nullopt;
  if (point.x < left || point.x > right || point.y < 0 || point.y > pane.height)
    return std::nullopt;
  return point;
}

// Scrolls act on the whole page: point at the middle of the exposed area.
inline std::optional<AgentMarkerPoint> AgentMarkerPaneCentre(const AgentMarkerPane& pane) {
  if (!pane.shown) return std::nullopt;
  for (const double value : {pane.width, pane.height, pane.clip_left, pane.clip_right})
    if (!AgentMarkerFinite(value)) return std::nullopt;
  const double left = std::max(0.0, pane.clip_left);
  const double right = pane.width - std::max(0.0, pane.clip_right);
  if (right - left < 1 || pane.height < 1) return std::nullopt;
  return AgentMarkerPoint{left + (right - left) / 2, pane.height / 2};
}

// Glide duration in seconds: brisk for short hops, never longer than 0.28 s.
// Matches the desktop pointer's feel.
inline double AgentMarkerTravelSeconds(double distance) {
  if (!AgentMarkerFinite(distance) || distance <= 0) return 0.16;
  return std::clamp(0.16 + distance * 0.0001, 0.16, 0.28);
}

// The marker's name tag sits right and below the ring, flipping to stay inside
// the pane. Returns {right, below}.
struct AgentMarkerTagSide {
  bool right = true;
  bool below = true;
};
inline AgentMarkerTagSide AgentMarkerTagPlacement(
    AgentMarkerPoint point, double tag_width, double tag_height,
    double pane_width, double pane_height, double clip_right,
    double gap = 10, double drop = 7, double margin = 4) {
  AgentMarkerTagSide side;
  side.right = point.x + gap + tag_width + margin <= pane_width - std::max(0.0, clip_right);
  side.below = point.y + drop + tag_height + margin <= pane_height;
  return side;
}

// Name tag colours: white text on the agent's colour, deepened only as far as
// needed for legibility; very light colours keep their hue with dark text.
// Same rule as the desktop pointer (desktop_cursor_macos.rs tag_palette).
struct AgentMarkerRgb {
  double r = 0, g = 0, b = 0;
};
struct AgentMarkerPalette {
  AgentMarkerRgb fill;
  AgentMarkerRgb ink;
};
inline double AgentMarkerLinear(double c) {
  return c <= 0.04045 ? c / 12.92 : std::pow((c + 0.055) / 1.055, 2.4);
}
inline double AgentMarkerLuminance(AgentMarkerRgb c) {
  return 0.2126 * AgentMarkerLinear(c.r) + 0.7152 * AgentMarkerLinear(c.g) +
         0.0722 * AgentMarkerLinear(c.b);
}
inline double AgentMarkerContrast(AgentMarkerRgb a, AgentMarkerRgb b) {
  const double la = AgentMarkerLuminance(a), lb = AgentMarkerLuminance(b);
  return (std::max(la, lb) + 0.05) / (std::min(la, lb) + 0.05);
}
inline AgentMarkerRgb AgentMarkerMix(AgentMarkerRgb a, AgentMarkerRgb b, double t) {
  return {a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t};
}
inline bool AgentMarkerValidColor(AgentMarkerRgb c) {
  for (const double v : {c.r, c.g, c.b})
    if (!std::isfinite(v) || v < 0 || v > 1) return false;
  return true;
}
inline AgentMarkerPalette AgentMarkerTagPalette(AgentMarkerRgb color, bool high_contrast) {
  const AgentMarkerRgb white{1, 1, 1}, ink{0.07, 0.07, 0.08};
  const double required = high_contrast ? 7.0 : 4.5;
  const double deepest = high_contrast ? 0.5 : 0.36;
  for (int step = 0; step <= 40; ++step) {
    const double amount = step * 0.0125;
    if (amount > deepest) break;
    const auto fill = AgentMarkerMix(color, {0, 0, 0}, amount);
    if (AgentMarkerContrast(fill, white) >= required) return {fill, white};
  }
  for (int step = 0; step <= 40; ++step) {
    const auto fill = AgentMarkerMix(color, white, step * 0.025);
    if (AgentMarkerContrast(fill, ink) >= required) return {fill, ink};
  }
  return {ink, white};
}

}  // namespace supermono
