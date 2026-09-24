#pragma once
#include <cstdint>

namespace supermono {
// Invalidation is monotonic: returning to a hidden layout does not validate an
// older asynchronous probe. Once closing starts, the caller waits for CEF's
// close/cancel callback before reusing the tab or releasing its agent veto.
class BrowserSleepState {
 public:
  uint64_t Begin() { active_ = true; closing_ = false; return attempt_ = ++generation_; }
  void Invalidate() { ++generation_; }
  bool Owns(uint64_t attempt) const { return active_ && attempt == attempt_; }
  bool Current(uint64_t attempt) const { return Owns(attempt) && attempt == generation_; }
  bool CanExpire(uint64_t attempt) const { return Owns(attempt) && !closing_; }
  uint64_t token() const { return attempt_; }
  bool BeginClose(uint64_t generation) {
    if (!Current(generation) || closing_) return false;
    closing_ = true; return true;
  }
  bool active() const { return active_; }
  bool closing() const { return closing_; }
  bool Finish(uint64_t attempt) {
    if (!Owns(attempt)) return false;
    active_ = closing_ = false; ++generation_; return true;
  }
 private:
  uint64_t generation_ = 0, attempt_ = 0;
  bool active_ = false, closing_ = false;
};
}
