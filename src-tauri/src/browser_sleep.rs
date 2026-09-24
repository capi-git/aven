use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSleepReport {
    pub eligible: bool,
    pub slept: bool,
    pub blockers: Vec<String>,
}

impl BrowserSleepReport {
    pub fn blocked(reason: &str) -> Self {
        Self {
            eligible: false,
            slept: false,
            blockers: vec![reason.into()],
        }
    }

    #[cfg(all(feature = "chromium", target_os = "macos"))]
    pub fn slept() -> Self {
        Self {
            eligible: true,
            slept: true,
            blockers: Vec::new(),
        }
    }
}
