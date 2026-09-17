//! Fixed DOM operations in a WebKit isolated content world. No website receives
//! a native message handler, capability token, or the agent's element map.
use serde_json::Value;
use tauri::Webview;

pub(crate) async fn operate(view: Webview, request: Value) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        evaluate(view, request).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (view, request);
        Err("Agent browser controls are currently available on macOS only".into())
    }
}

#[cfg(target_os = "macos")]
thread_local! {
    // WebKit's worldWithName cache is weak. Keep this strong reference across
    // calls or the snapshot's isolated JS globals disappear after evaluation.
    // Each document still has its own JS globals in this shared world identity.
    static AGENT_WORLD: std::cell::RefCell<Option<objc2::rc::Retained<objc2::runtime::AnyObject>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(target_os = "macos")]
fn retained_content_world() -> Result<objc2::rc::Retained<objc2::runtime::AnyObject>, String> {
    use objc2::{msg_send, runtime::AnyClass, MainThreadMarker};
    use objc2_foundation::NSString;
    if MainThreadMarker::new().is_none() {
        return Err("Browser controls must run on the main thread".into());
    }
    AGENT_WORLD.with(|slot| {
        let mut world = slot.borrow_mut();
        if world.is_none() {
            let class = AnyClass::get(c"WKContentWorld")
                .ok_or("This macOS version does not support isolated browser controls")?;
            let name = NSString::from_str("com.supermono.agent-browser");
            *world = Some(unsafe { msg_send![class, worldWithName: &*name] });
        }
        Ok(world.as_ref().unwrap().clone())
    })
}

#[cfg(any(target_os = "macos", test))]
fn decode_result(result: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(result)
        .map_err(|_| "Browser returned an invalid result".to_string())?;
    if let Some(message) = value.get("__supermonoAgentError").and_then(Value::as_str) {
        return Err(format!(
            "Browser operation failed: {}",
            message.chars().take(500).collect::<String>()
        ));
    }
    Ok(value)
}

#[cfg(target_os = "macos")]
async fn evaluate(view: Webview, request: Value) -> Result<Value, String> {
    use block2::RcBlock;
    use objc2::{msg_send, runtime::AnyObject};
    use objc2_foundation::{NSError, NSString};
    use std::{sync::mpsc, time::Duration};

    let script = format!("{}({})", include_str!("browser_agent_dom.js"), request);
    let (sender, receiver) = mpsc::channel::<Result<String, String>>();
    view.with_webview(move |platform| unsafe {
        let wk = &*platform.inner().cast::<AnyObject>();
        let world = match retained_content_world() {
            Ok(world) => world,
            Err(error) => { let _ = sender.send(Err(error)); return; }
        };
        let script = NSString::from_str(&script);
        let completion = RcBlock::new(move |result: *mut AnyObject, error: *mut NSError| {
            let response = if !error.is_null() {
                Err(format!("Browser operation failed: {}", (&*error).localizedDescription().to_string().chars().take(500).collect::<String>()))
            } else if result.is_null() {
                Err("Browser operation returned no result".into())
            } else {
                let result = &*(result.cast::<NSString>());
                let value = result.to_string();
                if value.len() > 256 * 1024 { Err("Browser snapshot exceeds the size limit".into()) } else { Ok(value) }
            };
            let _ = sender.send(response);
        });
        let frame: *const AnyObject = std::ptr::null();
        let _: () = msg_send![wk, evaluateJavaScript: &*script, inFrame: frame, inContentWorld: &*world, completionHandler: &*completion];
    }).map_err(|error| error.to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        receiver
            .recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Browser operation timed out".to_string())?
    })
    .await
    .map_err(|error| error.to_string())??;
    decode_result(&result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reports_stale_reference_errors_and_keeps_successful_snapshots() {
        assert_eq!(
            decode_result(r#"{"url":"https://example.com","elements":[]}"#).unwrap()["url"],
            "https://example.com"
        );
        let error =
            decode_result(r#"{"__supermonoAgentError":"Stale reference. Take a new snapshot."}"#)
                .unwrap_err();
        assert_eq!(
            error,
            "Browser operation failed: Stale reference. Take a new snapshot."
        );
    }
    #[test]
    fn bounds_javascript_error_messages() {
        let input = serde_json::json!({"__supermonoAgentError":"x".repeat(10000)}).to_string();
        assert_eq!(
            decode_result(&input).unwrap_err().len(),
            "Browser operation failed: ".len() + 500
        );
    }
}
