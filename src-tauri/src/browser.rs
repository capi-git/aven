//! Unprivileged native previews. Remote pages receive no capability, and cannot
//! navigate into the app origin. Only the owning local UI may control a view.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::{
    webview::{DownloadEvent, NewWindowFeatures, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, EventTarget, Manager, PhysicalPosition, PhysicalSize, Rect, Url, Webview,
    WebviewUrl, WebviewWindowBuilder,
};

#[path = "browser_floating.rs"]
mod floating;

#[derive(Clone, Deserialize)]
pub struct BrowserBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    scale: f64,
}

impl BrowserBounds {
    fn rect(&self) -> Result<Rect, String> {
        let values = [self.x, self.y, self.width, self.height, self.scale];
        if values.iter().any(|value| !value.is_finite())
            || self.x < 0.0
            || self.y < 0.0
            || self.width < 1.0
            || self.height < 1.0
            || self.scale <= 0.0
            || self.scale > 8.0
            || values[..4].iter().any(|value| *value > 32768.0)
        {
            return Err("Invalid preview bounds".into());
        }
        Ok(Rect {
            position: PhysicalPosition::new(
                (self.x * self.scale).round() as i32,
                (self.y * self.scale).round() as i32,
            )
            .into(),
            size: PhysicalSize::new(
                (self.width * self.scale).round() as u32,
                (self.height * self.scale).round() as u32,
            )
            .into(),
        })
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrowserState {
    id: String,
    url: String,
    title: String,
    loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    error: Option<String>,
    notice: Option<String>,
    focused: bool,
    floating: bool,
}

impl BrowserState {
    fn set_notice(&mut self, message: String) {
        self.notice = Some(message);
    }

    #[cfg(any(target_os = "macos", test))]
    fn begin_navigation(&mut self) {
        self.error = None;
        self.notice = None;
        self.loading = true;
    }

    #[cfg(any(target_os = "macos", test))]
    fn fail_navigation(
        &mut self,
        domain: &str,
        code: isize,
        url: Option<&str>,
        dev: Option<&Url>,
    ) -> bool {
        let Some(message) = navigation_failure_message(domain, code) else {
            return false;
        };
        if let Some(url) = url
            .and_then(|value| Url::parse(value).ok())
            .filter(|url| allowed_url(url, dev))
        {
            self.url = url.to_string();
        }
        self.loading = false;
        self.error = Some(message.into());
        self.notice = None;
        true
    }
}

#[cfg(any(target_os = "macos", test))]
fn navigation_failure_message(domain: &str, code: isize) -> Option<&'static str> {
    match (domain, code) {
        // Replaced navigations and responses converted to a download are not
        // failed pages. They must not cover a newer navigation or a valid page.
        ("NSURLErrorDomain", -999) | ("WebKitErrorDomain", 102) => None,
        ("NSURLErrorDomain", -1001) => Some("The page took too long to respond. Check the address or local server, then retry."),
        ("NSURLErrorDomain", -1003 | -1006) => Some("The server could not be found. Check the web address, or enter a search term in the address bar."),
        ("NSURLErrorDomain", -1004) => Some("Could not connect to this server. If this is a local preview, make sure its development server is running."),
        ("NSURLErrorDomain", -1009) => Some("The internet connection appears to be offline. Reconnect, then retry."),
        ("NSURLErrorDomain", -1206..=-1200 | -1022) => Some("A secure connection could not be established. The website's certificate or connection needs to be fixed; browser security remains enabled."),
        _ => Some("This page could not be loaded. Check the address and try again."),
    }
}

pub(crate) fn label(caller: &Webview, id: &str) -> Result<String, String> {
    if caller.label() != "main"
        && !(caller.label().starts_with("window-")
            && caller.label()[7..].chars().all(|c| c.is_ascii_digit()))
    {
        return Err("Only the app interface can control previews".into());
    }
    if id.is_empty() || id.len() > 80 || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid preview identifier".into());
    }
    Ok(format!("preview-{}-{id}", caller.label()))
}

fn allowed_url(url: &Url, dev_url: Option<&Url>) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && !matches!(
            url.host_str(),
            Some("tauri.localhost" | "asset.localhost" | "ipc.localhost")
        )
        && !dev_url.is_some_and(|dev| url.origin() == dev.origin())
}

pub(crate) fn parse_url(caller: &Webview, value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "Invalid web address".to_string())?;
    if !allowed_url(&url, caller.app_handle().config().build.dev_url.as_ref()) {
        return Err("Preview supports external http/https pages, including local development servers, but not the app's own address".into());
    }
    Ok(url)
}

pub(crate) fn preview(caller: &Webview, id: &str) -> Result<Webview, String> {
    let root = label(caller, id)?;
    let view = caller
        .app_handle()
        .get_webview(&root)
        .ok_or("Preview is closed")?;
    let entries = registry().lock().unwrap_or_else(|e| e.into_inner());
    let owner_matches = entries
        .roots
        .get(&root)
        .is_some_and(|context| context.caller.label() == caller.label());
    if owner_matches
        && preview_window_is_owned(
            view.window().label(),
            caller.window().label(),
            entries
                .floating
                .get(view.window().label())
                .map(String::as_str),
            &root,
        )
    {
        Ok(view)
    } else {
        Err("Preview is closed or belongs to another window".into())
    }
}

/// Read only browser state owned by the calling app window and explicitly
/// granted to an agent session. Never enumerate other app windows or profiles.
pub(crate) fn agent_tab_states(caller: &Webview, ids: &[String]) -> Vec<serde_json::Value> {
    ids.iter()
        .filter_map(|id| {
            let root = label(caller, id).ok()?;
            let context = registry().lock().ok()?.roots.get(&root)?.clone();
            preview(caller, id).ok()?;
            let state = context.state.lock().ok()?;
            serde_json::to_value(&*state).ok()
        })
        .collect()
}

fn preview_window_is_owned(
    actual: &str,
    owner: &str,
    floating_root: Option<&str>,
    root: &str,
) -> bool {
    actual == owner || floating_root == Some(root)
}

fn emit_state(caller: &Webview, state: &Arc<Mutex<BrowserState>>) {
    if let Ok(state) = state.lock() {
        let _ = caller.emit_to(
            EventTarget::webview(caller.label()),
            "browser-state",
            state.clone(),
        );
    }
}

#[derive(Clone)]
struct PreviewContext {
    caller: Webview,
    root_label: String,
    state: Arc<Mutex<BrowserState>>,
    downloads: Arc<Mutex<HashMap<String, Vec<PathBuf>>>>,
    placement: Arc<tauri::async_runtime::Mutex<BrowserPlacement>>,
}

#[derive(Default)]
struct BrowserPlacement {
    window: Option<String>,
    dock_bounds: Option<BrowserBounds>,
    dock_visible: bool,
    closed: bool,
}

impl BrowserPlacement {
    /// Remember the owner's latest layout even while another native window owns
    /// the page. Return whether that layout may touch the current native view.
    fn record_layout(&mut self, bounds: BrowserBounds, visible: bool) -> bool {
        self.dock_bounds = Some(bounds);
        self.dock_visible = visible;
        !self.closed && self.window.is_none()
    }
}

#[derive(Default)]
struct PreviewRegistry {
    roots: HashMap<String, PreviewContext>,
    popups: HashMap<String, String>,
    floating: HashMap<String, String>,
}
static REGISTRY: OnceLock<Mutex<PreviewRegistry>> = OnceLock::new();
static NEXT_POPUP: AtomicU64 = AtomicU64::new(1);

fn registry() -> &'static Mutex<PreviewRegistry> {
    REGISTRY.get_or_init(|| Mutex::new(PreviewRegistry::default()))
}

pub(crate) async fn ensure_update_idle(_app: &AppHandle) -> Result<(), String> {
    let entries = registry()
        .lock()
        .map_err(|_| "Browser activity could not be checked")?;
    if !entries.roots.is_empty() || !entries.popups.is_empty() {
        return Err(crate::window::UPDATE_BROWSER_BUSY.into());
    }
    Ok(())
}

// WebKit has no confirmed non-forced close bridge yet. Keep its pages open
// rather than silently discarding web forms on unsupported builds.
pub(crate) async fn prepare_update_restart(app: &AppHandle) -> Result<Vec<BrowserState>, String> {
    ensure_update_idle(app).await?;
    Ok(Vec::new())
}
pub(crate) async fn finish_update_restart(app: &AppHandle) -> Result<(), String> {
    ensure_update_idle(app).await
}
pub(crate) async fn cancel_update_restart(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

impl PreviewContext {
    fn notice(&self, message: impl Into<String>) {
        if let Ok(mut state) = self.state.lock() {
            state.set_notice(message.into());
        }
        emit_state(&self.caller, &self.state);
    }

    fn navigation(&self, url: &Url) -> bool {
        if allowed_navigation_url(
            url,
            self.caller.app_handle().config().build.dev_url.as_ref(),
        ) {
            return true;
        }
        // WKNavigationAction includes subframes. Rejection must never replace
        // the top-level URL or hide an otherwise usable page.
        self.notice(
            "This link cannot open in the embedded browser. The current page is still available.",
        );
        false
    }
}

fn allowed_navigation_url(url: &Url, dev_url: Option<&Url>) -> bool {
    allowed_url(url, dev_url)
        || (url.scheme() == "about" && matches!(url.path(), "blank" | "srcdoc"))
        || (url.scheme() == "blob"
            && Url::parse(url.path()).is_ok_and(|origin| allowed_url(&origin, dev_url)))
}

fn allowed_download_url(url: &Url, dev_url: Option<&Url>) -> bool {
    allowed_url(url, dev_url)
        || url.scheme() == "data"
        || (url.scheme() == "blob"
            && (url.path().starts_with("null/")
                || Url::parse(url.path()).is_ok_and(|origin| allowed_url(&origin, dev_url))))
}

fn safe_download_filename(value: &str) -> String {
    let mut name: String = value
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':') {
                '_'
            } else {
                c
            }
        })
        .collect();
    name = name
        .trim_matches(|c: char| c.is_whitespace() || c == '.')
        .to_string();
    while name.len() > 180 {
        name.pop();
    }
    if name.is_empty() {
        "download".into()
    } else {
        name
    }
}

fn unique_download_path(
    directory: &Path,
    suggested: &str,
    reserved: &HashSet<PathBuf>,
) -> Result<PathBuf, String> {
    let name = safe_download_filename(suggested);
    let file = Path::new(&name);
    let stem = file
        .file_stem()
        .and_then(|v| v.to_str())
        .unwrap_or("download");
    let extension = file
        .extension()
        .and_then(|v| v.to_str())
        .map(|v| format!(".{v}"))
        .unwrap_or_default();
    for index in 0..10_000 {
        let candidate = directory.join(if index == 0 {
            name.clone()
        } else {
            format!("{stem} ({index}){extension}")
        });
        if !candidate.exists() && !reserved.contains(&candidate) {
            return Ok(candidate);
        }
    }
    Err("Could not find an unused download filename.".into())
}

fn handle_download(context: &PreviewContext, event: DownloadEvent<'_>) -> bool {
    match event {
        DownloadEvent::Requested { url, destination } => {
            if !allowed_download_url(
                &url,
                context.caller.app_handle().config().build.dev_url.as_ref(),
            ) {
                context.notice("This address cannot be downloaded from the embedded browser.");
                return false;
            }
            let Ok(directory) = context.caller.app_handle().path().download_dir() else {
                context.notice("The Downloads folder is unavailable.");
                return false;
            };
            let suggested = destination
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or("download")
                .to_string();
            let result = (|| {
                let mut pending = context
                    .downloads
                    .lock()
                    .map_err(|_| "Download state is unavailable.")?;
                let reserved = pending.values().flatten().cloned().collect();
                let path = unique_download_path(&directory, &suggested, &reserved)?;
                // WKDownload requires a destination that does not already exist.
                // Existing files and concurrent downloads keep distinct paths.
                pending
                    .entry(url.to_string())
                    .or_default()
                    .push(path.clone());
                *destination = path;
                Ok::<(), String>(())
            })();
            match result {
                Ok(()) => {
                    context.notice(format!(
                        "Downloading {} to Downloads…",
                        destination
                            .file_name()
                            .unwrap_or_default()
                            .to_string_lossy()
                    ));
                    true
                }
                Err(error) => {
                    context.notice(error);
                    false
                }
            }
        }
        DownloadEvent::Finished { url, success, .. } => {
            // macOS reports no finished path; do not fabricate one when the
            // same URL has multiple concurrent downloads.
            if let Ok(mut pending) = context.downloads.lock() {
                if let Some(paths) = pending.get_mut(url.as_str()) {
                    paths.pop();
                    if paths.is_empty() {
                        pending.remove(url.as_str());
                    }
                }
            }
            context.notice(if success {
                "Download saved to Downloads."
            } else {
                "Download failed. The current page is still available."
            });
            true
        }
        _ => true,
    }
}

fn strip_app_bridge(view: &Webview) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    view.with_webview(|platform| unsafe {
        // Retain WebKit's supplied popup configuration/opener and website data
        // store, but never expose Tauri scripts or native message handlers.
        let controller = &*platform.controller().cast::<objc2::runtime::AnyObject>();
        let _: () = objc2::msg_send![controller, removeAllUserScripts];
        let _: () = objc2::msg_send![controller, removeAllScriptMessageHandlers];
    })
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn page_loaded(view: &Webview, context: &PreviewContext, event: PageLoadEvent) {
    if matches!(event, PageLoadEvent::Started) {
        crate::browser_dialogs::cancel(view.app_handle(), view.label());
    }
    if view.label() != context.root_label {
        return;
    }
    if matches!(event, PageLoadEvent::Started) {
        if let Ok(mut state) = context.state.lock() {
            state.notice = None;
            state.error = None;
        }
    }
    refresh_state(view, context.clone());
}

#[cfg(target_os = "macos")]
fn refresh_state(view: &Webview, context: PreviewContext) {
    let _ = view.with_webview(move |platform| unsafe {
        let wk = &*platform.inner().cast::<objc2::runtime::AnyObject>();
        mac_observer::publish(wk, &context);
    });
}
#[cfg(not(target_os = "macos"))]
fn refresh_state(view: &Webview, context: PreviewContext) {
    if let Ok(mut state) = context.state.lock() {
        if let Ok(url) = view.url() {
            if allowed_url(
                &url,
                context.caller.app_handle().config().build.dev_url.as_ref(),
            ) {
                state.url = url.to_string();
            }
        }
        state.loading = false;
        state.can_go_back = true;
        state.can_go_forward = true;
    }
    emit_state(&context.caller, &context.state);
}

/// Opt-in native QA diagnostics contain no page URLs, form data, or document text.
pub(crate) fn popup_diagnostic(message: &str) {
    if std::env::var_os("SUPERMONO_BROWSER_DIAGNOSTICS").is_some() {
        eprintln!("[browser-popup] {message}");
    }
}

fn create_popup(
    context: &PreviewContext,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<tauri::Wry> {
    popup_diagnostic(&format!(
        "managed request scheme={} blank={}",
        url.scheme(),
        url.as_str() == "about:blank"
    ));
    if !context.navigation(&url) {
        popup_diagnostic("managed request denied by origin policy");
        return NewWindowResponse::Deny;
    }
    let label = format!(
        "preview-popup-{}",
        NEXT_POPUP.fetch_add(1, Ordering::Relaxed)
    );
    let nav = context.clone();
    let popup = context.clone();
    let download = context.clone();
    let load = context.clone();
    // The supplied WK configuration preserves the original request (including
    // POST bodies), window.opener, blank-window scripting and shared cookies.
    let builder = WebviewWindowBuilder::new(
        context.caller.app_handle(),
        &label,
        WebviewUrl::External(Url::parse("about:blank").unwrap()),
    )
    .title("Browser window")
    .inner_size(1000.0, 720.0)
    .window_features(features)
    .visible(false)
    .disable_drag_drop_handler()
    .on_navigation(move |url| nav.navigation(url))
    .on_new_window(move |url, features| create_popup(&popup, url, features))
    .on_download(move |_, event| handle_download(&download, event))
    .on_page_load(move |view, payload| page_loaded(view.as_ref(), &load, payload.event()))
    .on_document_title_changed(|view, title| {
        let _ = view.set_title(&title.chars().take(160).collect::<String>());
    });
    match builder.build() {
        Ok(window) => {
            if let Err(error) = strip_app_bridge(window.as_ref())
                .and_then(|()| crate::browser_dialogs::install(window.as_ref(), true))
            {
                crate::browser_dialogs::remove(window.app_handle(), window.label());
                let _ = window.destroy();
                popup_diagnostic("managed popup setup failed");
                context.notice(format!("Could not open the browser window: {error}"));
                return NewWindowResponse::Deny;
            }
            let owned = {
                let mut entries = registry().lock().unwrap_or_else(|e| e.into_inner());
                if entries.roots.contains_key(&context.root_label) {
                    entries.popups.insert(label, context.root_label.clone());
                    true
                } else {
                    false
                }
            };
            if !owned {
                popup_diagnostic("managed popup owner is no longer present");
                crate::browser_dialogs::remove(window.app_handle(), window.label());
                let _ = window.destroy();
                return NewWindowResponse::Deny;
            }
            let _ = window.show();
            let _ = window.set_focus();
            popup_diagnostic("managed popup created");
            NewWindowResponse::Create { window }
        }
        Err(error) => {
            popup_diagnostic("managed popup window build failed");
            context.notice(format!("Could not open the browser window: {error}"));
            NewWindowResponse::Deny
        }
    }
}

fn close_owned_popups(app: &AppHandle, root: &str) {
    let popups = {
        let mut entries = registry().lock().unwrap_or_else(|e| e.into_inner());
        entries.roots.remove(root);
        let labels: Vec<_> = entries
            .popups
            .iter()
            .filter(|(_, owner)| owner.as_str() == root)
            .map(|(label, _)| label.clone())
            .collect();
        for label in &labels {
            entries.popups.remove(label);
        }
        labels
    };
    for label in popups {
        crate::browser_dialogs::remove(app, &label);
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    }
    crate::browser_dialogs::remove(app, root);
    #[cfg(target_os = "macos")]
    mac_observer::remove(app, root.to_string());
}

/// Called from the app's existing WindowEvent::Destroyed handler.
pub fn window_destroyed(app: &AppHandle, window_label: &str) {
    crate::browser_dialogs::remove_for_window(app, window_label);
    let roots = {
        let mut entries = registry().lock().unwrap_or_else(|e| e.into_inner());
        entries.popups.remove(window_label);
        entries
            .roots
            .iter()
            .filter(|(_, context)| context.caller.window().label() == window_label)
            .map(|(_, context)| context.clone())
            .collect::<Vec<_>>()
    };
    for context in roots {
        tauri::async_runtime::spawn(async move {
            let _ = floating::close_context(context).await;
        });
    }
    #[cfg(target_os = "macos")]
    crate::browser_floating_controls::remove(app, window_label);
}

pub(crate) fn return_floating(root: &str) {
    floating::request_return(root);
}

pub(crate) fn floating_owner(label: &str) -> Option<String> {
    let entries = registry().lock().unwrap_or_else(|error| error.into_inner());
    let root = entries.floating.get(label)?;
    Some(entries.roots.get(root)?.caller.window().label().to_string())
}

pub(crate) fn return_floating_window(label: &str) {
    let root = registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .floating
        .get(label)
        .cloned();
    if let Some(root) = root {
        floating::request_return(&root);
    }
}

pub fn dispatch_floating_menu(app: &AppHandle, id: &str) -> bool {
    floating::dispatch_menu(app, id)
}

pub fn focused_floating_owner(app: &AppHandle) -> Option<String> {
    let window = app.windows().into_values().find(|window| {
        window.label().starts_with("preview-float-") && window.is_focused().unwrap_or(false)
    })?;
    let entries = registry().lock().unwrap_or_else(|e| e.into_inner());
    let root = entries.floating.get(window.label())?;
    Some(entries.roots.get(root)?.caller.window().label().to_string())
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
    let context = floating::context_for(&caller, &id)?;
    floating::set_floating(context.clone(), floating).await?;
    if !floating {
        return Ok(None);
    }
    let placement = context.placement.lock().await;
    Ok(placement.window.clone())
}

#[tauri::command]
pub async fn browser_show_floating(caller: Webview, id: String) -> Result<(), String> {
    floating::show(floating::context_for(&caller, &id)?).await
}

#[cfg(target_os = "macos")]
mod mac_observer {
    use super::*;
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{AnyObject, AnyProtocol, NSObject, Sel},
        DefinedClass, MainThreadOnly,
    };
    use objc2_foundation::{
        MainThreadMarker, NSError, NSNotificationCenter, NSObjectProtocol, NSString,
        NSURLErrorFailingURLErrorKey,
    };
    use std::cell::{Cell, RefCell};
    use std::ffi::c_void;

    const KEYS: [&str; 5] = ["URL", "title", "loading", "canGoBack", "canGoForward"];
    const WINDOW_NOTIFICATIONS: [&str; 3] = [
        "NSWindowDidUpdateNotification",
        "NSWindowDidBecomeKeyNotification",
        "NSWindowDidResignKeyNotification",
    ];
    pub struct ObserverState {
        view: Retained<AnyObject>,
        context: PreviewContext,
        original_navigation_delegate: Option<Retained<AnyObject>>,
        navigation: Cell<usize>,
    }
    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = ObserverState]
        pub struct BrowserObserver;
        unsafe impl NSObjectProtocol for BrowserObserver {
            #[unsafe(method(respondsToSelector:))]
            fn responds(&self, selector: Sel) -> bool {
                let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
                own || self.original_responds(selector)
            }
            #[unsafe(method(conformsToProtocol:))]
            fn conforms(&self, protocol: &AnyProtocol) -> bool {
                let own: bool = unsafe { msg_send![super(self), conformsToProtocol: protocol] };
                own || self.ivars().original_navigation_delegate.as_ref().is_some_and(|original| unsafe {
                    msg_send![&**original, conformsToProtocol: protocol]
                })
            }
        }
        impl BrowserObserver {
            #[unsafe(method(windowUpdated:))]
            fn window_updated(&self, _notification: &AnyObject) {
                unsafe {
                    let wk = &*self.ivars().view;
                    let window: *mut AnyObject = msg_send![wk, window];
                    if window.is_null() { return; }
                    let key: bool = msg_send![window, isKeyWindow];
                    let hidden: bool = msg_send![wk, isHiddenOrHasHiddenAncestor];
                    let responder: *mut AnyObject = msg_send![window, firstResponder];
                    let focused = key && !hidden && !responder.is_null()
                        && msg_send![responder, respondsToSelector: objc2::sel!(isDescendantOf:)]
                        && msg_send![responder, isDescendantOf: wk];
                    let context = &self.ivars().context;
                    let changed = if let Ok(mut state) = context.state.lock() {
                        let changed = state.focused != focused;
                        state.focused = focused;
                        changed
                    } else { false };
                    if changed { emit_state(&context.caller, &context.state); }
                }
            }
            #[unsafe(method(forwardingTargetForSelector:))]
            fn forward(&self, selector: Sel) -> *mut AnyObject {
                if self.original_responds(selector) {
                    self.ivars().original_navigation_delegate.as_ref().map_or(std::ptr::null_mut(), |delegate| Retained::as_ptr(delegate).cast_mut())
                } else { std::ptr::null_mut() }
            }
            #[unsafe(method(webView:didStartProvisionalNavigation:))]
            fn started(&self, wk: &AnyObject, navigation: Option<&AnyObject>) {
                self.ivars().navigation.set(navigation.map_or(0, |nav| nav as *const _ as usize));
                crate::browser_dialogs::cancel(self.ivars().context.caller.app_handle(), &self.ivars().context.root_label);
                if let Ok(mut state) = self.ivars().context.state.lock() {
                    state.begin_navigation();
                }
                emit_state(&self.ivars().context.caller, &self.ivars().context.state);
                let selector = objc2::sel!(webView:didStartProvisionalNavigation:);
                if self.original_responds(selector) {
                    unsafe { let _: () = msg_send![&**self.ivars().original_navigation_delegate.as_ref().unwrap(), webView: wk, didStartProvisionalNavigation: navigation]; }
                }
            }
            #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
            fn failed_provisional(&self, wk: &AnyObject, navigation: Option<&AnyObject>, error: &NSError) {
                self.failed(navigation, error);
                if self.original_responds(objc2::sel!(webView:didFailProvisionalNavigation:withError:)) {
                    unsafe { let _: () = msg_send![&**self.ivars().original_navigation_delegate.as_ref().unwrap(), webView: wk, didFailProvisionalNavigation: navigation, withError: error]; }
                }
            }
            #[unsafe(method(webView:didFailNavigation:withError:))]
            fn failed_navigation(&self, wk: &AnyObject, navigation: Option<&AnyObject>, error: &NSError) {
                self.failed(navigation, error);
                if self.original_responds(objc2::sel!(webView:didFailNavigation:withError:)) {
                    unsafe { let _: () = msg_send![&**self.ivars().original_navigation_delegate.as_ref().unwrap(), webView: wk, didFailNavigation: navigation, withError: error]; }
                }
            }
            #[unsafe(method(webViewWebContentProcessDidTerminate:))]
            fn terminated(&self, wk: &AnyObject) {
                let context = &self.ivars().context;
                if let Ok(mut state) = context.state.lock() {
                    state.loading = false;
                    state.error = Some("The browser page stopped unexpectedly. Reload to reopen it.".into());
                }
                emit_state(&context.caller, &context.state);
                if self.original_responds(objc2::sel!(webViewWebContentProcessDidTerminate:)) {
                    unsafe { let _: () = msg_send![&**self.ivars().original_navigation_delegate.as_ref().unwrap(), webViewWebContentProcessDidTerminate: wk]; }
                }
            }
            #[unsafe(method(observeValueForKeyPath:ofObject:change:context:))]
            fn observe(&self, _key: Option<&NSString>, _object: Option<&AnyObject>, _change: Option<&AnyObject>, _context: *mut c_void) {
                unsafe { publish(&self.ivars().view, &self.ivars().context); }
            }
        }
    );

    impl BrowserObserver {
        fn original_responds(&self, selector: Sel) -> bool {
            self.ivars()
                .original_navigation_delegate
                .as_ref()
                .is_some_and(|original| unsafe {
                    msg_send![&**original, respondsToSelector: selector]
                })
        }

        fn failed(&self, navigation: Option<&AnyObject>, error: &NSError) {
            let active = self.ivars().navigation.get();
            if navigation.is_some_and(|nav| active != 0 && active != nav as *const _ as usize) {
                return;
            }
            let context = &self.ivars().context;
            let failing_url = unsafe {
                let info: *mut AnyObject = msg_send![error, userInfo];
                let value: *mut AnyObject =
                    msg_send![info, objectForKey: NSURLErrorFailingURLErrorKey];
                if !value.is_null()
                    && msg_send![value, respondsToSelector: objc2::sel!(absoluteString)]
                {
                    let absolute: *mut NSString = msg_send![value, absoluteString];
                    (!absolute.is_null()).then(|| (*absolute).to_string())
                } else {
                    None
                }
            };
            if let Ok(mut state) = context.state.lock() {
                if !state.fail_navigation(
                    &error.domain().to_string(),
                    error.code(),
                    failing_url.as_deref(),
                    context.caller.app_handle().config().build.dev_url.as_ref(),
                ) {
                    return;
                }
            }
            emit_state(&context.caller, &context.state);
        }
    }
    thread_local! { static OBSERVERS: RefCell<HashMap<String, Retained<BrowserObserver>>> = RefCell::new(HashMap::new()); }

    pub unsafe fn publish(wk: &AnyObject, context: &PreviewContext) {
        let url: *mut AnyObject = msg_send![wk, URL];
        let url_text = if url.is_null() {
            None
        } else {
            let absolute: *mut NSString = msg_send![url, absoluteString];
            (!absolute.is_null()).then(|| (*absolute).to_string())
        };
        let title: *mut NSString = msg_send![wk, title];
        let title = if title.is_null() {
            String::new()
        } else {
            (*title).to_string()
        };
        let loading: bool = msg_send![wk, isLoading];
        let mut back: bool = msg_send![wk, canGoBack];
        if back {
            let list: *mut AnyObject = msg_send![wk, backForwardList];
            let item: *mut AnyObject = msg_send![list, backItem];
            if !item.is_null() {
                let url: *mut AnyObject = msg_send![item, URL];
                let text: *mut NSString = msg_send![url, absoluteString];
                // The root's bridge-free bootstrap is an implementation detail,
                // not a page the user should land on with Back.
                if !text.is_null() && (*text).to_string() == "about:blank" {
                    back = false;
                }
            }
        }
        let forward: bool = msg_send![wk, canGoForward];
        let mut changed = false;
        if let Ok(mut state) = context.state.lock() {
            if state.error.is_some() {
                // KVO can publish the previous page URL after a provisional
                // failure. Keep the failed target available for Retry until
                // didStartProvisionalNavigation begins the next attempt.
                return;
            }
            // Transient about:blank/object URLs must not replace the restorable
            // web address. Subframe URLs never reach this WKWebView property.
            if let Some(url) = url_text.and_then(|url| Url::parse(&url).ok()) {
                if allowed_url(
                    &url,
                    context.caller.app_handle().config().build.dev_url.as_ref(),
                ) && state.url != url.as_str()
                {
                    state.url = url.to_string();
                    state.notice = None;
                    changed = true;
                }
            }
            changed |= state.title != title
                || state.loading != loading
                || state.can_go_back != back
                || state.can_go_forward != forward;
            state.title = title;
            state.loading = loading;
            state.can_go_back = back;
            state.can_go_forward = forward;
        }
        if changed {
            emit_state(&context.caller, &context.state);
        }
    }

    pub fn install(view: &Webview, context: PreviewContext) -> Result<(), String> {
        let label = view.label().to_string();
        view.with_webview(move |platform| unsafe {
            let Some(mtm) = MainThreadMarker::new() else { return; };
            let wk = &*platform.inner().cast::<AnyObject>();
            let original: *mut AnyObject = msg_send![wk, navigationDelegate];
            let observer = mtm.alloc::<BrowserObserver>().set_ivars(ObserverState {
                view: Retained::retain(wk as *const _ as *mut AnyObject).unwrap(),
                context,
                original_navigation_delegate: Retained::retain(original),
                navigation: Cell::new(0),
            });
            let observer: Retained<BrowserObserver> = msg_send![super(observer), init];
            // This is a per-view forwarding proxy. Policy/auth/download
            // decisions continue to use Wry's unchanged original delegate.
            let _: () = msg_send![wk, setNavigationDelegate: &*observer];
            for key in KEYS {
                let key = NSString::from_str(key);
                let _: () = msg_send![wk, addObserver: &*observer, forKeyPath: &*key, options: 1usize, context: std::ptr::null_mut::<c_void>()];
            }
            let window: *mut AnyObject = msg_send![wk, window];
            if !window.is_null() {
                let center = NSNotificationCenter::defaultCenter();
                for name in WINDOW_NOTIFICATIONS {
                    let name = NSString::from_str(name);
                    let _: () = msg_send![&*center, addObserver: &*observer, selector: objc2::sel!(windowUpdated:), name: &*name, object: window];
                }
            }
            publish(wk, &observer.ivars().context);
            OBSERVERS.with(|entries| { entries.borrow_mut().insert(label, observer); });
        }).map_err(|error| error.to_string())
    }

    pub fn remove(app: &AppHandle, label: String) {
        let _ = app.run_on_main_thread(move || {
            OBSERVERS.with(|entries| {
                entries.borrow_mut().remove(&label);
            });
        });
    }
    pub fn rebind_window(view: &Webview) -> Result<(), String> {
        let label = view.label().to_string();
        view.with_webview(move |platform| unsafe {
            OBSERVERS.with(|entries| {
                let entries = entries.borrow();
                let Some(observer) = entries.get(&label) else { return; };
                let center = NSNotificationCenter::defaultCenter();
                let _: () = msg_send![&*center, removeObserver: &**observer];
                let wk = &*platform.inner().cast::<AnyObject>();
                let window: *mut AnyObject = msg_send![wk, window];
                if window.is_null() { return; }
                for name in WINDOW_NOTIFICATIONS {
                    let name = NSString::from_str(name);
                    let _: () = msg_send![&*center, addObserver: &**observer, selector: objc2::sel!(windowUpdated:), name: &*name, object: window];
                }
            });
        }).map_err(|e| e.to_string())
    }
    impl Drop for BrowserObserver {
        fn drop(&mut self) {
            unsafe {
                let center = NSNotificationCenter::defaultCenter();
                let _: () = msg_send![&*center, removeObserver: &*self];
                let current: *mut AnyObject = msg_send![&*self.ivars().view, navigationDelegate];
                if current == self as *const _ as *mut AnyObject {
                    let original = self
                        .ivars()
                        .original_navigation_delegate
                        .as_ref()
                        .map_or(std::ptr::null_mut(), |value| {
                            Retained::as_ptr(value).cast_mut()
                        });
                    let _: () = msg_send![&*self.ivars().view, setNavigationDelegate: original];
                }
                for key in KEYS {
                    let key = NSString::from_str(key);
                    let _: () =
                        msg_send![&*self.ivars().view, removeObserver: &*self, forKeyPath: &*key];
                }
            }
        }
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
    let view_label = label(&caller, &id)?;
    let url = parse_url(&caller, &url)?;
    let rect = bounds.rect()?;
    if caller.app_handle().get_webview(&view_label).is_some() {
        return Err("Preview already exists".into());
    }
    let context = PreviewContext {
        caller: caller.clone(),
        root_label: view_label.clone(),
        downloads: Arc::new(Mutex::new(HashMap::new())),
        placement: Arc::new(tauri::async_runtime::Mutex::new(BrowserPlacement {
            dock_bounds: Some(bounds.clone()),
            ..Default::default()
        })),
        state: Arc::new(Mutex::new(BrowserState {
            id,
            url: url.to_string(),
            title: String::new(),
            loading: true,
            can_go_back: false,
            can_go_forward: false,
            error: None,
            notice: None,
            focused: false,
            floating: false,
        })),
    };
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .roots
        .insert(view_label.clone(), context.clone());
    let nav = context.clone();
    let popup = context.clone();
    let load = context.clone();
    let title = context.clone();
    let download = context.clone();
    // Install failure observation and remove the app bridge before the first
    // requested page loads, including localhost failures that return promptly.
    let builder = WebviewBuilder::new(
        &view_label,
        WebviewUrl::External(Url::parse("about:blank").unwrap()),
    )
    .focused(false)
    .disable_drag_drop_handler()
    .on_navigation(move |url| nav.navigation(url))
    .on_new_window(move |url, features| create_popup(&popup, url, features))
    .on_download(move |_, event| handle_download(&download, event))
    .on_page_load(move |view, payload| page_loaded(&view, &load, payload.event()))
    .on_document_title_changed(move |view, _| refresh_state(&view, title.clone()));
    let child = match caller.window().add_child(builder, rect.position, rect.size) {
        Ok(child) => child,
        Err(error) => {
            close_owned_popups(caller.app_handle(), &view_label);
            return Err(error.to_string());
        }
    };
    let setup = (|| {
        child.hide().map_err(|err| err.to_string())?;
        strip_app_bridge(&child)?;
        crate::browser_dialogs::install(&child, false)?;
        #[cfg(target_os = "macos")]
        mac_observer::install(&child, context.clone())?;
        child.navigate(url).map_err(|error| error.to_string())?;
        Ok::<(), String>(())
    })();
    if let Err(error) = setup {
        close_owned_popups(caller.app_handle(), &view_label);
        let _ = child.close();
        return Err(error);
    }
    emit_state(&caller, &context.state);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(caller: Webview, id: String, url: String) -> Result<(), String> {
    let url = parse_url(&caller, &url)?;
    let view = preview(&caller, &id)?;
    crate::browser_dialogs::cancel(view.app_handle(), view.label());
    view.navigate(url).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_action(caller: Webview, id: String, action: String) -> Result<(), String> {
    let view = preview(&caller, &id)?;
    if matches!(action.as_str(), "back" | "forward" | "reload") {
        crate::browser_dialogs::cancel(view.app_handle(), view.label());
    }
    #[cfg(target_os = "macos")]
    if matches!(action.as_str(), "back" | "forward") {
        return view
            .with_webview(move |platform| unsafe {
                let wk = &*platform.inner().cast::<objc2::runtime::AnyObject>();
                if action == "back" {
                    let _: *mut objc2::runtime::AnyObject = objc2::msg_send![wk, goBack];
                } else {
                    let _: *mut objc2::runtime::AnyObject = objc2::msg_send![wk, goForward];
                }
            })
            .map_err(|error| error.to_string());
    }
    match action.as_str() {
        "back" => view.eval("window.history.back()"),
        "forward" => view.eval("window.history.forward()"),
        "reload" => view.reload(),
        _ => return Err("Unknown preview action".into()),
    }
    .map_err(|err| err.to_string())
}

// Only the Chromium backend advertises nativeDropIndicator. Keep the shared
// shell IPC available on fallback platforms without changing webpage content.
#[tauri::command]
pub async fn browser_drop_indicator(
    caller: Webview,
    id: String,
    indicator: Option<serde_json::Value>,
) -> Result<(), String> {
    let _ = indicator;
    preview(&caller, &id)?;
    Ok(())
}

#[tauri::command]
pub async fn browser_menu(
    caller: Webview,
    id: String,
    anchor: BrowserBounds,
    options: serde_json::Value,
) -> Result<Option<String>, String> {
    let _ = (preview(&caller, &id)?, anchor.rect()?, options);
    Err("Native browser menus require the Chromium browser build.".into())
}

#[tauri::command]
pub async fn browser_edit(
    caller: Webview,
    id: String,
    active: bool,
    token: String,
) -> Result<(), String> {
    let _ = (preview(&caller, &id)?, active, token);
    Err("Visual page editing requires the Chromium browser build.".into())
}

#[tauri::command]
pub async fn browser_layout(
    caller: Webview,
    id: String,
    bounds: BrowserBounds,
    visible: bool,
) -> Result<(), String> {
    let rect = bounds.rect()?;
    let context = floating::context_for(&caller, &id)?;
    let mut placement = context.placement.lock().await;
    if !placement.record_layout(bounds, visible) {
        return Ok(());
    }
    let view = preview(&caller, &id)?;
    if !visible {
        view.hide().map_err(|err| err.to_string())?;
    }
    view.set_bounds(rect).map_err(|err| err.to_string())?;
    if visible {
        view.show().map_err(|err| err.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn browser_close(caller: Webview, id: String) -> Result<(), String> {
    let view_label = label(&caller, &id)?;
    let context = registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .roots
        .get(&view_label)
        .cloned();
    if let Some(context) = context {
        return floating::close_context(context).await;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserEngineOptions {
    pub low_memory: bool,
}

/// The WebKit preview engine has no low-memory mode. Report the options as
/// applied so the interface never asks for a restart that would change nothing.
#[tauri::command]
pub fn browser_engine_options(options: BrowserEngineOptions) -> bool {
    let _ = options;
    true
}

#[tauri::command]
pub async fn browser_sleep_probe(
    caller: Webview,
    id: String,
) -> Result<crate::browser_sleep::BrowserSleepReport, String> {
    preview(&caller, &id)?;
    Ok(crate::browser_sleep::BrowserSleepReport::blocked(
        "unsupported-engine",
    ))
}

#[tauri::command]
pub async fn browser_sleep(
    caller: Webview,
    id: String,
) -> Result<crate::browser_sleep::BrowserSleepReport, String> {
    browser_sleep_probe(caller, id).await
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
    preview(&caller, &id)?;
    let _ = (text, forward, find_next, match_case);
    Err("Find in page requires the Chromium build of Aven".into())
}

#[tauri::command]
pub fn browser_downloads(caller: Webview, id: String) -> Result<Vec<serde_json::Value>, String> {
    preview(&caller, &id)?;
    Err("Download history requires the Chromium build of Aven".into())
}

#[tauri::command]
pub async fn browser_download_action(
    caller: Webview,
    id: String,
    download_id: String,
    action: String,
) -> Result<(), String> {
    preview(&caller, &id)?;
    let _ = (download_id, action);
    Err("Download controls require the Chromium build of Aven".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detached_preview_authorization_requires_its_exact_owner_registry_entry() {
        let root = "preview-main-one";
        assert!(preview_window_is_owned("main", "main", None, root));
        assert!(preview_window_is_owned(
            "preview-float-1",
            "main",
            Some(root),
            root
        ));
        assert!(!preview_window_is_owned(
            "preview-float-1",
            "main",
            None,
            root
        ));
        assert!(!preview_window_is_owned(
            "preview-float-1",
            "main",
            Some("preview-window-2-other"),
            root
        ));
        assert!(!preview_window_is_owned("window-2", "main", None, root));
    }

    #[test]
    fn owner_layout_does_not_hide_or_resize_detached_page_but_updates_return_bounds() {
        let bounds = || BrowserBounds {
            x: 40.0,
            y: 90.0,
            width: 500.0,
            height: 320.0,
            scale: 2.0,
        };
        let mut placement = BrowserPlacement::default();
        assert!(placement.record_layout(bounds(), true));
        placement.window = Some("preview-float-1".into());
        let mut moved = bounds();
        moved.x = 700.0;
        moved.width = 260.0;
        assert!(!placement.record_layout(moved, false));
        assert!(!placement.dock_visible);
        assert_eq!(placement.dock_bounds.as_ref().unwrap().x, 700.0);
        assert_eq!(placement.dock_bounds.as_ref().unwrap().width, 260.0);
        placement.window = None;
        assert!(placement.record_layout(bounds(), true));
        placement.closed = true;
        assert!(!placement.record_layout(bounds(), true));
    }

    #[test]
    fn failed_navigation_keeps_retry_target_and_resets_on_next_attempt() {
        let mut state = BrowserState {
            id: "failure-test".into(),
            url: "http://localhost:3000/working".into(),
            title: "Previous page".into(),
            loading: true,
            can_go_back: true,
            can_go_forward: false,
            error: None,
            notice: Some("Old notice".into()),
            focused: false,
            floating: false,
        };
        assert!(!state.fail_navigation(
            "NSURLErrorDomain",
            -999,
            Some("https://old.example/"),
            None
        ));
        assert!(state.loading && state.error.is_none());
        assert!(state.fail_navigation(
            "NSURLErrorDomain",
            -1004,
            Some("http://localhost:3000/offline"),
            None
        ));
        assert!(!state.loading && state.error.is_some() && state.notice.is_none());
        assert_eq!(state.url, "http://localhost:3000/offline");
        assert!(state.can_go_back);
        state.begin_navigation();
        assert!(state.loading && state.error.is_none());
        state.fail_navigation(
            "NSURLErrorDomain",
            -1003,
            Some("http://tauri.localhost/private"),
            None,
        );
        assert_eq!(state.url, "http://localhost:3000/offline");
    }

    #[test]
    fn canceled_or_download_policy_navigations_are_not_page_failures() {
        assert!(navigation_failure_message("NSURLErrorDomain", -999).is_none());
        assert!(navigation_failure_message("WebKitErrorDomain", 102).is_none());
        assert!(navigation_failure_message("AnotherDomain", 102).is_some());
    }

    #[test]
    fn real_connection_dns_and_tls_failures_offer_visible_recovery() {
        assert!(navigation_failure_message("NSURLErrorDomain", -1003)
            .unwrap()
            .contains("server could not be found"));
        assert!(navigation_failure_message("NSURLErrorDomain", -1004)
            .unwrap()
            .contains("development server"));
        for code in -1206..=-1200 {
            assert!(navigation_failure_message("NSURLErrorDomain", code)
                .unwrap()
                .contains("security remains enabled"));
        }
        assert!(navigation_failure_message("NSURLErrorDomain", -1001)
            .unwrap()
            .contains("retry"));
    }

    #[test]
    fn remote_preview_cannot_enter_app_or_script_origins() {
        let dev = Url::parse("http://localhost:1420").unwrap();
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "tauri://localhost",
            "http://tauri.localhost",
            "https://asset.localhost",
            "http://ipc.localhost",
            "http://localhost:1420/anything",
            "https://user:password@example.com",
        ] {
            assert!(
                !allowed_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
        for value in [
            "https://example.com",
            "http://localhost:3000",
            "http://127.0.0.1:5173",
        ] {
            assert!(
                allowed_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
    }

    #[test]
    fn blank_frames_and_external_blob_pages_do_not_break_the_parent_page() {
        let dev = Url::parse("http://localhost:1420").unwrap();
        for value in [
            "about:blank",
            "about:srcdoc",
            "blob:https://example.com/1234",
            "http://localhost:3000/frame",
        ] {
            assert!(
                allowed_navigation_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
        for value in [
            "about:config",
            "file:///tmp/report",
            "tauri://localhost",
            "http://tauri.localhost",
            "blob:http://tauri.localhost/1234",
            "blob:http://localhost:1420/1234",
            "javascript:alert(1)",
        ] {
            assert!(
                !allowed_navigation_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
    }

    #[test]
    fn blocked_actions_are_not_page_errors_or_navigation_updates() {
        let mut state = BrowserState {
            id: "test".into(),
            url: "https://example.com/working-page".into(),
            title: "Working page".into(),
            loading: true,
            can_go_back: true,
            can_go_forward: false,
            error: None,
            notice: None,
            focused: false,
            floating: false,
        };
        state.set_notice("This link cannot open here.".into());
        assert_eq!(state.url, "https://example.com/working-page");
        assert_eq!(state.title, "Working page");
        assert!(state.loading && state.can_go_back);
        assert!(state.error.is_none());
        assert!(state.notice.is_some());
    }

    #[test]
    fn generated_downloads_are_supported_without_opening_internal_origins() {
        let dev = Url::parse("http://localhost:1420").unwrap();
        for value in [
            "https://example.com/export",
            "blob:https://example.com/1234",
            "blob:null/1234",
            "data:text/plain,hello",
        ] {
            assert!(
                allowed_download_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
        for value in [
            "http://ipc.localhost",
            "http://asset.localhost",
            "http://localhost:1420/secrets",
            "blob:http://asset.localhost/1234",
            "file:///etc/passwd",
        ] {
            assert!(
                !allowed_download_url(&Url::parse(value).unwrap(), Some(&dev)),
                "{value}"
            );
        }
    }

    #[test]
    fn download_names_stay_inside_downloads_and_avoid_existing_or_pending_files() {
        let directory = std::env::temp_dir().join(format!(
            "monocode-browser-downloads-{}-{}",
            std::process::id(),
            NEXT_POPUP.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let existing = directory.join("report.csv");
        std::fs::write(&existing, "preserve me").unwrap();
        let pending = directory.join("report (1).csv");
        let reserved = HashSet::from([pending]);
        assert_eq!(
            unique_download_path(&directory, "report.csv", &reserved).unwrap(),
            directory.join("report (2).csv")
        );
        let malicious =
            unique_download_path(&directory, "../../folder\\\\bad:name.csv", &reserved).unwrap();
        assert_eq!(malicious.parent(), Some(directory.as_path()));
        assert!(!malicious.file_name().unwrap().to_string_lossy().contains([
            '/',
            char::from(92),
            ':'
        ]));
        assert_eq!(
            safe_download_filename(&format!("...{}", char::from(10))),
            "_"
        );
        assert_eq!(safe_download_filename("..."), "download");
        assert!(safe_download_filename(&"é".repeat(200)).len() <= 180);
        assert_eq!(std::fs::read_to_string(existing).unwrap(), "preserve me");
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn bounds_reject_invalid_geometry() {
        let mut bounds = BrowserBounds {
            x: 0.0,
            y: 60.0,
            width: 500.0,
            height: 500.0,
            scale: 2.0,
        };
        assert!(bounds.rect().is_ok());
        bounds.width = f64::NAN;
        assert!(bounds.rect().is_err());
        bounds.width = 0.0;
        assert!(bounds.rect().is_err());
    }
}

#[tauri::command]
pub fn browser_attach(_caller: Webview, _id: String) -> Result<serde_json::Value, String> {
    Err("Moving browser pages requires the Chromium build".into())
}
