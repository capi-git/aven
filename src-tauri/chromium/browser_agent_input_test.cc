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
  // After confirm: move only to a named point; a direct click or a covered
  // hover (no point) is reported as it is, never as "Invalid pointer point".
  CHECK(AgentAfterConfirm(true, true) == AgentConfirmNext::kMove);
  CHECK(AgentAfterConfirm(true, false) == AgentConfirmNext::kReport);
  CHECK(AgentAfterConfirm(false, true) == AgentConfirmNext::kReport);
  CHECK(AgentAfterConfirm(false, false) == AgentConfirmNext::kReport);

  // The upload flow: one result, armed only around the steps that can open a
  // chooser, never past its deadline or the user's own input.
  {
    AgentUploadGate gate;
    CHECK(!gate.Pending() && !gate.Armed(0));
    CHECK(gate.Begin(1, 100));
    CHECK(!gate.Begin(2, 100));  // one upload per page
    CHECK(gate.Pending() && !gate.Armed(100));  // approved, not yet armed
    gate.Arm(1, true);  // around the aim step, which may click directly
    CHECK(gate.Armed(100.1));
    gate.Arm(1, false);  // the aim only chose a point
    CHECK(!gate.Armed(100.2));  // a chooser now (the user's) is left alone
    gate.Arm(2, true);  // a stale id never arms
    CHECK(!gate.Armed(100.2));
    gate.Arm(1, true);  // right before the press
    gate.Clicked(1, 101);
    CHECK(gate.Armed(105.9));
    CHECK(!gate.Expired(105.9));
    CHECK(gate.Expired(106));  // no chooser within the wait after the click
    CHECK(!gate.Armed(106));
    CHECK(gate.Finish(1));
    CHECK(!gate.Finish(1));  // the result is sent once
    CHECK(!gate.Pending() && !gate.Armed(106));
    // A chooser answered during the click: the later click result is stale.
    CHECK(gate.Begin(3, 200));
    gate.Arm(3, true);
    CHECK(gate.Finish(3));
    gate.Clicked(3, 200.5);
    CHECK(!gate.Pending() && !gate.Armed(200.5));
    // The deadline bounds everything, even a click near its end.
    CHECK(gate.Begin(4, 300));
    gate.Arm(4, true);
    gate.Clicked(4, 300 + kAgentUploadDeadlineSeconds - 1);
    CHECK(gate.Expired(300 + kAgentUploadDeadlineSeconds));
    CHECK(gate.Begin(5, 400) == false);  // still pending until finished
    CHECK(gate.Cancel());  // the user clicked in the page, or the host gave up
    CHECK(!gate.Cancel());
    CHECK(gate.Begin(5, 400) && gate.id() == 5);
    CHECK(gate.Expired(400 + kAgentUploadDeadlineSeconds));
    CHECK(kAgentUploadDeadlineSeconds < 40);  // the host waits 40 s
  }
  {
    // An agent's keys never make a page the user's; the user's first key,
    // click, drop or annotation does, and is reported once.
    UserTouch touch;
    CHECK(!touch.Key(1));
    CHECK(!touch.Key(2));
    CHECK(!touch.Touched(false));
    CHECK(touch.Touched(true));  // annotating right now
    CHECK(touch.Key(0));
    CHECK(touch.Touched(false));
    CHECK(!touch.Key(0));
    CHECK(!touch.Pointer());
    UserTouch clicked;
    CHECK(clicked.Pointer());
    CHECK(clicked.Touched(false));
    UserTouch annotated;
    CHECK(annotated.Annotate());
    CHECK(!annotated.Annotate());
    CHECK(annotated.Touched(false));  // stays the user's after the card closes
  }
  std::printf("%d agent input checks passed\n", checks);
}
