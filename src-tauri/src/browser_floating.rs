//! Move the existing remote WKWebView; never create another page or app renderer.
use super::*;

pub(super) fn context_for(caller: &Webview, id: &str) -> Result<PreviewContext, String> {
    preview(caller, id)?;
    registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .roots
        .get(&label(caller, id)?)
        .cloned()
        .ok_or_else(|| "Preview is closed".into())
}

pub(super) async fn close_context(context: PreviewContext) -> Result<(), String> {
    let mut placement = context.placement.lock().await;
    if placement.closed {
        return Ok(());
    }
    let app = context.caller.app_handle();
    if let Some(label) = &placement.window {
        crate::pip_group::detach_windows(app, std::slice::from_ref(label)).await?;
    }
    placement.closed = true;
    close_owned_popups(app, &context.root_label);
    let result = if let Some(view) = app.get_webview(&context.root_label) {
        view.close().map_err(|e| e.to_string())
    } else {
        Ok(())
    };
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

pub(super) async fn set_floating(context: PreviewContext, floating: bool) -> Result<(), String> {
    if !floating {
        let label = context.placement.lock().await.window.clone();
        if label.as_ref().is_some_and(|label| {
            crate::pip_group::request_return(context.caller.app_handle(), label)
        }) {
            return Ok(());
        }
    }
    // Layout, return and owner-close operations serialize per view. This async
    // lock is never acquired by a native main-thread callback.
    let mut placement = context.placement.lock().await;
    if placement.closed {
        return Err("Preview is closed".into());
    }
    let app = context.caller.app_handle();
    let view = app
        .get_webview(&context.root_label)
        .ok_or("Preview is closed")?;
    if floating {
        if let Some(label) = &placement.window {
            if let Some(window) = app.get_window(label) {
                window.show().map_err(|e| e.to_string())?;
                return window.set_focus().map_err(|e| e.to_string());
            }
            return Err("The picture-in-picture window is unavailable".into());
        }
        let label = format!(
            "preview-float-{}",
            NEXT_POPUP.fetch_add(1, Ordering::Relaxed)
        );
        let title = context
            .state
            .lock()
            .map(|state| {
                if state.title.trim().is_empty() {
                    state.url.clone()
                } else {
                    state.title.clone()
                }
            })
            .unwrap_or_else(|_| "Browser".into());
        let window = tauri::window::WindowBuilder::new(app, &label)
            .title(title.chars().take(160).collect::<String>())
            .inner_size(680.0, 460.0)
            .min_inner_size(320.0, 180.0)
            .always_on_top(true)
            .visible(false)
            .build()
            .map_err(|e| e.to_string())?;
        let event_root = context.root_label.clone();
        window.on_window_event(move |event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                request_return(&event_root);
            }
        });
        registry()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .floating
            .insert(label.clone(), context.root_label.clone());
        crate::browser_dialogs::cancel(app, &context.root_label);
        let moved = (|| {
            view.reparent(&window).map_err(|e| e.to_string())?;
            rebind_window(&view)?;
            #[cfg(target_os = "macos")]
            crate::browser_floating_controls::install(&window, context.root_label.clone())?;
            configure_floating_layout(&view, true)?;
            view.show().map_err(|e| e.to_string())?;
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
            view.set_focus().map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        })();
        if let Err(error) = moved {
            // Restore the old placement before destroying the temporary shell.
            // The same view and document survive a recoverable setup failure.
            let _ = configure_floating_layout(&view, false);
            if view.reparent(&context.caller.window()).is_err() {
                // A failed rollback must not destroy the window that still owns
                // the live page. Leave a recoverable floating placement instead.
                placement.window = Some(label);
                let _ = configure_floating_layout(&view, true);
                let _ = rebind_window(&view);
                let _ = view.show();
                let _ = window.show();
                publish_placement(&context, true);
                return Err(error);
            }
            let _ = rebind_window(&view);
            if let Some(bounds) = &placement.dock_bounds {
                if let Ok(rect) = bounds.rect() {
                    let _ = view.set_bounds(rect);
                }
            }
            if !placement.dock_visible {
                let _ = view.hide();
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
    } else {
        let Some(label) = placement.window.clone() else {
            return Ok(());
        };
        let owner = app
            .get_window(context.caller.window().label())
            .ok_or("The original workspace has closed")?;
        crate::pip_group::detach_windows(app, std::slice::from_ref(&label)).await?;
        crate::browser_dialogs::cancel(app, &context.root_label);
        configure_floating_layout(&view, false)?;
        if let Err(error) = view.reparent(&owner) {
            let _ = configure_floating_layout(&view, true);
            return Err(error.to_string());
        }
        // Once reparented, finish bookkeeping even if a subsequent cosmetic
        // update fails, so the workspace can restore its normal layout.
        let mut restored = rebind_window(&view);
        if let Some(bounds) = &placement.dock_bounds {
            restored =
                restored.and_then(|()| view.set_bounds(bounds.rect()?).map_err(|e| e.to_string()));
        }
        let visibility = if placement.dock_visible {
            view.show()
        } else {
            view.hide()
        };
        if let Err(error) = visibility {
            restored = Err(error.to_string());
        }
        if let Err(error) = restored {
            context.notice(error);
        }
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
    publish_placement(&context, floating);
    Ok(())
}

fn publish_placement(context: &PreviewContext, floating: bool) {
    if let Ok(mut state) = context.state.lock() {
        state.floating = floating;
        state.focused = false;
    }
    emit_state(&context.caller, &context.state);
}

fn configure_floating_layout(view: &Webview, floating: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // After reparenting, AppKit's actual superview is authoritative. Tao's
        // cached content-view size need not describe the new WK parent.
        view.set_auto_resize(false).map_err(|e| e.to_string())?;
        crate::browser_floating_controls::set_page_layout(view, floating)
    }
    #[cfg(not(target_os = "macos"))]
    {
        if floating {
            let size = view.window().inner_size().map_err(|e| e.to_string())?;
            view.set_bounds(Rect {
                position: PhysicalPosition::new(0, 0).into(),
                size: size.into(),
            })
            .map_err(|e| e.to_string())?;
        }
        view.set_auto_resize(floating).map_err(|e| e.to_string())
    }
}

fn rebind_window(view: &Webview) -> Result<(), String> {
    crate::browser_dialogs::install(view, false)?;
    #[cfg(target_os = "macos")]
    mac_observer::rebind_window(view)?;
    Ok(())
}

pub(super) fn request_return(root: &str) {
    let context = registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .roots
        .get(root)
        .cloned();
    if let Some(context) = context {
        tauri::async_runtime::spawn(async move {
            if let Err(error) = set_floating(context.clone(), false).await {
                context.notice(error);
            }
        });
    }
}

pub(super) fn dispatch_menu(app: &AppHandle, id: &str) -> bool {
    if id != "close_tab" {
        return false;
    }
    let focused = app.windows().into_values().find(|window| {
        window.label().starts_with("preview-float-") && window.is_focused().unwrap_or(false)
    });
    let Some(window) = focused else {
        return false;
    };
    let root = registry()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .floating
        .get(window.label())
        .cloned();
    if let Some(root) = root {
        request_return(&root);
        true
    } else {
        false
    }
}

pub(super) async fn show(context: PreviewContext) -> Result<(), String> {
    let placement = context.placement.lock().await;
    let label = placement
        .window
        .as_ref()
        .ok_or("This page is already in the workspace")?;
    let window = context
        .caller
        .app_handle()
        .get_window(label)
        .ok_or("Picture in Picture is closed")?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
