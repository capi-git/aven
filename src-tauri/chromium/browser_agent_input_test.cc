#include "browser_agent_input.h"
#include <cstdio>
#include <cstdlib>
#include <limits>

#define CHECK(condition) do { \
  if (!(condition)) { \
    std::fprintf(stderr, "Agent input check failed at line %d: %s\n", __LINE__, #condition); \
    std::abort(); \
  } \
  ++checks; \
} while (false)

using namespace supermono;
static int checks = 0;

int main() {
  // The guard refuses Chromium's system focus requests briefly after an
  // agent action, only while the view is not already focused.
  AgentFocusGuard guard;
  CHECK(!guard.Blocks(true, false, 100));
  guard.Hold(100);
  CHECK(guard.Blocks(true, false, 100.5));
  CHECK(!guard.Blocks(false, false, 100.5));  // navigation focus
  CHECK(!guard.Blocks(true, true, 100.5));    // already the user's focus
  CHECK(!guard.Blocks(true, false, 101.5));   // expired
  // A later, shorter hold never shortens an earlier one.
  guard.Hold(100, 3);
  guard.Hold(100.1, 0.1);
  CHECK(guard.Blocks(true, false, 102.9));
  // The user's own focus request releases it immediately.
  guard.Release();
  CHECK(!guard.Active(100.2));
  CHECK(!guard.Blocks(true, false, 100.2));

  // Pointer presses: on screen, at 100% zoom, with no zoom change pending.
  CHECK(AgentPointerAllowed(true, false, 1));
  CHECK(!AgentPointerAllowed(false, false, 1));  // hidden or occluded pane
  CHECK(!AgentPointerAllowed(true, true, 1));
  CHECK(!AgentPointerAllowed(true, false, 1.25));
  CHECK(!AgentPointerAllowed(true, false, std::numeric_limits<double>::quiet_NaN()));

  // Never repeat input whose outcome is unknown.
  CHECK(AgentAfterInput(true, false) == AgentInputOutcome::kDone);
  CHECK(AgentAfterInput(false, false) == AgentInputOutcome::kFallBack);
  CHECK(AgentAfterInput(false, true) == AgentInputOutcome::kUnconfirmed);
  std::printf("%d agent input checks passed\n", checks);
}
