#pragma once
#include <string>

// Whether a website's microphone or camera request can go ahead. Two parties
// must agree: the person, for this site (Aven's prompt, optionally remembered),
// and macOS, for Aven itself (Privacy & Security). This file holds only the
// decision so it can be tested without AppKit, AVFoundation or CEF.
namespace supermono {

// AVAuthorizationStatus for Aven.
enum class MediaSystemAccess { kNotDetermined, kAuthorized, kDenied, kRestricted };
// The person's remembered answer for one website and device.
enum class MediaSiteChoice { kAsk, kAllow, kBlock };

struct MediaDevices {
  bool microphone = false;
  bool camera = false;
  bool any() const { return microphone || camera; }
  bool operator==(const MediaDevices&) const = default;
};

struct MediaAccessState {
  MediaDevices requested;
  // Screen sharing has its own macOS permission; only Aven's prompt applies.
  bool screen = false;
  MediaSiteChoice microphone_site = MediaSiteChoice::kAsk;
  MediaSiteChoice camera_site = MediaSiteChoice::kAsk;
  MediaSystemAccess microphone_system = MediaSystemAccess::kNotDetermined;
  MediaSystemAccess camera_system = MediaSystemAccess::kNotDetermined;
  // The person allowed this request in Aven's prompt.
  bool person_allowed = false;
  // macOS has already been asked during this request.
  bool system_asked = false;
};

enum class MediaAccessStep {
  kBlockedBySite,    // Cancel: a remembered Deny covers a requested device.
  kBlockedBySystem,  // Cancel: macOS refuses Aven a requested device.
  kAskPerson,        // Show Aven's prompt for this site.
  kAskSystem,        // Ask macOS for `devices`, then decide again.
  kAllow,            // Continue with every requested permission.
};

struct MediaAccessDecision {
  MediaAccessStep step;
  // The devices the step is about: blocked, or still to ask macOS for.
  MediaDevices devices;
};

inline bool MediaSystemRefuses(MediaSystemAccess access, bool asked) {
  return access == MediaSystemAccess::kDenied || access == MediaSystemAccess::kRestricted ||
         // macOS answers every request; an unanswered one never allows capture.
         (asked && access == MediaSystemAccess::kNotDetermined);
}

// Call again after each step completes, with the updated state.
inline MediaAccessDecision DecideMediaAccess(const MediaAccessState& s) {
  const MediaDevices& want = s.requested;
  const MediaDevices site_blocked{want.microphone && s.microphone_site == MediaSiteChoice::kBlock,
                                  want.camera && s.camera_site == MediaSiteChoice::kBlock};
  if (site_blocked.any()) return {MediaAccessStep::kBlockedBySite, site_blocked};
  // When macOS already refuses, asking the person first would only lead to a
  // failure they cannot fix from the prompt.
  const MediaDevices system_blocked{
      want.microphone && MediaSystemRefuses(s.microphone_system, s.system_asked),
      want.camera && MediaSystemRefuses(s.camera_system, s.system_asked)};
  if (system_blocked.any()) return {MediaAccessStep::kBlockedBySystem, system_blocked};
  const bool remembered = want.any() && !s.screen &&
                          (!want.microphone || s.microphone_site == MediaSiteChoice::kAllow) &&
                          (!want.camera || s.camera_site == MediaSiteChoice::kAllow);
  if (!s.person_allowed && !remembered) return {MediaAccessStep::kAskPerson, want};
  // macOS shows its own prompt only after the person allowed the site.
  const MediaDevices undetermined{
      want.microphone && s.microphone_system == MediaSystemAccess::kNotDetermined,
      want.camera && s.camera_system == MediaSystemAccess::kNotDetermined};
  if (undetermined.any()) return {MediaAccessStep::kAskSystem, undetermined};
  return {MediaAccessStep::kAllow, want};
}

inline std::string MediaDeviceNames(MediaDevices devices) {
  if (devices.microphone && devices.camera) return "microphone and camera";
  return devices.camera ? "camera" : "microphone";
}

// The Privacy & Security pane to open for a macOS refusal. One button opens
// one pane; the microphone comes first because it is the commoner request.
inline const char* MediaPrivacyAction(MediaDevices blocked) {
  return blocked.microphone || !blocked.camera ? "privacy-microphone" : "privacy-camera";
}

inline const char* MediaPrivacyUrl(const std::string& action) {
  if (action == "privacy-camera")
    return "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";
  if (action == "privacy-microphone")
    return "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
  return nullptr;
}

inline std::string MediaSystemNotice(MediaDevices blocked, const std::string& app_name) {
  return "macOS is blocking " + app_name + " from using the " + MediaDeviceNames(blocked) +
         ". Allow " + app_name + " in System Settings > Privacy & Security, then try again.";
}

inline std::string MediaSiteNotice(MediaDevices blocked) {
  return "You blocked this site from using your " + MediaDeviceNames(blocked) + ".";
}

}  // namespace supermono
