//! Simulator device lists from `simctl list devices -j`, and the pure decisions
//! about which devices the iPhone pane offers.
// The iPhone pane runs on macOS only; other builds keep the shared parts.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DeviceFamily {
    Iphone,
    Ipad,
}

/// A simulator the iPhone pane can show.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SimDeviceInfo {
    pub udid: String,
    pub name: String,
    pub family: DeviceFamily,
    /// "iOS 27.0"
    pub runtime: String,
    pub booted: bool,
    /// "Booted", "Shutdown", "Booting", "Shutting Down"
    pub state: String,
    /// The device's data folder, where each boot leaves its mark.
    #[serde(skip)]
    pub data_path: Option<std::path::PathBuf>,
}

/// `com.apple.CoreSimulator.SimRuntime.iOS-27-0` → `iOS 27.0`. Other platforms
/// (watchOS, tvOS, visionOS) are not offered.
fn ios_runtime_label(identifier: &str) -> Option<String> {
    let tail = identifier.rsplit('.').next()?;
    let version = tail.strip_prefix("iOS-")?;
    Some(format!("iOS {}", version.replace('-', ".")))
}

fn family_of(device_type: &str, name: &str) -> Option<DeviceFamily> {
    let kind = device_type.rsplit('.').next().unwrap_or(device_type);
    if kind.starts_with("iPhone") || (kind.is_empty() && name.starts_with("iPhone")) {
        Some(DeviceFamily::Iphone)
    } else if kind.starts_with("iPad") || (kind.is_empty() && name.starts_with("iPad")) {
        Some(DeviceFamily::Ipad)
    } else {
        None
    }
}

/// Reads `xcrun simctl list devices -j`: available iPhones and iPads, newest
/// runtime first, then iPhones before iPads, booted first, then by name.
pub(crate) fn parse_device_list(text: &str) -> Result<Vec<SimDeviceInfo>, String> {
    let value: serde_json::Value = serde_json::from_str(text)
        .map_err(|error| format!("Could not read simulators: {error}"))?;
    let runtimes = value
        .get("devices")
        .and_then(|v| v.as_object())
        .ok_or("The simulator list has no devices")?;
    let mut devices = Vec::new();
    let mut order = Vec::new();
    for (identifier, list) in runtimes {
        let Some(runtime) = ios_runtime_label(identifier) else {
            continue;
        };
        let version: Vec<u32> = runtime
            .trim_start_matches("iOS ")
            .split('.')
            .filter_map(|part| part.parse().ok())
            .collect();
        for device in list.as_array().into_iter().flatten() {
            let get = |key: &str| device.get(key).and_then(|v| v.as_str()).unwrap_or("");
            if device.get("isAvailable").and_then(|v| v.as_bool()) == Some(false) {
                continue;
            }
            let (udid, name) = (get("udid"), get("name"));
            if udid.is_empty() || name.is_empty() {
                continue;
            }
            let Some(family) = family_of(get("deviceTypeIdentifier"), name) else {
                continue;
            };
            let state = get("state").to_owned();
            let data_path = Some(get("dataPath"))
                .filter(|path| path.starts_with('/'))
                .map(std::path::PathBuf::from);
            order.push(version.clone());
            devices.push(SimDeviceInfo {
                udid: udid.to_owned(),
                name: name.to_owned(),
                family,
                runtime: runtime.clone(),
                booted: state == "Booted",
                state,
                data_path,
            });
        }
    }
    let mut indexed: Vec<(Vec<u32>, SimDeviceInfo)> = order.into_iter().zip(devices).collect();
    indexed.sort_by(|(va, a), (vb, b)| {
        vb.cmp(va)
            .then_with(|| {
                (a.family != DeviceFamily::Iphone).cmp(&(b.family != DeviceFamily::Iphone))
            })
            .then_with(|| b.booted.cmp(&a.booted))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(indexed.into_iter().map(|(_, device)| device).collect())
}

/// Shaped like a simulator's UDID (a UUID). Anything else (a real device's
/// ECID-style identifier, `booted`, a name) is refused before it reaches a
/// tool. CoreDevice also gives real devices UUIDs, so a UUID is a simulator
/// only once `simctl list` names it (`known_simulator`).
pub(crate) fn valid_udid(udid: &str) -> bool {
    let parts: Vec<&str> = udid.split('-').collect();
    parts.len() == 5
        && [8, 4, 4, 4, 12]
            .iter()
            .zip(&parts)
            .all(|(len, part)| part.len() == *len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

/// A UUID that `simctl list` names: a simulator, never a real device (whose
/// CoreDevice identifier is also a UUID). Returns its canonical form.
pub(crate) fn known_simulator(udid: &str, devices: &[SimDeviceInfo]) -> Option<String> {
    if !valid_udid(udid) {
        return None;
    }
    devices
        .iter()
        .find(|d| d.udid.eq_ignore_ascii_case(udid))
        .map(|d| d.udid.to_uppercase())
}

/// The pane's choice when nothing is remembered. It never starts another
/// simulator while one is running: first one Aven started (`aven_booted`,
/// upper-case UDIDs), then any running one (shown at once; its home screen is
/// restarted for touches, and it joins the agent scope, only when the person
/// picks it), iPhones before
/// iPads; only when none runs, the newest iPhone that is shut down, else any
/// device; otherwise nothing, and the person picks.
pub(crate) fn default_device<'a>(
    devices: &'a [SimDeviceInfo],
    aven_booted: &std::collections::BTreeSet<String>,
) -> Option<&'a SimDeviceInfo> {
    let ours = |d: &&SimDeviceInfo| d.booted && aven_booted.contains(&d.udid.to_uppercase());
    let running = |d: &&SimDeviceInfo| d.booted;
    let iphone = |d: &&SimDeviceInfo| d.family == DeviceFamily::Iphone;
    let first = |keep: &dyn Fn(&&SimDeviceInfo) -> bool| {
        devices
            .iter()
            .filter(|d| keep(d))
            .find(|d| iphone(d))
            .or_else(|| devices.iter().find(|d| keep(d)))
    };
    first(&ours)
        .or_else(|| first(&running))
        .or_else(|| first(&|_| true))
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIST: &str = r#"{
  "devices" : {
    "com.apple.CoreSimulator.SimRuntime.iOS-26-2" : [
      { "udid" : "11111111-1111-1111-1111-111111111111", "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-17", "state" : "Shutdown", "name" : "iPhone 17" }
    ],
    "com.apple.CoreSimulator.SimRuntime.watchOS-12-0" : [
      { "udid" : "22222222-2222-2222-2222-222222222222", "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.Apple-Watch-Ultra", "state" : "Shutdown", "name" : "Apple Watch Ultra" }
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-27-0" : [
      { "udid" : "E5B294CF-EC79-4FE6-B919-D3175705B784", "isAvailable" : true, "lastUsedAt" : "2026-10-27T02:39:25Z",
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro", "state" : "Booted", "name" : "iPhone 18 Pro" },
      { "udid" : "0541E1A4-FEB2-4B8F-B6F5-4EB5A2F87E49", "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPad-Pro-13-inch-M5-12GB", "state" : "Shutdown", "name" : "iPad Pro 13-inch (M5)" },
      { "udid" : "32BA9274-974F-481F-BEAF-D565EEFDE4F0", "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro-Max", "state" : "Shutdown", "name" : "iPhone 18 Pro Max" },
      { "udid" : "33333333-3333-3333-3333-333333333333", "isAvailable" : false,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.iPhone-18", "state" : "Shutdown", "name" : "Broken" },
      { "udid" : "44444444-4444-4444-4444-444444444444", "isAvailable" : true,
        "deviceTypeIdentifier" : "com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K", "state" : "Shutdown", "name" : "Apple TV" }
    ]
  }
}"#;

    #[test]
    fn lists_available_iphones_and_ipads_newest_runtime_first() {
        let devices = parse_device_list(LIST).unwrap();
        let names: Vec<_> = devices
            .iter()
            .map(|d| (d.name.as_str(), d.runtime.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("iPhone 18 Pro", "iOS 27.0"),
                ("iPhone 18 Pro Max", "iOS 27.0"),
                ("iPad Pro 13-inch (M5)", "iOS 27.0"),
                ("iPhone 17", "iOS 26.2"),
            ]
        );
        assert!(devices[0].booted);
        assert_eq!(devices[2].family, DeviceFamily::Ipad);
        // The person's running iPhone 18 Pro is shown rather than starting a
        // second simulator beside it.
        let none = std::collections::BTreeSet::new();
        assert_eq!(
            default_device(&devices, &none).unwrap().name,
            "iPhone 18 Pro"
        );
    }

    #[test]
    fn prefers_a_running_device_aven_started() {
        let mut devices = parse_device_list(LIST).unwrap();
        devices[1].booted = true;
        let ours: std::collections::BTreeSet<String> =
            ["32BA9274-974F-481F-BEAF-D565EEFDE4F0".to_owned()].into();
        assert_eq!(
            default_device(&devices, &ours).unwrap().name,
            "iPhone 18 Pro Max"
        );
        // Aven's boot no longer running: the running device, not a new boot.
        devices[1].booted = false;
        assert_eq!(
            default_device(&devices, &ours).unwrap().name,
            "iPhone 18 Pro"
        );
    }

    #[test]
    fn starts_a_shut_down_iphone_only_when_none_runs() {
        let none = std::collections::BTreeSet::new();
        let mut devices = parse_device_list(LIST).unwrap();
        devices.iter_mut().for_each(|d| d.booted = false);
        devices.rotate_left(2);
        assert_eq!(default_device(&devices, &none).unwrap().name, "iPhone 17");
        assert!(default_device(&[], &none).is_none());
        // Only an iPad runs: it is shown, and no iPhone is started beside it.
        let ipad = devices
            .iter()
            .position(|d| d.family == DeviceFamily::Ipad)
            .unwrap();
        devices[ipad].booted = true;
        assert_eq!(
            default_device(&devices, &none).unwrap().name,
            "iPad Pro 13-inch (M5)"
        );
    }

    #[test]
    fn only_listed_simulators_count_as_known() {
        let devices = parse_device_list(LIST).unwrap();
        assert_eq!(
            known_simulator("e5b294cf-ec79-4fe6-b919-d3175705b784", &devices).as_deref(),
            Some("E5B294CF-EC79-4FE6-B919-D3175705B784")
        );
        // A real device's CoreDevice identifier is UUID-shaped too.
        assert!(valid_udid("6D1B1E5A-2F44-4C1B-9E5A-0E4D1C2B3A49"));
        assert_eq!(
            known_simulator("6D1B1E5A-2F44-4C1B-9E5A-0E4D1C2B3A49", &devices),
            None
        );
        assert_eq!(known_simulator("00008120-001A2B3C4D5E6F70", &devices), None);
    }

    #[test]
    fn rejects_bad_lists() {
        assert!(parse_device_list("not json").is_err());
        assert!(parse_device_list("{}").is_err());
    }

    #[test]
    fn accepts_only_simulator_udids() {
        assert!(valid_udid("E5B294CF-EC79-4FE6-B919-D3175705B784"));
        assert!(!valid_udid("booted"));
        assert!(!valid_udid("00008120-001A2B3C4D5E6F70"));
        assert!(!valid_udid("E5B294CF-EC79-4FE6-B919-D3175705B78Z"));
        assert!(!valid_udid("E5B294CF-EC79-4FE6-B919-D3175705B784 --set x"));
    }
}
