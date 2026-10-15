#pragma once
#include <algorithm>
#include <climits>
#include <cstdint>

namespace supermono {
constexpr int64_t kBrowserPumpFallback = INT_MAX;
constexpr int64_t kBrowserPumpForegroundMs = 1000 / 30;
constexpr int64_t kBrowserPumpIdleMs = 250;

// With a page on screen in the active app, every wait is capped at 33ms, as
// CEF's external-pump sample does. Otherwise long waits are capped at 250ms
// instead: CEF's shorter deadlines are still met exactly, and work it asks
// for now still runs now, but a pending far-off timer no longer wakes Aven
// thirty times a second while no page is visible.
constexpr int64_t BrowserPumpDelayMs(int64_t requested, bool foreground) {
  const int64_t ceiling =
      foreground ? kBrowserPumpForegroundMs : kBrowserPumpIdleMs;
  if (requested == kBrowserPumpFallback) return ceiling;
  return std::clamp<int64_t>(requested, 0, ceiling);
}
}  // namespace supermono
