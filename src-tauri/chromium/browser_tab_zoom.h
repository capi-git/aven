#pragma once
#include <algorithm>
#include <cmath>
#include <optional>

namespace supermono {

// One in-flight target command and the latest requested value per live tab.
// Navigation can request the same factor again without losing pending input.
class BrowserTabZoom {
 public:
  bool Request(double factor) {
    if (!std::isfinite(factor)) return false;
    factor_ = std::clamp(factor, .25, 5.0);
    dirty_ = true;
    return true;
  }
  double factor() const { return factor_; }
  // Device emulation's visual scale does not adjust window.devicePixelRatio
  // like normal page zoom does. Report the effective display density so a
  // DPR-sized canvas keeps the same physical pixel budget when zooming out.
  double device_scale_factor() const { return backing_scale_ * factor_; }
  bool SetBackingScale(double scale) {
    if (!std::isfinite(scale) || scale <= 0 || scale > 8 || scale == backing_scale_)
      return false;
    backing_scale_ = scale;
    dirty_ = true;
    return true;
  }
  bool pending() const { return running_ || dirty_; }
  std::optional<double> Begin() {
    if (running_ || !dirty_) return std::nullopt;
    running_ = true;
    dirty_ = false;
    running_factor_ = factor_;
    return running_factor_;
  }
  void Complete(bool success) {
    if (!running_) return;
    running_ = false;
    if (success) applied_factor_ = running_factor_;
    // A failed older command cannot replace a newer queued request. With no
    // queued request, show the last factor Chromium actually acknowledged.
    if (!dirty_) factor_ = applied_factor_;
  }

 private:
  double factor_ = 1.0, applied_factor_ = 1.0, running_factor_ = 1.0;
  double backing_scale_ = 1.0;
  bool running_ = false, dirty_ = false;
};

}  // namespace supermono
