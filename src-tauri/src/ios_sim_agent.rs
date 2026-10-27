//! `aven --aven-simulator '<json>'`: agents use the iPhone pane's simulator.
//!
//! Requests travel over the chat's scoped browser connection. A chat may
//! drive only the simulators its project's iPhone pane booted or picked, and
//! only while that pane is open beside it; real devices are never reachable.
//! Coordinates are the screen's upright points from its top-left corner,
//! matching screenshots and snapshots.

use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "action", rename_all = "lowercase", deny_unknown_fields)]
pub(crate) enum Request {
    List {},
    Screenshot {
        udid: Option<String>,
        label: Option<String>,
    },
    Snapshot {
        udid: Option<String>,
        #[serde(rename = "maxNodes")]
        max_nodes: Option<u32>,
    },
    Tap {
        udid: Option<String>,
        x: f64,
        y: f64,
    },
    Swipe {
        udid: Option<String>,
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
        #[serde(rename = "durationMs")]
        duration_ms: Option<u64>,
    },
    Type {
        udid: Option<String>,
        text: String,
    },
    Press {
        udid: Option<String>,
        key: String,
    },
    Button {
        udid: Option<String>,
        name: String,
    },
    Rotate {
        udid: Option<String>,
        orientation: String,
    },
    /// Run the project (build, install, launch), or with `"build":false`
    /// relaunch the app that was last built.
    Launch {
        udid: Option<String>,
        build: Option<bool>,
    },
    Logs {
        lines: Option<u32>,
    },
}

const ORIENTATIONS: [&str; 4] = [
    "portrait",
    "portraitUpsideDown",
    "landscapeLeft",
    "landscapeRight",
];

fn valid_point(values: &[f64]) -> bool {
    values
        .iter()
        .all(|v| v.is_finite() && (-1.0..=10_000.0).contains(v))
}

impl Request {
    pub(crate) fn udid(&self) -> Option<&str> {
        match self {
            Self::List {} | Self::Logs { .. } => None,
            Self::Screenshot { udid, .. }
            | Self::Snapshot { udid, .. }
            | Self::Tap { udid, .. }
            | Self::Swipe { udid, .. }
            | Self::Type { udid, .. }
            | Self::Press { udid, .. }
            | Self::Button { udid, .. }
            | Self::Rotate { udid, .. }
            | Self::Launch { udid, .. } => udid.as_deref(),
        }
    }

    /// Checked before the request leaves the agent's process and again in Aven.
    pub(crate) fn validate(&self) -> Result<(), String> {
        if let Some(udid) = self.udid() {
            if !crate::ios_sim_devices::valid_udid(udid) {
                return Err("udid must be a simulator's UDID from the list action".into());
            }
        }
        match self {
            Self::Screenshot { label: Some(label), .. } => crate::turn_shots::validate_label(label),
            Self::Snapshot { max_nodes: Some(n), .. } if !(20..=1000).contains(n) => {
                Err("maxNodes must be between 20 and 1000".into())
            }
            Self::Tap { x, y, .. } if !valid_point(&[*x, *y]) => Err("Invalid point".into()),
            Self::Swipe { x1, y1, x2, y2, .. } if !valid_point(&[*x1, *y1, *x2, *y2]) => Err("Invalid points".into()),
            Self::Swipe {
                duration_ms: Some(ms), ..
            } if !(50..=5000).contains(ms) => Err("durationMs must be between 50 and 5000".into()),
            Self::Type { text, .. } if text.is_empty() || text.len() > 4000 => {
                Err("text must be 1 to 4000 bytes".into())
            }
            Self::Press { key, .. } if crate::ios_sim_keys::key_for_name(key).is_none() => Err(
                "Unsupported key; use Enter, Tab, Backspace, Escape, Space, arrows, Home, End, PageUp or PageDown".into(),
            ),
            Self::Button { name, .. } if name != "home" && name != "lock" => Err("Buttons are home and lock".into()),
            Self::Rotate { orientation, .. } if !ORIENTATIONS.contains(&orientation.as_str()) => {
                Err("orientation is portrait, portraitUpsideDown, landscapeLeft or landscapeRight".into())
            }
            Self::Logs { lines: Some(n) } if !(1..=2000).contains(n) => Err("lines must be between 1 and 2000".into()),
            _ => Ok(()),
        }
    }

    /// How long the agent's command waits for Aven.
    pub(crate) fn reply_wait(&self) -> std::time::Duration {
        std::time::Duration::from_secs(match self {
            Self::Launch { .. } => 1200,
            // The first snapshot builds and starts Aven's XCUITest agent.
            Self::Snapshot { .. } => 400,
            Self::Type { .. } => 120,
            _ => 60,
        })
    }
}

/// Picks the device a request is for among the ones this chat may use.
pub(crate) fn resolve_udid(
    requested: Option<&str>,
    allowed: &std::collections::BTreeSet<String>,
    pane_device: Option<&str>,
) -> Result<String, String> {
    if let Some(udid) = requested {
        let key = udid.to_uppercase();
        return if allowed.contains(&key) {
            Ok(key)
        } else {
            Err("That simulator is not one this chat's iPhone pane uses. Use a udid from the list action.".into())
        };
    }
    if let Some(device) = pane_device
        .map(str::to_uppercase)
        .filter(|d| allowed.contains(d))
    {
        return Ok(device);
    }
    match allowed.len() {
        0 => Err(
            "The iPhone pane has no simulator yet. Ask the user to pick one in the pane.".into(),
        ),
        1 => Ok(allowed.iter().next().cloned().unwrap_or_default()),
        _ => Err("Several simulators are in use; pass udid from the list action.".into()),
    }
}

pub(crate) const HELP: &str = r#"Aven iPhone simulator control (macOS, with Xcode)

Usage:
  aven --aven-simulator '<json>'
  aven --aven-simulator --help

Works only while this chat has an iPhone pane open beside it, and only on the
simulators that pane uses. Coordinates are the screen's upright points from
its top-left corner, the same as screenshots and snapshot frames. udid is
optional when the pane uses one simulator.

Actions:
  {"action":"list"}                      devices, screen size, orientation, the app's run status
  {"action":"snapshot"}                  the foreground app's accessibility tree with frames
  {"action":"screenshot","label":"after"}  JPEG at point size: {path,width,height,markdown}
  {"action":"tap","x":201,"y":420}
  {"action":"swipe","x1":200,"y1":700,"x2":200,"y2":250,"durationMs":300}
  {"action":"type","text":"hello@example.com"}   types into the focused field
  {"action":"press","key":"Enter"}       Enter, Tab, Backspace, Escape, Space, arrows, Home, End, PageUp, PageDown
  {"action":"button","name":"home"}      home or lock
  {"action":"rotate","orientation":"landscapeLeft"}
  {"action":"launch"}                    build, install and open the project's app (like Run); waits for the result
  {"action":"launch","build":false}      reopen the last built app without building
  {"action":"logs","lines":200}          the app's recent console output

Read the snapshot before tapping and tap the centre of an element's frame.
Check results with a new snapshot; take a screenshot only to judge how
something looks. Labelled screenshots are kept; unlabelled ones that no
message shows are deleted when the turn ends.
"#;

#[cfg(target_os = "macos")]
pub(crate) use macos::execute;

#[cfg(not(target_os = "macos"))]
pub(crate) fn execute(
    _app: &tauri::AppHandle,
    _session_id: &str,
    _project: Option<&str>,
    _actor: (String, [f64; 3]),
    _request: Request,
) -> Result<serde_json::Value, String> {
    Err("The iPhone simulator is available on macOS only".into())
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{resolve_udid, Request};
    use crate::ios_sim::{self, Phase};
    use crate::ios_sim_native as native;
    use serde_json::{json, Value};
    use std::time::Duration;
    use tauri::{AppHandle, Manager};

    fn no_pane() -> String {
        "This chat has no iPhone pane open. Ask the user to open one (the phone button beside the browser button), then try again.".into()
    }

    pub(crate) fn execute(
        app: &AppHandle,
        session_id: &str,
        project: Option<&str>,
        actor: (String, [f64; 3]),
        request: Request,
    ) -> Result<Value, String> {
        request.validate()?;
        let project = project.ok_or_else(no_pane)?;
        let support = ios_sim::support();
        if !support.xcode {
            return Err("Xcode is not installed, so the iPhone simulator is unavailable.".into());
        }
        let allowed = ios_sim::scoped_devices(project);
        let status = ios_sim::status_of(project);
        if let Request::List {} = request {
            return list(&allowed, &status, support.live);
        }
        if let Request::Logs { lines } = request {
            let lines = ios_sim::recent_logs(project, lines.unwrap_or(200) as usize);
            return Ok(json!({ "lines": lines, "status": status.message }));
        }
        let pane = ios_sim::pane_device(project).or_else(|| status.udid.clone());
        let udid = resolve_udid(request.udid(), &allowed, pane.as_deref())?;
        let (name, color) = actor;
        match request {
            Request::List {} | Request::Logs { .. } => unreachable!(),
            Request::Screenshot { label, .. } => {
                screenshot(app, session_id, &udid, label.as_deref())
            }
            Request::Snapshot { max_nodes, .. } => {
                let mut agent =
                    crate::ios_sim_xcuitest::connect(&udid, status.bundle_id.as_deref())?;
                let snapshot = agent.request(
                    json!({ "action": "snapshot", "maxNodes": max_nodes.unwrap_or(400) }),
                )?;
                Ok(json!({
                    "udid": udid,
                    "app": status.bundle_id,
                    "outline": crate::ios_sim_xcuitest::outline(&snapshot),
                    "truncated": snapshot.get("truncated").cloned().unwrap_or(Value::Bool(false)),
                }))
            }
            Request::Tap { x, y, .. } => {
                if support.live {
                    let screen = ios_sim::screen(&udid)?;
                    let (dx, dy) = screen.to_device(x, y);
                    ios_sim::show_marker(&udid, dx, dy, &name, color, 0);
                    ios_sim::tap(&udid, dx, dy)?;
                } else {
                    crate::ios_sim_xcuitest::connect(&udid, status.bundle_id.as_deref())?
                        .request(json!({ "action": "tap", "x": x, "y": y }))?;
                }
                Ok(json!({ "tapped": [x, y] }))
            }
            Request::Swipe {
                x1,
                y1,
                x2,
                y2,
                duration_ms,
                ..
            } => {
                if support.live {
                    let screen = ios_sim::screen(&udid)?;
                    let from = screen.to_device(x1, y1);
                    let to = screen.to_device(x2, y2);
                    ios_sim::show_marker(&udid, from.0, from.1, &name, color, 3);
                    ios_sim::swipe(
                        &udid,
                        from,
                        to,
                        Duration::from_millis(duration_ms.unwrap_or(300)),
                    )?;
                } else {
                    crate::ios_sim_xcuitest::connect(&udid, status.bundle_id.as_deref())?.request(
                        json!({ "action": "swipe", "x1": x1, "y1": y1, "x2": x2, "y2": y2 }),
                    )?;
                }
                Ok(json!({ "swiped": [[x1, y1], [x2, y2]] }))
            }
            Request::Type { text, .. } => {
                if support.live {
                    ios_sim::type_text(&udid, &text)?;
                } else {
                    crate::ios_sim_xcuitest::connect(&udid, status.bundle_id.as_deref())?
                        .request(json!({ "action": "type", "text": text }))?;
                }
                Ok(json!({ "typed": text.chars().count() }))
            }
            Request::Press { key, .. } => {
                if !support.live {
                    return Err(
                        "Key presses need Aven's live simulator view; use type instead.".into(),
                    );
                }
                ios_sim::press_named_key(&udid, &key)?;
                Ok(json!({ "pressed": key }))
            }
            Request::Button { name: button, .. } => {
                match (button.as_str(), support.live) {
                    ("home", true) => ios_sim::press_button(&udid, native::Button::Home)?,
                    ("lock", true) => ios_sim::press_button(&udid, native::Button::Lock)?,
                    ("home", false) => crate::ios_sim_xcuitest::press_home(&udid)?,
                    _ => return Err("The lock button needs Aven's live simulator view".into()),
                }
                Ok(json!({ "pressed": button }))
            }
            Request::Rotate { orientation, .. } => {
                ios_sim::set_orientation(&udid, &orientation)?;
                Ok(json!({ "orientation": orientation }))
            }
            Request::Launch { build, .. } => launch(project, &udid, build.unwrap_or(true), &status),
        }
    }

    fn list(
        allowed: &std::collections::BTreeSet<String>,
        status: &ios_sim::RunStatus,
        live: bool,
    ) -> Result<Value, String> {
        let devices = ios_sim::list_devices()?;
        let devices: Vec<Value> = devices
            .into_iter()
            .filter(|d| allowed.contains(&d.udid.to_uppercase()))
            .map(|d| {
                let screen = if d.booted && live { ios_sim::screen(&d.udid).ok() } else { None };
                json!({
                    "udid": d.udid,
                    "name": d.name,
                    "runtime": d.runtime,
                    "booted": d.booted,
                    "screen": screen.map(|s| {
                        let (w, h) = s.size();
                        json!({ "width": w, "height": h, "scale": s.info.scale })
                    }),
                    // Named as the rotate action takes them (device
                    // orientation; UIKit's interface orientation is mirrored).
                    "orientation": screen.map(|s| match s.info.orientation {
                        2 => "portraitUpsideDown",
                        3 => "landscapeRight",
                        4 => "landscapeLeft",
                        _ => "portrait",
                    }),
                    "inPane": status.udid.as_deref().is_some_and(|u| u.eq_ignore_ascii_case(&d.udid)),
                })
            })
            .collect();
        Ok(json!({
            "devices": devices,
            "app": {
                "status": status.phase,
                "message": status.message,
                "bundleId": status.bundle_id,
            },
            "mode": if live { "live" } else { "basic" },
        }))
    }

    fn screenshot(
        app: &AppHandle,
        session_id: &str,
        udid: &str,
        label: Option<&str>,
    ) -> Result<Value, String> {
        let (png, scale) = ios_sim::screenshot_png(udid)?;
        let image = crate::turn_shot_image::compress(&png, scale)?;
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?;
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        crate::turn_shots::store(&app_data, session_id, label, &image, millis, |names| {
            app.try_state::<crate::session_store::SessionStore>()
                .ok_or("Chat history is unavailable")?
                .chat_mentions(session_id, names)
        })
    }

    fn launch(
        project: &str,
        udid: &str,
        build: bool,
        status: &ios_sim::RunStatus,
    ) -> Result<Value, String> {
        let generation = if build {
            let info = ios_sim::project_info(project, ios_sim::pane_container(project).as_deref());
            let container = info
                .container
                .ok_or_else(|| info.error.clone().unwrap_or_default())?;
            let scheme = ios_sim::pane_scheme(project)
                .filter(|s| info.schemes.contains(s))
                .or_else(|| info.schemes.first().cloned())
                .ok_or("This project has no scheme to run")?;
            ios_sim::start_run(ios_sim::RunRequest {
                project: project.to_owned(),
                udid: udid.to_owned(),
                container: container.path.to_string_lossy().into_owned(),
                scheme,
            })?
        } else {
            let bundle = status
                .bundle_id
                .clone()
                .ok_or("Nothing has been built yet; launch with build first")?;
            ios_sim::relaunch(project, udid, &bundle)?
        };
        // Wait for the run to settle.
        let deadline = std::time::Instant::now() + Duration::from_secs(1150);
        loop {
            let now = ios_sim::status_of(project);
            if ios_sim::generation_of(project) != generation {
                return Err("The run was replaced or stopped".into());
            }
            match now.phase {
                Phase::Running => {
                    return Ok(
                        json!({ "status": "running", "message": now.message, "bundleId": now.bundle_id }),
                    )
                }
                Phase::Failed => {
                    return Ok(json!({
                        "status": "failed",
                        "message": now.message,
                        "errors": now.errors,
                        "logPath": now.log_path,
                    }))
                }
                Phase::Stopped => {
                    return Ok(json!({ "status": "stopped", "message": now.message }))
                }
                _ if std::time::Instant::now() > deadline => {
                    return Err("The build is still running; check list for its status".into())
                }
                _ => std::thread::sleep(Duration::from_millis(250)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    const A: &str = "E5B294CF-EC79-4FE6-B919-D3175705B784";
    const B: &str = "32BA9274-974F-481F-BEAF-D565EEFDE4F0";

    fn parse(text: &str) -> Result<Request, String> {
        let request: Request = serde_json::from_str(text).map_err(|e| e.to_string())?;
        request.validate()?;
        Ok(request)
    }

    #[test]
    fn parses_and_checks_requests() {
        assert!(parse(r#"{"action":"list"}"#).is_ok());
        assert!(parse(r#"{"action":"tap","x":201,"y":420}"#).is_ok());
        assert!(parse(r#"{"action":"tap","x":201}"#).is_err());
        assert!(parse(r#"{"action":"tap","x":1e9,"y":1}"#).is_err());
        assert!(parse(r#"{"action":"tap","x":1,"y":1,"extra":true}"#).is_err());
        assert!(
            parse(r#"{"action":"swipe","x1":1,"y1":2,"x2":3,"y2":4,"durationMs":10}"#).is_err()
        );
        assert!(parse(r#"{"action":"type","text":""}"#).is_err());
        assert!(parse(r#"{"action":"press","key":"Enter"}"#).is_ok());
        assert!(parse(r#"{"action":"press","key":"F1"}"#).is_err());
        assert!(parse(r#"{"action":"button","name":"siri"}"#).is_err());
        assert!(parse(r#"{"action":"rotate","orientation":"landscapeLeft"}"#).is_ok());
        assert!(parse(r#"{"action":"rotate","orientation":"sideways"}"#).is_err());
        assert!(parse(r#"{"action":"screenshot","label":"after"}"#).is_ok());
        assert!(parse(r#"{"action":"snapshot","maxNodes":5}"#).is_err());
        assert!(parse(r#"{"action":"logs","lines":0}"#).is_err());
        assert!(parse(r#"{"action":"launch","build":false}"#).is_ok());
        assert!(parse(r#"{"action":"reboot"}"#).is_err());
    }

    #[test]
    fn refuses_identifiers_that_are_not_simulators() {
        assert!(parse(&format!(r#"{{"action":"tap","udid":"{A}","x":1,"y":1}}"#)).is_ok());
        // A physical device's identifier, and anything simctl would read as a name.
        assert!(
            parse(r#"{"action":"tap","udid":"00008120-001A2B3C4D5E6F70","x":1,"y":1}"#).is_err()
        );
        assert!(parse(r#"{"action":"tap","udid":"booted","x":1,"y":1}"#).is_err());
    }

    #[test]
    fn scopes_requests_to_the_panes_devices() {
        let one: BTreeSet<String> = [A.to_owned()].into();
        let two: BTreeSet<String> = [A.to_owned(), B.to_owned()].into();
        assert_eq!(resolve_udid(None, &one, None).unwrap(), A);
        assert_eq!(
            resolve_udid(Some(&A.to_lowercase()), &one, None).unwrap(),
            A
        );
        assert!(resolve_udid(Some(B), &one, None).is_err());
        assert!(resolve_udid(None, &two, None).is_err());
        assert_eq!(resolve_udid(None, &two, Some(B)).unwrap(), B);
        // The pane's device counts only when it is in scope.
        assert_eq!(resolve_udid(None, &one, Some(B)).unwrap(), A);
        assert!(resolve_udid(None, &BTreeSet::new(), None).is_err());
    }

    #[test]
    fn waits_longer_for_builds_and_the_first_snapshot() {
        let launch = parse(r#"{"action":"launch"}"#).unwrap();
        let tap = parse(r#"{"action":"tap","x":1,"y":1}"#).unwrap();
        assert!(launch.reply_wait() > tap.reply_wait());
        assert!(parse(r#"{"action":"snapshot"}"#).unwrap().reply_wait() > tap.reply_wait());
    }
}
