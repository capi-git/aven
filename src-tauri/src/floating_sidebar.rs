//! The workspace sidebar's hover peek as a native layer above live browser
//! pages (macOS with Chromium). A transparent child webview renders the app's
//! own sidebar; `chromium/floating_sidebar.mm` hosts it above every page and
//! slides it in one Core Animation commit with the cut-out of the workspace
//! webview and the leading edge of each page. Elsewhere the commands report
//! that the layer is unavailable and the workspace draws its own peek.
use serde::Deserialize;
use tauri::Webview;

pub const OVERLAY_PREFIX: &str = "floating-sidebar-";

/// A document's viewport in CSS pixels and its device pixel ratio.
#[cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    device_pixel_ratio: f64,
    width: f64,
    height: f64,
}

#[cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]
#[derive(Clone, Copy, Debug, Deserialize)]
pub struct Rect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

/// The workspace document's band under the card and its reveal edge.
#[cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGeometry {
    viewport: Viewport,
    cover_top: f64,
    cover_bottom: f64,
    edge_top: f64,
    edge_bottom: f64,
    enabled: bool,
}

/// The overlay document's card and every region that takes pointer events.
#[cfg_attr(not(all(feature = "chromium", target_os = "macos")), allow(dead_code))]
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayRegions {
    viewport: Viewport,
    card: Rect,
    regions: Vec<Rect>,
}

/// The workspace label an overlay webview belongs to.
pub(crate) fn overlay_owner(label: &str) -> Option<&str> {
    label
        .strip_prefix(OVERLAY_PREFIX)
        .filter(|owner| crate::window::is_workspace_label(owner))
}

fn workspace_owner(caller: &Webview) -> Result<String, String> {
    let label = caller.label();
    if crate::window::is_workspace_label(label) {
        Ok(label.to_string())
    } else {
        Err("Only a workspace window has a floating sidebar".into())
    }
}

/// Creates (or reuses) the sidebar layer for the calling workspace and returns
/// the overlay webview's label.
#[tauri::command]
pub async fn floating_sidebar_attach(caller: Webview) -> Result<String, String> {
    imp::attach(caller).await
}

#[tauri::command]
pub fn floating_sidebar_workspace(
    caller: Webview,
    geometry: WorkspaceGeometry,
) -> Result<(), String> {
    let owner = workspace_owner(&caller)?;
    imp::workspace(&caller, owner, geometry)
}

#[tauri::command]
pub fn floating_sidebar_regions(caller: Webview, regions: OverlayRegions) -> Result<(), String> {
    let owner = overlay_owner(caller.label())
        .ok_or("Only the floating sidebar reports its regions")?
        .to_string();
    if regions.regions.len() > 64 {
        return Err("Too many floating sidebar regions".into());
    }
    imp::regions(&caller, owner, regions)
}

#[tauri::command]
pub fn floating_sidebar_set_open(
    caller: Webview,
    open: bool,
    animated: bool,
) -> Result<(), String> {
    let owner = workspace_owner(&caller)?;
    imp::set_open(&caller, owner, open, animated)
}

/// Returns the keyboard to the workspace document after a sidebar action.
#[tauri::command]
pub fn floating_sidebar_focus_workspace(caller: Webview) -> Result<(), String> {
    let owner = match overlay_owner(caller.label()) {
        Some(owner) => owner.to_string(),
        None => workspace_owner(&caller)?,
    };
    imp::focus_workspace(&caller, owner)
}

pub fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    if crate::window::is_workspace_label(label) {
        imp::detach(app, label.to_string());
    }
}

#[cfg(all(feature = "chromium", target_os = "macos"))]
mod imp {
    use super::{OverlayRegions, WorkspaceGeometry, OVERLAY_PREFIX};
    use crate::display_rate::FullRefreshRate;
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::sync::OnceLock;
    use tauri::{
        window::Color, AppHandle, Emitter, EventTarget, LogicalPosition, Manager, Url, Webview,
        WebviewBuilder, WebviewUrl,
    };

    type SidebarEvent =
        unsafe extern "C" fn(*const c_char, *const c_char, *const c_char, *mut c_void);
    extern "C" {
        fn sm_sidebar_attach(
            owner: *const c_char,
            workspace_webview: *mut c_void,
            overlay_webview: *mut c_void,
            cb: SidebarEvent,
            context: *mut c_void,
        ) -> c_int;
        fn sm_sidebar_workspace(
            owner: *const c_char,
            device_pixel_ratio: f64,
            viewport_width: f64,
            viewport_height: f64,
            cover_top: f64,
            cover_bottom: f64,
            edge_top: f64,
            edge_bottom: f64,
            enabled: c_int,
        ) -> c_int;
        fn sm_sidebar_regions(
            owner: *const c_char,
            device_pixel_ratio: f64,
            viewport_width: f64,
            viewport_height: f64,
            card_x: f64,
            card_y: f64,
            card_width: f64,
            card_height: f64,
            regions: *const f64,
            region_count: c_int,
        ) -> c_int;
        fn sm_sidebar_set_open(owner: *const c_char, open: c_int, animated: c_int) -> c_int;
        fn sm_sidebar_focus_workspace(owner: *const c_char) -> c_int;
        fn sm_sidebar_detach(owner: *const c_char);
    }

    static APP: OnceLock<AppHandle> = OnceLock::new();
    const ENTRY: &str = "index.html?floatingSidebar=1";

    /// Native pointer and state reports go to the owning workspace document.
    unsafe extern "C" fn on_event(
        owner: *const c_char,
        event: *const c_char,
        json: *const c_char,
        _context: *mut c_void,
    ) {
        if owner.is_null() || event.is_null() || json.is_null() {
            return;
        }
        let (Some(app), Ok(owner), Ok(event), Ok(json)) = (
            APP.get(),
            CStr::from_ptr(owner).to_str(),
            CStr::from_ptr(event).to_str(),
            CStr::from_ptr(json).to_str(),
        ) else {
            return;
        };
        let payload = serde_json::from_str(json).unwrap_or(serde_json::Value::Null);
        let _ = app.emit_to(
            EventTarget::webview(owner),
            &format!("floating-sidebar-{event}"),
            payload,
        );
    }

    fn allowed_url(url: &Url, expected: &Url) -> bool {
        let mut url = url.clone();
        url.set_fragment(None);
        let mut expected = expected.clone();
        expected.set_fragment(None);
        url == expected
    }

    fn owner_name(owner: &str) -> Result<CString, String> {
        CString::new(owner).map_err(|_| "Invalid workspace label".to_string())
    }

    /// The native view behind a webview, read on the main thread.
    fn native_view(view: &Webview) -> Result<usize, String> {
        let (send, receive) = std::sync::mpsc::sync_channel(1);
        view.with_webview(move |platform| {
            let _ = send.send(platform.inner() as usize);
        })
        .map_err(|error| error.to_string())?;
        receive
            .recv()
            .map_err(|_| "The webview closed before its sidebar attached".to_string())
    }

    pub async fn attach(caller: Webview) -> Result<String, String> {
        let owner = super::workspace_owner(&caller)?;
        let app = caller.app_handle().clone();
        let _ = APP.set(app.clone());
        let label = format!("{OVERLAY_PREFIX}{owner}");
        let overlay = match app.get_webview(&label) {
            Some(existing) => existing,
            None => {
                let expected = caller
                    .url()
                    .map_err(|error| error.to_string())?
                    .join(ENTRY)
                    .map_err(|error| error.to_string())?;
                let window = caller.window();
                let overlay_label = label.clone();
                let builder_app = app.clone();
                crate::usage_panel::on_main(&app, move || {
                    let scale = window.scale_factor().map_err(|error| error.to_string())?;
                    let size = window
                        .inner_size()
                        .map_err(|error| error.to_string())?
                        .to_logical::<f64>(scale);
                    let builder =
                        WebviewBuilder::new(&overlay_label, WebviewUrl::App(ENTRY.into()))
                            .full_refresh_rate(&builder_app)
                            .focused(false)
                            .transparent(true)
                            .background_color(Color(0, 0, 0, 0))
                            .disable_drag_drop_handler()
                            .on_navigation(move |url| allowed_url(url, &expected))
                            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny);
                    window
                        .add_child(builder, LogicalPosition::new(0.0, 0.0), size)
                        .map_err(|error| error.to_string())
                })
                .await?
            }
        };
        let workspace_view = caller.clone();
        let overlay_view = overlay.clone();
        let (workspace, overlay_native) = tauri::async_runtime::spawn_blocking(move || {
            Ok::<_, String>((native_view(&workspace_view)?, native_view(&overlay_view)?))
        })
        .await
        .map_err(|error| error.to_string())??;
        let name = owner_name(&owner)?;
        let attached = crate::usage_panel::on_main(&app, move || {
            let attached = unsafe {
                sm_sidebar_attach(
                    name.as_ptr(),
                    workspace as *mut c_void,
                    overlay_native as *mut c_void,
                    on_event,
                    std::ptr::null_mut(),
                )
            };
            Ok(attached == 1)
        })
        .await?;
        if !attached {
            return Err("The floating sidebar could not attach".into());
        }
        Ok(label)
    }

    fn on_main(view: &Webview, operation: impl FnOnce() + Send + 'static) -> Result<(), String> {
        view.app_handle()
            .run_on_main_thread(operation)
            .map_err(|error| error.to_string())
    }

    pub fn workspace(
        view: &Webview,
        owner: String,
        geometry: WorkspaceGeometry,
    ) -> Result<(), String> {
        let name = owner_name(&owner)?;
        let viewport = geometry.viewport;
        on_main(view, move || unsafe {
            sm_sidebar_workspace(
                name.as_ptr(),
                viewport.device_pixel_ratio,
                viewport.width,
                viewport.height,
                geometry.cover_top,
                geometry.cover_bottom,
                geometry.edge_top,
                geometry.edge_bottom,
                c_int::from(geometry.enabled),
            );
        })
    }

    pub fn regions(view: &Webview, owner: String, regions: OverlayRegions) -> Result<(), String> {
        let name = owner_name(&owner)?;
        let flat: Vec<f64> = regions
            .regions
            .iter()
            .flat_map(|rect| [rect.x, rect.y, rect.width, rect.height])
            .collect();
        let (viewport, card) = (regions.viewport, regions.card);
        on_main(view, move || unsafe {
            sm_sidebar_regions(
                name.as_ptr(),
                viewport.device_pixel_ratio,
                viewport.width,
                viewport.height,
                card.x,
                card.y,
                card.width,
                card.height,
                flat.as_ptr(),
                (flat.len() / 4) as c_int,
            );
        })
    }

    pub fn set_open(
        view: &Webview,
        owner: String,
        open: bool,
        animated: bool,
    ) -> Result<(), String> {
        let name = owner_name(&owner)?;
        on_main(view, move || unsafe {
            sm_sidebar_set_open(name.as_ptr(), c_int::from(open), c_int::from(animated));
        })
    }

    pub fn focus_workspace(view: &Webview, owner: String) -> Result<(), String> {
        let name = owner_name(&owner)?;
        on_main(view, move || unsafe {
            sm_sidebar_focus_workspace(name.as_ptr());
        })
    }

    pub fn detach(app: &AppHandle, owner: String) {
        let Ok(name) = owner_name(&owner) else {
            return;
        };
        let _ = app.run_on_main_thread(move || unsafe { sm_sidebar_detach(name.as_ptr()) });
    }
}

#[cfg(not(all(feature = "chromium", target_os = "macos")))]
mod imp {
    use super::{OverlayRegions, WorkspaceGeometry};
    use tauri::{AppHandle, Webview};

    const UNAVAILABLE: &str = "The native floating sidebar is unavailable on this build";

    pub async fn attach(_caller: Webview) -> Result<String, String> {
        Err(UNAVAILABLE.into())
    }
    pub fn workspace(_: &Webview, _: String, _: WorkspaceGeometry) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn regions(_: &Webview, _: String, _: OverlayRegions) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn set_open(_: &Webview, _: String, _: bool, _: bool) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn focus_workspace(_: &Webview, _: String) -> Result<(), String> {
        Err(UNAVAILABLE.into())
    }
    pub fn detach(_: &AppHandle, _: String) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_workspace_overlays_have_owners() {
        assert_eq!(overlay_owner("floating-sidebar-main"), Some("main"));
        assert_eq!(overlay_owner("floating-sidebar-window-3"), Some("window-3"));
        assert_eq!(overlay_owner("floating-sidebar-usage-panel-1"), None);
        assert_eq!(overlay_owner("floating-sidebar-"), None);
        assert_eq!(overlay_owner("main"), None);
    }

    #[test]
    fn geometry_deserializes_from_the_renderer_shape() {
        let geometry: WorkspaceGeometry = serde_json::from_value(serde_json::json!({
            "viewport": { "devicePixelRatio": 2, "width": 1440, "height": 900 },
            "coverTop": 40, "coverBottom": 900, "edgeTop": 0, "edgeBottom": 870,
            "enabled": true
        }))
        .unwrap();
        assert!(geometry.enabled);
        let regions: OverlayRegions = serde_json::from_value(serde_json::json!({
            "viewport": { "devicePixelRatio": 2, "width": 1440, "height": 900 },
            "card": { "x": 5, "y": 5, "width": 260, "height": 890 },
            "regions": [{ "x": 5, "y": 5, "width": 260, "height": 890 }]
        }))
        .unwrap();
        assert_eq!(regions.regions.len(), 1);
    }
}
