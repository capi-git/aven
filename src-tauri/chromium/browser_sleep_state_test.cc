#include "browser_sleep_state.h"
#include <cstdio>
#include <cstdlib>

#define CHECK(condition) do { if (!(condition)) { \
  std::fprintf(stderr,"Browser sleep state failure at %d: %s\n",__LINE__,#condition); \
  std::abort(); } } while (false)

int main() {
  supermono::BrowserSleepState state;
  const auto hidden_probe = state.Begin();
  CHECK(state.Current(hidden_probe));
  state.Invalidate(); // Navigation, visible layout, or another browser action.
  CHECK(!state.BeginClose(hidden_probe));
  CHECK(state.CanExpire(hidden_probe));
  CHECK(state.Finish(hidden_probe));
  const auto next = state.Begin();
  CHECK(state.BeginClose(next));
  CHECK(!state.BeginClose(next));
  state.Invalidate(); // Reactivation must still wait for the outstanding close.
  CHECK(state.active() && state.closing());
  CHECK(!state.CanExpire(next)); // The pre-close deadline cannot release a close.
  CHECK(state.Finish(next)); // beforeunload veto or confirmed native close.
  CHECK(!state.active() && !state.closing());
  CHECK(!state.BeginClose(next));
  const auto retry = state.Begin();
  CHECK(state.CanExpire(retry));
  CHECK(!state.CanExpire(next));
  CHECK(!state.Finish(next)); // A timed-out attempt's late callback cannot cancel retry.
  CHECK(state.Current(retry));
  CHECK(state.BeginClose(retry));
  CHECK(state.Finish(retry));
  const auto timed_out = state.Begin();
  CHECK(state.CanExpire(timed_out));
  CHECK(state.Finish(timed_out));
  CHECK(!state.BeginClose(timed_out)); // Late eligibility result cannot close a page.
  const auto fresh = state.Begin();
  CHECK(!state.Finish(timed_out));
  CHECK(!state.CanExpire(timed_out));
  CHECK(state.Current(fresh));
}
