// Aven's iPhone pane: the live simulator screen, touch, keys and buttons.
//
// Uses Xcode's private CoreSimulator and SimulatorKit frameworks, loaded with
// dlopen at runtime (no link-time dependency). `aven_sim_probe` checks every
// class, selector and symbol before anything else is called; when it fails,
// Aven uses its basic mode (simctl screenshots, XCUITest input) instead.
//
// Functions returning int return 0 on success and write a message to `error`
// (NUL-terminated, truncated to `error_len`) otherwise. View functions must be
// called on the main thread; the others may be called from any thread.
#pragma once
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// The CFBundleVersion of CoreSimulator and of `developer_dir`'s SimulatorKit,
// read from their Info.plist files without loading them. 0 when both exist.
int aven_sim_framework_versions(const char *developer_dir, char *core, size_t core_len, char *kit, size_t kit_len);

// Loads the frameworks for `developer_dir` (Xcode's Contents/Developer) and
// checks the private interfaces. 0 when the live screen and input can be used.
int aven_sim_probe(const char *developer_dir, char *error, size_t error_len);

typedef struct {
  double width;    // portrait framebuffer points
  double height;
  double scale;    // pixels per point
  uint32_t orientation;  // UIKit interface orientation, 1 = portrait
} AvenSimDisplayInfo;

int aven_sim_display_info(const char *udid, AvenSimDisplayInfo *info, char *error, size_t error_len);

// The framebuffer as PNG, turned upright by `quarter_turns` counterclockwise
// turns. Free `*png` with aven_sim_free.
int aven_sim_screenshot_png(const char *udid, uint32_t quarter_turns, uint8_t **png, size_t *png_len,
                            char *error, size_t error_len);
void aven_sim_free(void *pointer);

// phase: 1 down, 2 up, 6 moved. Points are portrait framebuffer points.
// Returns 0 when sent, 1 when a move was dropped by SimulatorKit's 16 ms
// throttle, -1 on error.
int aven_sim_touch(const char *udid, int phase, double x, double y, char *error, size_t error_len);
// button: 0 home, 1 lock. phase: 1 down, 2 up.
int aven_sim_button(const char *udid, int button, int phase, char *error, size_t error_len);
// usage: USB HID keyboard usage (page 7). phase: 1 down, 2 up.
int aven_sim_key(const char *udid, uint32_t usage, int phase, char *error, size_t error_len);
// Forget the cached HID client and display (after a reboot or a backboardd
// restart, the next action connects again).
void aven_sim_reset(const char *udid);

// Native events for Rust: `json` is a small object with "type" and "view".
typedef void (*AvenSimEventCallback)(const char *json, void *context);
void aven_sim_set_event_callback(AvenSimEventCallback callback, void *context);

// A pane's live view inside a window's content view, above `webview` and
// below the floating sidebar. Created hidden.
int aven_sim_view_attach(const char *view_id, void *content_view, void *webview, char *error, size_t error_len);
// Show `udid` live (NULL clears it).
int aven_sim_view_set_device(const char *view_id, const char *udid, char *error, size_t error_len);
// Placement in the webview's CSS points (top-left origin of its viewport).
// `holes` holds `hole_count` × [x, y, width, height, radius] relative to the
// view; they are cut out and pass clicks to the webview.
int aven_sim_view_layout(const char *view_id, double x, double y, double width, double height, int visible,
                         double viewport_height, double clip_left, double clip_right, const double *holes,
                         int hole_count, char *error, size_t error_len);
// The agent's ring at a framebuffer point; colour components 0…1.
int aven_sim_view_marker(const char *view_id, double x, double y, const char *name, double red, double green,
                         double blue, int action);
int aven_sim_view_focus(const char *view_id);
void aven_sim_view_detach(const char *view_id);

// Aven Dev's iPhone check only: a click on the live view at a framebuffer
// point, through its hit test and mouse handlers (no system input), and a
// key press through its key handler. 0 when the view took it.
int aven_sim_view_debug_click(const char *view_id, double x, double y);
int aven_sim_view_debug_key(const char *view_id, unsigned short key_code, const char *characters,
                            unsigned long modifiers);
// Frames the simulator drew and the view showed since it was created, and
// whether its window is on screen (the check's frame-rate step). Main
// thread. 0 when the view exists.
int aven_sim_view_frames(const char *view_id, uint64_t *drawn, uint64_t *shown, int *visible);

// Puts PNG bytes on the Mac clipboard.
int aven_sim_copy_png(const uint8_t *png, size_t png_len, char *error, size_t error_len);

#ifdef __cplusplus
}
#endif
