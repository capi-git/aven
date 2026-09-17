//! Explicit native tab groups for already-owned PiP windows. No new renderers.
use std::{
    collections::{HashMap, HashSet},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, Webview};

#[derive(Clone)]
struct Group {
    owner: String,
    labels: Vec<String>,
}

struct ReturningGroup {
    owner: String,
    selected: String,
    labels: Vec<String>,
    pending: HashSet<String>,
    detaching: bool,
}

#[derive(Default)]
struct Registry {
    groups: HashMap<String, Group>,
    returning: Vec<ReturningGroup>,
}

impl Registry {
    fn is_detaching(&self, label: &str) -> bool {
        self.returning
            .iter()
            .any(|group| group.detaching && group.pending.contains(label))
    }

    fn finish_detaching(&mut self, labels: &[String], success: bool) {
        if success {
            for group in &mut self.returning {
                if group.labels == labels {
                    group.detaching = false;
                }
            }
        } else {
            self.returning.retain(|group| group.labels != labels);
        }
    }
    fn group(&self, label: &str) -> Option<Group> {
        self.groups
            .values()
            .find(|group| group.labels.iter().any(|member| member == label))
            .cloned()
    }

    fn remove_members(&mut self, labels: &[String]) {
        for group in self.groups.values_mut() {
            group.labels.retain(|label| !labels.contains(label));
        }
        // A detached sibling may return first. Keep the last member's return
        // tracking so its later return still completes the frontend handshake.
        self.groups.retain(|_, group| !group.labels.is_empty());
    }

    fn insert(&mut self, owner: String, labels: Vec<String>) {
        self.remove_members(&labels);
        self.groups
            .insert(uuid::Uuid::new_v4().to_string(), Group { owner, labels });
    }

    fn destroyed(&mut self, label: &str) -> Vec<(String, String, Vec<String>)> {
        self.remove_members(&[label.to_string()]);
        let mut completed = Vec::new();
        self.returning.retain_mut(|group| {
            group.pending.remove(label);
            if group.pending.is_empty() {
                completed.push((
                    group.owner.clone(),
                    group.selected.clone(),
                    group.labels.clone(),
                ));
                false
            } else {
                true
            }
        });
        completed
    }
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

fn validate_members(
    owner: &str,
    labels: &[String],
    selected: &str,
    owners: &[Option<String>],
) -> Result<(), String> {
    if !(2..=32).contains(&labels.len())
        || labels.len() != owners.len()
        || labels.iter().collect::<HashSet<_>>().len() != labels.len()
        || !labels.iter().any(|label| label == selected)
    {
        return Err("Choose between two and 32 distinct Picture in Picture tabs".into());
    }
    if owners.iter().any(|actual| actual.as_deref() != Some(owner)) {
        return Err(
            "Only this workspace's existing Picture in Picture windows can be grouped".into(),
        );
    }
    Ok(())
}

fn owner_for(app: &AppHandle, label: &str) -> Option<String> {
    crate::session_pip::owner_for_label(app, label)
        .or_else(|| crate::browser::floating_owner(label))
}

#[tauri::command]
pub async fn pip_group_windows(
    caller: Webview,
    labels: Vec<String>,
    selected_label: String,
) -> Result<(), String> {
    if !crate::window::is_workspace_label(caller.label())
        || caller.label() != caller.window().label()
    {
        return Err("Only the owning workspace can group Picture in Picture windows".into());
    }
    let app = caller.app_handle().clone();
    let owner = caller.window().label().to_string();
    let owners = labels
        .iter()
        .map(|label| owner_for(&app, label))
        .collect::<Vec<_>>();
    validate_members(&owner, &labels, &selected_label, &owners)?;
    if registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .returning
        .iter()
        .any(|group| labels.iter().any(|label| group.pending.contains(label)))
    {
        return Err("These Picture in Picture windows are returning to the workspace".into());
    }
    #[cfg(target_os = "macos")]
    {
        native::group(&app, &owner, &labels, &selected_label).await?;
        set_pinned(&app, &selected_label, true)?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err("Grouped Picture in Picture is available on macOS".into())
}

/// Actual AppKit membership matters: a tab dragged into its own window returns
/// independently. Only members authorized in the original owner group qualify.
fn current_group(app: &AppHandle, label: &str) -> Option<Group> {
    let group = registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .group(label)?;
    #[cfg(target_os = "macos")]
    let labels = native::members(app, label, &group.labels).ok()?;
    #[cfg(not(target_os = "macos"))]
    let labels = vec![label.to_string()];
    let labels = labels
        .into_iter()
        .filter(|member| owner_for(app, member).as_deref() == Some(&group.owner))
        .collect();
    Some(Group {
        owner: group.owner,
        labels,
    })
}

pub fn request_return(app: &AppHandle, label: &str) -> bool {
    request_return_inner(app, label, false)
}

pub fn return_with_ready_draft(app: &AppHandle, label: &str) -> bool {
    request_return_inner(app, label, true)
}

fn request_return_inner(app: &AppHandle, label: &str, ready_draft: bool) -> bool {
    if registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .is_detaching(label)
    {
        return true;
    }
    let Some(group) = current_group(app, label) else {
        return false;
    };
    if group.labels.is_empty() {
        return false;
    }
    {
        let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
        // Remove first so existing per-window return entry points cannot recurse.
        registry.remove_members(&group.labels);
        registry.returning.push(ReturningGroup {
            owner: group.owner.clone(),
            selected: label.to_string(),
            labels: group.labels.clone(),
            pending: group.labels.iter().cloned().collect(),
            detaching: true,
        });
    }
    let app = app.clone();
    let ready_label = ready_draft.then(|| label.to_string());
    tauri::async_runtime::spawn(async move {
        // Detach before the existing destroy handshakes run inside Tao. Closing
        // a still-tabbed window can synchronously redraw its siblings there.
        let result = detach_windows(&app, &group.labels).await;
        {
            let mut registry = registry().lock().unwrap_or_else(|error| error.into_inner());
            registry.finish_detaching(&group.labels, result.is_ok());
            if result.is_err() {
                registry.insert(group.owner.clone(), group.labels.clone());
            }
        }
        if let Err(error) = result {
            let _ = app.emit_to(
                EventTarget::webview(&group.owner),
                "pip-group-error",
                serde_json::json!({"message": error}),
            );
            return;
        }
        for member in group.labels {
            if ready_label.as_deref() == Some(&member) {
                let _ = crate::session_pip::finish_ready_return(&app, &member);
            } else if crate::session_pip::owner_for_label(&app, &member).is_some() {
                let _ = crate::session_pip::request_return(&app, &member);
            } else {
                crate::browser::return_floating_window(&member);
            }
        }
    });
    true
}

/// Cleanup can reach here after the owner registry has already been removed.
/// Native membership is therefore inspected directly, not inferred from it.
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
    let labels = current_group(app, label)
        .map(|group| group.labels)
        .unwrap_or_else(|| vec![label.to_string()]);
    for member in labels {
        if let Some(window) = app.get_window(&member) {
            window
                .set_always_on_top(pinned)
                .map_err(|error| error.to_string())?;
            crate::session_pip::publish_pinned(app, &member, pinned)?;
            #[cfg(target_os = "macos")]
            crate::browser_floating_controls::set_pinned(app, &member, pinned);
        }
    }
    Ok(())
}

pub fn window_destroyed(app: &AppHandle, label: &str) {
    let completed = registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .destroyed(label);
    for (owner, selected, labels) in completed {
        let _ = app.emit_to(
            EventTarget::webview(owner),
            "pip-group-returned",
            serde_json::json!({"selectedLabel": selected, "labels": labels}),
        );
    }
}

#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_foundation::{MainThreadMarker, NSString};

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

    fn on_main<T: Send + 'static>(
        app: &AppHandle,
        operation: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        if MainThreadMarker::new().is_some() {
            return operation();
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(operation());
        })
        .map_err(|error| error.to_string())?;
        receiver
            .recv()
            .map_err(|_| "Native Picture in Picture operation was interrupted".to_string())?
    }

    fn windows(app: &AppHandle, labels: &[String]) -> Result<Vec<(String, usize)>, String> {
        labels
            .iter()
            .map(|label| {
                let window = app
                    .get_window(label)
                    .ok_or("A Picture in Picture window closed")?;
                let pointer = window.ns_window().map_err(|error| error.to_string())? as usize;
                Ok((label.clone(), pointer))
            })
            .collect()
    }

    pub(super) async fn group(
        app: &AppHandle,
        owner: &str,
        labels: &[String],
        selected: &str,
    ) -> Result<(), String> {
        let native_app = app.clone();
        let owner = owner.to_string();
        let labels = labels.to_vec();
        let selected = selected.to_string();
        mutate(move || unsafe {
            let windows = windows(&native_app, &labels)?;
            let identifier = NSString::from_str(&format!("supermono-pip-{}", uuid::Uuid::new_v4()));
            for (_, pointer) in &windows {
                let _: () =
                    msg_send![*pointer as *mut AnyObject, setTabbingIdentifier: &*identifier];
                // Preferred permits explicit grouping regardless of the system
                // tabbing preference; the unique identifier prevents auto merges.
                let _: () = msg_send![*pointer as *mut AnyObject, setTabbingMode: 1isize];
            }
            let first = windows[0].1 as *mut AnyObject;
            // Adding after the previous tab preserves the owner's tab order.
            for pair in windows.windows(2) {
                let _: () = msg_send![pair[0].1 as *mut AnyObject, addTabbedWindow: pair[1].1 as *mut AnyObject, ordered: 1isize];
            }
            let group: *mut AnyObject = msg_send![first, tabGroup];
            if group.is_null() {
                return Err("macOS could not group these windows".into());
            }
            let selected = windows
                .iter()
                .find(|(label, _)| label == &selected)
                .ok_or("The selected Picture in Picture tab closed")?
                .1 as *mut AnyObject;
            let _: () = msg_send![group, setSelectedWindow: selected];
            // Register before yielding the native queue back to user input;
            // an immediate close must use the group lifecycle too.
            registry().lock().unwrap_or_else(|error| error.into_inner()).insert(owner, labels);
            let visible: bool = msg_send![group, isTabBarVisible];
            if !visible {
                let _: () = msg_send![selected, toggleTabBar: std::ptr::null::<AnyObject>()];
            }
            let _: () = msg_send![selected, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
            Ok(())
        }).await
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

    pub(super) fn members(
        app: &AppHandle,
        label: &str,
        candidates: &[String],
    ) -> Result<Vec<String>, String> {
        let native_app = app.clone();
        let candidates = candidates.to_vec();
        let label = label.to_string();
        on_main(app, move || unsafe {
            let pointers = windows(
                &native_app,
                &candidates
                    .into_iter()
                    .filter(|member| native_app.get_window(member).is_some())
                    .collect::<Vec<_>>(),
            )?;
            let selected = pointers
                .iter()
                .find(|(candidate, _)| candidate == &label)
                .ok_or("Picture in Picture window closed")?
                .1;
            let group: *mut AnyObject = msg_send![selected as *mut AnyObject, tabGroup];
            if group.is_null() {
                return Ok(pointers
                    .into_iter()
                    .filter(|(_, pointer)| *pointer == selected)
                    .map(|(label, _)| label)
                    .collect());
            }
            let windows: *mut AnyObject = msg_send![group, windows];
            let count: usize = msg_send![windows, count];
            let mut members = Vec::new();
            for index in 0..count {
                let window: *mut AnyObject = msg_send![windows, objectAtIndex: index];
                if let Some((label, _)) = pointers
                    .iter()
                    .find(|(_, pointer)| *pointer == window as usize)
                {
                    members.push(label.clone());
                }
            }
            Ok(members)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authorization_rejects_mixed_owners_unregistered_duplicates_and_missing_selection() {
        let labels = vec!["session".into(), "browser".into()];
        assert!(validate_members(
            "main",
            &labels,
            "browser",
            &[Some("main".into()), Some("main".into())]
        )
        .is_ok());
        assert!(validate_members(
            "main",
            &labels,
            "browser",
            &[Some("main".into()), Some("window-2".into())]
        )
        .is_err());
        assert!(
            validate_members("main", &labels, "browser", &[Some("main".into()), None]).is_err()
        );
        assert!(validate_members(
            "main",
            &labels,
            "other",
            &[Some("main".into()), Some("main".into())]
        )
        .is_err());
        assert!(validate_members(
            "main",
            &["same".into(), "same".into()],
            "same",
            &[Some("main".into()), Some("main".into())]
        )
        .is_err());
    }

    #[test]
    fn returning_a_detached_tab_preserves_the_remaining_group_and_waits_for_each_draft_window() {
        let mut registry = Registry::default();
        registry.insert("main".into(), vec!["a".into(), "b".into(), "c".into()]);
        registry.remove_members(&["a".into()]);
        assert!(registry.group("a").is_none());
        assert_eq!(registry.group("b").unwrap().labels, vec!["b", "c"]);
        registry.returning.push(ReturningGroup {
            owner: "main".into(),
            selected: "c".into(),
            labels: vec!["b".into(), "c".into()],
            pending: HashSet::from(["b".into(), "c".into()]),
            detaching: true,
        });
        assert!(registry.destroyed("unrelated").is_empty());
        assert!(registry.destroyed("c").is_empty());
        assert_eq!(
            registry.destroyed("b"),
            vec![("main".into(), "c".into(), vec!["b".into(), "c".into()])]
        );
        assert!(registry.groups.is_empty());
        assert!(registry.returning.is_empty());
    }

    #[test]
    fn repeated_return_waits_for_native_detach_and_a_failure_does_not_leave_a_return_pending() {
        let mut registry = Registry::default();
        let labels = vec!["session".into(), "browser".into()];
        registry.returning.push(ReturningGroup {
            owner: "main".into(),
            selected: "session".into(),
            labels: labels.clone(),
            pending: labels.iter().cloned().collect(),
            detaching: true,
        });
        assert!(registry.is_detaching("session"));
        assert!(registry.is_detaching("browser"));
        assert!(!registry.is_detaching("unrelated"));
        registry.finish_detaching(&["unrelated".into()], true);
        assert!(registry.is_detaching("session"));
        registry.finish_detaching(&labels, true);
        assert!(!registry.is_detaching("session"));
        assert_eq!(registry.returning[0].pending.len(), 2);
        registry.finish_detaching(&labels, false);
        assert!(registry.returning.is_empty());
    }

    #[test]
    fn returning_one_of_two_detached_tabs_keeps_the_last_tabs_completion_handshake() {
        let mut registry = Registry::default();
        registry.insert("main".into(), vec!["a".into(), "b".into()]);
        registry.remove_members(&["a".into()]);
        assert!(registry.group("a").is_none());
        assert_eq!(registry.group("b").unwrap().labels, vec!["b"]);
        assert!(registry.destroyed("a").is_empty());
        assert_eq!(registry.group("b").unwrap().labels, vec!["b"]);

        let remaining = registry.group("b").unwrap();
        registry.remove_members(&remaining.labels);
        registry.returning.push(ReturningGroup {
            owner: remaining.owner,
            selected: "b".into(),
            pending: remaining.labels.iter().cloned().collect(),
            labels: remaining.labels,
            detaching: false,
        });
        assert_eq!(
            registry.destroyed("b"),
            vec![("main".into(), "b".into(), vec!["b".into()])]
        );
        assert!(registry.groups.is_empty());
        assert!(registry.returning.is_empty());
    }
}
