//! Per-preview WebKit dialogs, without exposing the app's IPC to web pages.
//! A retained proxy forwards every existing optional UI-delegate method.

#[cfg(target_os = "macos")]
use tauri::Manager;
use tauri::{AppHandle, Webview};

pub fn install(view: &Webview, allow_script_close: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let label = view.label().to_string();
        let window_label = view.window().label().to_string();
        if allow_script_close && (!label.starts_with("preview-popup-") || label != window_label) {
            return Err("Only managed browser popups may close their window".into());
        }
        let app = view.app_handle().clone();
        view.with_webview(move |platform| unsafe {
            platform::install(
                &*platform.inner().cast(),
                label,
                window_label,
                app,
                allow_script_close,
            );
        })
        .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (view, allow_script_close);
    Ok(())
}

pub fn cancel(app: &AppHandle, label: &str) {
    #[cfg(target_os = "macos")]
    {
        let label = label.to_string();
        let _ = app.run_on_main_thread(move || platform::cancel(&label));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, label);
}

pub fn remove(app: &AppHandle, label: &str) {
    #[cfg(target_os = "macos")]
    {
        let label = label.to_string();
        let _ = app.run_on_main_thread(move || platform::remove(&label));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, label);
}

pub fn remove_for_window(app: &AppHandle, window_label: &str) {
    #[cfg(target_os = "macos")]
    {
        let window_label = window_label.to_string();
        let _ = app.run_on_main_thread(move || platform::remove_for_window(&window_label));
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, window_label);
}

#[cfg(target_os = "macos")]
mod platform {
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, AnyProtocol, Bool, NSObject, NSObjectProtocol, Sel};
    use objc2::{define_class, msg_send, sel, DefinedClass, MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{
        NSAlert, NSAlertFirstButtonReturn, NSAlertStyle, NSModalResponse, NSModalResponseCancel,
        NSTextField, NSWindow,
    };
    use objc2_foundation::{NSMutableURLRequest, NSPoint, NSRect, NSSize, NSString, NSURL};
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::ptr;
    use std::rc::Rc;
    use tauri::{AppHandle, Manager};

    enum Completion {
        Alert(RcBlock<dyn Fn()>),
        Confirm(RcBlock<dyn Fn(Bool)>),
        Prompt(RcBlock<dyn Fn(*mut NSString)>),
    }

    /// Take the callback before calling WebKit: a reply may reenter the delegate.
    struct OnceCompletion(RefCell<Option<Completion>>);

    impl OnceCompletion {
        fn respond(&self, accepted: bool, text: Option<&str>) {
            let completion = self.0.borrow_mut().take();
            match completion {
                Some(Completion::Alert(block)) => block.call(()),
                Some(Completion::Confirm(block)) => {
                    block.call((if accepted { Bool::YES } else { Bool::NO },));
                }
                Some(Completion::Prompt(block)) => {
                    let value = accepted.then(|| NSString::from_str(text.unwrap_or_default()));
                    block.call((value
                        .as_ref()
                        .map_or(ptr::null_mut(), |text| Retained::as_ptr(text).cast_mut()),));
                }
                None => {}
            }
        }
    }

    struct Pending {
        alert: Retained<NSAlert>,
        parent: Retained<NSWindow>,
        input: Option<Retained<NSTextField>>,
        completion: OnceCompletion,
    }

    impl Pending {
        fn answer(&self, accepted: bool) {
            let text = self
                .input
                .as_ref()
                .map(|input| input.stringValue().to_string());
            self.completion.respond(accepted, text.as_deref());
        }

        fn cancel(&self) {
            self.parent
                .endSheet_returnCode(&self.alert.window(), NSModalResponseCancel);
            self.completion.respond(false, None);
        }
    }

    #[derive(Default)]
    struct DialogState {
        pending: RefCell<HashMap<u64, Rc<Pending>>>,
        next_id: Cell<u64>,
        cancelling: Cell<bool>,
        closed: Cell<bool>,
    }

    impl DialogState {
        fn finish(&self, id: u64, accepted: bool) {
            let pending = self.pending.borrow_mut().remove(&id);
            if let Some(pending) = pending {
                pending.answer(accepted);
            }
        }

        fn cancel_all(&self) {
            if self.cancelling.replace(true) {
                return;
            }
            // NSAlert and JS callbacks may reenter: hold no RefCell borrow.
            let pending: Vec<_> = self.pending.borrow_mut().drain().map(|(_, p)| p).collect();
            for pending in pending {
                pending.cancel();
            }
            self.cancelling.set(false);
        }
    }

    pub(super) struct DelegateIvars {
        original: Option<Retained<AnyObject>>,
        state: Rc<DialogState>,
        app: AppHandle,
        popup_label: Option<String>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "SupermonoPreviewDialogDelegate"]
        #[thread_kind = MainThreadOnly]
        #[ivars = DelegateIvars]
        struct Delegate;

        unsafe impl NSObjectProtocol for Delegate {
            #[unsafe(method(respondsToSelector:))]
            fn responds(&self, selector: Sel) -> bool {
                let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
                own || self.original_responds(selector)
            }

            #[unsafe(method(conformsToProtocol:))]
            fn conforms(&self, protocol: &AnyProtocol) -> bool {
                let own: bool = unsafe { msg_send![super(self), conformsToProtocol: protocol] };
                own || self.ivars().original.as_ref().is_some_and(|original| unsafe {
                    msg_send![&**original, conformsToProtocol: protocol]
                })
            }
        }

        impl Delegate {
            #[unsafe(method(forwardingTargetForSelector:))]
            fn forward(&self, selector: Sel) -> *mut AnyObject {
                if self.original_responds(selector) {
                    self.ivars().original.as_ref()
                        .map_or(ptr::null_mut(), |original| Retained::as_ptr(original).cast_mut())
                } else {
                    ptr::null_mut()
                }
            }

            // Keep WebKit's original action/configuration/features intact.
            // Only Wry's view of a truly empty request gets about:blank so
            // Tauri's URL parser can reach the managed-popup callback.
            // method_id preserves Wry's autoreleased return ABI.
            #[unsafe(method_id(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
            unsafe fn create_web_view(&self, view: &AnyObject, configuration: &AnyObject, action: &AnyObject, features: &AnyObject) -> Option<Retained<AnyObject>> {
                diagnose_popup_action(action);
                let normalized = normalized_blank_action(action);
                let forwarded_action: &AnyObject = match normalized.as_ref() {
                    Some(proxy) => proxy,
                    None => action,
                };
                let selector = sel!(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:);
                let result = if self.original_responds(selector) {
                    self.ivars().original.as_ref().and_then(|original| {
                        msg_send![&**original,
                            webView: view,
                            createWebViewWithConfiguration: configuration,
                            forNavigationAction: forwarded_action,
                            windowFeatures: features
                        ]
                    })
                } else {
                    None
                };
                crate::browser::popup_diagnostic(if result.is_some() {
                    "proxy popup returned a webview"
                } else {
                    "proxy popup returned no webview"
                });
                result
            }

            #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
            fn alert(&self, view: &AnyObject, message: &NSString, frame: &AnyObject, handler: &DynBlock<dyn Fn()>) {
                self.show(view, message, frame, None, Completion::Alert(handler.copy()));
            }

            #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
            fn confirm(&self, view: &AnyObject, message: &NSString, frame: &AnyObject, handler: &DynBlock<dyn Fn(Bool)>) {
                self.show(view, message, frame, None, Completion::Confirm(handler.copy()));
            }

            #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
            fn prompt(&self, view: &AnyObject, message: &NSString, default_text: Option<&NSString>, frame: &AnyObject, handler: &DynBlock<dyn Fn(*mut NSString)>) {
                self.show(view, message, frame, default_text, Completion::Prompt(handler.copy()));
            }

            #[unsafe(method(webViewDidClose:))]
            fn script_closed(&self, view: &AnyObject) {
                // Embedded previews never close their containing application.
                let Some(label) = self.ivars().popup_label.clone() else { return; };
                self.ivars().state.closed.set(true);
                self.ivars().state.cancel_all();
                let app = self.ivars().app.clone();
                // Defer destruction until the native delegate callback returns.
                tauri::async_runtime::spawn(async move {
                    if let Some(window) = app.get_webview_window(&label) {
                        let _ = window.destroy();
                    }
                });
                let selector = sel!(webViewDidClose:);
                if self.original_responds(selector) {
                    if let Some(original) = &self.ivars().original {
                        let _: () = unsafe { msg_send![&**original, webViewDidClose: view] };
                    }
                }
            }
        }
    );

    struct BlankActionIvars {
        original: Retained<AnyObject>,
        request: Retained<NSMutableURLRequest>,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "SupermonoBlankPopupAction"]
        #[thread_kind = MainThreadOnly]
        #[ivars = BlankActionIvars]
        struct BlankPopupAction;

        unsafe impl NSObjectProtocol for BlankPopupAction {
            #[unsafe(method(respondsToSelector:))]
            fn responds(&self, selector: Sel) -> bool {
                let own: bool = unsafe { msg_send![super(self), respondsToSelector: selector] };
                own || unsafe { msg_send![&*self.ivars().original, respondsToSelector: selector] }
            }
        }

        impl BlankPopupAction {
            #[unsafe(method_id(request))]
            fn request(&self) -> Retained<NSMutableURLRequest> {
                self.ivars().request.clone()
            }

            #[unsafe(method(forwardingTargetForSelector:))]
            fn forward(&self, _selector: Sel) -> *mut AnyObject {
                Retained::as_ptr(&self.ivars().original).cast_mut()
            }
        }
    );

    fn blank_popup_url_needs_normalization(value: Option<&str>) -> bool {
        value == Some("")
    }

    /// This temporary wrapper is passed only to Wry's original UI delegate.
    /// WebKit still owns its untouched real action and completes the original
    /// blank-window request, preserving opener, document.write and form data.
    unsafe fn normalized_blank_action(action: &AnyObject) -> Option<Retained<BlankPopupAction>> {
        let request: Option<Retained<AnyObject>> = msg_send![action, request];
        let request = request?;
        let url: Option<Retained<NSURL>> = msg_send![&*request, URL];
        let absolute = url
            .and_then(|url| url.absoluteString())
            .map(|value| value.to_string());
        if !blank_popup_url_needs_normalization(absolute.as_deref()) {
            return None;
        }
        let blank = NSURL::URLWithString(&NSString::from_str("about:blank"))?;
        let request: Retained<NSMutableURLRequest> = msg_send![&*request, mutableCopy];
        request.setURL(Some(&blank));
        let original = Retained::retain((action as *const AnyObject).cast_mut())?;
        let mtm = MainThreadMarker::new().expect("WebKit delegate runs on the main thread");
        let proxy = mtm
            .alloc::<BlankPopupAction>()
            .set_ivars(BlankActionIvars { original, request });
        crate::browser::popup_diagnostic("proxy normalized an empty popup request for URL parsing");
        Some(msg_send![super(proxy), init])
    }

    impl Delegate {
        fn original_responds(&self, selector: Sel) -> bool {
            self.ivars()
                .original
                .as_ref()
                .is_some_and(|original| unsafe {
                    msg_send![&**original, respondsToSelector: selector]
                })
        }

        fn show(
            &self,
            view: &AnyObject,
            message: &NSString,
            frame: &AnyObject,
            default_text: Option<&NSString>,
            completion: Completion,
        ) {
            let state = &self.ivars().state;
            let completion = OnceCompletion(RefCell::new(Some(completion)));
            let parent: Option<Retained<NSWindow>> = unsafe { msg_send![view, window] };
            let Some(parent) = parent.filter(|_| !state.closed.get() && !state.cancelling.get())
            else {
                completion.respond(false, None);
                return;
            };
            let alert = NSAlert::new(self.mtm());
            alert.setAlertStyle(NSAlertStyle::Informational);
            alert.setMessageText(&NSString::from_str(&format!("{} says", frame_host(frame))));
            alert.setInformativeText(&NSString::from_str(
                &message.to_string().chars().take(4000).collect::<String>(),
            ));
            alert.addButtonWithTitle(&NSString::from_str("OK"));
            let is_alert = matches!(*completion.0.borrow(), Some(Completion::Alert(_)));
            let is_prompt = matches!(*completion.0.borrow(), Some(Completion::Prompt(_)));
            if !is_alert {
                let cancel = alert.addButtonWithTitle(&NSString::from_str("Cancel"));
                cancel.setKeyEquivalent(&NSString::from_str("\u{1b}"));
            }
            let input = is_prompt.then(|| {
                let input = NSTextField::new(self.mtm());
                input.setFrame(NSRect::new(
                    NSPoint::new(0.0, 0.0),
                    NSSize::new(320.0, 24.0),
                ));
                input.setStringValue(default_text.unwrap_or(&NSString::from_str("")));
                alert.setAccessoryView(Some(&input));
                input
            });
            let pending = Rc::new(Pending {
                alert,
                parent,
                input,
                completion,
            });
            let id = state.next_id.get();
            state.next_id.set(id.wrapping_add(1));
            state.pending.borrow_mut().insert(id, pending.clone());
            // Weak state avoids alert -> block -> pending -> alert ownership cycles.
            let weak = Rc::downgrade(state);
            let handler = RcBlock::new(move |response: NSModalResponse| {
                if let Some(state) = weak.upgrade() {
                    state.finish(id, response == NSAlertFirstButtonReturn);
                }
            });
            pending
                .alert
                .beginSheetModalForWindow_completionHandler(&pending.parent, Some(&handler));
            if let Some(input) = &pending.input {
                let _ = pending.alert.window().makeFirstResponder(Some(input));
            }
        }
    }

    fn diagnose_popup_action(action: &AnyObject) {
        if std::env::var_os("SUPERMONO_BROWSER_DIAGNOSTICS").is_none() {
            return;
        }
        unsafe {
            let request: Option<Retained<AnyObject>> = msg_send![action, request];
            let url: Option<Retained<NSURL>> = request
                .as_ref()
                .and_then(|request| msg_send![&**request, URL]);
            let absolute = url.as_ref().and_then(|url| url.absoluteString());
            let scheme = url.as_ref().and_then(|url| url.scheme());
            let scheme = match scheme.as_ref().map(|scheme| scheme.to_string()).as_deref() {
                Some("http") => "http",
                Some("https") => "https",
                Some("about") => "about",
                None => "none",
                _ => "other",
            };
            // No host, path, query, form payload or page content is logged.
            crate::browser::popup_diagnostic(&format!(
                "proxy request present={} url_present={} empty={} about_blank={} scheme={scheme}",
                request.is_some(),
                url.is_some(),
                absolute.as_ref().is_none_or(|value| value.is_empty()),
                absolute
                    .as_ref()
                    .is_some_and(|value| value.to_string() == "about:blank"),
            ));
        }
    }

    fn frame_host(frame: &AnyObject) -> String {
        unsafe {
            let request: Option<Retained<AnyObject>> = msg_send![frame, request];
            let url: Option<Retained<NSURL>> = request
                .as_ref()
                .and_then(|request| msg_send![&**request, URL]);
            url.and_then(|url| url.host())
                .map(|host| host.to_string())
                .filter(|host| !host.is_empty())
                .unwrap_or_else(|| "This website".into())
        }
    }

    struct Entry {
        view: Retained<AnyObject>,
        delegate: Retained<Delegate>,
        window_label: String,
    }

    impl Drop for Entry {
        fn drop(&mut self) {
            // The view is retained until its previous weak delegate is restored.
            // Never overwrite a newer delegate installed by another owner.
            unsafe {
                let current: *mut AnyObject = msg_send![&*self.view, UIDelegate];
                if current == Retained::as_ptr(&self.delegate).cast_mut().cast() {
                    let original = self
                        .delegate
                        .ivars()
                        .original
                        .as_ref()
                        .map_or(ptr::null_mut(), |original| {
                            Retained::as_ptr(original).cast_mut()
                        });
                    let _: () = msg_send![&*self.view, setUIDelegate: original];
                }
            }
            self.delegate.ivars().state.closed.set(true);
            self.delegate.ivars().state.cancel_all();
        }
    }

    thread_local! {
        static ENTRIES: RefCell<HashMap<String, Entry>> = RefCell::new(HashMap::new());
    }

    pub(super) unsafe fn install(
        view: &AnyObject,
        label: String,
        window_label: String,
        app: AppHandle,
        allow_script_close: bool,
    ) {
        remove(&label);
        let mtm = MainThreadMarker::new().expect("WebKit callback runs on the main thread");
        let original: Option<Retained<AnyObject>> = msg_send![view, UIDelegate];
        let delegate = mtm.alloc::<Delegate>().set_ivars(DelegateIvars {
            original,
            state: Rc::new(DialogState::default()),
            app,
            popup_label: allow_script_close.then(|| label.clone()),
        });
        let delegate: Retained<Delegate> = msg_send![super(delegate), init];
        let view =
            Retained::retain((view as *const AnyObject).cast_mut()).expect("WebKit view is valid");
        let _: () = msg_send![&*view, setUIDelegate: &*delegate];
        ENTRIES.with(|entries| {
            entries.borrow_mut().insert(
                label,
                Entry {
                    view,
                    delegate,
                    window_label,
                },
            )
        });
    }

    pub(super) fn cancel(label: &str) {
        let state = ENTRIES.with(|entries| {
            entries
                .borrow()
                .get(label)
                .map(|entry| entry.delegate.ivars().state.clone())
        });
        if let Some(state) = state {
            state.cancel_all();
        }
    }

    pub(super) fn remove(label: &str) {
        let entry = ENTRIES.with(|entries| entries.borrow_mut().remove(label));
        drop(entry);
    }

    pub(super) fn remove_for_window(window_label: &str) {
        let labels: Vec<_> = ENTRIES.with(|entries| {
            entries
                .borrow()
                .iter()
                .filter(|(_, entry)| entry.window_label == window_label)
                .map(|(label, _)| label.clone())
                .collect()
        });
        for label in labels {
            remove(&label);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{blank_popup_url_needs_normalization, Completion, OnceCompletion};
        use block2::RcBlock;
        use objc2::runtime::Bool;
        use objc2_foundation::NSString;
        use std::cell::{Cell, RefCell};
        use std::rc::Rc;

        #[test]
        fn only_a_present_empty_popup_url_is_normalized() {
            assert!(blank_popup_url_needs_normalization(Some("")));
            for value in [
                None,
                Some(" "),
                Some("about:blank"),
                Some("http://127.0.0.1/"),
                Some("https://example.test/"),
                Some("/relative"),
                Some("javascript:void(0)"),
            ] {
                assert!(!blank_popup_url_needs_normalization(value));
            }
        }

        #[test]
        fn confirm_completion_is_consumed_before_repeated_cancel_or_accept() {
            let values = Rc::new(RefCell::new(Vec::new()));
            let observed = values.clone();
            let block =
                RcBlock::new(move |accepted: Bool| observed.borrow_mut().push(accepted.as_bool()));
            let response = OnceCompletion(RefCell::new(Some(Completion::Confirm(block))));
            response.respond(false, None);
            response.respond(true, None);
            assert_eq!(*values.borrow(), [false]);
        }

        #[test]
        fn prompt_distinguishes_cancel_from_an_accepted_empty_string() {
            for (accepted, expected) in [(false, None), (true, Some(String::new()))] {
                let value = Rc::new(RefCell::new(None));
                let observed = value.clone();
                let block = RcBlock::new(move |text: *mut NSString| {
                    *observed.borrow_mut() =
                        Some(unsafe { text.as_ref() }.map(|text| text.to_string()));
                });
                let response = OnceCompletion(RefCell::new(Some(Completion::Prompt(block))));
                response.respond(accepted, Some(""));
                assert_eq!(*value.borrow(), Some(expected));
            }
        }

        #[test]
        fn alert_completes_exactly_once_when_cancelled() {
            let count = Rc::new(Cell::new(0));
            let observed = count.clone();
            let block = RcBlock::new(move || observed.set(observed.get() + 1));
            let response = OnceCompletion(RefCell::new(Some(Completion::Alert(block))));
            response.respond(false, None);
            response.respond(false, None);
            assert_eq!(count.get(), 1);
        }

        #[test]
        fn a_completion_can_reenter_without_borrowing_or_firing_twice() {
            let count = Rc::new(Cell::new(0));
            let observed = count.clone();
            let holder = Rc::new(RefCell::new(std::rc::Weak::<OnceCompletion>::new()));
            let callback_holder = holder.clone();
            let block = RcBlock::new(move || {
                observed.set(observed.get() + 1);
                let response = callback_holder.borrow().upgrade().unwrap();
                response.respond(false, None);
            });
            let response = Rc::new(OnceCompletion(RefCell::new(Some(Completion::Alert(block)))));
            *holder.borrow_mut() = Rc::downgrade(&response);
            response.respond(true, None);
            assert_eq!(count.get(), 1);
        }
    }
}
