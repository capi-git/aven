use tauri::Manager;

mod access_panel;
mod agent_tools;
#[cfg_attr(
    all(feature = "chromium", target_os = "macos"),
    path = "browser_chromium.rs"
)]
mod browser;
mod browser_agent;
#[cfg(not(all(feature = "chromium", target_os = "macos")))]
mod browser_agent_dom;
#[cfg(all(feature = "chromium", target_os = "macos"))]
#[path = "browser_chromium_dom.rs"]
mod browser_agent_dom;
pub use browser_agent::run_browser_cli;
#[cfg(not(all(feature = "chromium", target_os = "macos")))]
mod browser_dialogs;
#[cfg(target_os = "macos")]
mod browser_floating_controls;
mod browser_snapshot;
mod chat_background;
mod checkpoint;
mod control;
pub mod control_cli;
mod cursor_store;
mod fs;
mod github_account;
mod harness;
mod inbox_media;
mod linear;
#[cfg(target_os = "macos")]
mod macos;
mod menu;
mod notes;
mod notifications;
mod personal_project;
mod pip_group;
mod project_logo;
mod projectless;
mod provider_updates;
mod pty;
mod rate_limits;
mod search;
mod session_pip;
mod session_store;
mod shell_navigation;
mod skills;
mod startup_cli;
pub use startup_cli::run_startup_cli;
mod usage_panel;
mod window;
mod window_transfer;
#[cfg(windows)]
mod windows;
mod workspace_menu_panel;
mod workspace_window;

// Phase 1 seam: spawn / kill harness children per Aven thread.
// Adapters own the protocol; this host only supervises processes.

/// Project directory for new sessions — prefer cwd, else home.
#[tauri::command]
fn default_cwd() -> String {
    if let Ok(cwd) = std::env::current_dir() {
        return fs::path_to_js(&cwd);
    }
    dirs_home()
        .map(|home| fs::path_to_js(std::path::Path::new(&home)))
        .unwrap_or_else(|| "~".into())
}

#[tauri::command]
fn home_dir() -> String {
    dirs_home()
        .map(|home| fs::path_to_js(std::path::Path::new(&home)))
        .unwrap_or_else(|| "~".into())
}

pub(crate) struct PasswdIdentity {
    pub home: String,
    pub user: String,
    pub shell: String,
}

pub(crate) fn dirs_home() -> Option<String> {
    #[cfg(windows)]
    let keys = ["USERPROFILE", "HOME"];
    #[cfg(not(windows))]
    let keys = ["HOME", "USERPROFILE"];
    for key in keys {
        if let Some(home) = std::env::var_os(key) {
            let home = home.to_string_lossy().into_owned();
            if !home.is_empty() {
                return Some(home);
            }
        }
    }
    match (std::env::var("HOMEDRIVE"), std::env::var("HOMEPATH")) {
        (Ok(drive), Ok(path)) if !drive.is_empty() && !path.is_empty() => {
            Some(format!("{drive}{path}"))
        }
        _ => passwd_identity().map(|id| id.home),
    }
}

/// Hide the console window that Windows allocates for GUI-spawned children.
pub(crate) fn hide_window_console(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let _ = cmd;
}

/// Finder-launched .app bundles often omit HOME/USER/SHELL. Fall back to the
/// passwd database so harness CLIs still find `~/.fx` and the login keychain.
pub(crate) fn passwd_identity() -> Option<PasswdIdentity> {
    #[cfg(unix)]
    {
        let uid = unsafe { libc::getuid() };
        let mut buf = vec![0u8; 4096];
        let mut pwd = unsafe { std::mem::zeroed::<libc::passwd>() };
        let mut result = std::ptr::null_mut::<libc::passwd>();
        let rc = unsafe {
            libc::getpwuid_r(
                uid,
                &mut pwd,
                buf.as_mut_ptr() as *mut libc::c_char,
                buf.len(),
                &mut result,
            )
        };
        if rc != 0 || result.is_null() {
            return None;
        }
        unsafe {
            let user = std::ffi::CStr::from_ptr(pwd.pw_name)
                .to_string_lossy()
                .into_owned();
            let home = std::ffi::CStr::from_ptr(pwd.pw_dir)
                .to_string_lossy()
                .into_owned();
            let shell = std::ffi::CStr::from_ptr(pwd.pw_shell)
                .to_string_lossy()
                .into_owned();
            if user.is_empty() || home.is_empty() {
                return None;
            }
            Some(PasswdIdentity { home, user, shell })
        }
    }
    #[cfg(not(unix))]
    {
        None
    }
}

#[tauri::command]
fn set_traffic_lights_visible(
    #[allow(unused_variables)] window: tauri::Window,
    #[allow(unused_variables)] visible: bool,
) {
    #[cfg(target_os = "macos")]
    macos::set_visible(&window, visible);
}

#[tauri::command]
fn set_window_background_blur(
    #[allow(unused_variables)] window: tauri::Window,
    #[allow(unused_variables)] radius: u8,
) {
    #[cfg(target_os = "macos")]
    macos::set_background_blur_radius(&window, radius);
}

#[tauri::command]
fn set_dock_badge(
    #[allow(unused_variables)] window: tauri::Window,
    #[allow(unused_variables)] count: u32,
) {
    #[cfg(target_os = "macos")]
    macos::set_window_badge(&window, count);
}

#[tauri::command]
fn open_new_window(app: tauri::AppHandle) -> Result<(), String> {
    window::open_new_window(&app)
}

#[cfg(debug_assertions)]
pub(crate) const DEV_PRODUCT_NAME: &str = "Aven Dev";
#[cfg(debug_assertions)]
pub(crate) const DEV_BUNDLE_ID: &str = "com.capi.aven.dev";

/// Enforce isolation in the binary, including when `tauri dev` is invoked
/// without the development runner's configuration overlay.
#[cfg(debug_assertions)]
fn configure_development(config: &mut tauri::Config) {
    config.identifier = DEV_BUNDLE_ID.into();
    config.product_name = Some(DEV_PRODUCT_NAME.into());
    config.version = Some(env!("CARGO_PKG_VERSION").into());
    config.build.dev_url = Some("http://127.0.0.1:1420".parse().expect("fixed dev URL"));
    for window in &mut config.app.windows {
        window.title = DEV_PRODUCT_NAME.into();
    }
    config.plugins.0.remove("updater");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    windows::initialize().expect("Failed to initialize Windows process safety");
    let context = tauri::generate_context!();
    #[cfg(debug_assertions)]
    let context = {
        let mut context = context;
        configure_development(context.config_mut());
        context.package_info_mut().name = DEV_PRODUCT_NAME.into();
        context
    };
    let builder = tauri::Builder::default();
    // A development binary must never download or install a production update.
    #[cfg(not(debug_assertions))]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        .plugin(shell_navigation::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_filter(window::is_workspace_label)
                .build(),
        )
        .manage(harness::HarnessHost::new())
        .manage(pty::PtyHost::new())
        .manage(window::UpdateRestartState::default())
        .manage(window_transfer::WindowTransferState::new())
        .manage(session_pip::SessionPipState::default())
        .manage(workspace_window::WorkspaceWindowState::default())
        .manage(usage_panel::UsagePanelState::default())
        .manage(access_panel::AccessPanelState::default())
        .manage(workspace_menu_panel::WorkspaceMenuPanelState::default())
        .setup(|app| {
            // The development app owns only the children it starts. Leave any
            // process-wide recovery of production leftovers to the release app.
            if !cfg!(debug_assertions) {
                harness::reap_orphaned_harness_processes();
            }
            session_store::init(app.handle())?;
            control::init(app.handle())?;
            checkpoint::init(app.handle())?;
            menu::install(app.handle())?;
            #[cfg(target_os = "macos")]
            {
                macos::install_dock_menu(app.handle());
                if let Some(window) = app.get_window("main") {
                    macos::install(&window);
                }
            }
            #[cfg(not(target_os = "macos"))]
            {
                if let Some(window) = app.get_window("main") {
                    let _ = window.set_decorations(false);
                    let _ = window.set_shadow(true);
                }
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::dispatch(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            access_panel::access_panel_open,
            access_panel::access_panel_update,
            access_panel::access_panel_get_state,
            access_panel::access_panel_ready,
            access_panel::access_panel_action,
            access_panel::access_panel_close,
            workspace_menu_panel::workspace_menu_panel_open,
            workspace_menu_panel::workspace_menu_panel_update,
            workspace_menu_panel::workspace_menu_panel_get_state,
            workspace_menu_panel::workspace_menu_panel_ready,
            workspace_menu_panel::workspace_menu_panel_action,
            workspace_menu_panel::workspace_menu_panel_close,
            usage_panel::usage_panel_open,
            usage_panel::usage_panel_update,
            usage_panel::usage_panel_get_state,
            usage_panel::usage_panel_ready,
            usage_panel::usage_panel_action,
            usage_panel::usage_panel_close,
            browser_agent::browser_agent_bind,
            browser_agent::browser_agent_revoke,
            browser_agent::browser_agent_open_result,
            browser_agent::browser_agent_open_file_result,
            browser::browser_create,
            browser::browser_navigate,
            browser::browser_action,
            browser::browser_menu,
            browser::browser_edit,
            browser::browser_drop_indicator,
            browser::browser_layout,
            browser::browser_close,
            browser::browser_set_floating,
            browser::browser_show_floating,
            browser::browser_find,
            browser::browser_downloads,
            browser::browser_download_action,
            browser_snapshot::browser_snapshot,
            projectless::projectless_cwd,
            workspace_window::workspace_window_open,
            workspace_window::workspace_window_update,
            workspace_window::workspace_window_get_state,
            workspace_window::workspace_window_visibility,
            workspace_window::workspace_window_focus,
            workspace_window::workspace_window_new_session,
            workspace_window::workspace_window_ack,
            workspace_window::workspace_window_freeze,
            workspace_window::workspace_window_resume,
            workspace_window::workspace_window_return_selection,
            workspace_window::workspace_window_ready,
            workspace_window::workspace_window_action,
            workspace_window::workspace_window_checkpoint,
            workspace_window::workspace_window_return,
            workspace_window::workspace_window_set_pinned,
            workspace_window::workspace_window_show,
            workspace_window::workspace_window_list,
            workspace_window::workspace_window_recover,
            workspace_window::workspace_window_close,
            browser::browser_attach,
            session_pip::session_pip_open,
            session_pip::session_pip_update,
            session_pip::session_pip_get_state,
            session_pip::session_pip_action,
            session_pip::session_pip_draft,
            session_pip::session_pip_return,
            session_pip::session_pip_set_pinned,
            session_pip::session_pip_show,
            session_pip::session_pip_close,
            session_pip::session_pip_flush_all,
            pip_group::pip_group_windows,
            default_cwd,
            home_dir,
            notifications::notification_permission,
            notifications::request_notification_permission,
            notifications::show_notification,
            notifications::open_notification_settings,
            fs::list_dir,
            personal_project::personal_project_info,
            fs::list_project_files,
            fs::git_diff_stats,
            fs::git_diff_index,
            fs::git_diff_files,
            fs::git_file_diff,
            fs::git_history,
            fs::git_commit_files,
            fs::git_commit_file_diff,
            fs::git_stage_file,
            fs::git_stage_contents,
            fs::git_unstage_file,
            fs::git_discard_file,
            fs::git_discard_all,
            fs::git_stage_all,
            fs::git_unstage_all,
            fs::git_commit,
            fs::git_staged_context,
            fs::git_push,
            fs::git_pull,
            fs::git_sync,
            fs::git_range_context,
            fs::git_pr_status,
            fs::git_pr_create,
            fs::git_github_repo,
            fs::git_github_work_items,
            fs::git_github_work_item_details,
            fs::git_github_work_item_thread,
            fs::git_github_work_item_comment,
            fs::git_github_pr_diff,
            inbox_media::fetch_inbox_media,
            linear::linear_status,
            linear::linear_set_token,
            linear::linear_list_teams,
            linear::linear_list_issues,
            linear::linear_issue_details,
            linear::linear_issue_thread,
            linear::linear_issue_comment,
            fs::git_branches,
            fs::git_checkout,
            fs::git_create_branch,
            fs::git_stash,
            fs::create_path,
            fs::rename_path,
            fs::delete_path,
            fs::copy_path,
            fs::move_path,
            fs::reveal_path,
            fs::clone_repo,
            fs::read_file_preview,
            fs::stat_files,
            fs::inspect_paths,
            fs::read_file_base64,
            fs::read_binary_file,
            fs::write_attachment,
            fs::read_text_file,
            fs::write_text_file,
            skills::list_skills,
            agent_tools::agent_tool_status,
            agent_tools::open_computer_use_settings,
            search::search_project,
            cursor_store::cursor_tool_calls,
            harness::harness_resolve_cursor,
            harness::harness_resolve_codex,
            harness::harness_resolve_opencode,
            harness::harness_resolve_claude,
            harness::harness_resolve_omp,
            harness::harness_resolve_pi,
            harness::harness_resolve_fx,
            harness::harness_resolve_grok,
            harness::harness_free_port,
            harness::harness_spawn,
            harness::harness_write,
            harness::harness_kill,
            harness::harness_kill_all,
            harness::harness_http,
            harness::harness_sse_open,
            harness::harness_sse_close,
            harness::harness_exec,
            rate_limits::fetch_claude_usage,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_status,
            pty::pty_kill,
            pty::pty_kill_all,
            control::control_enable,
            control::control_disable,
            control::control_reply,
            control::control_save,
            control::control_load,
            control::control_scopes,
            control::control_attach_worker,
            control::control_authorize_turn,
            control::control_turn_finished,
            session_store::session_upsert,
            session_store::session_list_by_project,
            session_store::session_search,
            session_store::session_get,
            session_store::session_delete,
            session_store::session_set_archived,
            session_store::session_set_pinned,
            session_store::session_set_in_flight,
            session_store::session_list_in_flight,
            session_store::session_take_in_flight,
            session_store::workspace_set_snapshot,
            session_store::workspace_get_snapshot,
            notes::notes_list,
            notes::notes_get,
            notes::notes_upsert,
            notes::notes_delete,
            notes::notes_save_image,
            notes::notes_image_path,
            checkpoint::session_checkpoint_ensure,
            checkpoint::session_checkpoint_prepare,
            checkpoint::session_checkpoint_capture,
            checkpoint::session_checkpoint_status,
            checkpoint::session_checkpoint_file_diff,
            checkpoint::session_checkpoint_undo,
            checkpoint::session_checkpoint_keep,
            set_traffic_lights_visible,
            set_window_background_blur,
            set_dock_badge,
            open_new_window,
            window::hide_window,
            window::destroy_window,
            window::confirm_quit,
            window::prepare_update_restart,
            window::finish_update_restart_preparation,
            window::cancel_update_restart,
            window::relaunch_after_update,
            provider_updates::provider_refresh_cli,
            window::set_window_glass_enabled,
            window_transfer::stage_window_transfer,
            window_transfer::take_window_transfer,
            chat_background::save_chat_background,
            chat_background::remove_chat_background,
            chat_background::save_project_chat_background,
            chat_background::remove_project_chat_background,
            project_logo::save_project_logo,
            project_logo::remove_project_logo,
            project_logo::forget_logo_file,
        ])
        .build(context)
        .expect("error while building Aven");

    app.run(|handle, event| {
        if let tauri::RunEvent::WindowEvent {
            ref label,
            ref event,
            ..
        } = event
        {
            window::update_window_event(handle, label, event);
            usage_panel::window_event(handle, label, event);
            access_panel::window_event(handle, label, event);
            workspace_menu_panel::window_event(handle, label, event);
        }
        match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                let _ = window::show_hidden_or_open_new(handle);
            }
            tauri::RunEvent::Ready => {
                #[cfg(target_os = "macos")]
                {
                    macos::request_badge_authorization();
                    notifications::install_delegate(handle);
                    #[cfg(debug_assertions)]
                    macos::prefer_bundle_dock_icon();
                }
                window::ensure_launch_window_visible(handle);
            }
            tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::Destroyed,
                ..
            } => {
                control::window_closed(handle, &label);
                browser_agent::window_destroyed(&label);
                browser::window_destroyed(handle, &label);
                session_pip::window_destroyed(handle, &label);
                workspace_window::window_destroyed(handle, &label);
                pip_group::window_destroyed(handle, &label);
                let other_window = handle
                    .windows()
                    .keys()
                    .any(|name| name != &label && window::is_workspace_label(name));
                if !other_window {
                    reap_harness_children(handle);
                }
            }
            tauri::RunEvent::ExitRequested { api, code, .. } => {
                if window::allow_exit() {
                    return;
                }
                api.prevent_exit();
                // Last window destroyed (red button). Stay in the dock on macOS;
                // ⌘Q is a separate menu handler and arrives with an exit code.
                // Windows has no dock, so the last close is a quit.
                if code.is_none() {
                    #[cfg(target_os = "windows")]
                    window::request_quit(handle);
                    return;
                }
                window::request_quit(handle);
            }
            tauri::RunEvent::Exit => {
                browser_agent::shutdown();
                #[cfg(all(feature = "chromium", target_os = "macos"))]
                browser::shutdown();
                reap_harness_children(handle);
            }
            _ => {}
        }
    });
}

fn reap_harness_children(handle: &tauri::AppHandle) {
    if let Some(host) = handle.try_state::<harness::HarnessHost>() {
        host.kill_all();
    }
    if let Some(host) = handle.try_state::<pty::PtyHost>() {
        host.kill_all();
    }
}

#[cfg(all(debug_assertions, target_os = "macos"))]
pub fn ensure_macos_dev_bundle() {
    macos::ensure_dev_bundle();
}

#[cfg(all(test, debug_assertions))]
mod development_identity_tests {
    use super::*;

    #[test]
    fn raw_debug_builds_override_production_storage_and_update_identity() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(config.identifier, "com.capi.monocode.personal");
        assert!(config.plugins.0.contains_key("updater"));

        configure_development(&mut config);

        assert_eq!(config.identifier, "com.capi.aven.dev");
        assert_eq!(config.product_name.as_deref(), Some("Aven Dev"));
        assert_eq!(config.version.as_deref(), Some(env!("CARGO_PKG_VERSION")));
        assert_eq!(
            config.build.dev_url.as_ref().map(tauri::Url::as_str),
            Some("http://127.0.0.1:1420/")
        );
        assert!(config
            .app
            .windows
            .iter()
            .all(|window| window.title == "Aven Dev"));
        assert!(!config.plugins.0.contains_key("updater"));
    }

    #[test]
    fn development_overlay_cannot_restore_a_release_identity() {
        let mut config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        config.identifier = "com.monocode.desktop".into();
        config.product_name = Some("CoveCode".into());

        configure_development(&mut config);

        assert_eq!(config.identifier, DEV_BUNDLE_ID);
        assert_eq!(config.product_name.as_deref(), Some(DEV_PRODUCT_NAME));
    }
}
