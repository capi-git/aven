#pragma once
#include <algorithm>
#include <climits>
#include <cstdint>

namespace supermono {
constexpr int64_t kBrowserPumpFallback = INT_MAX;
constexpr int64_t kBrowserPumpForegroundMs = 1000 / 30;
constexpr int64_t kBrowserPumpIdleMs = 250;

// Only the safety heartbeat backs off. CEF's explicit deadlines keep their
// existing 33ms ceiling, including loading, IPC, media and agent commands.
constexpr int64_t BrowserPumpDelayMs(int64_t requested, bool foreground) {
  if (requested == kBrowserPumpFallback)
    return foreground ? kBrowserPumpForegroundMs : kBrowserPumpIdleMs;
  return std::clamp<int64_t>(requested, 0, kBrowserPumpForegroundMs);
}
}  // namespace supermono
