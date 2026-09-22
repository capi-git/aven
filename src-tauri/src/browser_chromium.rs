//! Chromium pages are native child views. Only the trusted workspace can control
//! them; remote documents never receive Tauri IPC or agent credentials.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, EventTarget, Manager, Url, Webview, Window};

type NativeEvent = unsafe extern "C" fn(*const c_char, *const c_char, *mut c_void);
extern "C" {
    fn sm_chromium_initialize(
        config: *const c_char,
        callback: NativeEvent,
        context: *mut c_void,
    ) -> c_int;
    fn sm_chromium_create(
        id: *const c_char,
        parent: *mut c_void,
        url: *const c_char,
        profile: *const c_char,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    ) -> c_int;
    fn sm_chromium_layout(
        id: *const c_char,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        visible: c_int,
        clip_left: f64,
        clip_right: f64,
        viewport_height: f64,
    ) -> c_int;
    fn sm_chromium_reparent(
        id: *const c_char,
        parent: *mut c_void,
        x: f64,
        y: f64,
        width: f64,
        height: f64,
        auto_resize_top_inset: f64,
    ) -> c_int;
    fn sm_chromium_command(
        id: *const c_char,
        request_id: *const c_char,
        request: *const c_char,
    ) -> c_int;
    fn sm_chromium_menu(
        id: *const c_char,
        request_id: *const c_char,
        parent: *mut c_void,
        request: *const c_char,
    ) -> c_int;
    fn sm_chromium_close(id: *const c_char) -> c_int;
    fn sm_chromium_is_focused(id: *const c_char) -> c_int;
    fn sm_chromium_live_browser_count() -> c_int;
    fn sm_chromium_shutdown();
    fn sm_chromium_last_error() -> *const c_char;
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
    #[serde(default)]
    clip_left: f64,
    #[serde(default)]
    clip_right: f64,
    #[serde(default)]
    viewport_height: Option<f64>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMenuOptions {
    can_add_to_chat: bool,
    can_float: bool,
    floating: bool,
    can_use_page: bool,
}

impl BrowserBounds {
    fn validate(&self) -> Result<(), String> {
        let values = [self.x, self.y, self.width, self.height, self.scale];
        if values.iter().any(|value| !value.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.scale <= 0.0
            || self.scale > 8.0
            || values[..4].iter().any(|value| *value > 32768.0)
            || !self.clip_left.is_finite()
            || !self.clip_right.is_finite()
            || self.clip_left < 0.0
            || self.clip_right < 0.0
            || self.clip_left + self.clip_right > self.width
            || self
                .viewport_height
                .is_some_and(|height| !height.is_finite() || height <= 0.0 || height > 32768.0)
        {
            return Err("Invalid browser bounds".into());
        }
        Ok(())
    }
    fn points(&self, native_scale: f64) -> Result<[f64; 4], String> {
        self.validate()?;
        if !native_scale.is_finite() || native_scale <= 0.0 {
            return Err("Invalid display scale".into());
        }
        let ratio = self.scale / native_scale;
        Ok([
            self.x * ratio,
            self.y * ratio,
            self.width * ratio,
            self.height * ratio,
        ])
    }
    fn clip_points(&self, native_scale: f64) -> Result<[f64; 2], String> {
        // Use the same zoom/Retina conversion as the full browser viewport.
        self.points(native_scale)?;
        let ratio = self.scale / native_scale;
        let left = self.clip_left * ratio;
        // Keep a fully covered viewport valid despite floating-point rounding.
        let right = (self.clip_right * ratio).min(self.width * ratio - left);
        Ok([left, right])
    }
    fn viewport_points(&self, native_scale: f64) -> Result<f64, String> {
        self.points(native_scale)?;
        Ok(self.viewport_height.unwrap_or(0.0) * self.scale / native_scale)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserState {
    id: String,
    url: String,
    title: String,
    favicon: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    error: Option<String>,
    notice: Option<String>,
    focused: bool,
    floating: bool,
    zoom_factor: f64,
    find_result: Option<Value>,
    engine: &'static str,
    native_menus: bool,
    native_drop_indicator: bool,
    closed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDownload {
    id: String,
    filename: String,
    received_bytes: u64,
    total_bytes: Option<u64>,
    state: String,
    error: Option<String>,
    #[serde(skip)]
    path: Option<PathBuf>,
}

#[derive(Default, Clone)]
struct Placement {
    window: Option<String>,
    detached_window: Option<String>,
    detached_bounds: Option<BrowserBounds>,
    detached_visible: bool,
    awaiting_layout: bool,
    dock_bounds: Option<BrowserBounds>,
    dock_visible: bool,
}
struct PageContext {
    caller: Webview,
    root: String,
    native_id: String,
    state: Mutex<BrowserState>,
    downloads: Mutex<Vec<BrowserDownload>>,
    pending_toolbar: Mutex<Option<String>>,
    delegate: Mutex<Option<String>>,
    placement: tauri::async_runtime::Mutex<Placement>,
    closed: AtomicBool,
}

#[derive(Clone)]
pub(crate) struct ChromiumPage(Arc<PageContext>);
struct Pending {
    native_id: String,
    sender: mpsc::Sender<Result<Value, String>>,
}
#[derive(Default)]
struct Registry {
    roots: HashMap<String, Arc<PageContext>>,
    pages: HashMap<String, Arc<PageContext>>,
    floating: HashMap<String, String>,
    pending: HashMap<String, Pending>,
    creating: HashMap<String, mpsc::Sender<Result<(), String>>>,
    closing: HashMap<String, mpsc::Sender<()>>,
}
static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
static INITIALIZED: AtomicBool = AtomicBool::new(false);
static NEXT: AtomicU64 = AtomicU64::new(1);
fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

pub(crate) async fn ensure_update_idle(app: &AppHandle) -> Result<(), String> {
    {
        let entries = registry()
            .lock()
            .map_err(|_| "Browser activity could not be checked")?;
        if !entries.roots.is_empty() || !entries.creating.is_empty() || !entries.closing.is_empty()
        {
            return Err(crate::window::UPDATE_BROWSER_BUSY.into());
        }
    }
    if INITIALIZED.load(Ordering::Acquire)
        && on_main(app, || Ok(unsafe { sm_chromium_live_browser_count() })).await? != 0
    {
        return Err(crate::window::UPDATE_BROWSER_BUSY.into());
    }
    Ok(())
}
fn string(value: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| "Browser input contains a null character".into())
}
fn native_result(code: c_int) -> Result<(), String> {
    if code != 0 {
        return Ok(());
    }
    let pointer = unsafe { sm_chromium_last_error() };
    let message = if pointer.is_null() {
        "Chromium operation failed".into()
    } else {
        unsafe { CStr::from_ptr(pointer) }
            .to_string_lossy()
            .chars()
            .take(1000)
            .collect()
    };
    Err(message)
}

async fn on_main<T: Send + 'static>(
    app: &AppHandle,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = send.send(operation());
    })
    .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        receive
            .recv_timeout(Duration::from_secs(20))
            .map_err(|_| "Chromium did not respond".to_string())?
    })
    .await
    .map_err(|error| error.to_string())?
}

fn wait_for_shutdown_completion(receive: mpsc::Receiver<()>) -> Result<(), String> {
    receive
        .recv()
        .map_err(|_| "Chromium shutdown completion was lost".to_string())
}

async fn shutdown_on_main(app: &AppHandle) -> Result<(), String> {
    let (send, receive) = mpsc::channel();
    app.run_on_main_thread(move || {
        shutdown();
        let _ = send.send(());
    })
    .map_err(|error| error.to_string())?;
    // CefShutdown is irreversible and cannot be cancelled by dropping this
    // receiver. A macOS Keychain prompt can delay it beyond the normal command
    // timeout; finish the authorized quit when CEF returns instead of leaving
    // an interactive window whose engine has already been shut down.
    tauri::async_runtime::spawn_blocking(move || wait_for_shutdown_completion(receive))
        .await
        .map_err(|error| error.to_string())?
}

/// Called only on the Cocoa main thread; a single runtime serves all pages.
fn initialize(app: &AppHandle) -> Result<PathBuf, String> {
    let cache = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("browser/chromium");
    if !INITIALIZED.load(Ordering::Acquire) {
        std::fs::create_dir_all(&cache)
            .map_err(|error| format!("Could not create Chromium profile: {error}"))?;
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let contents = executable
            .parent()
            .and_then(|path| path.parent())
            .ok_or("Aven app bundle is unavailable")?;
        let frameworks = contents.join("Frameworks");
        let framework = frameworks.join("Chromium Embedded Framework.framework");
        let helper = frameworks.join("Supermono Helper.app/Contents/MacOS/Supermono Helper");
        if !framework.exists() || !helper.exists() {
            return Err("Chromium is missing from this app bundle. Reinstall the complete Aven application.".into());
        }
        let config = string(
            &json!({
                "frameworkPath": framework.to_string_lossy(),
                "resourcesPath": framework.join("Resources").to_string_lossy(),
                "helperPath": helper.to_string_lossy(),
                "cachePath": cache.to_string_lossy(),
                "devUrl": app.config().build.dev_url.as_ref().map(Url::as_str),
            })
            .to_string(),
        )?;
        native_result(unsafe {
            sm_chromium_initialize(config.as_ptr(), native_event, std::ptr::null_mut())
        })?;
        INITIALIZED.store(true, Ordering::Release);
    }
    Ok(cache)
}

unsafe fn content_view(window: &Window) -> Result<*mut c_void, String> {
    let native = window.ns_window().map_err(|error| error.to_string())?;
    let view: *mut objc2::runtime::AnyObject =
        objc2::msg_send![native as *mut objc2::runtime::AnyObject, contentView];
    if view.is_null() {
        Err("Browser window has no content view".into())
    } else {
        Ok(view.cast())
    }
}

pub(crate) fn label(caller: &Webview, id: &str) -> Result<String, String> {
    let delegated = crate::workspace_window::owner_for_child(caller.app_handle(), caller.label());
    let name = delegated.as_deref().unwrap_or(caller.label());
    if name != "main"
        && !(name.starts_with("window-")
            && name.len() > 7
            && name[7..].chars().all(|c| c.is_ascii_digit()))
    {
        return Err("Only the app interface can control browsers".into());
    }
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid browser identifier".into());
    }
    Ok(format!("preview-{name}-{id}"))
}

fn allowed_url(url: &Url, dev: Option<&Url>) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(
            url.host_str(),
            Some("tauri.localhost" | "asset.localhost" | "ipc.localhost")
        )
        && !dev.is_some_and(|dev| url.origin() == dev.origin())
}
pub(crate) fn parse_url(caller: &Webview, value: &str) -> Result<Url, String> {
    if value.len() > 16384 {
        return Err("Web address is too long".into());
    }
    let url = Url::parse(value).map_err(|_| "Invalid web address".to_string())?;
    if !allowed_url(&url, caller.app_handle().config().build.dev_url.as_ref()) {
        return Err("The browser supports external HTTP/HTTPS addresses and local development servers, but cannot open Aven's app address".into());
    }
    Ok(url)
}

pub(crate) fn preview(caller: &Webview, id: &str) -> Result<ChromiumPage, String> {
    let root = label(caller, id)?;
    let context = registry()
        .lock()
        .map_err(|_| "Browser is unavailable")?
        .roots
        .get(&root)
        .cloned()
        .ok_or("Browser is closed")?;
    if context.closed.load(Ordering::Acquire)
        || (context.caller.label() != caller.label()
            && context
                .delegate
                .lock()
                .ok()
                .is_none_or(|d| d.as_deref() != Some(caller.label())))
    {
        return Err("Browser is closed or belongs to another window".into());
    }
    Ok(ChromiumPage(context))
}
pub(crate) fn agent_tab_states(caller: &Webview, ids: &[String]) -> Vec<Value> {
    ids.iter()
        .filter_map(|id| {
            let page = preview(caller, id).ok()?;
            let state = page.0.state.lock().ok()?;
            serde_json::to_value(&*state).ok()
        })
        .collect()
}
fn emit_state(context: &PageContext) {
    let state = context.state.lock().ok().map(|state| state.clone());
    if let Some(state) = state {
        let _ = context.caller.emit_to(
            EventTarget::webview(context.caller.label()),
            "browser-state",
            state.clone(),
        );
        if let Some(label) = context.delegate.lock().ok().and_then(|d| d.clone()) {
            let _ = context
                .caller
                .emit_to(EventTarget::webview(label), "browser-state", state);
        }
    }
}
fn notice(context: &PageContext, message: String) {
    if let Ok(mut state) = context.state.lock() {
        state.notice = Some(message);
    }
    emit_state(context);
}

unsafe extern "C" fn native_event(id: *const c_char, payload: *const c_char, _: *mut c_void) {
    // No panic or borrowed native string may escape the FFI callback.
    let _ = std::panic::catch_unwind(|| {
        if id.is_null() || payload.is_null() {
            return;
        }
        let id = unsafe { CStr::from_ptr(id) }.to_string_lossy();
        let bytes = unsafe { CStr::from_ptr(payload) }.to_bytes();
        if bytes.len() > 16 * 1024 * 1024 {
            return;
        }
        let Ok(event) = serde_json::from_slice::<Value>(bytes) else {
            return;
        };
        handle_event(&id, event);
    });
}

fn edit_screenshot_payload(value: &Value) -> Option<Value> {
    use base64::Engine;
    let data_url = value.get("dataUrl")?.as_str()?;
    let data = data_url.strip_prefix("data:image/png;base64,")?;
    if data.is_empty() || data.len() > 8 * 1024 * 1024 {
        return None;
    }
    let png = base64::engine::general_purpose::STANDARD
        .decode(data)
        .ok()?;
    if png.get(..16)? != b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" {
        return None;
    }
    let width = u32::from_be_bytes(png.get(16..20)?.try_into().ok()?);
    let height = u32::from_be_bytes(png.get(20..24)?.try_into().ok()?);
    if width == 0
        || height == 0
        || width > 4096
        || height > 4096
        || u64::from(width) * u64::from(height) > 8 * 1024 * 1024
        || value.get("width")?.as_u64()? != u64::from(width)
        || value.get("height")?.as_u64()? != u64::from(height)
    {
        return None;
    }
    Some(json!({"dataUrl":data_url,"width":width,"height":height}))
}

fn edit_event_payload(id: &str, event: &Value) -> Option<Value> {
    let active = event.get("active")?.as_bool()?;
    let token = event.get("token")?.as_str()?;
    if token.is_empty() || token.len() > 128 {
        return None;
    }
    let mut payload = json!({"id":id,"active":active,"token":token});
    if let Some(error) = event.get("error").and_then(Value::as_str) {
        payload["error"] = Value::String(error.chars().take(500).collect());
    }
    if let Some(selection) = event.get("selection") {
        let mut safe = json!({});
        for (name, limit) in [
            ("url", 2048),
            ("title", 240),
            ("selector", 2048),
            ("tag", 64),
            ("text", 1000),
        ] {
            let value = selection.get(name)?.as_str()?;
            if value.chars().count() > limit {
                return None;
            }
            safe[name] = Value::String(value.to_owned());
        }
        payload["selection"] = safe;
        payload["screenshot"] = edit_screenshot_payload(event.get("screenshot")?)?;
    }
    if let Some(comment) = event.get("comment") {
        let comment = comment.as_str()?;
        // The annotation is a user-authored commit, never page-supplied text or
        // an intermediate picker event. Keep it bound to the validated image.
        if active
            || payload.get("selection").is_none()
            || comment.trim().is_empty()
            || comment.chars().count() > 4000
        {
            return None;
        }
        payload["comment"] = Value::String(comment.to_owned());
    }
    Some(payload)
}

fn handle_event(native_id: &str, event: Value) {
    let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
    if kind == "result" {
        let Some(request) = event.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let pending = {
            let mut entries = registry().lock().unwrap_or_else(|error| error.into_inner());
            if !entries
                .pending
                .get(request)
                .is_some_and(|pending| pending.native_id == native_id)
            {
                return;
            }
            entries.pending.remove(request)
        };
        if let Some(pending) = pending {
            let result = if event.get("ok").and_then(Value::as_bool) == Some(true) {
                Ok(event.get("result").cloned().unwrap_or(Value::Null))
            } else {
                Err(event
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Browser operation failed")
                    .chars()
                    .take(1000)
                    .collect())
            };
            let _ = pending.sender.send(result);
        }
        return;
    }
    let context = registry()
        .lock()
        .ok()
        .and_then(|entries| entries.pages.get(native_id).cloned());
    let Some(context) = context else {
        return;
    };
    match kind {
        "edit" => {
            if let Some(id) = context.state.lock().ok().map(|state| state.id.clone()) {
                if let Some(payload) = edit_event_payload(&id, &event) {
                    let label = context
                        .delegate
                        .lock()
                        .ok()
                        .and_then(|d| d.clone())
                        .unwrap_or_else(|| context.caller.label().into());
                    let _ = context.caller.emit_to(
                        EventTarget::webview(label),
                        "browser-edit",
                        payload,
                    );
                }
            }
        }
        "created" => {
            if let Some(sender) = registry()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .creating
                .remove(native_id)
            {
                let _ = sender.send(Ok(()));
            }
        }
        "state" => {
            if let Ok(mut state) = context.state.lock() {
                if let Some(value) = event.get("url").and_then(Value::as_str) {
                    state.url = value.chars().take(16384).collect();
                }
                if let Some(value) = event.get("title").and_then(Value::as_str) {
                    state.title = value.chars().take(1000).collect();
                }
                if let Some(value) = event.get("favicon").and_then(Value::as_str) {
                    state.favicon =
                        if value.len() <= 32768 && value.starts_with("data:image/png;base64,") {
                            value.to_string()
                        } else {
                            String::new()
                        };
                }
                if let Some(value) = event.get("loading").and_then(Value::as_bool) {
                    state.loading = value;
                }
                if let Some(value) = event.get("canGoBack").and_then(Value::as_bool) {
                    state.can_go_back = value;
                }
                if let Some(value) = event.get("canGoForward").and_then(Value::as_bool) {
                    state.can_go_forward = value;
                }
                if let Some(value) = event.get("focused").and_then(Value::as_bool) {
                    state.focused = value;
                }
                if let Some(value) = event
                    .get("zoomFactor")
                    .and_then(Value::as_f64)
                    .filter(|value| value.is_finite() && *value > 0.0)
                {
                    state.zoom_factor = value;
                }
                if let Some(value) = event.get("error") {
                    state.error = value
                        .as_str()
                        .map(|value| value.chars().take(1000).collect());
                }
                if let Some(value) = event.get("notice") {
                    state.notice = value
                        .as_str()
                        .map(|value| value.chars().take(1000).collect());
                }
                if let Some(value) = event.get("findResult") {
                    state.find_result = (!value.is_null()).then(|| value.clone());
                }
            }
            emit_state(&context);
        }
        "toolbar" => {
            if let Some(action @ ("find" | "address")) = event.get("action").and_then(Value::as_str)
            {
                route_toolbar_command(context, action.to_string());
            }
        }
        "download" => {
            if let Some(download) = event.get("download").and_then(parse_download) {
                let downloads = {
                    let mut downloads = context.downloads.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(existing) = downloads.iter_mut().find(|item| item.id == download.id)
                    {
                        let path = download.path.clone().or_else(|| existing.path.clone());
                        *existing = download;
                        existing.path = path;
                    } else {
                        downloads.insert(0, download);
                    }
                    // Retain active transfers even when the recent-history limit is reached.
                    let mut completed = 0;
                    downloads.retain(|item| {
                        if item.state == "in-progress" {
                            true
                        } else {
                            completed += 1;
                            completed <= 100
                        }
                    });
                    downloads.clone()
                };
                let id = context.state.lock().ok().map(|state| state.id.clone());
                if let Some(id) = id {
                    let _ = context.caller.emit_to(
                        EventTarget::webview(
                            context
                                .delegate
                                .lock()
                                .ok()
                                .and_then(|d| d.clone())
                                .unwrap_or_else(|| context.caller.label().into()),
                        ),
                        "browser-downloads",
                        json!({"id":id,"downloads":downloads}),
                    );
                }
            }
        }
        "closed" => {
            if let Some(sender) = registry()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .closing
                .remove(native_id)
            {
                let _ = sender.send(());
            }
            let requested = context.closed.swap(true, Ordering::AcqRel);
            remove_context(&context);
            if !requested {
                if let Ok(mut state) = context.state.lock() {
                    state.loading = false;
                    state.closed = true;
                    state.error = Some("This browser page closed. Retry to reopen it.".into());
                }
                emit_state(&context);
            }
        }
        "error" => notice(
            &context,
            event
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Chromium reported an error")
                .chars()
                .take(1000)
                .collect(),
        ),
        _ => {}
    }
}

fn parse_download(value: &Value) -> Option<BrowserDownload> {
    let id = value
        .get("id")?
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.get("id")?.as_u64().map(|id| id.to_string()))?;
    if id.len() > 80 {
        return None;
    }
    let state = value.get("state")?.as_str()?;
    if !matches!(state, "in-progress" | "completed" | "cancelled" | "failed") {
        return None;
    }
    Some(BrowserDownload {
        id,
        filename: value.get("filename")?.as_str()?.chars().take(255).collect(),
        received_bytes: value.get("receivedBytes").and_then(byte_count).unwrap_or(0),
        total_bytes: value.get("totalBytes").and_then(byte_count),
        state: state.into(),
        error: value
            .get("error")
            .and_then(Value::as_str)
            .map(|error| error.chars().take(500).collect()),
        path: value
            .get("path")
            .and_then(Value::as_str)
            .map(PathBuf::from)
            .filter(|path| path.is_absolute()),
    })
}

fn byte_count(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| {
        value
            .as_f64()
            .filter(|value| {
                value.is_finite()
                    && *value >= 0.0
                    && *value < u64::MAX as f64
                    && value.fract() == 0.0
            })
            .map(|value| value as u64)
    })
}

fn remove_context(context: &Arc<PageContext>) {
    let pending = {
        let mut entries = registry().lock().unwrap_or_else(|e| e.into_inner());
        if entries
            .roots
            .get(&context.root)
            .is_some_and(|entry| Arc::ptr_eq(entry, context))
        {
            entries.roots.remove(&context.root);
        }
        entries.pages.remove(&context.native_id);
        if let Some(sender) = entries.creating.remove(&context.native_id) {
            let _ = sender.send(Err("Browser closed while opening".into()));
        }
        let ids = entries
            .pending
            .iter()
            .filter(|(_, item)| item.native_id == context.native_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        ids.iter()
            .filter_map(|id| entries.pending.remove(id))
            .collect::<Vec<_>>()
    };
    for pending in pending {
        let _ = pending.sender.send(Err("Browser is closed".into()));
    }
}

fn wait_for_command_result(
    receiver: mpsc::Receiver<Result<Value, String>>,
    timeout: Option<Duration>,
) -> Result<Value, String> {
    if let Some(timeout) = timeout {
        receiver.recv_timeout(timeout).map_err(|_| {
            "Browser operation timed out. Retry after the page finishes loading.".to_string()
        })?
    } else {
        receiver
            .recv()
            .map_err(|_| "Browser menu closed without a result".to_string())?
    }
}

impl ChromiumPage {
    pub(crate) async fn command(&self, request: Value) -> Result<Value, String> {
        self.request(request, None).await
    }

    async fn request(
        &self,
        mut request: Value,
        menu_anchor: Option<(Window, BrowserBounds)>,
    ) -> Result<Value, String> {
        if self.0.closed.load(Ordering::Acquire) {
            return Err("Browser is closed".into());
        }
        let id = self.0.native_id.clone();
        let request_id = uuid::Uuid::new_v4().to_string();
        let (sender, receiver) = mpsc::channel();
        {
            let mut entries = registry().lock().map_err(|_| "Browser is unavailable")?;
            if entries.pending.len() >= 128 {
                return Err("Browser is busy. Retry shortly.".into());
            }
            entries.pending.insert(
                request_id.clone(),
                Pending {
                    native_id: id.clone(),
                    sender,
                },
            );
        }
        let native_id = string(&id)?;
        let native_request_id = string(&request_id)?;
        let is_menu = menu_anchor.is_some();
        let result = on_main(self.0.caller.app_handle(), move || {
            if let Some((window, bounds)) = menu_anchor {
                let scale = window.scale_factor().map_err(|error| error.to_string())?;
                let [x, y, width, height] = bounds.points(scale)?;
                request["x"] = json!(x);
                request["y"] = json!(y);
                request["width"] = json!(width);
                request["height"] = json!(height);
                request["viewportHeight"] = json!(bounds.viewport_points(scale)?);
                let request = string(&request.to_string())?;
                native_result(unsafe {
                    sm_chromium_menu(
                        native_id.as_ptr(),
                        native_request_id.as_ptr(),
                        content_view(&window)?,
                        request.as_ptr(),
                    )
                })
            } else {
                let request = string(&request.to_string())?;
                native_result(unsafe {
                    sm_chromium_command(
                        native_id.as_ptr(),
                        native_request_id.as_ptr(),
                        request.as_ptr(),
                    )
                })
            }
        })
        .await;
        let result = if result.is_ok() {
            tauri::async_runtime::spawn_blocking(move || {
                // The native menu dispatch itself returns immediately. Its
                // selection is user-driven, so only normal commands time out.
                wait_for_command_result(receiver, (!is_menu).then_some(Duration::from_secs(12)))
            })
            .await
            .map_err(|error| error.to_string())?
        } else {
            result.map(|()| Value::Null)
        };
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .pending
            .remove(&request_id);
        result
    }
}

#[tauri::command]
pub async fn browser_create(
    caller: Webview,
    id: String,
    url: String,
    bounds: BrowserBounds,
) -> Result<(), String> {
    let _work = crate::window::begin_runtime_work(caller.app_handle())?;
    let root = label(&caller, &id)?;
    let url = parse_url(&caller, &url)?;
    bounds.validate()?;
    if preview(&caller, &id).is_ok() {
        return browser_layout(caller, id, bounds, true).await;
    }
    let delegate = crate::workspace_window::owner_for_child(caller.app_handle(), caller.label());
    let page_owner = delegate
        .as_ref()
        .and_then(|label| caller.app_handle().get_webview(label))
        .unwrap_or_else(|| caller.clone());
    let creation_window = caller.window();
    let context = Arc::new(PageContext {
        caller: page_owner,
        root: root.clone(),
        native_id: format!("{root}-{}", NEXT.fetch_add(1, Ordering::Relaxed)),
        state: Mutex::new(BrowserState {
            id,
            url: url.to_string(),
            title: String::new(),
            favicon: String::new(),
            loading: true,
            can_go_back: false,
            can_go_forward: false,
            error: None,
            notice: None,
            focused: false,
            floating: false,
            zoom_factor: 1.0,
            find_result: None,
            engine: "chromium",
            native_menus: true,
            native_drop_indicator: true,
            closed: false,
        }),
        downloads: Mutex::new(Vec::new()),
        pending_toolbar: Mutex::new(None),
        delegate: Mutex::new(delegate.as_ref().map(|_| caller.label().to_string())),
        placement: tauri::async_runtime::Mutex::new(Placement {
            window: None,
            detached_bounds: delegate.as_ref().map(|_| bounds.clone()),
            detached_visible: true,
            awaiting_layout: false,
            detached_window: delegate.map(|_| caller.label().to_string()),
            dock_bounds: Some(bounds.clone()),
            dock_visible: true,
        }),
        closed: AtomicBool::new(false),
    });
    let (created_sender, created_receiver) = mpsc::channel();
    {
        let mut entries = registry().lock().map_err(|_| "Browser is unavailable")?;
        if entries.roots.contains_key(&root) {
            return Err("This browser tab is already opening".into());
        }
        if entries.roots.len() >= 128 {
            return Err("Close some browser tabs before opening more".into());
        }
        entries.roots.insert(root, context.clone());
        entries
            .pages
            .insert(context.native_id.clone(), context.clone());
        entries
            .creating
            .insert(context.native_id.clone(), created_sender);
    }
    let creation_context = context.clone();
    let result = on_main(caller.app_handle(), move || {
        let app = creation_context.caller.app_handle();
        let profile = initialize(app)?;
        let window = creation_window;
        let [x, y, w, h] =
            bounds.points(window.scale_factor().map_err(|error| error.to_string())?)?;
        let native_id = string(&creation_context.native_id)?;
        let url = string(url.as_str())?;
        let profile = string(&profile.join("Default").to_string_lossy())?;
        native_result(unsafe {
            sm_chromium_create(
                native_id.as_ptr(),
                content_view(&window)?,
                url.as_ptr(),
                profile.as_ptr(),
                x,
                y,
                w,
                h,
            )
        })
    })
    .await;
    let result = if result.is_ok() {
        tauri::async_runtime::spawn_blocking(move || {
            created_receiver
                .recv_timeout(Duration::from_secs(15))
                .map_err(|_| "Chromium could not open this tab".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    } else {
        result
    };
    if let Err(error) = result {
        let _ = close_context(context).await;
        return Err(error);
    }
    emit_state(&context);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(caller: Webview, id: String, url: String) -> Result<(), String> {
    let url = parse_url(&caller, &url)?;
    preview(&caller, &id)?
        .command(json!({"action":"navigate","url":url}))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn browser_action(caller: Webview, id: String, action: String) -> Result<(), String> {
    let page = preview(&caller, &id)?;
    let request = match action.as_str() {
        "back" | "forward" | "reload" | "stop" | "focus" | "devtools" => json!({"action":action}),
        "stop-find" => json!({"action":"findStop"}),
        "zoom-in" | "zoom-out" | "zoom-reset" => {
            let factor = page
                .0
                .state
                .lock()
                .map_err(|_| "Browser is unavailable")?
                .zoom_factor;
            let factor = match action.as_str() {
                "zoom-in" => (factor * 1.2).min(5.0),
                "zoom-out" => (factor / 1.2).max(0.25),
                _ => 1.0,
            };
            json!({"action":"zoom","factor":factor})
        }
        _ => return Err("Unknown browser action".into()),
    };
    page.command(request).await.map(|_| ())
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserDropIndicator {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    edge: String,
    kind: String,
    title: String,
}

impl BrowserDropIndicator {
    fn validate(&self) -> Result<(), String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width <= 0.0
            || self.height <= 0.0
            || self.x + self.width > 1.000001
            || self.y + self.height > 1.000001
            || !matches!(self.edge.as_str(), "tab" | "left" | "right" | "up" | "down")
            || !matches!(self.kind.as_str(), "tab" | "group")
            || self.title.encode_utf16().count() > 160
        {
            return Err("Invalid browser drop indicator".into());
        }
        Ok(())
    }
}

#[tauri::command]
pub async fn browser_drop_indicator(
    caller: Webview,
    id: String,
    indicator: Option<BrowserDropIndicator>,
) -> Result<(), String> {
    if let Some(value) = &indicator {
        value.validate()?;
    }
    let page = preview(&caller, &id)?;
    // Serialize with transfers/layout so a retiring owner's delayed clear
    // cannot erase the destination window's current drag feedback.
    let placement = page.0.placement.lock().await;
    let primary = page.0.caller.window();
    let owner = placement
        .detached_window
        .as_deref()
        .unwrap_or(primary.label());
    if placement.window.is_some() || owner != caller.window().label() {
        return Ok(());
    }
    page.command(json!({"action":"drop-indicator", "indicator":indicator}))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn browser_menu(
    caller: Webview,
    id: String,
    anchor: BrowserBounds,
    options: BrowserMenuOptions,
) -> Result<Option<String>, String> {
    anchor.validate()?;
    let page = preview(&caller, &id)?;
    let result = page
        .request(
            serde_json::to_value(options).map_err(|error| error.to_string())?,
            Some((caller.window(), anchor)),
        )
        .await?;
    Ok(result
        .get("selection")
        .and_then(Value::as_str)
        .filter(|choice| {
            matches!(
                *choice,
                "find" | "downloads" | "devtools" | "pip" | "chat" | "external"
            )
        })
        .map(str::to_string))
}

#[tauri::command]
pub async fn browser_edit(
    caller: Webview,
    id: String,
    active: bool,
    token: String,
) -> Result<(), String> {
    if token.is_empty()
        || token.len() > 128
        || !token
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err("Invalid page editing request".into());
    }
    preview(&caller, &id)?
        .command(json!({"action":if active {"edit-start"} else {"edit-stop"},"token":token}))
        .await
        .map(|_| ())
}

#[tauri::command]
pub async fn browser_find(
    caller: Webview,
    id: String,
    text: String,
    forward: bool,
    find_next: bool,
    match_case: bool,
) -> Result<(), String> {
    if text.len() > 4096 {
        return Err("Search text is too long".into());
    }
    preview(&caller, &id)?.command(json!({"action":"find","text":text,"forward":forward,"findNext":find_next,"matchCase":match_case})).await.map(|_| ())
}
#[tauri::command]
pub fn browser_downloads(caller: Webview, id: String) -> Result<Vec<BrowserDownload>, String> {
    Ok(preview(&caller, &id)?
        .0
        .downloads
        .lock()
        .map_err(|_| "Downloads are unavailable")?
        .clone())
}
#[tauri::command]
pub async fn browser_download_action(
    caller: Webview,
    id: String,
    download_id: String,
    action: String,
) -> Result<(), String> {
    let page = preview(&caller, &id)?;
    let download = page
        .0
        .downloads
        .lock()
        .map_err(|_| "Downloads are unavailable")?
        .iter()
        .find(|download| download.id == download_id)
        .cloned()
        .ok_or("Download is no longer available")?;
    if action == "cancel" {
        if download.state != "in-progress" {
            return Err("This download has already finished".into());
        }
        return page
            .command(json!({"action":"downloadCancel","downloadId":download_id}))
            .await
            .map(|_| ());
    }
    if !matches!(action.as_str(), "open" | "reveal") {
        return Err("Unknown download action".into());
    }
    if download.state != "completed" {
        return Err("Wait for this download to finish".into());
    }
    let path = download
        .path
        .filter(|path| path.is_file())
        .ok_or("The downloaded file was moved or removed")?;
    // Only native-recorded completed paths can reach Launch Services. The UI
    // cannot supply arbitrary paths or arguments through this command.
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new("/usr/bin/open");
        if action == "reveal" {
            command.arg("-R");
        }
        let status = command
            .arg(path)
            .status()
            .map_err(|error| error.to_string())?;
        if status.success() {
            Ok(())
        } else {
            Err("macOS could not open this download".into())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn browser_layout(
    caller: Webview,
    id: String,
    bounds: BrowserBounds,
    visible: bool,
) -> Result<(), String> {
    bounds.validate()?;
    let page = preview(&caller, &id)?;
    let mut placement = page.0.placement.lock().await;
    let delegated = placement.detached_window.as_deref() == Some(caller.label());
    if delegated {
        placement.detached_bounds = Some(bounds.clone());
        placement.detached_visible = visible;
    }
    if !delegated {
        placement.dock_bounds = Some(bounds.clone());
        placement.dock_visible = visible;
    }
    if (placement.detached_window.is_some() && !delegated)
        || placement.window.is_some()
        || page.0.closed.load(Ordering::Acquire)
    {
        return Ok(());
    }
    let context = page.0.clone();
    let layout_window = caller.window();
    let result = on_main(caller.app_handle(), move || {
        let window = layout_window;
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let [x, y, w, h] = bounds.points(scale)?;
        let [clip_left, clip_right] = bounds.clip_points(scale)?;
        let viewport_height = bounds.viewport_points(scale)?;
        let native_id = string(&context.native_id)?;
        native_result(unsafe {
            sm_chromium_layout(
                native_id.as_ptr(),
                x,
                y,
                w,
                h,
                visible.into(),
                clip_left,
                clip_right,
                viewport_height,
            )
        })
    })
    .await;
    if result.is_ok() {
        placement.awaiting_layout = false;
    }
    result
}

async fn move_page(
    context: Arc<PageContext>,
    window: Window,
    bounds: Option<BrowserBounds>,
    floating: bool,
    visible: bool,
) -> Result<(), String> {
    let app = window.app_handle().clone();
    on_main(&app, move || {
        let scale = window.scale_factor().map_err(|error| error.to_string())?;
        let mut clip = [0.0, 0.0];
        let mut viewport_height = 0.0;
        let [x, y, w, h] = if let Some(bounds) = bounds {
            if !floating {
                clip = bounds.clip_points(scale)?;
                viewport_height = bounds.viewport_points(scale)?;
            }
            bounds.points(scale)?
        } else {
            let size = window.inner_size().map_err(|error| error.to_string())?;
            [
                0.0,
                0.0,
                size.width as f64 / scale,
                size.height as f64 / scale,
            ]
        };
        let id = string(&context.native_id)?;
        native_result(unsafe {
            sm_chromium_reparent(
                id.as_ptr(),
                content_view(&window)?,
                x,
                y,
                w,
                h,
                if floating { 0.0 } else { -1.0 },
            )
        })?;
        native_result(unsafe {
            sm_chromium_layout(
                id.as_ptr(),
                x,
                y,
                w,
                h,
                visible.into(),
                clip[0],
                clip[1],
                viewport_height,
            )
        })
    })
    .await
}

/// Attach a controlled view to the existing CEF page without navigation/reload.
#[tauri::command]
pub fn browser_attach(caller: Webview, id: String) -> Result<BrowserState, String> {
    let page = preview(&caller, &id)?;
    let state = page
        .0
        .state
        .lock()
        .map_err(|_| "Browser is unavailable")?
        .clone();
    Ok(state)
}

/// All pages move or every already-moved page is restored. The placement lock
/// serializes native reparenting with layout/visibility commands from both views.
pub(crate) async fn transfer_workspace_pages(
    caller: Webview,
    ids: Vec<String>,
    target: Option<String>,
) -> Result<(), String> {
    if let Some(label) = &target {
        if crate::workspace_window::owner_for_child(caller.app_handle(), label).as_deref()
            != Some(caller.label())
        {
            return Err("Browser destination belongs to another workspace".into());
        }
    }
    let mut pages = Vec::new();
    for id in ids {
        let page = preview(&caller, &id)?;
        if !pages
            .iter()
            .any(|p: &Arc<PageContext>| p.root == page.0.root)
        {
            pages.push(page.0);
        }
    }
    let mut moved: Vec<(Arc<PageContext>, Placement)> = Vec::new();
    let result = async {
        for context in pages {
            let mut placement = context.placement.lock().await;
            if placement.window.is_some() {
                return Err(
                    "Return this browser from Picture in Picture before moving its workspace"
                        .to_string(),
                );
            }
            let previous = placement.clone();
            let window = if let Some(label) = &target {
                caller
                    .app_handle()
                    .get_window(label)
                    .ok_or("Destination workspace closed")?
            } else {
                context.caller.window()
            };
            let bounds = if target.is_some() {
                None
            } else {
                placement.dock_bounds.clone()
            };
            // Hide only while moving between native windows; child's committed
            // layout shows it after acknowledging the exact split bounds.
            move_page(context.clone(), window, bounds, false, false).await?;
            placement.detached_window = target.clone();
            placement.detached_bounds = None;
            placement.detached_visible = false;
            placement.awaiting_layout = true;
            *context
                .delegate
                .lock()
                .map_err(|_| "Browser delegation unavailable")? = target.clone();
            moved.push((context.clone(), previous));
        }
        Ok(())
    }
    .await;
    if let Err(error) = result {
        let mut failures = Vec::new();
        for (context, previous) in moved.into_iter().rev() {
            let mut placement = context.placement.lock().await;
            let window = previous
                .detached_window
                .as_ref()
                .and_then(|label| caller.app_handle().get_window(label))
                .unwrap_or_else(|| context.caller.window());
            let bounds = if previous.detached_window.is_some() {
                previous.detached_bounds.clone()
            } else {
                previous.dock_bounds.clone()
            };
            match move_page(
                context.clone(),
                window,
                bounds,
                false,
                if previous.detached_window.is_some() {
                    previous.detached_visible
                } else {
                    previous.dock_visible
                },
            )
            .await
            {
                Ok(()) => {
                    *context
                        .delegate
                        .lock()
                        .map_err(|_| "Browser delegation unavailable")? =
                        previous.detached_window.clone();
                    *placement = previous;
                    emit_state(&context);
                }
                Err(reason) => failures.push(reason),
            }
        }
        return Err(if failures.is_empty() {
            error
        } else {
            format!("{error}; move rollback failed: {}", failures.join("; "))
        });
    }
    for (context, _) in moved {
        emit_state(&context);
    }
    Ok(())
}

// Keep keyboard intent attached to the existing native page while a grouped
// return waits for every sibling. Only the final docked page may deliver it.
async fn flush_toolbar_command(context: &Arc<PageContext>) {
    let placement = context.placement.lock().await;
    if placement.window.is_some() || context.closed.load(Ordering::Acquire) {
        return;
    }
    let action = context
        .pending_toolbar
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .take();
    if let Some(action) = action {
        let id = context.state.lock().ok().map(|state| state.id.clone());
        if let Some(id) = id {
            // The renderer waits for its group to be visible, then transfers
            // native first responder to WKWebView before focusing the field.
            let _ = context.caller.emit_to(
                EventTarget::webview(
                    context
                        .delegate
                        .lock()
                        .ok()
                        .and_then(|d| d.clone())
                        .unwrap_or_else(|| context.caller.label().into()),
                ),
                "browser-toolbar-command",
                json!({"id": id, "action": action}),
            );
        }
    }
}

fn route_toolbar_command(context: Arc<PageContext>, action: String) {
    tauri::async_runtime::spawn(async move {
        let floating = {
            let placement = context.placement.lock().await;
            if context.closed.load(Ordering::Acquire) {
                return;
            }
            *context
                .pending_toolbar
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = Some(action);
            placement.window.is_some()
        };
        // set_floating owns the existing group-return handshake. A grouped
        // return starts asynchronously; it flushes this intent when docking
        // actually finishes, not when the group merely accepts the request.
        if floating {
            if let Err(error) = set_floating(context.clone(), false).await {
                context
                    .pending_toolbar
                    .lock()
                    .unwrap_or_else(|error| error.into_inner())
                    .take();
                notice(&context, error);
                return;
            }
        }
        flush_toolbar_command(&context).await;
    });
}

async fn set_floating(context: Arc<PageContext>, floating: bool) -> Result<(), String> {
    if !floating {
        let current = context.placement.lock().await.window.clone();
        if current.as_ref().is_some_and(|label| {
            crate::pip_group::request_return(context.caller.app_handle(), label)
        }) {
            return Ok(());
        }
    }
    let mut placement = context.placement.lock().await;
    if context.closed.load(Ordering::Acquire) {
        return Err("Browser is closed".into());
    }
    if placement.detached_window.is_some() {
        return Err("Use Keep on top for this detached workspace, or return it before opening browser Picture in Picture".into());
    }
    let app = context.caller.app_handle();
    if floating {
        if let Some(label) = &placement.window {
            let window = app
                .get_window(label)
                .ok_or("Picture in Picture is unavailable")?;
            window.show().map_err(|error| error.to_string())?;
            return window.set_focus().map_err(|error| error.to_string());
        }
        let label = format!("preview-float-{}", NEXT.fetch_add(1, Ordering::Relaxed));
        let title = context
            .state
            .lock()
            .map(|state| {
                if state.title.is_empty() {
                    state.url.clone()
                } else {
                    state.title.clone()
                }
            })
            .unwrap_or_else(|_| "Browser".into());
        let window = tauri::window::WindowBuilder::new(app, &label)
            .title(title.chars().take(160).collect::<String>())
            .inner_size(760.0, 520.0)
            .min_inner_size(320.0, 180.0)
            .always_on_top(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?;
        let root = context.root.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                return_floating(&root);
            }
        });
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .floating
            .insert(label.clone(), context.root.clone());
        if let Err(error) = move_page(context.clone(), window.clone(), None, true, true).await {
            // Reparenting may have succeeded before a later layout failed. Do
            // not destroy the new owner until the same live view is back home.
            if move_page(
                context.clone(),
                context.caller.window(),
                placement.dock_bounds.clone(),
                false,
                placement.dock_visible,
            )
            .await
            .is_err()
            {
                placement.window = Some(label);
                let _ = crate::browser_floating_controls::install(&window, context.root.clone());
                let _ = window.show();
                if let Ok(mut state) = context.state.lock() {
                    state.floating = true;
                    state.notice = Some(error.clone());
                }
                emit_state(&context);
                return Err(error);
            }
            registry()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .floating
                .remove(&label);
            let _ = window.destroy();
            return Err(error);
        }
        placement.window = Some(label);
        // The live Chromium view has already moved. Cosmetic failures must not
        // destroy its owner or lose its placement.
        let _ = crate::browser_floating_controls::install(&window, context.root.clone());
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        let Some(label) = placement.window.clone() else {
            return Ok(());
        };
        let owner = app
            .get_window(context.caller.window().label())
            .ok_or("The original workspace has closed")?;
        crate::pip_group::detach_windows(app, std::slice::from_ref(&label)).await?;
        move_page(
            context.clone(),
            owner.clone(),
            placement.dock_bounds.clone(),
            false,
            placement.dock_visible,
        )
        .await?;
        placement.window = None;
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .floating
            .remove(&label);
        if let Some(window) = app.get_window(&label) {
            let _ = window.destroy();
        }
        let _ = owner.show();
        let _ = owner.set_focus();
    }
    if let Ok(mut state) = context.state.lock() {
        state.floating = floating;
        state.focused = false;
    }
    emit_state(&context);
    drop(placement);
    if !floating {
        flush_toolbar_command(&context).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_set_floating(
    caller: Webview,
    id: String,
    floating: bool,
) -> Result<Option<String>, String> {
    let _work = if floating {
        Some(crate::window::begin_runtime_work(caller.app_handle())?)
    } else {
        None
    };
    let context = preview(&caller, &id)?.0;
    set_floating(context.clone(), floating).await?;
    let label = context.placement.lock().await.window.clone();
    Ok(label)
}
#[tauri::command]
pub async fn browser_show_floating(caller: Webview, id: String) -> Result<(), String> {
    let context = preview(&caller, &id)?.0;
    let label = context
        .placement
        .lock()
        .await
        .window
        .clone()
        .ok_or("This page is already in the workspace")?;
    let window = caller
        .app_handle()
        .get_window(&label)
        .ok_or("Picture in Picture is closed")?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}
async fn close_context(context: Arc<PageContext>) -> Result<(), String> {
    let mut placement = context.placement.lock().await;
    if context.closed.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let app = context.caller.app_handle();
    if let Some(label) = &placement.window {
        let _ = crate::pip_group::detach_windows(app, std::slice::from_ref(label)).await;
    }
    let id = string(&context.native_id)?;
    let (sender, receiver) = mpsc::channel();
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .closing
        .insert(context.native_id.clone(), sender);
    let result = on_main(app, move || {
        native_result(unsafe { sm_chromium_close(id.as_ptr()) })
    })
    .await;
    if result.is_ok() {
        // Keep the owning NSWindow alive until Chromium releases its child view.
        // Waiting on the async worker lets Cocoa continue delivering close events.
        let finished = tauri::async_runtime::spawn_blocking(move || {
            receiver.recv_timeout(Duration::from_secs(10))
        })
        .await
        .map_err(|error| error.to_string())?;
        if finished.is_err() {
            context.closed.store(false, Ordering::Release);
            registry()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .closing
                .remove(&context.native_id);
            return Err("Chromium is still closing this page. Retry shortly.".into());
        }
    }
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .closing
        .remove(&context.native_id);
    remove_context(&context);
    if let Some(label) = placement.window.take() {
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .floating
            .remove(&label);
        if let Some(window) = app.get_window(&label) {
            let _ = window.destroy();
        }
    }
    result
}
#[tauri::command]
pub async fn browser_close(caller: Webview, id: String) -> Result<(), String> {
    let root = label(&caller, &id)?;
    let context = registry()
        .lock()
        .map_err(|_| "Browser is unavailable")?
        .roots
        .get(&root)
        .cloned();
    if let Some(context) = context {
        preview(&caller, &id)?;
        close_context(context).await
    } else {
        Ok(())
    }
}
pub(crate) fn return_floating(root: &str) {
    let context = registry()
        .lock()
        .ok()
        .and_then(|entries| entries.roots.get(root).cloned());
    if let Some(context) = context {
        tauri::async_runtime::spawn(async move {
            if let Err(error) = set_floating(context.clone(), false).await {
                notice(&context, error);
            }
        });
    }
}
pub(crate) fn floating_owner(label: &str) -> Option<String> {
    let entries = registry().lock().ok()?;
    let root = entries.floating.get(label)?;
    Some(entries.roots.get(root)?.caller.window().label().to_string())
}
pub(crate) fn return_floating_window(label: &str) {
    let root = registry()
        .lock()
        .ok()
        .and_then(|entries| entries.floating.get(label).cloned());
    if let Some(root) = root {
        return_floating(&root);
    }
}
pub fn focused_floating_owner(app: &AppHandle) -> Option<String> {
    app.windows()
        .into_values()
        .find(|window| {
            window.label().starts_with("preview-float-") && window.is_focused().unwrap_or(false)
        })
        .and_then(|window| floating_owner(window.label()))
}
pub fn dispatch_floating_menu(app: &AppHandle, id: &str) -> bool {
    if id != "close_tab" {
        return false;
    }
    if let Some(window) = app.windows().into_values().find(|window| {
        window.label().starts_with("preview-float-") && window.is_focused().unwrap_or(false)
    }) {
        return_floating_window(window.label());
        true
    } else {
        false
    }
}

pub(crate) fn dispatch_native_menu(id: &str) -> bool {
    if !INITIALIZED.load(Ordering::Acquire)
        || !matches!(
            id,
            "find" | "zoom_in" | "zoom_out" | "zoom_reset" | "back_tab" | "forward_tab"
        )
    {
        return false;
    }
    let pages = registry()
        .lock()
        .map(|entries| entries.roots.values().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    let page = pages.into_iter().find(|context| {
        string(&context.native_id)
            .is_ok_and(|id| unsafe { sm_chromium_is_focused(id.as_ptr()) != 0 })
    });
    let Some(context) = page else {
        return false;
    };
    if id == "find" {
        route_toolbar_command(context, "find".into());
    } else {
        let action = match id {
            "zoom_in" => "zoom-in",
            "zoom_out" => "zoom-out",
            "zoom_reset" => "zoom-reset",
            "back_tab" => "back",
            _ => "forward",
        }
        .to_string();
        tauri::async_runtime::spawn(async move {
            let id = context.state.lock().ok().map(|state| state.id.clone());
            if let Some(id) = id {
                if let Err(error) = browser_action(context.caller.clone(), id, action).await {
                    notice(&context, error);
                }
            }
        });
    }
    true
}
pub fn window_destroyed(app: &AppHandle, label: &str) {
    let contexts = registry()
        .lock()
        .map(|entries| {
            entries
                .roots
                .values()
                .filter(|context| context.caller.window().label() == label)
                .cloned()
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for context in contexts {
        tauri::async_runtime::spawn(async move {
            let _ = close_context(context).await;
        });
    }
    crate::browser_floating_controls::remove(app, label);
}

pub(crate) async fn close_window_pages(app: &AppHandle, label: Option<&str>) -> Result<(), String> {
    let contexts = registry()
        .lock()
        .map_err(|_| "Browser is unavailable")?
        .roots
        .values()
        .filter(|context| label.is_none_or(|label| context.caller.window().label() == label))
        .cloned()
        .collect::<Vec<_>>();
    for context in contexts {
        if let Err(error) = close_context(context.clone()).await {
            notice(&context, error.clone());
            return Err(error);
        }
    }
    let _ = app;
    Ok(())
}
pub(crate) fn shutdown() {
    if INITIALIZED.swap(false, Ordering::AcqRel) {
        unsafe {
            sm_chromium_shutdown();
        }
    }
}

pub(crate) async fn prepare_shutdown(app: &AppHandle) -> Result<(), String> {
    if !INITIALIZED.load(Ordering::Acquire) {
        return Ok(());
    }
    for _ in 0..100 {
        if on_main(app, || Ok(unsafe { sm_chromium_live_browser_count() == 0 })).await? {
            return shutdown_on_main(app).await;
        }
        // Popups finish closing on Cocoa's event loop, which remains free while
        // this worker waits. This runs only during an explicit application quit.
        tauri::async_runtime::spawn_blocking(|| std::thread::sleep(Duration::from_millis(50)))
            .await
            .map_err(|error| error.to_string())?;
    }
    Err("Chromium popup windows are still closing. Retry Quit shortly.".into())
}

/// Opening is acknowledged only after the child supplied its committed bounds.
pub(crate) async fn workspace_pages_ready(caller: Webview, ids: Vec<String>) -> Result<(), String> {
    workspace_pages_condition(caller, ids, false).await
}
pub(crate) async fn workspace_pages_hidden(
    caller: Webview,
    ids: Vec<String>,
) -> Result<(), String> {
    workspace_pages_condition(caller, ids, true).await
}
async fn workspace_pages_condition(
    caller: Webview,
    ids: Vec<String>,
    hidden: bool,
) -> Result<(), String> {
    let pages = ids
        .iter()
        .map(|id| preview(&caller, id).map(|page| page.0))
        .collect::<Result<Vec<_>, _>>()?;
    let label = caller.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        for _ in 0..300 {
            let ready = pages.iter().all(|page| {
                let Ok(placement) = page.placement.try_lock() else {
                    return false;
                };
                let belongs = if page.caller.label() == label {
                    placement.detached_window.is_none()
                } else {
                    placement.detached_window.as_deref() == Some(&label)
                };
                belongs && !placement.awaiting_layout && (!hidden || !placement.detached_visible)
            });
            if ready {
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        Err("The browser did not publish its destination layout".into())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::BrowserDropIndicator;

    #[test]
    fn drop_indicator_rejects_invalid_geometry_and_unbounded_labels() {
        let valid = BrowserDropIndicator {
            x: 0.5,
            y: 0.0,
            width: 0.5,
            height: 1.0,
            edge: "right".into(),
            kind: "tab".into(),
            title: "Page".into(),
        };
        assert!(valid.validate().is_ok());
        for value in [f64::NAN, f64::INFINITY, -0.1, 1.1] {
            let mut invalid = valid.clone();
            invalid.x = value;
            assert!(invalid.validate().is_err());
        }
        let mut invalid = valid.clone();
        invalid.edge = "execute".into();
        assert!(invalid.validate().is_err());
        invalid = valid.clone();
        invalid.kind = "window".into();
        assert!(invalid.validate().is_err());
        invalid = valid.clone();
        invalid.title = "🌊".repeat(81);
        assert!(invalid.validate().is_err());
    }

    #[test]
    fn menu_result_waits_for_dismissal_after_normal_command_deadline() {
        let (send, receive) = std::sync::mpsc::channel();
        let (finished, completion) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            finished
                .send(super::wait_for_command_result(receive, None))
                .unwrap();
        });
        assert!(matches!(
            completion.recv_timeout(std::time::Duration::from_millis(20)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        send.send(Ok(serde_json::json!({"selection":"find"})))
            .unwrap();
        assert_eq!(
            completion
                .recv_timeout(std::time::Duration::from_secs(2))
                .unwrap(),
            Ok(serde_json::json!({"selection":"find"}))
        );
        worker.join().unwrap();
        let (normal_send, normal_receive) = std::sync::mpsc::channel();
        assert!(super::wait_for_command_result(
            normal_receive,
            Some(std::time::Duration::from_millis(1))
        )
        .unwrap_err()
        .contains("timed out"));
        drop(normal_send);
    }

    #[test]
    fn closing_browser_releases_menu_waiter() {
        let (send, receive) = std::sync::mpsc::channel();
        send.send(Err("Browser is closed".into())).unwrap();
        assert_eq!(
            super::wait_for_command_result(receive, None),
            Err("Browser is closed".into())
        );
    }

    #[test]
    fn shutdown_completion_wait_survives_a_delayed_native_return() {
        let (native_send, native_receive) = std::sync::mpsc::channel();
        let (finished_send, finished_receive) = std::sync::mpsc::channel();
        let worker = std::thread::spawn(move || {
            let result = super::wait_for_shutdown_completion(native_receive);
            finished_send.send(result).unwrap();
        });
        // Model a system prompt keeping the irreversible native operation
        // alive beyond the caller's ordinary responsiveness deadline.
        assert!(matches!(
            finished_receive.recv_timeout(std::time::Duration::from_millis(20)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ));
        native_send.send(()).unwrap();
        assert_eq!(
            finished_receive
                .recv_timeout(std::time::Duration::from_secs(1))
                .unwrap(),
            Ok(())
        );
        worker.join().unwrap();
    }

    #[test]
    fn shutdown_completion_reports_a_dropped_native_operation() {
        let (send, receive) = std::sync::mpsc::channel();
        drop(send);
        assert_eq!(
            super::wait_for_shutdown_completion(receive),
            Err("Chromium shutdown completion was lost".to_string())
        );
    }

    #[test]
    fn edit_event_keeps_page_data_bounded_and_uses_the_owned_browser_id() {
        let value = serde_json::json!({"id":"untrusted", "token":"selection-1", "active":false,"screenshot":edit_test_screenshot(),"selection":{
            "url":"http://localhost/", "title":"Example", "selector":"#button", "tag":"button", "text":"Save", "extra":"discard"
        }});
        let payload = super::edit_event_payload("owned", &value).unwrap();
        assert_eq!(payload["id"], "owned");
        assert_eq!(payload["screenshot"], edit_test_screenshot());
        assert!(payload["selection"].get("extra").is_none());
        let mut oversized = value.clone();
        oversized["selection"]["text"] = serde_json::json!("x".repeat(1001));
        assert!(super::edit_event_payload("owned", &oversized).is_none());
        assert!(
            super::edit_event_payload("owned", &serde_json::json!({"active":"true"})).is_none()
        );
    }
    fn edit_test_screenshot() -> Value {
        serde_json::json!({"dataUrl":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP/0AAAAASUVORK5CYII=","width":1,"height":1})
    }
    #[test]
    fn edit_comment_is_bounded_and_only_accepted_with_a_committed_capture() {
        let mut event = serde_json::json!({"token":"commented-selection","active":false,
        "comment":"Make this heading blue.","screenshot":edit_test_screenshot(),"selection":{
            "url":"http://localhost/","title":"Example","selector":"h1","tag":"h1","text":"Page heading"
        }});
        let payload = super::edit_event_payload("owned", &event).unwrap();
        assert_eq!(payload["comment"], "Make this heading blue.");
        assert_eq!(payload["screenshot"], edit_test_screenshot());
        event["comment"] = serde_json::json!("😀".repeat(4000));
        assert!(super::edit_event_payload("owned", &event).is_some());
        for comment in [
            serde_json::json!("x".repeat(4001)),
            serde_json::json!(42),
            serde_json::json!(null),
            serde_json::json!({"text":"not a string"}),
            serde_json::json!("   "),
        ] {
            event["comment"] = comment;
            assert!(super::edit_event_payload("owned", &event).is_none());
        }
        event["comment"] = serde_json::json!("Make this heading blue.");
        event["active"] = serde_json::json!(true);
        assert!(super::edit_event_payload("owned", &event).is_none());
        event["active"] = serde_json::json!(false);
        let mut no_selection = event.clone();
        no_selection.as_object_mut().unwrap().remove("selection");
        assert!(super::edit_event_payload("owned", &no_selection).is_none());
        event.as_object_mut().unwrap().remove("screenshot");
        assert!(super::edit_event_payload("owned", &event).is_none());
    }
    #[test]
    fn edit_screenshot_rejects_mismatched_or_unbounded_images() {
        use base64::Engine;
        let valid = edit_test_screenshot();
        assert_eq!(super::edit_screenshot_payload(&valid), Some(valid.clone()));
        let mut bad = valid.clone();
        bad["width"] = serde_json::json!(2);
        assert!(super::edit_screenshot_payload(&bad).is_none());
        for data in ["data:image/svg+xml,<svg/>", "data:image/png;base64,not-png"] {
            bad = valid.clone();
            bad["dataUrl"] = serde_json::json!(data);
            assert!(super::edit_screenshot_payload(&bad).is_none());
        }
        let mut png = base64::engine::general_purpose::STANDARD
            .decode(
                valid["dataUrl"]
                    .as_str()
                    .unwrap()
                    .split_once(',')
                    .unwrap()
                    .1,
            )
            .unwrap();
        png[16..20].copy_from_slice(&4097u32.to_be_bytes());
        bad = serde_json::json!({"dataUrl":format!("data:image/png;base64,{}",base64::engine::general_purpose::STANDARD.encode(png)),"width":4097,"height":1});
        assert!(super::edit_screenshot_payload(&bad).is_none());
        bad["dataUrl"] = serde_json::json!(format!(
            "data:image/png;base64,{}",
            "A".repeat(8 * 1024 * 1024 + 1)
        ));
        assert!(super::edit_screenshot_payload(&bad).is_none());
    }
    #[test]
    fn edit_cancel_or_capture_failure_keeps_the_run_token_without_an_image() {
        let event = serde_json::json!({"active":false,"token":"cancelled-run","error":"Could not capture this element"});
        let payload = super::edit_event_payload("owned", &event).unwrap();
        assert_eq!(payload["token"], "cancelled-run");
        assert_eq!(payload["active"], false);
        assert_eq!(payload["error"], "Could not capture this element");
        assert!(payload.get("selection").is_none());
        assert!(payload.get("screenshot").is_none());
    }
    use super::*;
    #[test]
    fn converts_css_zoom_and_retina_to_native_points() {
        let bounds = BrowserBounds {
            x: 100.0,
            y: 50.0,
            width: 800.0,
            height: 600.0,
            scale: 1.6,
            clip_left: 0.0,
            clip_right: 0.0,
            viewport_height: Some(860.0),
        };
        assert_eq!(bounds.points(2.0).unwrap(), [80.0, 40.0, 640.0, 480.0]);
        assert_eq!(bounds.viewport_points(2.0).unwrap(), 688.0);
        assert_eq!(
            BrowserBounds {
                viewport_height: None,
                ..bounds.clone()
            }
            .viewport_points(2.0)
            .unwrap(),
            0.0
        );
        for height in [f64::NAN, f64::INFINITY, -1.0, 0.0, 32769.0] {
            assert!(BrowserBounds {
                viewport_height: Some(height),
                ..bounds.clone()
            }
            .validate()
            .is_err());
        }
        assert!(BrowserBounds {
            width: f64::NAN,
            ..bounds.clone()
        }
        .validate()
        .is_err());
        assert!(bounds.points(0.0).is_err());
    }
    #[test]
    fn keeps_privileged_origins_and_non_web_schemes_out() {
        let dev = Url::parse("http://localhost:1420").unwrap();
        for url in [
            "tauri://localhost",
            "file:///etc/passwd",
            "https://ipc.localhost/",
            "http://asset.localhost/test",
            "https://user:pass@example.com",
            "http://localhost:1420/page",
        ] {
            assert!(!allowed_url(&Url::parse(url).unwrap(), Some(&dev)), "{url}");
        }
        for url in [
            "https://example.com",
            "http://localhost:5173",
            "http://127.0.0.1:3000",
        ] {
            assert!(allowed_url(&Url::parse(url).unwrap(), Some(&dev)));
        }
    }
    #[test]
    fn download_events_cannot_expose_native_paths_to_ui() {
        assert_eq!(byte_count(&json!(1024.0)), Some(1024));
        assert_eq!(byte_count(&json!(-1)), None);
        assert_eq!(byte_count(&json!(1.5)), None);
        let download = parse_download(&json!({"id":1,"filename":"example.txt","receivedBytes":30,"totalBytes":30,"state":"completed","path":"/tmp/example.txt"})).unwrap();
        assert_eq!(download.id, "1");
        assert!(download.path.is_some());
        assert!(serde_json::to_value(download)
            .unwrap()
            .get("path")
            .is_none());
        assert!(
            parse_download(&json!({"id":"1","filename":"example","state":"unknown"})).is_none()
        );
    }
}
