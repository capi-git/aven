//! Native window helpers for floating browser windows (browser Picture in
//! Picture): detach from AppKit tab groups and keep-on-top pinning.
use tauri::{AppHandle, Manager};

/// Remove each window from any native tab group and disallow tabbing, so a
/// floating window never merges into another window's tab bar.
pub async fn detach_windows(app: &AppHandle, labels: &[String]) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        native::detach(app, labels).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, labels);
        Ok(())
    }
}

pub fn set_pinned(app: &AppHandle, label: &str, pinned: bool) -> Result<(), String> {
    if let Some(window) = app.get_window(label) {
        window
            .set_always_on_top(pinned)
            .map_err(|error| error.to_string())?;
        #[cfg(target_os = "macos")]
        crate::browser_floating_controls::set_pinned(app, label, pinned);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::{msg_send, runtime::AnyObject};

    async fn mutate<T: Send + 'static>(
        operation: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        // Tauri's run_on_main_thread runs under Tao's event-handler mutex.
        // AppKit tabbing can synchronously draw a Tao view and reenter that same
        // handler. Dispatching to the main queue runs after the handler unlocks.
        dispatch2::DispatchQueue::main().exec_async(move || {
            let _ = sender.send(operation());
        });
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv()
                .map_err(|_| "Native Picture in Picture operation was interrupted".to_string())?
        })
        .await
        .map_err(|error| error.to_string())?
    }

    pub(super) async fn detach(app: &AppHandle, labels: &[String]) -> Result<(), String> {
        let native_app = app.clone();
        let labels = labels.to_vec();
        mutate(move || unsafe {
            for label in labels {
                let Some(window) = native_app.get_window(&label) else {
                    continue;
                };
                let pointer =
                    window.ns_window().map_err(|error| error.to_string())? as *mut AnyObject;
                let group: *mut AnyObject = msg_send![pointer, tabGroup];
                if !group.is_null() {
                    let windows: *mut AnyObject = msg_send![group, windows];
                    let count: usize = msg_send![windows, count];
                    if count > 1 {
                        let _: () = msg_send![group, removeWindow: pointer];
                    }
                }
                let _: () = msg_send![pointer, setTabbingMode: 2isize];
            }
            Ok(())
        })
        .await
    }
}
