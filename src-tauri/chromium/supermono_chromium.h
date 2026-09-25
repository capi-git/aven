#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// All calls and callbacks run on the macOS main thread. Strings are borrowed
// for the duration of a call. Browser IDs remain owned by the Rust caller.
typedef void (*sm_chromium_event_cb)(const char *id, const char *json, void *context);
int sm_chromium_initialize(const char *config_json, sm_chromium_event_cb cb, void *context);
int sm_chromium_create(const char *id, void *parent_nsview, const char *url,
                      const char *profile_path, double x, double y, double w, double h);
int sm_chromium_layout(const char *id, double x, double y, double w, double h,
                       int visible, double clip_left, double clip_right, double viewport_height,
                       double bottom_corner_radius);
int sm_chromium_reparent(const char *id, void *parent_nsview, double x, double y,
                        double w, double h, double auto_resize_top_inset);
int sm_chromium_command(const char *id, const char *request_id, const char *request_json);
// Opens asynchronously; the result callback arrives only after menu dismissal.
int sm_chromium_menu(const char *id, const char *request_id, void *anchor_parent_nsview,
                     const char *request_json);
int sm_chromium_close(const char *id);
int sm_chromium_is_focused(const char *id);
int sm_chromium_live_browser_count(void);
int sm_chromium_cancel_update(void);
void sm_chromium_shutdown(void);
const char *sm_chromium_last_error(void);

#ifdef __cplusplus
}
#endif
