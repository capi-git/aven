#pragma once

namespace supermono {

// The workspace's Control and Control-Option chords a focused page would
// otherwise keep: Chromium hands the app only its Command keys (through the
// menu). Pane keys are Cydonia's. Returns the action the app hears, or null.
// `key_code` is the Windows virtual-key code CEF reports.
// Letters are the layout's (CEF's code follows the character the key types),
// matching the workspace's own key handling on AZERTY and QWERTZ.
inline const char* WorkspaceKey(int key_code, bool command, bool control,
                                bool option, bool shift) {
  constexpr int kTab = 0x09, kPageUp = 0x21, kPageDown = 0x22, kW = 0x57,
                kZ = 0x5A;
  if (command || !control) return nullptr;
  if (!option) {
    if (key_code == kTab) return shift ? "prev-tab" : "next-tab";
    return nullptr;
  }
  if (key_code == kTab) return shift ? "prev-pane" : "next-pane";
  if (key_code == kPageDown) return "next-pane";
  if (key_code == kPageUp) return "prev-pane";
  if (shift) return nullptr;
  if (key_code == kZ) return "zoom-pane";
  if (key_code == kW) return "close-pane";
  return nullptr;
}

}  // namespace supermono
