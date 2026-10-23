#include "browser_agent_input.h"
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <string>
#include <vector>

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

  // A real pointer in every pane, hidden or shown, at any zoom; only a zoom
  // change in flight is refused.
  CHECK(AgentPointerAllowed(false, 1));
  CHECK(AgentPointerAllowed(false, 1.25));
  CHECK(AgentPointerAllowed(false, 0.5));
  CHECK(!AgentPointerAllowed(true, 1));
  CHECK(!AgentPointerAllowed(false, 0));
  CHECK(!AgentPointerAllowed(false, std::numeric_limits<double>::quiet_NaN()));

  // Visual-viewport CSS pixels times the page zoom, inside the view.
  {
    auto point = AgentPointerPoint(100, 50, 1.25, 800, 600);
    CHECK(point && point->x == 125 && point->y == 62.5);
    point = AgentPointerPoint(0, 0, 1, 800, 600);
    CHECK(point && point->x == 0 && point->y == 0);
    CHECK(AgentPointerPoint(799.5, 599.5, 1, 800, 600));
    CHECK(!AgentPointerPoint(700, 10, 1.25, 800, 600));  // 875 is past the view
    CHECK(!AgentPointerPoint(-1, 10, 1, 800, 600));
    CHECK(!AgentPointerPoint(10, 10, 0, 800, 600));
    CHECK(!AgentPointerPoint(std::numeric_limits<double>::infinity(), 10, 1, 800, 600));
    CHECK(!AgentPointerPoint(10, 10, 1, 0, 600));
  }
  // A careful mouse: hover settles before the press, which is held briefly.
  CHECK(kAgentHoverSettleMs >= 30 && kAgentPressHoldMs >= 20 && kAgentPressDelayMs > 0);

  // Never repeat input whose outcome is unknown.
  CHECK(AgentAfterInput(true, false) == AgentInputOutcome::kDone);
  CHECK(AgentAfterInput(false, false) == AgentInputOutcome::kFallBack);
  CHECK(AgentAfterInput(false, true) == AgentInputOutcome::kUnconfirmed);

  // A sent press is always released, even when its reply timed out, so a
  // key or button is never left down. Only a refused press is not released.
  CHECK(AgentNeedsRelease(true, false));
  CHECK(AgentNeedsRelease(false, true));
  CHECK(!AgentNeedsRelease(false, false));
  CHECK(std::string(kAgentKeyUnconfirmed).find("Take a snapshot before retrying") != std::string::npos);
  // Passed through as is: the host rewrites only bare "timed out" errors.
  CHECK(std::string(kAgentKeyUnconfirmed).find("timed out") == std::string::npos);
  CHECK(std::string(kAgentPointerNoReply).find("nothing was pressed") != std::string::npos);

  // Keys: Space types a space and activates buttons; unknown names refuse.
  {
    const auto* space = FindAgentKey("Space");
    CHECK(space && std::string(space->key) == " " && std::string(space->code) == "Space" &&
          space->key_code == 32 && std::string(space->text) == " ");
    const auto* enter = FindAgentKey("Enter");
    CHECK(enter && enter->key_code == 13 && std::string(enter->text) == "\r");
    CHECK(FindAgentKey("Escape") && !FindAgentKey("Escape")->text);
    CHECK(FindAgentKey("ArrowDown") && FindAgentKey("ArrowDown")->key_code == 40);
    CHECK(!FindAgentKey("Meta+Q") && !FindAgentKey("") && !FindAgentKey(" "));
  }

  // File choosers: only the armed tab's own open-file chooser is answered.
  using M = AgentChooserMode;
  using A = AgentChooserAnswer;
  CHECK(DecideAgentChooser(true, true, M::kOpen, 1, true) == A::kAnswer);
  CHECK(DecideAgentChooser(true, true, M::kOpenMultiple, 3, true) == A::kAnswer);
  CHECK(DecideAgentChooser(false, true, M::kOpen, 1, true) == A::kLeaveToUser);  // the user's own
  CHECK(DecideAgentChooser(true, false, M::kOpen, 1, true) == A::kLeaveToUser);  // a popup window
  CHECK(DecideAgentChooser(true, true, M::kSave, 1, true) == A::kLeaveToUser);
  CHECK(DecideAgentChooser(true, true, M::kFolder, 1, true) == A::kLeaveToUser);
  CHECK(DecideAgentChooser(true, true, M::kOpen, 1, false) == A::kRefuseSite);
  CHECK(DecideAgentChooser(true, true, M::kOpen, 2, true) == A::kRefuseCount);
  CHECK(DecideAgentChooser(true, true, M::kOpenMultiple, 0, true) == A::kRefuseCount);
  CHECK(DecideAgentChooser(true, true, M::kOpenMultiple, kAgentUploadMaxFiles + 1, true) == A::kRefuseCount);
  CHECK(kAgentUploadWaitSeconds > 0 && kAgentUploadWaitSeconds <= 5);

  CHECK(AgentUploadSameSite("framer.com", "Framer.com"));
  CHECK(AgentUploadSameSite("framer.com", "framer.com."));
  CHECK(!AgentUploadSameSite("framer.com", "evil.example"));
  CHECK(!AgentUploadSameSite("framer.com", "sub.framer.com"));
  CHECK(!AgentUploadSameSite("", ""));
  CHECK(AgentUploadSameSite("[::1]", "::1"));  // Rust keeps IPv6 brackets; NSURL drops them
  CHECK(!AgentUploadSameSite("[::1]", "::2"));

  // Accept lists inform, never refuse: unknown expansions skip the check.
  {
    using V = std::vector<std::string>;
    CHECK(AgentUploadUnaccepted({"llms.txt"}, {".png", ".svg"}, {"", ""}) == V{"llms.txt"});
    CHECK(AgentUploadUnaccepted({"logo.SVG"}, {".png", ".svg"}, {"", ""}).empty());
    CHECK(AgentUploadUnaccepted({"a.jpg", "b.txt"}, {"image/*"}, {".png;.jpg;.gif"}) == V{"b.txt"});
    CHECK(AgentUploadUnaccepted({"b.txt"}, {"application/x-unknown"}, {""}).empty());
    CHECK(AgentUploadUnaccepted({"README"}, {".md"}, {""}) == V{"README"});
    CHECK(AgentUploadUnaccepted({"b.txt"}, {}, {}).empty());
  }
  std::printf("%d agent input checks passed\n", checks);
}
