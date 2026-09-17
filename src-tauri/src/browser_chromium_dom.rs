//! Fixed operations in Chromium's isolated execution world. No page IPC.
use serde_json::Value;

pub(crate) async fn operate(
    page: crate::browser::ChromiumPage,
    request: Value,
) -> Result<Value, String> {
    page.command(serde_json::json!({"action":"dom", "request":request}))
        .await
}
