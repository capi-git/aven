//! Keep native WebView link actions from replacing the trusted app document.
//!
//! WebKit's context-menu Open Link does not dispatch a DOM click, so the frontend
//! link router alone cannot protect the shell. Browser child views retain their
//! own navigation policies; this plugin only handles workspace app documents.

use serde::Serialize;
use tauri::{
    plugin::{Builder, TauriPlugin},
    utils::config::{Config, FrontendDist},
    Emitter, EventTarget, Manager, Runtime, Url, WebviewUrl,
};

const OPEN_LINK_EVENT: &str = "aven:open-link";
const LOCAL_FILE_FRAGMENT: &str = "covecode-file=";

#[derive(Clone, Serialize)]
struct OpenLink<'a> {
    url: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
enum Navigation {
    Allow,
    OpenInBrowser,
    OpenInEditor,
    Deny,
}

fn same_origin(a: &Url, b: &Url) -> bool {
    // Url::origin() is opaque for tauri:, so compare the authority explicitly.
    a.scheme() == b.scheme()
        && a.host_str() == b.host_str()
        && a.port_or_known_default() == b.port_or_known_default()
        && a.username() == b.username()
        && a.password() == b.password()
}

fn entry_path(path: &str) -> &str {
    match path {
        "" | "/" | "/index.html" => "/",
        other => other,
    }
}

fn navigation(url: &Url, entry: Option<&Url>) -> Navigation {
    let Some(entry) = entry else {
        return Navigation::Deny;
    };
    if same_origin(url, entry) {
        return if entry_path(url.path()) == entry_path(entry.path()) && url.query() == entry.query()
        {
            if url
                .fragment()
                .is_some_and(|fragment| fragment.starts_with(LOCAL_FILE_FRAGMENT))
            {
                // A native Open Link skips React's click handler. Keep the shell
                // mounted and ask its existing file router to resolve this link.
                Navigation::OpenInEditor
            } else {
                // Other same-document fragments and legitimate reloads are safe.
                Navigation::Allow
            }
        } else {
            // A different app entrypoint/query can also unload the main UI.
            Navigation::Deny
        };
    }
    if matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
    {
        Navigation::OpenInBrowser
    } else {
        Navigation::Deny
    }
}

fn shell_entry(config: &Config, development: bool) -> Option<Url> {
    let window = config
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")?;
    let base = if development {
        config.build.dev_url.clone()
    } else {
        match config.build.frontend_dist.as_ref() {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    }
    .or_else(|| {
        let protocol = if cfg!(any(windows, target_os = "android")) {
            if window.use_https_scheme {
                "https://tauri.localhost"
            } else {
                "http://tauri.localhost"
            }
        } else {
            "tauri://localhost"
        };
        Url::parse(protocol).ok()
    })?;
    match &window.url {
        // Match Tauri's App URL resolution: index.html uses the base URL itself.
        WebviewUrl::App(path) if path.to_str() == Some("index.html") => Some(base),
        WebviewUrl::App(path) => base.join(&path.to_string_lossy()).ok(),
        WebviewUrl::External(url) | WebviewUrl::CustomProtocol(url) => Some(url.clone()),
        _ => None,
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("shell-navigation")
        .on_navigation(|webview, url| {
            if !crate::window::is_workspace_label(webview.label()) {
                return true;
            }
            let entry = shell_entry(webview.app_handle().config(), tauri::is_dev());
            match navigation(url, entry.as_ref()) {
                Navigation::Allow => true,
                Navigation::OpenInBrowser => {
                    // Target only the originating trusted shell, never a remote
                    // browser child or another workspace's navigation listener.
                    let _ = webview.app_handle().emit_to(
                        EventTarget::webview(webview.label()),
                        OPEN_LINK_EVENT,
                        OpenLink { url: url.as_str() },
                    );
                    false
                }
                Navigation::OpenInEditor => {
                    // Only a known fragment from this exact trusted app entry
                    // reaches this branch; remote browser views never emit it.
                    let fragment = format!("#{}", url.fragment().unwrap_or_default());
                    let _ = webview.app_handle().emit_to(
                        EventTarget::webview(webview.label()),
                        OPEN_LINK_EVENT,
                        OpenLink { url: &fragment },
                    );
                    false
                }
                Navigation::Deny => false,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn decision(entry: &str, target: &str) -> Navigation {
        navigation(
            &Url::parse(target).unwrap(),
            Some(&Url::parse(entry).unwrap()),
        )
    }

    #[test]
    fn production_shell_allows_only_its_entrypoint_and_fragments() {
        for url in [
            "tauri://localhost",
            "tauri://localhost/",
            "tauri://localhost/index.html",
            "tauri://localhost/#message-42",
        ] {
            assert_eq!(
                decision("tauri://localhost", url),
                Navigation::Allow,
                "{url}"
            );
        }
        for url in [
            "tauri://localhost/index.html?usagePanel=1",
            "tauri://localhost/?pipSession=1",
            "tauri://localhost/index.html?workspaceWindow=1",
            "tauri://localhost/another.html",
            "tauri://elsewhere/index.html",
            "tauri://localhost:1420/index.html",
        ] {
            assert_eq!(
                decision("tauri://localhost", url),
                Navigation::Deny,
                "{url}"
            );
        }
    }

    #[test]
    fn local_file_context_menu_uses_editor_only_from_the_exact_shell_entry() {
        for (entry, url) in [
            (
                "tauri://localhost",
                "tauri://localhost/index.html#covecode-file=%2Ftmp%2Fnotes.md",
            ),
            (
                "http://localhost:1420/",
                "http://localhost:1420/#covecode-file=%2Fp%2FREADME.md%3A12%3A2",
            ),
            (
                "http://localhost:1420/?mode=test",
                "http://localhost:1420/index.html?mode=test#covecode-file=%2Fp%2Fnotes.md",
            ),
        ] {
            assert_eq!(decision(entry, url), Navigation::OpenInEditor, "{url}");
        }
        for url in [
            "tauri://localhost/other.html#covecode-file=%2Ftmp%2Fnotes.md",
            "tauri://localhost/?usagePanel=1#covecode-file=%2Ftmp%2Fnotes.md",
            "tauri://elsewhere/#covecode-file=%2Ftmp%2Fnotes.md",
            "file:///tmp/index.html#covecode-file=%2Ftmp%2Fnotes.md",
        ] {
            assert_eq!(
                decision("tauri://localhost", url),
                Navigation::Deny,
                "{url}"
            );
        }
        assert_eq!(
            decision(
                "tauri://localhost",
                "https://example.com/#covecode-file=%2Ftmp%2Fnotes.md"
            ),
            Navigation::OpenInBrowser
        );
        assert_eq!(
            decision(
                "tauri://localhost",
                "tauri://localhost/#not-covecode-file=hello"
            ),
            Navigation::Allow
        );
    }

    #[test]
    fn external_context_menu_link_is_routed_without_navigating_shell() {
        for url in [
            "https://nemsis.org/technical-resources/version-3/version-3-resources/",
            "http://localhost:5173/#protocols",
            "https://example.com/report?q=a%20b#section",
        ] {
            assert_eq!(
                decision("tauri://localhost", url),
                Navigation::OpenInBrowser
            );
        }
    }

    #[test]
    fn local_and_executable_urls_cannot_replace_shell_or_route_to_browser() {
        for url in [
            "file:///tmp/example.html",
            "javascript:alert(1)",
            "data:text/html,hello",
            "blob:https://example.com/uuid",
            "about:blank",
            "asset://localhost/tmp/report.html",
            "mailto:someone@example.com",
            "https://user:password@example.com/",
        ] {
            assert_eq!(
                decision("tauri://localhost", url),
                Navigation::Deny,
                "{url}"
            );
        }
    }

    #[test]
    fn development_trust_is_exact_including_port_and_no_panel_query() {
        let entry = "http://localhost:1420/";
        assert_eq!(
            decision(entry, "http://localhost:1420/index.html#chat"),
            Navigation::Allow
        );
        for url in [
            "http://localhost:5173/",
            "http://127.0.0.1:1420/",
            "https://localhost:1420/",
            "http://localhost.evil.test:1420/",
        ] {
            assert_eq!(decision(entry, url), Navigation::OpenInBrowser, "{url}");
        }
        assert_eq!(
            decision(entry, "http://localhost:1420/index.html?usagePanel=1"),
            Navigation::Deny
        );
        assert_eq!(
            decision(entry, "http://localhost:1420/src/main.tsx"),
            Navigation::Deny
        );
    }

    #[test]
    fn configured_app_entry_is_not_inferred_from_an_untrusted_destination() {
        let config: Config = serde_json::from_value(serde_json::json!({
            "identifier": "com.example.aven-test",
            "build": { "devUrl": "http://localhost:1420", "frontendDist": "../dist" },
            "app": { "windows": [{ "label": "main" }] }
        }))
        .unwrap();
        assert_eq!(
            shell_entry(&config, true).unwrap().as_str(),
            "http://localhost:1420/"
        );
        let production = shell_entry(&config, false).unwrap();
        assert_eq!(
            production.scheme(),
            if cfg!(any(windows, target_os = "android")) {
                "http"
            } else {
                "tauri"
            }
        );
        assert_eq!(
            navigation(&Url::parse("https://example.com/").unwrap(), None),
            Navigation::Deny
        );
    }

    #[test]
    fn configured_query_is_preserved_and_only_fragments_vary() {
        assert_eq!(
            decision(
                "http://localhost:1420/index.html?mode=test",
                "http://localhost:1420/index.html?mode=test#message"
            ),
            Navigation::Allow
        );
        assert_eq!(
            decision(
                "http://localhost:1420/index.html?mode=test",
                "http://localhost:1420/index.html"
            ),
            Navigation::Deny
        );
    }

    #[test]
    fn workspace_scope_excludes_remote_browser_and_auxiliary_webviews() {
        for label in ["main", "window-1", "window-42"] {
            assert!(crate::window::is_workspace_label(label));
        }
        for label in [
            "browser-main",
            "browser-1",
            "workspace-detached-1",
            "pip-session-1",
            "usage-panel",
            "access-panel",
            "window-not-a-number",
        ] {
            assert!(!crate::window::is_workspace_label(label), "{label}");
        }
    }
}
