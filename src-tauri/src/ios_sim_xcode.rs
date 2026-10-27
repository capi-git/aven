//! Xcode project detection and `xcodebuild` output parsing for the iPhone pane.
//!
//! Everything here is pure (no processes) so it can be tested with fixtures on
//! any platform. `ios_sim.rs` runs the tools and feeds their output in here.

use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ContainerKind {
    Workspace,
    Project,
}

/// An `.xcworkspace` or `.xcodeproj` that `xcodebuild` can build.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct XcodeContainer {
    pub kind: ContainerKind,
    pub path: PathBuf,
}

impl XcodeContainer {
    /// `-workspace <path>` or `-project <path>`.
    pub fn args(&self) -> [String; 2] {
        let flag = match self.kind {
            ContainerKind::Workspace => "-workspace",
            ContainerKind::Project => "-project",
        };
        [flag.into(), self.path.to_string_lossy().into_owned()]
    }
}

/// Folders that never hold the project the person means to run.
fn skipped_folder(name: &str) -> bool {
    name.starts_with('.')
        || matches!(
            name,
            "Pods"
                | "Carthage"
                | "node_modules"
                | "DerivedData"
                | "build"
                | "Build"
                | "vendor"
                | "target"
                | "dist"
        )
}

fn container_of(path: &Path) -> Option<XcodeContainer> {
    let ext = path.extension()?.to_str()?;
    let kind = match ext {
        "xcworkspace" => ContainerKind::Workspace,
        "xcodeproj" => ContainerKind::Project,
        _ => return None,
    };
    Some(XcodeContainer {
        kind,
        path: path.to_path_buf(),
    })
}

/// Workspaces and projects in `root` and its direct subfolders, best first:
/// shallower before deeper, a workspace (CocoaPods, several projects) before a
/// project in the same folder, then by name. The `project.xcworkspace` inside
/// every `.xcodeproj` is never listed.
pub(crate) fn find_containers(root: &Path) -> Vec<XcodeContainer> {
    let mut found: Vec<(usize, XcodeContainer)> = Vec::new();
    let scan = |dir: &Path, depth: usize, found: &mut Vec<(usize, XcodeContainer)>| {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if !kind.is_dir() {
                continue;
            }
            if let Some(container) = container_of(&path) {
                found.push((depth, container));
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if !skipped_folder(&name) && !name.ends_with(".app") && !name.ends_with(".bundle") {
                subdirs.push(path);
            }
        }
        subdirs
    };
    let subdirs = scan(root, 0, &mut found);
    for dir in subdirs {
        scan(&dir, 1, &mut found);
    }
    found.sort_by(|(da, a), (db, b)| {
        da.cmp(db)
            .then_with(|| a.path.parent().cmp(&b.path.parent()))
            .then_with(|| {
                (a.kind != ContainerKind::Workspace).cmp(&(b.kind != ContainerKind::Workspace))
            })
            .then_with(|| a.path.cmp(&b.path))
    });
    found.into_iter().map(|(_, c)| c).collect()
}

/// What `xcodebuild -list -json` reports for a workspace or project.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SchemeList {
    pub name: String,
    pub schemes: Vec<String>,
    pub targets: Vec<String>,
    pub configurations: Vec<String>,
}

fn strings(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// The JSON object starts at the first `{`; `xcodebuild` can print notices first.
fn json_start(text: &str) -> &str {
    text.find(['{', '['])
        .map(|index| &text[index..])
        .unwrap_or(text)
}

/// Parses `xcodebuild -list -json`. CocoaPods' `Pods-*` schemes are dropped
/// when the workspace has schemes of its own.
pub(crate) fn parse_list_json(text: &str) -> Result<SchemeList, String> {
    let value: serde_json::Value = serde_json::from_str(json_start(text))
        .map_err(|error| format!("Could not read the scheme list: {error}"))?;
    let body = value
        .get("workspace")
        .or_else(|| value.get("project"))
        .ok_or("The scheme list has no workspace or project")?;
    let mut schemes = strings(body.get("schemes"));
    let own: Vec<String> = schemes
        .iter()
        .filter(|scheme| !scheme.starts_with("Pods-") && scheme.as_str() != "Pods")
        .cloned()
        .collect();
    if !own.is_empty() {
        schemes = own;
    }
    Ok(SchemeList {
        name: body
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned(),
        schemes,
        targets: strings(body.get("targets")),
        configurations: strings(body.get("configurations")),
    })
}

/// The app a scheme builds, from `-showBuildSettings -json`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppProduct {
    pub target: String,
    pub app_path: PathBuf,
    pub bundle_id: String,
    pub product_name: String,
    pub executable: String,
}

/// Picks the first iOS application target. Settings for other platforms
/// (a macOS or watchOS target in the same scheme) and non-app products are
/// skipped; a target that supports the simulator is preferred.
pub(crate) fn parse_build_settings(text: &str) -> Result<AppProduct, String> {
    let value: serde_json::Value = serde_json::from_str(json_start(text))
        .map_err(|error| format!("Could not read the build settings: {error}"))?;
    let targets = value
        .as_array()
        .ok_or("The build settings are not a list of targets")?;
    let mut best: Option<(u8, AppProduct)> = None;
    for target in targets {
        let Some(settings) = target.get("buildSettings") else {
            continue;
        };
        let get = |key: &str| settings.get(key).and_then(|v| v.as_str()).unwrap_or("");
        if get("WRAPPER_EXTENSION") != "app" {
            continue;
        }
        let platform = get("PLATFORM_NAME");
        let supported = get("SUPPORTED_PLATFORMS");
        let rank = if platform == "iphonesimulator" {
            0
        } else if supported.split_whitespace().any(|p| p == "iphonesimulator") {
            1
        } else {
            continue;
        };
        let dir = get("TARGET_BUILD_DIR");
        let wrapper = get("WRAPPER_NAME");
        let bundle_id = get("PRODUCT_BUNDLE_IDENTIFIER");
        if dir.is_empty() || wrapper.is_empty() || bundle_id.is_empty() {
            continue;
        }
        let product = AppProduct {
            target: target
                .get("target")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_owned(),
            app_path: Path::new(dir).join(wrapper),
            bundle_id: bundle_id.to_owned(),
            product_name: get("PRODUCT_NAME").to_owned(),
            executable: get("EXECUTABLE_NAME").to_owned(),
        };
        if best.as_ref().is_none_or(|(r, _)| rank < *r) {
            best = Some((rank, product));
        }
    }
    best.map(|(_, product)| product)
        .ok_or_else(|| "This scheme does not build an iPhone or iPad app".into())
}

/// One compiler or build error from `xcodebuild`'s output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildIssue {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub message: String,
    /// One-based line of the issue in the saved build log.
    pub log_line: usize,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BuildSummary {
    pub succeeded: bool,
    pub errors: Vec<BuildIssue>,
    pub warnings: usize,
}

/// A diagnostic's file, line, column and message.
type Diagnostic = (Option<String>, Option<u32>, Option<u32>, String);

/// `path:line:col: error: message`, `path:line: error: message` or
/// `error: message` (linker and tool errors).
fn parse_diagnostic(line: &str, kind: &str) -> Option<Diagnostic> {
    let marker = format!("{kind}: ");
    let at = line.find(&marker)?;
    let message = line[at + marker.len()..].trim().to_owned();
    if message.is_empty() {
        return None;
    }
    let head = line[..at].trim_end();
    if head.is_empty() {
        return Some((None, None, None, message));
    }
    let head = head.strip_suffix(':')?;
    // Swift's annotated snippets repeat the error after `|` or a backtick;
    // only the first, located line counts.
    if head.contains('|') || head.contains('`') || head.starts_with("macro expansion") {
        return None;
    }
    let mut parts = head.rsplitn(3, ':');
    let last = parts.next()?;
    let middle = parts.next();
    let first = parts.next();
    match (first, middle, last.parse::<u32>()) {
        (Some(file), Some(line_no), Ok(column)) if line_no.parse::<u32>().is_ok() => Some((
            Some(file.to_owned()),
            line_no.parse().ok(),
            Some(column),
            message,
        )),
        (_, Some(file_part), Ok(line_no)) => {
            let file = match first {
                Some(first) => format!("{first}:{file_part}"),
                None => file_part.to_owned(),
            };
            Some((Some(file), Some(line_no), None, message))
        }
        _ if head.starts_with('/') => Some((Some(head.to_owned()), None, None, message)),
        // A tool's own message: `ld: warning: …`, `clang: error: …`.
        _ if !head.contains([' ', '/', ':']) => Some((None, None, None, message)),
        _ => None,
    }
}

/// Reads a whole `xcodebuild` log: errors in order without the repeats Swift
/// prints for each architecture and each annotated snippet, and the outcome.
pub(crate) fn parse_build_output(text: &str) -> BuildSummary {
    let mut summary = BuildSummary::default();
    let mut seen = std::collections::HashSet::new();
    let mut warnings = std::collections::HashSet::new();
    let mut failed = false;
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim_end();
        if line.contains("** BUILD SUCCEEDED **") {
            summary.succeeded = true;
        }
        if line.contains("** BUILD FAILED **") {
            failed = true;
        }
        if let Some((file, line_no, column, message)) = parse_diagnostic(line, "error") {
            let key = (file.clone(), line_no, column, message.clone());
            if seen.insert(key) {
                summary.errors.push(BuildIssue {
                    file,
                    line: line_no,
                    column,
                    message,
                    log_line: index + 1,
                });
            }
        } else if let Some(found) = parse_diagnostic(line, "warning") {
            warnings.insert(found);
        }
    }
    summary.warnings = warnings.len();
    if failed {
        summary.succeeded = false;
    }
    summary
}

/// "Build failed · 2 errors", "Build failed · 1 error".
pub(crate) fn failure_label(summary: &BuildSummary) -> String {
    match summary.errors.len() {
        0 => "Build failed".into(),
        1 => "Build failed · 1 error".into(),
        n => format!("Build failed · {n} errors"),
    }
}

/// "built in 1.8 s", "built in 42 s", "built in 2 min 5 s".
pub(crate) fn built_in_label(millis: u64) -> String {
    let seconds = millis as f64 / 1000.0;
    if seconds < 10.0 {
        format!("built in {seconds:.1} s")
    } else if seconds < 60.0 {
        format!("built in {} s", seconds.round() as u64)
    } else {
        let whole = seconds.round() as u64;
        format!("built in {} min {} s", whole / 60, whole % 60)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECT_LIST: &str = r#"{
  "project" : {
    "configurations" : [ "Debug", "Release" ],
    "name" : "SpikeApp",
    "schemes" : [ "SpikeApp" ],
    "targets" : [ "SpikeApp" ]
  }
}"#;

    const WORKSPACE_LIST: &str = r#"Command line invocation:
    /Applications/Xcode.app/Contents/Developer/usr/bin/xcodebuild -list -json
{
  "workspace" : {
    "name" : "Pom",
    "schemes" : [ "Pods-Pom", "Pom", "Pom Widgets", "Alamofire" ]
  }
}"#;

    #[test]
    fn reads_a_project_scheme_list() {
        let list = parse_list_json(PROJECT_LIST).unwrap();
        assert_eq!(list.name, "SpikeApp");
        assert_eq!(list.schemes, ["SpikeApp"]);
        assert_eq!(list.targets, ["SpikeApp"]);
        assert_eq!(list.configurations, ["Debug", "Release"]);
    }

    #[test]
    fn reads_a_workspace_list_after_notices_and_drops_pods_schemes() {
        let list = parse_list_json(WORKSPACE_LIST).unwrap();
        assert_eq!(list.name, "Pom");
        assert_eq!(list.schemes, ["Pom", "Pom Widgets", "Alamofire"]);
        assert!(list.configurations.is_empty());
    }

    #[test]
    fn keeps_pods_schemes_when_they_are_all_there_is() {
        let list = parse_list_json(r#"{"workspace":{"name":"W","schemes":["Pods-W"]}}"#).unwrap();
        assert_eq!(list.schemes, ["Pods-W"]);
    }

    #[test]
    fn rejects_lists_without_a_container() {
        assert!(parse_list_json("{}").is_err());
        assert!(parse_list_json("xcodebuild: error: not a project").is_err());
    }

    fn settings(target: &str, extra: &[(&str, &str)]) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        for (key, value) in extra {
            map.insert((*key).into(), (*value).into());
        }
        serde_json::json!({ "action": "build", "target": target, "buildSettings": map })
    }

    fn ios_app(target: &str, platform: &str) -> serde_json::Value {
        settings(
            target,
            &[
                ("WRAPPER_EXTENSION", "app"),
                ("WRAPPER_NAME", &format!("{target}.app")),
                (
                    "TARGET_BUILD_DIR",
                    "/dd/Build/Products/Debug-iphonesimulator",
                ),
                (
                    "PRODUCT_BUNDLE_IDENTIFIER",
                    &format!("com.example.{target}"),
                ),
                ("PRODUCT_NAME", target),
                ("EXECUTABLE_NAME", target),
                ("PLATFORM_NAME", platform),
                ("SUPPORTED_PLATFORMS", "iphoneos iphonesimulator"),
            ],
        )
    }

    #[test]
    fn finds_the_app_and_bundle_id_from_build_settings() {
        let text = serde_json::json!([ios_app("SpikeApp", "iphonesimulator")]).to_string();
        let app = parse_build_settings(&text).unwrap();
        assert_eq!(app.target, "SpikeApp");
        assert_eq!(
            app.app_path,
            Path::new("/dd/Build/Products/Debug-iphonesimulator/SpikeApp.app")
        );
        assert_eq!(app.bundle_id, "com.example.SpikeApp");
        assert_eq!(app.executable, "SpikeApp");
    }

    #[test]
    fn skips_frameworks_tests_and_mac_apps() {
        let framework = settings(
            "Kit",
            &[
                ("WRAPPER_EXTENSION", "framework"),
                ("PLATFORM_NAME", "iphonesimulator"),
            ],
        );
        let mac = settings(
            "Mac",
            &[
                ("WRAPPER_EXTENSION", "app"),
                ("WRAPPER_NAME", "Mac.app"),
                ("TARGET_BUILD_DIR", "/dd"),
                ("PRODUCT_BUNDLE_IDENTIFIER", "com.example.mac"),
                ("PLATFORM_NAME", "macosx"),
                ("SUPPORTED_PLATFORMS", "macosx"),
            ],
        );
        let device_only = ios_app("Device", "iphoneos");
        let simulator = ios_app("Phone", "iphonesimulator");
        let text = serde_json::json!([framework, mac, device_only, simulator]).to_string();
        assert_eq!(parse_build_settings(&text).unwrap().target, "Phone");
        let text = serde_json::json!([ios_app("Device", "iphoneos")]).to_string();
        assert_eq!(parse_build_settings(&text).unwrap().target, "Device");
        let text =
            serde_json::json!([settings("Kit", &[("WRAPPER_EXTENSION", "framework")])]).to_string();
        assert!(parse_build_settings(&text).is_err());
    }

    const FAILED_BUILD: &str = "\
CompileSwift normal arm64 /p/App/ContentView.swift (in target 'App' from project 'App')
/p/App/ContentView.swift:12:36: error: cannot convert value of type 'String' to specified type 'Int'
10 | struct ContentView: View {
12 |     @State private var text: Int = \"\"
   |                                    `- error: cannot convert value of type 'String' to specified type 'Int'
macro expansion @State:2:30: error: cannot convert value of type 'String' to specified type 'Int'
/p/App/ContentView.swift:19:18: error: cannot find 'tapsx' in scope
/p/App/ContentView.swift:30:9: warning: variable 'x' was never used
/p/App/ContentView.swift:12:36: error: cannot convert value of type 'String' to specified type 'Int'
ld: warning: ignoring duplicate libraries: '-lc++'
error: Signing for \"App\" requires a development team.

** BUILD FAILED **

The following build commands failed:
\tSwiftCompile normal arm64 (in target 'App' from project 'App')
(1 failure)
";

    #[test]
    fn counts_each_error_once_and_ignores_annotated_repeats() {
        let summary = parse_build_output(FAILED_BUILD);
        assert!(!summary.succeeded);
        let messages: Vec<_> = summary.errors.iter().map(|e| e.message.as_str()).collect();
        assert_eq!(
            messages,
            [
                "cannot convert value of type 'String' to specified type 'Int'",
                "cannot find 'tapsx' in scope",
                "Signing for \"App\" requires a development team.",
            ]
        );
        let first = &summary.errors[0];
        assert_eq!(first.file.as_deref(), Some("/p/App/ContentView.swift"));
        assert_eq!(
            (first.line, first.column, first.log_line),
            (Some(12), Some(36), 2)
        );
        assert_eq!(summary.errors[2].file, None);
        assert_eq!(summary.warnings, 2);
        assert_eq!(failure_label(&summary), "Build failed · 3 errors");
    }

    #[test]
    fn reads_a_successful_build() {
        let summary = parse_build_output("CompileSwift ...\n** BUILD SUCCEEDED **\n");
        assert!(summary.succeeded);
        assert!(summary.errors.is_empty());
        assert_eq!(failure_label(&BuildSummary::default()), "Build failed");
    }

    #[test]
    fn reads_errors_without_a_column() {
        let summary = parse_build_output("/p/Info.plist:4: error: bad key\n** BUILD FAILED **\n");
        let issue = &summary.errors[0];
        assert_eq!(issue.file.as_deref(), Some("/p/Info.plist"));
        assert_eq!((issue.line, issue.column), (Some(4), None));
        assert_eq!(failure_label(&summary), "Build failed · 1 error");
    }

    #[test]
    fn labels_build_times() {
        assert_eq!(built_in_label(1800), "built in 1.8 s");
        assert_eq!(built_in_label(42_400), "built in 42 s");
        assert_eq!(built_in_label(125_000), "built in 2 min 5 s");
    }

    #[test]
    fn finds_workspaces_before_projects_and_skips_nested_and_vendored_ones() {
        let root = std::env::temp_dir().join(format!("aven-xcode-detect-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in [
            "App.xcodeproj/project.xcworkspace",
            "App.xcworkspace",
            "Pods/Pods.xcodeproj",
            "node_modules/x/X.xcodeproj",
            "ios/Mobile.xcodeproj",
            ".hidden/H.xcodeproj",
            "a/b/Deep.xcodeproj",
        ] {
            std::fs::create_dir_all(root.join(dir)).unwrap();
        }
        let found = find_containers(&root);
        let names: Vec<_> = found
            .iter()
            .map(|c| {
                c.path
                    .strip_prefix(&root)
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(
            names,
            ["App.xcworkspace", "App.xcodeproj", "ios/Mobile.xcodeproj"]
        );
        assert_eq!(found[0].kind, ContainerKind::Workspace);
        assert_eq!(found[0].args()[0], "-workspace");
        assert_eq!(found[1].args()[0], "-project");
        std::fs::remove_dir_all(&root).unwrap();
    }
}
