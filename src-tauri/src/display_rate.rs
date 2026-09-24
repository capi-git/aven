//! Let Aven's own WebKit documents render at the display's full refresh rate.
//!
//! WebKit enables "Prefer Page Rendering Updates near 60fps" by default, which
//! paces `requestAnimationFrame`, scrolling updates and CSS animations at about
//! 16.7 ms even on 120 Hz ProMotion displays. The page reads the preference
//! when it is created; changing it on a live WKWebView keeps the 60 fps cadence.
//! App documents therefore receive a WKWebViewConfiguration with the feature
//! disabled before Tauri builds them.
//!
//! Remote browser pages are unaffected: Chromium tabs use their own compositor,
//! and WebKit previews keep WebKit's default behavior.

use tauri::{webview::WebviewBuilder, AppHandle, Runtime, WebviewWindowBuilder};

const FEATURE_KEY: &str = "PreferPageRenderingUpdatesNear60FPSEnabled";
/// Set `AVEN_DEBUG_COMPOSITING=1` to outline composited layers and tiles in
/// Aven's own documents, WebKit's equivalent of Safari's Layers inspector.
const COMPOSITING_DEBUG_KEYS: [&str; 2] = [
    "CompositingBordersVisible",
    "CompositingRepaintCountersVisible",
];

pub(crate) trait FullRefreshRate<R: Runtime>: Sized {
    /// Request full-refresh rendering for a trusted Aven document.
    fn full_refresh_rate(self, app: &AppHandle<R>) -> Self;
}

impl<R: Runtime> FullRefreshRate<R> for WebviewBuilder<R> {
    fn full_refresh_rate(self, app: &AppHandle<R>) -> Self {
        #[cfg(target_os = "macos")]
        if let Some(configuration) = mac::configuration(app) {
            return self.with_webview_configuration(configuration);
        }
        let _ = app;
        self
    }
}

impl<R: Runtime, M: tauri::Manager<R>> FullRefreshRate<R> for WebviewWindowBuilder<'_, R, M> {
    fn full_refresh_rate(self, app: &AppHandle<R>) -> Self {
        #[cfg(target_os = "macos")]
        if let Some(configuration) = mac::configuration(app) {
            return self.with_webview_configuration(configuration);
        }
        let _ = app;
        self
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use super::{COMPOSITING_DEBUG_KEYS, FEATURE_KEY};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyClass, AnyObject, Bool};
    use objc2::{msg_send, sel, MainThreadMarker};
    use objc2_foundation::{NSArray, NSObjectProtocol, NSString};
    use objc2_web_kit::WKWebViewConfiguration;
    use tauri::{AppHandle, Runtime};

    struct MainThreadConfiguration(Option<Retained<WKWebViewConfiguration>>);
    // The configuration is created on the main thread and only handed to
    // Tauri, which builds the WKWebView on the main thread (its own
    // WebviewAttributes carry the same object across threads).
    unsafe impl Send for MainThreadConfiguration {}

    pub(super) fn configuration<R: Runtime>(
        app: &AppHandle<R>,
    ) -> Option<Retained<WKWebViewConfiguration>> {
        if let Some(mtm) = MainThreadMarker::new() {
            return create(mtm);
        }
        // Async commands build windows from a worker thread. WebKit objects
        // belong on the main thread, so create the configuration there.
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let configuration = MainThreadMarker::new().and_then(create);
            let _ = sender.send(MainThreadConfiguration(configuration));
        })
        .ok()?;
        receiver.recv().ok()?.0
    }

    fn create(mtm: MainThreadMarker) -> Option<Retained<WKWebViewConfiguration>> {
        let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
        let disabled = objc2::exception::catch(std::panic::AssertUnwindSafe(|| unsafe {
            disable_60fps_preference(&configuration)
        }));
        // A WebKit without this SPI keeps its default pacing and Tauri's own
        // configuration rather than failing the window.
        matches!(disabled, Ok(true)).then_some(configuration)
    }

    /// Uses WebKit's feature-flag SPI, the same interface as Safari's Feature
    /// Flags settings. Returns false when this WebKit does not expose it.
    unsafe fn disable_60fps_preference(configuration: &WKWebViewConfiguration) -> bool {
        let preferences = configuration.preferences();
        let Some(class) = AnyClass::get(c"WKPreferences") else {
            return false;
        };
        if !class.metaclass().responds_to(sel!(_features))
            || !preferences.respondsToSelector(sel!(_setEnabled:forFeature:))
        {
            return false;
        }
        let features: Option<Retained<NSArray<AnyObject>>> = msg_send![class, _features];
        let Some(features) = features else {
            return false;
        };
        let wanted = NSString::from_str(FEATURE_KEY);
        let debug_compositing =
            std::env::var_os("AVEN_DEBUG_COMPOSITING").is_some_and(|v| v == "1");
        let mut disabled = false;
        for feature in features.iter() {
            let key: Option<Retained<NSString>> = msg_send![&*feature, key];
            let Some(key) = key else { continue };
            if key.isEqualToString(&wanted) {
                let _: () = msg_send![&*preferences, _setEnabled: Bool::NO, forFeature: &*feature];
                let enabled: Bool = msg_send![&*preferences, _isEnabledForFeature: &*feature];
                disabled = !enabled.as_bool();
            } else if debug_compositing
                && COMPOSITING_DEBUG_KEYS
                    .iter()
                    .any(|debug| key.isEqualToString(&NSString::from_str(debug)))
            {
                let _: () = msg_send![&*preferences, _setEnabled: Bool::YES, forFeature: &*feature];
            }
        }
        disabled
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn installed_webkit_exposes_the_feature_flag_interface() {
            // WebKit terminates when its preferences are used off the main
            // thread, and unit tests run on workers. Only check the selectors.
            let class = AnyClass::get(c"WKPreferences").expect("WebKit is linked");
            assert!(class.metaclass().responds_to(sel!(_features)));
            assert!(class.responds_to(sel!(_setEnabled:forFeature:)));
            assert!(class.responds_to(sel!(_isEnabledForFeature:)));
        }
    }
}
