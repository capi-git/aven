#pragma once

#ifdef __cplusplus
extern "C" {
#endif

// The workspace sidebar's hover peek on macOS. A native host above every live
// browser page in the window holds the app-rendered sidebar, and one Core
// Animation transaction slides it together with the cut-out of the workspace
// webview and the leading edge of each page beneath it.
//
// All calls and callbacks run on the macOS main thread. Strings are borrowed
// for the duration of a call; `owner` is the workspace webview's label.
typedef void (*sm_sidebar_event_cb)(const char *owner, const char *event, const char *json,
                                    void *context);
int sm_sidebar_attach(const char *owner, void *workspace_webview, void *overlay_webview,
                      sm_sidebar_event_cb cb, void *context);
// The workspace document in CSS pixels: the vertical extent the card covers
// (the workspace column) and the reveal edge's extent at the window's left.
int sm_sidebar_workspace(const char *owner, double device_pixel_ratio, double viewport_width,
                         double viewport_height, double cover_top, double cover_bottom,
                         double edge_top, double edge_bottom, int enabled);
// The overlay document in CSS pixels: the sidebar card and every region that
// takes pointer events (the card, its menus and dialogs) as [x, y, w, h] groups.
int sm_sidebar_regions(const char *owner, double device_pixel_ratio, double viewport_width,
                       double viewport_height, double card_x, double card_y, double card_width,
                       double card_height, const double *regions, int region_count);
int sm_sidebar_set_open(const char *owner, int open, int animated);
int sm_sidebar_focus_workspace(const char *owner);
void sm_sidebar_detach(const char *owner);

#ifdef __cplusplus
}

#import <Cocoa/Cocoa.h>
namespace supermono {
// Identifies the host view; live pages stay beneath it in their window.
static NSString *const kFloatingSidebarHostIdentifier = @"aven.floating-sidebar";
}  // namespace supermono
// Live pages in `parent` crop their leading edge up to `edge` points from the
// workspace's left. When `animated`, a crop that starts or ends slides on the
// hover springs; otherwise it applies at once. Defined beside the pages in
// supermono_chromium.mm.
void SMSetFloatingSidebarEdge(NSView *parent, double edge, bool animated);
#endif
