#[cfg(target_os = "macos")]
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
#[cfg(target_os = "macos")]
use tauri::Wry;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

const GITHUB_URL: &str = "https://github.com/capi-git/aven";
const REPORT_BUG_URL: &str = "https://github.com/capi-git/aven/issues/new?template=bug_report.yml";
const REQUEST_FEATURE_URL: &str =
    "https://github.com/capi-git/aven/issues/new?template=feature_request.yml";

/// External page opened by a Help menu item, if `id` is one.
fn help_url(id: &str) -> Option<&'static str> {
    match id {
        "help_github" => Some(GITHUB_URL),
        "help_report_bug" => Some(REPORT_BUG_URL),
        "help_request_feature" => Some(REQUEST_FEATURE_URL),
        _ => None,
    }
}

/// Menu commands every window hears; each window decides whether it acts.
fn is_broadcast_command(id: &str) -> bool {
    matches!(
        id,
        "new_tab"
            | "close_tab"
            | "close_other_tabs"
            | "next_tab"
            | "prev_tab"
            | "back_tab"
            | "forward_tab"
            | "split_right"
            | "split_down"
            | "focus_left"
            | "focus_right"
            | "focus_up"
            | "focus_down"
            | "sidebar_opacity"
            | "open_project"
            | "go_to_file"
            | "open_palette"
            | "open_search"
            | "open_inbox"
            | "open_automations"
            | "open_notes"
            | "find_in_project"
            | "find"
            | "new_terminal"
            | "new_terminal_tab"
            | "toggle_terminal"
            | "open_model_picker"
            | "open_settings"
            | "check_for_updates"
    )
}

/// Picks the window a single-window menu command belongs to: the focused one,
/// else the first visible one, else any. Labels are sorted for stability.
fn single_target(windows: &[(String, bool, bool)]) -> Option<&str> {
    let mut sorted: Vec<_> = windows.iter().collect();
    sorted.sort_by(|a, b| a.0.cmp(&b.0));
    sorted
        .iter()
        .find(|(_, focused, _)| *focused)
        .or_else(|| sorted.iter().find(|(_, _, visible)| *visible))
        .or(sorted.first())
        .map(|(label, _, _)| label.as_str())
}

/// Emits to one window only: a broadcast would make every window act on a
/// single menu click (each would toggle its sidebar, or bump the shared
/// interface scale again).
fn emit_to_one_window(app: &AppHandle, id: &str) {
    let windows: Vec<_> = app
        .windows()
        .into_values()
        .map(|window| {
            (
                window.label().to_string(),
                window.is_focused().unwrap_or(false),
                window.is_visible().unwrap_or(false),
            )
        })
        .collect();
    match single_target(&windows) {
        Some(label) => {
            let _ = app.emit_to(label, id, ());
        }
        None => {
            let _ = app.emit(id, ());
        }
    }
}

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    app.set_menu(build(app)?)?;
    let _ = app;
    Ok(())
}

pub fn dispatch(app: &AppHandle, id: &str) {
    // Help links leave the app, so no window or floating browser owns them.
    if let Some(url) = help_url(id) {
        let _ = app.opener().open_url(url, None::<&str>);
        return;
    }
    #[cfg(all(feature = "chromium", target_os = "macos"))]
    if crate::browser::dispatch_native_menu(id) {
        return;
    }
    if crate::browser::dispatch_floating_menu(app, id) {
        return;
    }
    if !matches!(id, "new_window" | "quit") {
        if let Some(owner) = crate::browser::focused_floating_owner(app) {
            // The floating browser hosts the existing page, not another App.
            // Its workspace shortcuts and zoom belong only to its owner.
            let _ = app.emit_to(tauri::EventTarget::webview(owner), id, ());
            return;
        }
    }
    // A website popup owns its close shortcut; it must not close an agent pane
    // in the main workspace via the normal broadcast command.
    #[cfg(not(all(feature = "chromium", target_os = "macos")))]
    if id == "close_tab" {
        if let Some(popup) = app.webview_windows().into_values().find(|window| {
            window.label().starts_with("preview-popup-") && window.is_focused().unwrap_or(false)
        }) {
            crate::browser_dialogs::remove(app, popup.label());
            let _ = popup.destroy();
            return;
        }
    }
    match id {
        "new_window" => {
            let _ = crate::window::open_new_window(app);
        }
        "quit" => crate::window::request_quit(app),
        _ if is_broadcast_command(id) => {
            let _ = app.emit(id, ());
        }
        "toggle_sidebar" | "toggle_inspector" | "zoom_in" | "zoom_out" | "zoom_reset" => {
            emit_to_one_window(app, id);
        }
        _ => {}
    }
}

#[cfg(target_os = "macos")]
fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let open_settings = MenuItemBuilder::with_id("open_settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let check_for_updates =
        MenuItemBuilder::with_id("check_for_updates", "Check for Updates…").build(app)?;
    let new_window = MenuItemBuilder::with_id("new_window", "New Window")
        .accelerator("CmdOrCtrl+Shift+N")
        .build(app)?;
    let open_project = MenuItemBuilder::with_id("open_project", "Open Project…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let go_to_file = MenuItemBuilder::with_id("go_to_file", "Go to File…")
        .accelerator("CmdOrCtrl+P")
        .build(app)?;
    let open_palette = MenuItemBuilder::with_id("open_palette", "Command Palette…")
        .accelerator("CmdOrCtrl+K")
        .build(app)?;
    let open_search = MenuItemBuilder::with_id("open_search", "Search…")
        .accelerator("CmdOrCtrl+Shift+K")
        .build(app)?;
    let open_inbox = MenuItemBuilder::with_id("open_inbox", "Inbox").build(app)?;
    let open_automations =
        MenuItemBuilder::with_id("open_automations", "Automations").build(app)?;
    let open_notes = MenuItemBuilder::with_id("open_notes", "Notes").build(app)?;
    let new_tab = MenuItemBuilder::with_id("new_tab", "New Tab")
        .accelerator("CmdOrCtrl+T")
        .build(app)?;
    let new_terminal = MenuItemBuilder::with_id("new_terminal", "New Terminal")
        .accelerator("CmdOrCtrl+`")
        .build(app)?;
    let new_terminal_tab = MenuItemBuilder::with_id("new_terminal_tab", "New Terminal Tab")
        .accelerator("CmdOrCtrl+Shift+`")
        .build(app)?;
    let toggle_terminal = MenuItemBuilder::with_id("toggle_terminal", "Toggle Terminal")
        .accelerator("CmdOrCtrl+J")
        .build(app)?;
    let split_right = MenuItemBuilder::with_id("split_right", "Split Pane Right")
        .accelerator("CmdOrCtrl+D")
        .build(app)?;
    let split_down = MenuItemBuilder::with_id("split_down", "Split Pane Down")
        .accelerator("CmdOrCtrl+Shift+D")
        .build(app)?;
    let close_tab = MenuItemBuilder::with_id("close_tab", "Close Pane")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;
    let close_other_tabs = MenuItemBuilder::with_id("close_other_tabs", "Close Other Tabs")
        .accelerator("CmdOrCtrl+Alt+T")
        .build(app)?;
    let next_tab = MenuItemBuilder::with_id("next_tab", "Next Tab")
        .accelerator("CmdOrCtrl+Shift+]")
        .build(app)?;
    let prev_tab = MenuItemBuilder::with_id("prev_tab", "Previous Tab")
        .accelerator("CmdOrCtrl+Shift+[")
        .build(app)?;
    let back_tab = MenuItemBuilder::with_id("back_tab", "Go Back")
        .accelerator("CmdOrCtrl+[")
        .build(app)?;
    let forward_tab = MenuItemBuilder::with_id("forward_tab", "Go Forward")
        .accelerator("CmdOrCtrl+]")
        .build(app)?;

    let focus_left = MenuItemBuilder::with_id("focus_left", "Focus Pane Left")
        .accelerator("CmdOrCtrl+Alt+Left")
        .build(app)?;
    let focus_right = MenuItemBuilder::with_id("focus_right", "Focus Pane Right")
        .accelerator("CmdOrCtrl+Alt+Right")
        .build(app)?;
    let focus_up = MenuItemBuilder::with_id("focus_up", "Focus Pane Up")
        .accelerator("CmdOrCtrl+Alt+Up")
        .build(app)?;
    let focus_down = MenuItemBuilder::with_id("focus_down", "Focus Pane Down")
        .accelerator("CmdOrCtrl+Alt+Down")
        .build(app)?;

    let toggle_sidebar = MenuItemBuilder::with_id("toggle_sidebar", "Toggle Sidebar")
        .accelerator("CmdOrCtrl+B")
        .build(app)?;
    let toggle_inspector = MenuItemBuilder::with_id("toggle_inspector", "Toggle File Panel")
        .accelerator("CmdOrCtrl+Shift+B")
        .build(app)?;
    let open_model_picker = MenuItemBuilder::with_id("open_model_picker", "Switch Model…")
        .accelerator("CmdOrCtrl+.")
        .build(app)?;
    let sidebar_opacity =
        MenuItemBuilder::with_id("sidebar_opacity", "Sidebar Appearance…").build(app)?;
    // No accelerators here on purpose: the webview key handler owns
    // CmdOrCtrl + - 0, and a menu accelerator would fire the same command
    // a second time on top of it.
    let zoom_in = MenuItemBuilder::with_id("zoom_in", "Zoom In").build(app)?;
    let zoom_out = MenuItemBuilder::with_id("zoom_out", "Zoom Out").build(app)?;
    let zoom_reset = MenuItemBuilder::with_id("zoom_reset", "Reset Zoom").build(app)?;
    let find = MenuItemBuilder::with_id("find", "Find")
        .accelerator("CmdOrCtrl+F")
        .build(app)?;

    let find_in_project = MenuItemBuilder::with_id("find_in_project", "Find in Files…")
        .accelerator("CmdOrCtrl+Shift+F")
        .build(app)?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&new_window)
        .item(&open_project)
        .item(&open_palette)
        .item(&open_search)
        .item(&go_to_file)
        .item(&find_in_project)
        .separator()
        .item(&new_tab)
        .item(&new_terminal)
        .item(&new_terminal_tab)
        .item(&split_right)
        .item(&split_down)
        .item(&close_tab)
        .item(&close_other_tabs)
        .separator()
        .item(&prev_tab)
        .item(&next_tab)
        .item(&back_tab)
        .item(&forward_tab)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&toggle_sidebar)
        .item(&toggle_inspector)
        .item(&open_inbox)
        .item(&open_automations)
        .item(&open_notes)
        .item(&toggle_terminal)
        .item(&open_model_picker)
        .separator()
        .item(&focus_left)
        .item(&focus_right)
        .item(&focus_up)
        .item(&focus_down)
        .separator()
        .item(&zoom_in)
        .item(&zoom_out)
        .item(&zoom_reset)
        .separator()
        .item(&sidebar_opacity)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&find)
        .build()?;

    #[cfg(target_os = "macos")]
    {
        let quit = MenuItemBuilder::with_id("quit", "Quit Aven")
            .accelerator("CmdOrCtrl+Q")
            .build(app)?;
        let app_menu = SubmenuBuilder::new(app, "Aven")
            .about(Some(AboutMetadata::default()))
            .separator()
            .item(&open_settings)
            .item(&check_for_updates)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&quit)
            .build()?;
        // Tauri registers this submenu via NSApp.setWindowsMenu:, which throws
        // on macOS 12 when the menu is empty and aborts the app at launch.
        let window_menu = SubmenuBuilder::with_id(app, tauri::menu::WINDOW_SUBMENU_ID, "Window")
            .minimize()
            .maximize()
            .build()?;
        let github = MenuItemBuilder::with_id("help_github", "View on GitHub").build(app)?;
        let report_bug = MenuItemBuilder::with_id("help_report_bug", "Report a Bug…").build(app)?;
        let request_feature =
            MenuItemBuilder::with_id("help_request_feature", "Request a Feature…").build(app)?;
        let help = SubmenuBuilder::with_id(app, tauri::menu::HELP_SUBMENU_ID, "Help")
            .item(&github)
            .separator()
            .item(&report_bug)
            .item(&request_feature)
            .build()?;
        return Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window_menu, &help]);
    }

    #[allow(unreachable_code)]
    Menu::with_items(app, &[&file, &edit, &view])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn help_links_open_aven_pages_only() {
        assert_eq!(
            help_url("help_github"),
            Some("https://github.com/capi-git/aven")
        );
        assert_eq!(
            help_url("help_report_bug"),
            Some("https://github.com/capi-git/aven/issues/new?template=bug_report.yml")
        );
        assert_eq!(
            help_url("help_request_feature"),
            Some("https://github.com/capi-git/aven/issues/new?template=feature_request.yml")
        );
        assert_eq!(help_url("toggle_sidebar"), None);
        for url in [GITHUB_URL, REPORT_BUG_URL, REQUEST_FEATURE_URL] {
            assert!(url.starts_with("https://github.com/capi-git/aven"));
            assert!(!url.to_lowercase().contains("monocode"));
            assert!(!url.contains("usemono"));
        }
    }

    #[test]
    fn library_views_open_in_every_window_that_listens() {
        for id in ["open_inbox", "open_automations", "open_notes"] {
            assert!(is_broadcast_command(id), "{id} should reach the webviews");
        }
        // Single-window and app-level commands keep their own routing.
        for id in [
            "toggle_sidebar",
            "zoom_in",
            "new_window",
            "quit",
            "help_github",
        ] {
            assert!(!is_broadcast_command(id), "{id} is not a broadcast");
        }
        assert!(!is_broadcast_command("open_scheduled"));
    }

    #[test]
    fn single_window_commands_prefer_focused_then_visible_window() {
        let window = |label: &str, focused, visible| (label.to_string(), focused, visible);
        assert_eq!(
            single_target(&[window("main", false, true), window("window-2", true, true),]),
            Some("window-2")
        );
        assert_eq!(
            single_target(&[
                window("window-2", false, true),
                window("main", false, false),
            ]),
            Some("window-2")
        );
        assert_eq!(
            single_target(&[
                window("window-2", false, false),
                window("main", false, false),
            ]),
            Some("main")
        );
        assert_eq!(single_target(&[]), None);
    }
}
