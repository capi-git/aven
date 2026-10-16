#include "browser_media_access.h"
#include <cstdio>
#include <cstdlib>
#include <cstring>

#define CHECK(condition) do { if (!(condition)) { \
  std::fprintf(stderr,"Browser media access failure at %d: %s\n",__LINE__,#condition); \
  std::abort(); } } while (false)

using supermono::DecideMediaAccess;
using supermono::MediaAccessState;
using supermono::MediaAccessStep;
using supermono::MediaDevices;
using supermono::MediaSiteChoice;
using supermono::MediaSystemAccess;

namespace {
MediaAccessState Microphone(MediaSystemAccess system) {
  MediaAccessState state;
  state.requested.microphone = true;
  state.microphone_system = system;
  return state;
}
}  // namespace

int main() {
  // First request on a fresh install: Aven's prompt, then macOS's, then go.
  auto state = Microphone(MediaSystemAccess::kNotDetermined);
  auto decision = DecideMediaAccess(state);
  CHECK(decision.step == MediaAccessStep::kAskPerson);
  CHECK((decision.devices == MediaDevices{true, false}));
  state.person_allowed = true;
  decision = DecideMediaAccess(state);
  CHECK(decision.step == MediaAccessStep::kAskSystem);
  CHECK((decision.devices == MediaDevices{true, false}));
  state.system_asked = true;
  state.microphone_system = MediaSystemAccess::kAuthorized;
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kAllow);
  // The person declines the macOS prompt: cancel with the macOS notice.
  state.microphone_system = MediaSystemAccess::kDenied;
  decision = DecideMediaAccess(state);
  CHECK(decision.step == MediaAccessStep::kBlockedBySystem);
  CHECK((decision.devices == MediaDevices{true, false}));
  // An unanswered macOS request never turns into access or a second ask.
  state.microphone_system = MediaSystemAccess::kNotDetermined;
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kBlockedBySystem);

  // macOS already refuses Aven: say so without asking the person for nothing.
  for (auto system : {MediaSystemAccess::kDenied, MediaSystemAccess::kRestricted}) {
    state = Microphone(system);
    CHECK(DecideMediaAccess(state).step == MediaAccessStep::kBlockedBySystem);
    state.microphone_site = MediaSiteChoice::kAllow;
    CHECK(DecideMediaAccess(state).step == MediaAccessStep::kBlockedBySystem);
  }

  // Already authorized by macOS: only Aven's prompt, unless remembered.
  state = Microphone(MediaSystemAccess::kAuthorized);
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kAskPerson);
  state.microphone_site = MediaSiteChoice::kAllow;
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kAllow);
  // A remembered allow still waits for macOS's first answer.
  state.microphone_system = MediaSystemAccess::kNotDetermined;
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kAskSystem);
  // A remembered deny wins over everything, including a macOS refusal.
  state.microphone_site = MediaSiteChoice::kBlock;
  state.microphone_system = MediaSystemAccess::kDenied;
  decision = DecideMediaAccess(state);
  CHECK(decision.step == MediaAccessStep::kBlockedBySite);
  CHECK((decision.devices == MediaDevices{true, false}));

  // Microphone and camera together: each needs its own answers.
  MediaAccessState both;
  both.requested = {true, true};
  both.microphone_system = MediaSystemAccess::kAuthorized;
  both.camera_system = MediaSystemAccess::kNotDetermined;
  both.microphone_site = MediaSiteChoice::kAllow;
  CHECK(DecideMediaAccess(both).step == MediaAccessStep::kAskPerson);
  both.camera_site = MediaSiteChoice::kAllow;
  decision = DecideMediaAccess(both);
  CHECK(decision.step == MediaAccessStep::kAskSystem);
  CHECK((decision.devices == MediaDevices{false, true}));
  both.system_asked = true;
  both.camera_system = MediaSystemAccess::kDenied;
  decision = DecideMediaAccess(both);
  CHECK(decision.step == MediaAccessStep::kBlockedBySystem);
  CHECK((decision.devices == MediaDevices{false, true}));
  CHECK(std::strcmp(supermono::MediaPrivacyAction(decision.devices), "privacy-camera") == 0);
  both.camera_site = MediaSiteChoice::kBlock;
  decision = DecideMediaAccess(both);
  CHECK(decision.step == MediaAccessStep::kBlockedBySite);
  CHECK((decision.devices == MediaDevices{false, true}));
  // A site choice for a device the page did not request does not apply.
  state = Microphone(MediaSystemAccess::kAuthorized);
  state.camera_site = MediaSiteChoice::kBlock;
  state.camera_system = MediaSystemAccess::kDenied;
  CHECK(DecideMediaAccess(state).step == MediaAccessStep::kAskPerson);

  // Screen sharing is never remembered and has no device authorization here.
  MediaAccessState screen;
  screen.screen = true;
  CHECK(DecideMediaAccess(screen).step == MediaAccessStep::kAskPerson);
  screen.person_allowed = true;
  CHECK(DecideMediaAccess(screen).step == MediaAccessStep::kAllow);
  screen = {};
  screen.screen = true;
  screen.requested.microphone = true;
  screen.microphone_site = MediaSiteChoice::kAllow;
  screen.microphone_system = MediaSystemAccess::kAuthorized;
  CHECK(DecideMediaAccess(screen).step == MediaAccessStep::kAskPerson);

  CHECK(supermono::MediaDeviceNames({true, false}) == "microphone");
  CHECK(supermono::MediaDeviceNames({false, true}) == "camera");
  CHECK(supermono::MediaDeviceNames({true, true}) == "microphone and camera");
  CHECK(std::strcmp(supermono::MediaPrivacyAction({true, true}), "privacy-microphone") == 0);
  CHECK(std::strcmp(supermono::MediaPrivacyUrl("privacy-microphone"),
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone") == 0);
  CHECK(std::strcmp(supermono::MediaPrivacyUrl("privacy-camera"),
                    "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera") == 0);
  CHECK(supermono::MediaPrivacyUrl("site-media-reset") == nullptr);
  CHECK(supermono::MediaPrivacyUrl("") == nullptr);
  CHECK(supermono::MediaSystemNotice({true, false}, "Aven Dev") ==
        "macOS is blocking Aven Dev from using the microphone. Allow Aven Dev in System Settings > "
        "Privacy & Security, then try again.");
  CHECK(supermono::MediaSiteNotice({true, true}) ==
        "You blocked this site from using your microphone and camera.");
  std::puts("Browser media access decisions passed");
}
