#pragma once
#include "browser_viewport.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <optional>

namespace supermono {
constexpr uint32_t kEditCaptureMaxEdge = 4096;
constexpr uint64_t kEditCaptureMaxPixels = 8 * 1024 * 1024;
constexpr size_t kEditCaptureMaxBase64 = 8 * 1024 * 1024;

struct BrowserEditCapture { BrowserRect clip; double scale; BrowserRect target; };

// DOM bounds and scroll offsets are CSS pixels. CDP's document clip uses the
// same space; multiplying coordinates by page zoom or Retina density crops
// the wrong element. Device density affects only the bounded output scale.
inline std::optional<BrowserEditCapture> ElementCaptureClip(
    BrowserRect rect, BrowserRect viewport, double scroll_x, double scroll_y,
    double device_scale, double hidden_left = 0, double hidden_right = 0) {
  const auto valid_rect = [](BrowserRect r) {
    return std::isfinite(r.x) && std::isfinite(r.y) &&
           std::isfinite(r.width) && std::isfinite(r.height) &&
           r.width > 0 && r.height > 0 &&
           std::isfinite(r.x + r.width) && std::isfinite(r.y + r.height);
  };
  if (!valid_rect(rect) || !valid_rect(viewport) ||
      !std::isfinite(scroll_x) || !std::isfinite(scroll_y) ||
      !std::isfinite(device_scale) || device_scale <= 0 || device_scale > 16 ||
      !std::isfinite(hidden_left) || !std::isfinite(hidden_right) ||
      hidden_left < 0 || hidden_right < 0 || hidden_left + hidden_right >= 1)
    return std::nullopt;
  const double x = std::max(rect.x, viewport.x + viewport.width * hidden_left);
  const double y = std::max(rect.y, viewport.y);
  const double right = std::min(rect.x + rect.width,
      viewport.x + viewport.width * (1 - hidden_right));
  const double bottom = std::min(rect.y + rect.height, viewport.y + viewport.height);
  const BrowserRect clip{x + scroll_x, y + scroll_y, right - x, bottom - y};
  // Chromium requires at least one CSS pixel for its screenshot output size.
  if (!valid_rect(clip) || clip.width < 1 || clip.height < 1 ||
      std::abs(clip.x) > 1e9 || std::abs(clip.y) > 1e9 ||
      clip.width > 32768 || clip.height > 32768) return std::nullopt;
  const double pixels_w = clip.width * device_scale;
  const double pixels_h = clip.height * device_scale;
  const double scale = std::min({1.0, kEditCaptureMaxEdge / pixels_w,
      kEditCaptureMaxEdge / pixels_h,
      std::sqrt(double(kEditCaptureMaxPixels) / (pixels_w * pixels_h))});
  // Normalized CSS viewport coordinates map into the native view without
  // applying page zoom or Retina density twice.
  const BrowserRect target{(x - viewport.x) / viewport.width,
      (y - viewport.y) / viewport.height,
      clip.width / viewport.width, clip.height / viewport.height};
  return BrowserEditCapture{clip, scale, target};
}

// Read actual PNG dimensions rather than predicting Chromium's pixel rounding.
inline bool EditCapturePngDimensions(const unsigned char* bytes, size_t size,
                                     uint32_t& width, uint32_t& height) {
  constexpr unsigned char signature[]{137,80,78,71,13,10,26,10};
  if (!bytes || size < 24 || std::memcmp(bytes, signature, 8) != 0 ||
      bytes[8] || bytes[9] || bytes[10] || bytes[11] != 13 ||
      std::memcmp(bytes + 12, "IHDR", 4) != 0) return false;
  const auto number = [bytes](size_t at) {
    return uint32_t(bytes[at]) << 24 | uint32_t(bytes[at+1]) << 16 |
           uint32_t(bytes[at+2]) << 8 | uint32_t(bytes[at+3]);
  };
  width = number(16); height = number(20);
  return width && height && width <= kEditCaptureMaxEdge &&
      height <= kEditCaptureMaxEdge && uint64_t(width) * height <= kEditCaptureMaxPixels;
}
}  // namespace supermono
