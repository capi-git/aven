//! Platform-independent rules for Accessibility-element desktop control: a
//! bounded tree capture, compact serialisation with secure-field redaction,
//! per-chat snapshot indexes and their staleness checks, action fallbacks, key
//! mapping, and bookkeeping for the Electron/Chromium accessibility switches.
//!
//! The macOS adapter supplies elements through [`Source`]; nothing in this
//! module talks to the OS, so every policy here is unit tested directly.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use super::Region;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::ops::RangeInclusive;

pub(crate) const DEFAULT_MAX_NODES: u32 = 250;
pub(crate) const NODE_RANGE: RangeInclusive<u32> = 20..=1000;
/// Tree depth followed below a root. Deeper elements are reported as truncated.
pub(crate) const MAX_DEPTH: usize = 48;
/// Elements read (indexed or not) before a capture stops.
pub(crate) const MAX_VISITS: usize = 6000;
/// Children read from one element; the rest are reported as truncated.
pub(crate) const MAX_CHILDREN: usize = 300;
pub(crate) const MAX_ACTIONS: usize = 16;
/// Upper bound on the serialised tree, well inside the socket response limit.
pub(crate) const OUTLINE_LIMIT: usize = 150 * 1024;
const LABEL_LIMIT: usize = 120;
const VALUE_LIMIT: usize = 200;
/// Labels shown in Aven's presence bar.
const BAR_LABEL_LIMIT: usize = 40;
/// Windows remembered per chat; older snapshots are dropped first.
pub(crate) const SNAPSHOTS_PER_SCOPE: usize = 4;
pub(crate) const STALE: &str = "State changed; call appState again.";
pub(crate) const MAX_TEXT: usize = 4000;
const REDACTED: &str = "<redacted>";

pub(crate) const SECURE_TEXT_FIELD: &str = "AXSecureTextField";
const TEXT_INPUT_ROLES: &[&str] = &[
    "AXTextField",
    "AXTextArea",
    SECURE_TEXT_FIELD,
    "AXComboBox",
    "AXSearchField",
];
/// Roles that are always indexed: controls, and containers an agent may
/// scroll, select in, or need to recognise.
const KEEP_ROLES: &[&str] = &[
    "AXButton",
    "AXCheckBox",
    "AXRadioButton",
    "AXTextField",
    "AXTextArea",
    SECURE_TEXT_FIELD,
    "AXComboBox",
    "AXSearchField",
    "AXPopUpButton",
    "AXMenuButton",
    "AXSlider",
    "AXIncrementor",
    "AXStepper",
    "AXLink",
    "AXMenu",
    "AXMenuItem",
    "AXMenuBarItem",
    "AXTabGroup",
    "AXRow",
    "AXTable",
    "AXOutline",
    "AXList",
    "AXScrollArea",
    "AXWebArea",
    "AXWindow",
    "AXSheet",
    "AXDrawer",
    "AXPopover",
    "AXToolbar",
    "AXDisclosureTriangle",
    "AXColorWell",
    "AXDateField",
    "AXSplitter",
];
/// Containers whose frame clips what their descendants can show.
const CLIPPING_ROLES: &[&str] = &["AXScrollArea", "AXWebArea"];
/// Actions too common to be worth listing for every element.
const QUIET_ACTIONS: &[&str] = &["AXScrollToVisible"];
const ADJUSTABLE_ROLES: &[&str] = &[
    "AXSlider",
    "AXIncrementor",
    "AXStepper",
    "AXScrollBar",
    "AXValueIndicator",
    "AXLevelIndicator",
];
const SPACE_PRESS_ROLES: &[&str] = &[
    "AXButton",
    "AXCheckBox",
    "AXRadioButton",
    "AXPopUpButton",
    "AXMenuButton",
    "AXDisclosureTriangle",
    "AXLink",
    "AXMenuItem",
];
/// Element actions an agent may request explicitly. Window raising and focus
/// changes are excluded: they would reorder the user's windows.
pub(crate) const SECONDARY_ACTIONS: &[&str] = &[
    "AXShowMenu",
    "AXShowAlternateUI",
    "AXShowDefaultUI",
    "AXIncrement",
    "AXDecrement",
    "AXPick",
    "AXConfirm",
    "AXCancel",
    "AXPress",
    "AXScrollToVisible",
];

/// A value read from an element. Secure text is never read, only marked.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum NodeValue {
    Text(String),
    Number(f64),
    Bool(bool),
    Redacted,
}

/// Everything recorded about one element. `frame` is in global screen points
/// (top-left origin) as read; serialisation converts it to window points.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct NodeInfo {
    pub role: String,
    pub subrole: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub placeholder: Option<String>,
    pub identifier: Option<String>,
    pub value: Option<NodeValue>,
    pub enabled: Option<bool>,
    pub focused: bool,
    pub selected: bool,
    pub actions: Vec<String>,
    pub frame: Option<Region>,
}

impl NodeInfo {
    pub(crate) fn has_action(&self, action: &str) -> bool {
        self.actions.iter().any(|candidate| candidate == action)
    }
    pub(crate) fn is_secure(&self) -> bool {
        is_secure(&self.role, self.subrole.as_deref())
    }
    pub(crate) fn is_text_input(&self) -> bool {
        TEXT_INPUT_ROLES.contains(&self.role.as_str())
            || self.subrole.as_deref() == Some("AXSearchField")
            || self.is_secure()
    }
    fn label(&self) -> Option<&str> {
        [&self.title, &self.description, &self.placeholder]
            .into_iter()
            .flatten()
            .map(String::as_str)
            .find(|label| !label.trim().is_empty())
    }
    /// The centre of the element in global points, when it has a usable frame.
    pub(crate) fn centre(&self) -> Option<(f64, f64)> {
        let frame = self.frame?;
        (frame.width > 0.0 && frame.height > 0.0)
            .then(|| (frame.x + frame.width / 2.0, frame.y + frame.height / 2.0))
    }
}

/// Secure fields are recognised by role or subrole. Their value is never
/// requested from the app, so it cannot appear in a response or a log.
pub(crate) fn is_secure(role: &str, subrole: Option<&str>) -> bool {
    role == SECURE_TEXT_FIELD || subrole == Some(SECURE_TEXT_FIELD)
}

/// Collapses whitespace, removes control, bidirectional and invisible
/// formatting characters, and truncates with an ellipsis.
pub(crate) fn clean(value: &str, limit: usize) -> Option<String> {
    let joined = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned: String = joined
        .chars()
        .filter(|character| {
            !character.is_control()
                && !matches!(
                    character,
                    '\u{061c}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}'
                        | '\u{2060}'..='\u{206f}' | '\u{feff}'
                )
        })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() || limit == 0 {
        return None;
    }
    if cleaned.chars().count() <= limit {
        return Some(cleaned.to_owned());
    }
    let mut short: String = cleaned.chars().take(limit.saturating_sub(1)).collect();
    short.truncate(short.trim_end().len());
    short.push('…');
    Some(short)
}

/// The label Aven shows in its bar while acting on an element: its title,
/// description or placeholder. Never its value, and never typed text.
pub(crate) fn element_label(info: &NodeInfo) -> Option<String> {
    info.label().and_then(|label| clean(label, BAR_LABEL_LIMIT))
}

fn strip_ax(name: &str) -> &str {
    name.strip_prefix("AX")
        .filter(|rest| !rest.is_empty())
        .unwrap_or(name)
}

fn quoted(value: &str, limit: usize) -> Option<String> {
    clean(value, limit).map(|text| serde_json::Value::String(text).to_string())
}

fn number_text(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{}", value as i64)
    } else {
        let text = format!("{value:.4}");
        text.trim_end_matches('0').trim_end_matches('.').to_owned()
    }
}

fn value_text(info: &NodeInfo) -> Option<String> {
    if info.is_secure() {
        // Even a value that a caller supplied by mistake is never shown.
        return Some(REDACTED.into());
    }
    match info.value.as_ref()? {
        NodeValue::Redacted => Some(REDACTED.into()),
        NodeValue::Text(text) => match quoted(text, VALUE_LIMIT) {
            Some(text) => Some(text),
            None if info.is_text_input() => Some("\"\"".into()),
            None => None,
        },
        NodeValue::Number(number) if number.is_finite() => Some(number_text(*number)),
        NodeValue::Number(_) => None,
        NodeValue::Bool(value) => Some(value.to_string()),
    }
}

/// One compact outline line. Frames are window-screenshot points.
pub(crate) fn format_line(
    index: usize,
    depth: usize,
    info: &NodeInfo,
    origin: (f64, f64),
) -> String {
    let mut line = format!(
        "{}[{index}] {}",
        "  ".repeat(depth.min(12)),
        strip_ax(&info.role)
    );
    if let Some(subrole) = info.subrole.as_deref().filter(|s| *s != info.role) {
        line.push(':');
        line.push_str(strip_ax(subrole));
    }
    let title = info.title.as_deref().and_then(|t| quoted(t, LABEL_LIMIT));
    if let Some(title) = &title {
        line.push(' ');
        line.push_str(title);
    }
    if let Some(description) = info
        .description
        .as_deref()
        .and_then(|d| quoted(d, LABEL_LIMIT))
        .filter(|d| Some(d) != title.as_ref())
    {
        line.push_str(" desc=");
        line.push_str(&description);
    }
    if let Some(placeholder) = info
        .placeholder
        .as_deref()
        .and_then(|p| quoted(p, LABEL_LIMIT))
    {
        line.push_str(" placeholder=");
        line.push_str(&placeholder);
    }
    if let Some(value) = value_text(info) {
        line.push_str(" value=");
        line.push_str(&value);
    }
    if info.enabled == Some(false) {
        line.push_str(" disabled");
    }
    if info.focused {
        line.push_str(" focused");
    }
    if info.selected {
        line.push_str(" selected");
    }
    if let Some(frame) = info.frame {
        line.push_str(&format!(
            " @{},{} {}x{}",
            (frame.x - origin.0).round() as i64,
            (frame.y - origin.1).round() as i64,
            frame.width.round() as i64,
            frame.height.round() as i64
        ));
    }
    let actions: Vec<&str> = info
        .actions
        .iter()
        .filter(|action| !QUIET_ACTIONS.contains(&action.as_str()))
        .map(|action| strip_ax(action))
        .collect();
    if !actions.is_empty() {
        line.push_str(" actions=");
        line.push_str(&actions.join(","));
    }
    line
}

/// Whether an element is worth an index. Unlabelled layout groups are
/// flattened: their children appear at the group's own depth.
pub(crate) fn interesting(info: &NodeInfo) -> bool {
    if info
        .frame
        .is_some_and(|frame| frame.width <= 0.0 || frame.height <= 0.0)
    {
        return false;
    }
    KEEP_ROLES.contains(&info.role.as_str())
        || info.label().is_some()
        || value_text(info).is_some_and(|value| value != "\"\"")
        || info
            .actions
            .iter()
            .any(|action| !matches!(action.as_str(), "AXScrollToVisible" | "AXShowMenu"))
}

fn intersects(a: Region, b: Region) -> bool {
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

fn intersection(a: Region, b: Region) -> Option<Region> {
    let x = a.x.max(b.x);
    let y = a.y.max(b.y);
    let right = (a.x + a.width).min(b.x + b.width);
    let bottom = (a.y + a.height).min(b.y + b.height);
    (right > x && bottom > y).then_some(Region {
        x,
        y,
        width: right - x,
        height: bottom - y,
    })
}

/// Supplies elements to a capture. Implementations bound each OS call.
pub(crate) trait Source {
    type Node: Clone;
    fn read(&mut self, node: &Self::Node) -> Option<NodeInfo>;
    /// Must be deterministic for an unchanged element: paths index into it.
    fn children(&mut self, node: &Self::Node, info: &NodeInfo) -> Vec<Self::Node>;
    fn expired(&self) -> bool;
}

#[derive(Clone, Debug)]
pub(crate) struct Captured<N> {
    pub node: N,
    pub info: NodeInfo,
    /// Which capture root (0 is the window, then any open menus).
    pub root: usize,
    /// Child positions from that root.
    pub path: Vec<u16>,
    pub depth: usize,
}

#[derive(Debug)]
pub(crate) struct Capture<N> {
    pub nodes: Vec<Captured<N>>,
    pub truncated: Option<&'static str>,
    pub offscreen: usize,
}

/// Depth-first, bounded capture. Roots are always indexed; each root has an
/// optional clip outside which whole subtrees are skipped as off screen.
pub(crate) fn capture<S: Source>(
    source: &mut S,
    roots: &[(S::Node, Option<Region>)],
    max_nodes: usize,
) -> Capture<S::Node> {
    struct Pending<N> {
        node: N,
        root: usize,
        path: Vec<u16>,
        depth: usize,
        level: usize,
        clip: Option<Region>,
    }
    let mut stack: Vec<Pending<S::Node>> = roots
        .iter()
        .enumerate()
        .rev()
        .map(|(root, (node, clip))| Pending {
            node: node.clone(),
            root,
            path: Vec::new(),
            depth: 0,
            level: 0,
            clip: *clip,
        })
        .collect();
    let mut result = Capture {
        nodes: Vec::new(),
        truncated: None,
        offscreen: 0,
    };
    let mut visits = 0;
    while let Some(item) = stack.pop() {
        if source.expired() {
            result.truncated = Some("time limit");
            break;
        }
        visits += 1;
        if visits > MAX_VISITS {
            result.truncated = Some("element limit");
            break;
        }
        let Some(info) = source.read(&item.node) else {
            continue;
        };
        let is_root = item.path.is_empty();
        // An open menu can extend past its window; it is never clipped.
        let menu = info.role == "AXMenu";
        if !is_root && !menu {
            if let (Some(frame), Some(clip)) = (info.frame, item.clip) {
                if frame.width > 0.0 && frame.height > 0.0 && !intersects(frame, clip) {
                    result.offscreen += 1;
                    continue;
                }
            }
        }
        let keep = is_root || interesting(&info);
        if keep && result.nodes.len() >= max_nodes {
            result.truncated = Some("node limit");
            break;
        }
        if item.level >= MAX_DEPTH {
            result.truncated.get_or_insert("depth limit");
        }
        let children = if item.level < MAX_DEPTH {
            source.children(&item.node, &info)
        } else {
            Vec::new()
        };
        if children.len() > MAX_CHILDREN {
            result.truncated.get_or_insert("child limit");
        }
        let clip = match (info.frame, CLIPPING_ROLES.contains(&info.role.as_str())) {
            _ if menu => None,
            (Some(frame), true) => item
                .clip
                .map_or(Some(frame), |clip| intersection(clip, frame).or(Some(clip))),
            _ => item.clip,
        };
        let child_depth = item.depth + usize::from(keep);
        for (index, child) in children.into_iter().take(MAX_CHILDREN).enumerate().rev() {
            let mut path = item.path.clone();
            path.push(index as u16);
            stack.push(Pending {
                node: child,
                root: item.root,
                path,
                depth: child_depth,
                level: item.level + 1,
                clip,
            });
        }
        if keep {
            result.nodes.push(Captured {
                node: item.node,
                info,
                root: item.root,
                path: item.path,
                depth: item.depth,
            });
        }
    }
    result
}

/// Serialises captured nodes. When the outline would exceed its byte limit,
/// later nodes are dropped (and therefore have no index) and `true` returned.
pub(crate) fn outline<N>(nodes: &mut Vec<Captured<N>>, origin: (f64, f64)) -> (String, bool) {
    let mut text = String::new();
    for (index, node) in nodes.iter().enumerate() {
        let line = format_line(index, node.depth, &node.info, origin);
        if text.len() + line.len() + 1 > OUTLINE_LIMIT {
            nodes.truncate(index);
            return (text, true);
        }
        text.push_str(&line);
        text.push('\n');
    }
    (text, false)
}

/// The identity used to decide whether an element is still the one the agent
/// chose. Values and frames may change; role and labels may not.
pub(crate) fn same_identity(old: &NodeInfo, new: &NodeInfo) -> bool {
    old.role == new.role
        && old.subrole == new.subrole
        && old.title == new.title
        && old.description == new.description
        && old.identifier == new.identifier
}

/// Re-resolving by path is only safe for an element with a distinguishing
/// label or identifier; an anonymous group could match a different one.
pub(crate) fn reresolvable(info: &NodeInfo) -> bool {
    [&info.title, &info.description, &info.identifier]
        .into_iter()
        .flatten()
        .any(|text| !text.trim().is_empty())
}

pub(crate) struct Snapshot<N> {
    pub id: u64,
    pub pid: i32,
    pub window_id: u32,
    pub window: Region,
    pub roots: Vec<N>,
    pub nodes: Vec<Captured<N>>,
}

impl<N> Snapshot<N> {
    /// Converts a global frame recorded in this snapshot to the window's
    /// current position, so an anchor follows a moved window.
    pub(crate) fn anchor(&self, index: usize, window: Region) -> Option<(f64, f64)> {
        let (x, y) = self.nodes.get(index)?.info.centre()?;
        Some((x - self.window.x + window.x, y - self.window.y + window.y))
    }
}

/// Latest snapshots per chat scope. Indexes are only valid for the snapshot
/// that produced them; a newer capture of the same window replaces it.
pub(crate) struct Store<N> {
    next: u64,
    scopes: HashMap<String, Vec<Snapshot<N>>>,
}

impl<N> Default for Store<N> {
    fn default() -> Self {
        Self {
            next: 0,
            scopes: HashMap::new(),
        }
    }
}

impl<N> Store<N> {
    pub(crate) fn insert(&mut self, scope: &str, mut snapshot: Snapshot<N>) -> u64 {
        self.next = self.next.wrapping_add(1).max(1);
        snapshot.id = self.next;
        let list = self.scopes.entry(scope.into()).or_default();
        list.retain(|existing| existing.window_id != snapshot.window_id);
        list.push(snapshot);
        if list.len() > SNAPSHOTS_PER_SCOPE {
            list.remove(0);
        }
        self.next
    }

    pub(crate) fn snapshot(
        &self,
        scope: &str,
        window_id: u32,
        state_id: Option<u64>,
    ) -> Result<&Snapshot<N>, String> {
        let snapshot = self
            .scopes
            .get(scope)
            .and_then(|list| list.iter().find(|snapshot| snapshot.window_id == window_id))
            .ok_or_else(|| {
                format!("No accessibility state for window {window_id}. Call appState for this windowId first; element indexes come from its latest state.")
            })?;
        if state_id.is_some_and(|id| id != snapshot.id) {
            return Err(format!(
                "{STALE} That stateId is no longer the latest for window {window_id}."
            ));
        }
        Ok(snapshot)
    }

    pub(crate) fn lookup(
        &self,
        scope: &str,
        window_id: u32,
        state_id: Option<u64>,
        index: u32,
    ) -> Result<(&Snapshot<N>, &Captured<N>), String> {
        let snapshot = self.snapshot(scope, window_id, state_id)?;
        let node = snapshot
            .nodes
            .get(index as usize)
            .ok_or_else(|| format!("Element {index} is not in state {}. {STALE}", snapshot.id))?;
        Ok((snapshot, node))
    }

    pub(crate) fn forget(&mut self, scope: Option<&str>) {
        match scope {
            Some(scope) => {
                self.scopes.remove(scope);
            }
            None => self.scopes.clear(),
        }
    }
}

/// Re-validates a stored element against the live app. The stored reference
/// is preferred; when it is gone, a labelled element is found again by its
/// path. Anything else is stale.
pub(crate) fn resolve<S: Source>(
    source: &mut S,
    roots: &[S::Node],
    stored: &Captured<S::Node>,
) -> Result<(S::Node, NodeInfo, bool), String> {
    if let Some(fresh) = source.read(&stored.node) {
        if same_identity(&stored.info, &fresh) {
            return Ok((stored.node.clone(), fresh, false));
        }
    }
    if !reresolvable(&stored.info) {
        return Err(STALE.into());
    }
    let mut node = roots.get(stored.root).ok_or(STALE)?.clone();
    for &position in &stored.path {
        let info = source.read(&node).ok_or(STALE)?;
        node = source
            .children(&node, &info)
            .into_iter()
            .nth(usize::from(position))
            .ok_or(STALE)?;
    }
    let fresh = source.read(&node).ok_or(STALE)?;
    if same_identity(&stored.info, &fresh) {
        Ok((node, fresh, true))
    } else {
        Err(STALE.into())
    }
}

/// How a background click is attempted, in order.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ClickStep {
    Perform(&'static str),
    /// Give a text input keyboard focus inside its app (AXFocused).
    Focus,
    /// Select a row (AXSelected).
    Select,
    /// App-directed mouse events at the element's centre.
    Events,
}

pub(crate) fn click_plan(info: &NodeInfo, right: bool, count: u8) -> Vec<ClickStep> {
    let mut plan = Vec::new();
    if count != 1 {
        // Accessibility has no double-click; keep the semantic of the request.
    } else if right {
        if info.has_action("AXShowMenu") {
            plan.push(ClickStep::Perform("AXShowMenu"));
        }
    } else if info.is_text_input() {
        plan.push(ClickStep::Focus);
    } else {
        for action in ["AXPress", "AXPick", "AXConfirm"] {
            if info.has_action(action) {
                plan.push(ClickStep::Perform(action));
            }
        }
        if info.role == "AXRow" || info.role == "AXCell" {
            plan.push(ClickStep::Select);
        }
    }
    plan.push(ClickStep::Events);
    plan
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyTarget {
    /// The requested element, or the app's focused element.
    Element,
    /// The window's default button (Return).
    DefaultButton,
    /// The window's cancel button (Escape).
    CancelButton,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KeyStep {
    Perform(KeyTarget, &'static str),
    Insert(&'static str),
    DeleteBackward,
    DeleteForward,
    /// The existing app-directed key events (requires that app's focused window).
    Events,
}

/// Maps a key to Accessibility actions where one has the same meaning, in
/// order. Keys with modifiers, and keys with no semantic equivalent, use the
/// existing key-event path.
pub(crate) fn key_plan(key: &str, modifiers: bool, info: Option<&NodeInfo>) -> Vec<KeyStep> {
    let mut plan = Vec::new();
    if modifiers {
        return vec![KeyStep::Events];
    }
    let has = |action: &str| info.is_some_and(|info| info.has_action(action));
    let role = info.map(|info| info.role.as_str()).unwrap_or_default();
    let text = info.is_some_and(NodeInfo::is_text_input);
    let secure = info.is_some_and(NodeInfo::is_secure);
    match key {
        "Enter" if role == "AXTextArea" => plan.push(KeyStep::Insert("\n")),
        "Enter" => {
            if has("AXConfirm") {
                plan.push(KeyStep::Perform(KeyTarget::Element, "AXConfirm"));
            }
            plan.push(KeyStep::Perform(KeyTarget::DefaultButton, "AXPress"));
        }
        "Escape" => {
            if has("AXCancel") {
                plan.push(KeyStep::Perform(KeyTarget::Element, "AXCancel"));
            }
            plan.push(KeyStep::Perform(KeyTarget::CancelButton, "AXPress"));
        }
        "ArrowUp" | "ArrowRight" | "ArrowDown" | "ArrowLeft"
            if ADJUSTABLE_ROLES.contains(&role) =>
        {
            let action = if matches!(key, "ArrowUp" | "ArrowRight") {
                "AXIncrement"
            } else {
                "AXDecrement"
            };
            if has(action) {
                plan.push(KeyStep::Perform(KeyTarget::Element, action));
            }
        }
        "Space" if text => plan.push(KeyStep::Insert(" ")),
        "Space" if SPACE_PRESS_ROLES.contains(&role) && has("AXPress") => {
            plan.push(KeyStep::Perform(KeyTarget::Element, "AXPress"));
        }
        "Backspace" if text && !secure => plan.push(KeyStep::DeleteBackward),
        "Delete" if text && !secure => plan.push(KeyStep::DeleteForward),
        _ => {}
    }
    plan.push(KeyStep::Events);
    plan
}

/// Accepts names with or without the AX prefix, limited to the allow-list.
pub(crate) fn secondary_action(name: Option<&str>) -> Result<&'static str, String> {
    let Some(name) = name else {
        return Ok("AXShowMenu");
    };
    let wanted = name.trim();
    SECONDARY_ACTIONS
        .iter()
        .copied()
        .find(|action| *action == wanted || strip_ax(action) == wanted)
        .ok_or_else(|| {
            format!(
                "Unsupported element action. Use one of: {}.",
                SECONDARY_ACTIONS
                    .iter()
                    .map(|action| strip_ax(action))
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum ScrollDirection {
    Up,
    Down,
    Left,
    Right,
}

impl ScrollDirection {
    pub(crate) fn page_action(self) -> &'static str {
        match self {
            Self::Up => "AXScrollUpByPage",
            Self::Down => "AXScrollDownByPage",
            Self::Left => "AXScrollLeftByPage",
            Self::Right => "AXScrollRightByPage",
        }
    }
    pub(crate) fn vertical(self) -> bool {
        matches!(self, Self::Up | Self::Down)
    }
    /// +1 towards the end of the content (down or right).
    pub(crate) fn sign(self) -> f64 {
        if matches!(self, Self::Down | Self::Right) {
            1.0
        } else {
            -1.0
        }
    }
}

/// The next scroll-bar value (0 to 1) for `pages` pages of 90% of the visible
/// length, or None when the content does not scroll.
pub(crate) fn scrollbar_value(
    current: f64,
    visible: f64,
    content: f64,
    pages: u8,
    sign: f64,
) -> Option<f64> {
    let range = content - visible;
    if !(current.is_finite() && visible > 0.0 && range > 0.5) {
        return None;
    }
    let step = visible * 0.9 * f64::from(pages) / range;
    Some((current + step * sign).clamp(0.0, 1.0))
}

/// App-directed wheel deltas for the same scroll, in points (+ is down/right).
pub(crate) fn event_delta(visible: f64, pages: u8, direction: ScrollDirection) -> (i32, i32) {
    let distance = (visible.max(40.0) * 0.9 * f64::from(pages)).min(2000.0) * direction.sign();
    let distance = distance.round() as i32;
    if direction.vertical() {
        (0, distance)
    } else {
        (distance, 0)
    }
}

pub(crate) fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// Byte offset of a UTF-16 offset, only at a character boundary.
fn byte_offset(text: &str, utf16: usize) -> Option<usize> {
    let mut units = 0;
    for (byte, character) in text.char_indices() {
        if units == utf16 {
            return Some(byte);
        }
        units += character.len_utf16();
        if units > utf16 {
            return None;
        }
    }
    (units == utf16).then_some(text.len())
}

/// Replaces a UTF-16 range (as Accessibility reports selections) and returns
/// the new value and caret. None when the range is outside the text or would
/// split a character.
pub(crate) fn splice_utf16(
    value: &str,
    location: usize,
    length: usize,
    insert: &str,
) -> Option<(String, usize)> {
    let start = byte_offset(value, location)?;
    let end = byte_offset(value, location.checked_add(length)?)?;
    let mut result = String::with_capacity(value.len() + insert.len());
    result.push_str(&value[..start]);
    result.push_str(insert);
    result.push_str(&value[end..]);
    Some((result, location + utf16_len(insert)))
}

/// The UTF-16 range of the character before / after a caret.
pub(crate) fn char_range(value: &str, caret: usize, backward: bool) -> Option<(usize, usize)> {
    let byte = byte_offset(value, caret)?;
    if backward {
        let character = value[..byte].chars().next_back()?;
        let width = character.len_utf16();
        Some((caret - width, width))
    } else {
        let character = value[byte..].chars().next()?;
        Some((caret, character.len_utf16()))
    }
}

/// The UTF-16 range of the first occurrence of `needle`.
pub(crate) fn find_utf16(value: &str, needle: &str) -> Option<(usize, usize)> {
    if needle.is_empty() {
        return None;
    }
    let byte = value.find(needle)?;
    Some((utf16_len(&value[..byte]), utf16_len(needle)))
}

/// Which accessibility switch makes an app expose its full tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Engine {
    /// Electron apps honour AXManualAccessibility.
    Electron,
    /// Chromium browsers build their tree for AXEnhancedUserInterface.
    Chromium,
}

impl Engine {
    pub(crate) fn attribute(self) -> &'static str {
        match self {
            Self::Electron => "AXManualAccessibility",
            Self::Chromium => "AXEnhancedUserInterface",
        }
    }
}

/// Detects the engine from the names in an app's Contents/Frameworks.
pub(crate) fn engine_for(frameworks: &[String]) -> Option<Engine> {
    if frameworks
        .iter()
        .any(|name| name == "Electron Framework.framework")
    {
        return Some(Engine::Electron);
    }
    const CHROMIUM: &[&str] = &[
        "Chromium Embedded Framework.framework",
        "Chromium Framework.framework",
        "Google Chrome Framework.framework",
        "Google Chrome Beta Framework.framework",
        "Google Chrome Canary Framework.framework",
        "Microsoft Edge Framework.framework",
        "Brave Browser Framework.framework",
        "Vivaldi Framework.framework",
        "Opera Framework.framework",
    ];
    frameworks
        .iter()
        .any(|name| CHROMIUM.contains(&name.as_str()))
        .then_some(Engine::Chromium)
}

struct FlagEntry {
    attribute: &'static str,
    previous: Option<bool>,
    executable: String,
    scopes: HashSet<String>,
}

/// A switch to turn back off once no chat uses the app any more.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Restore {
    pub pid: i32,
    pub attribute: &'static str,
    pub executable: String,
}

/// Which apps had an accessibility switch turned on by Aven, their previous
/// value, and which chats still rely on it.
#[derive(Default)]
pub(crate) struct FlagRegistry {
    entries: HashMap<i32, FlagEntry>,
}

impl FlagRegistry {
    /// Joins an existing switch for this process. False means the caller
    /// should read the previous value, turn it on, and `record` it. A reused
    /// PID (different executable) discards the old entry without restoring.
    pub(crate) fn join(&mut self, scope: &str, pid: i32, executable: &str) -> bool {
        match self.entries.get_mut(&pid) {
            Some(entry) if entry.executable == executable => {
                entry.scopes.insert(scope.into());
                true
            }
            Some(_) => {
                self.entries.remove(&pid);
                false
            }
            None => false,
        }
    }

    pub(crate) fn record(
        &mut self,
        scope: &str,
        pid: i32,
        attribute: &'static str,
        previous: Option<bool>,
        executable: &str,
    ) {
        let entry = self.entries.entry(pid).or_insert_with(|| FlagEntry {
            attribute,
            previous,
            executable: executable.into(),
            scopes: HashSet::new(),
        });
        entry.scopes.insert(scope.into());
    }

    /// Ends a chat's use (or every chat's with None) and returns the switches
    /// nobody uses any more that were off before Aven turned them on.
    pub(crate) fn release(&mut self, scope: Option<&str>) -> Vec<Restore> {
        let mut restore = Vec::new();
        self.entries.retain(|pid, entry| {
            match scope {
                Some(scope) => {
                    entry.scopes.remove(scope);
                }
                None => entry.scopes.clear(),
            }
            if !entry.scopes.is_empty() {
                return true;
            }
            if entry.previous != Some(true) {
                restore.push(Restore {
                    pid: *pid,
                    attribute: entry.attribute,
                    executable: entry.executable.clone(),
                });
            }
            false
        });
        restore.sort_by_key(|item| item.pid);
        restore
    }

    #[cfg(test)]
    fn holds(&self, pid: i32) -> bool {
        self.entries.contains_key(&pid)
    }
}

/// Short, app-specific guidance returned with appState for well-known apps.
pub(crate) fn app_tips(bundle: Option<&str>) -> Option<&'static str> {
    let bundle = bundle?;
    Some(match bundle {
        "com.tinyspeck.slackmacgap" => include_str!("desktop_app_tips/slack.md"),
        "notion.id" => include_str!("desktop_app_tips/notion.md"),
        "com.microsoft.VSCode" | "com.microsoft.VSCodeInsiders" => {
            include_str!("desktop_app_tips/vscode.md")
        }
        "com.google.Chrome" | "com.google.Chrome.beta" | "com.google.Chrome.canary" => {
            include_str!("desktop_app_tips/chrome.md")
        }
        "com.apple.finder" => include_str!("desktop_app_tips/finder.md"),
        "com.apple.mail" => include_str!("desktop_app_tips/mail.md"),
        "com.apple.MobileSMS" => include_str!("desktop_app_tips/messages.md"),
        "com.apple.Music" | "com.spotify.client" => include_str!("desktop_app_tips/music.md"),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(x: f64, y: f64, width: f64, height: f64) -> Region {
        Region {
            x,
            y,
            width,
            height,
        }
    }

    fn info(role: &str, title: Option<&str>) -> NodeInfo {
        NodeInfo {
            role: role.into(),
            title: title.map(Into::into),
            frame: Some(region(110.0, 220.0, 50.0, 20.0)),
            enabled: Some(true),
            ..NodeInfo::default()
        }
    }

    /// A fake app: node IDs index `infos`; `kids` lists children.
    struct Fake {
        infos: Vec<Option<NodeInfo>>,
        kids: HashMap<usize, Vec<usize>>,
        reads: usize,
        budget: usize,
    }

    impl Fake {
        fn new(infos: Vec<NodeInfo>, kids: &[(usize, &[usize])]) -> Self {
            Self {
                infos: infos.into_iter().map(Some).collect(),
                kids: kids.iter().map(|(id, list)| (*id, list.to_vec())).collect(),
                reads: 0,
                budget: usize::MAX,
            }
        }
    }

    impl Source for Fake {
        type Node = usize;
        fn read(&mut self, node: &usize) -> Option<NodeInfo> {
            self.reads += 1;
            self.infos.get(*node).cloned().flatten()
        }
        fn children(&mut self, node: &usize, _: &NodeInfo) -> Vec<usize> {
            self.kids.get(node).cloned().unwrap_or_default()
        }
        fn expired(&self) -> bool {
            self.reads >= self.budget
        }
    }

    fn window_tree() -> Fake {
        let mut window = info("AXWindow", Some("Compose"));
        window.frame = Some(region(100.0, 200.0, 400.0, 300.0));
        let group = NodeInfo {
            role: "AXGroup".into(),
            frame: Some(region(100.0, 200.0, 400.0, 300.0)),
            ..NodeInfo::default()
        };
        let mut send = info("AXButton", Some("Send"));
        send.actions = vec!["AXPress".into(), "AXScrollToVisible".into()];
        let mut password = info("AXTextField", None);
        password.subrole = Some(SECURE_TEXT_FIELD.into());
        password.description = Some("Password".into());
        password.value = Some(NodeValue::Text("hunter2".into()));
        let mut offscreen = info("AXButton", Some("Hidden"));
        offscreen.frame = Some(region(900.0, 900.0, 20.0, 20.0));
        let mut body = info("AXTextArea", None);
        body.description = Some("Body".into());
        body.value = Some(NodeValue::Text(format!("line\n{}", "x".repeat(400))));
        body.focused = true;
        Fake::new(
            vec![window, group, send, password, offscreen, body],
            &[(0, &[1]), (1, &[2, 3, 4, 5])],
        )
    }

    #[test]
    fn capture_flattens_groups_skips_offscreen_and_records_paths() {
        let mut tree = window_tree();
        let clip = Some(region(100.0, 200.0, 400.0, 300.0));
        let result = capture(&mut tree, &[(0, clip)], 100);
        let roles: Vec<_> = result.nodes.iter().map(|n| n.info.role.as_str()).collect();
        assert_eq!(roles, ["AXWindow", "AXButton", "AXTextField", "AXTextArea"]);
        assert_eq!(result.offscreen, 1);
        assert_eq!(result.truncated, None);
        // The unlabelled group is not indexed: its children sit at depth 1.
        assert!(result.nodes[1..].iter().all(|n| n.depth == 1));
        assert_eq!(result.nodes[1].path, vec![0, 0]);
        assert_eq!(result.nodes[3].path, vec![0, 3]);
    }

    #[test]
    fn serialisation_uses_window_points_truncates_and_redacts_secure_values() {
        let mut tree = window_tree();
        let mut nodes = capture(&mut tree, &[(0, None)], 100).nodes;
        let (text, cut) = outline(&mut nodes, (100.0, 200.0));
        assert!(!cut);
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines[0], "[0] Window \"Compose\" @0,0 400x300");
        assert_eq!(lines[1], "  [1] Button \"Send\" @10,20 50x20 actions=Press");
        assert!(lines[2].contains("TextField:SecureTextField desc=\"Password\" value=<redacted>"));
        assert!(!text.contains("hunter2"));
        // Newlines collapse and long values end with an ellipsis.
        let body = lines.iter().find(|l| l.contains("Body")).unwrap();
        assert!(
            body.contains("value=\"line xxx") && body.contains("…\"") && body.contains("focused")
        );
        assert!(body.chars().count() < 320);
        // Redaction also applies to the role form and a value set by mistake.
        let mut secure = info(SECURE_TEXT_FIELD, Some("PIN"));
        secure.value = Some(NodeValue::Text("1234".into()));
        let line = format_line(0, 0, &secure, (0.0, 0.0));
        assert!(line.contains("value=<redacted>") && !line.contains("1234"));
        assert!(secure.is_secure() && secure.is_text_input());
    }

    #[test]
    fn labels_are_sanitised_quoted_and_never_use_values() {
        let mut button = info("AXButton", Some("Say \"hi\"\u{202e}\n now"));
        button.value = Some(NodeValue::Text("secret draft".into()));
        let line = format_line(3, 2, &button, (100.0, 200.0));
        assert!(
            line.starts_with("    [3] Button \"Say \\\"hi\\\" now\""),
            "{line}"
        );
        assert_eq!(element_label(&button).as_deref(), Some("Say \"hi\" now"));
        let mut field = info("AXTextField", None);
        field.value = Some(NodeValue::Text("typed words".into()));
        assert_eq!(element_label(&field), None);
        field.placeholder = Some("Search".into());
        assert_eq!(element_label(&field).as_deref(), Some("Search"));
        let long = info("AXButton", Some(&"word ".repeat(30)));
        let label = element_label(&long).unwrap();
        assert!(label.chars().count() <= BAR_LABEL_LIMIT && label.ends_with('…'));
        let mut slider = info("AXSlider", None);
        slider.value = Some(NodeValue::Number(0.25));
        assert!(format_line(0, 0, &slider, (0.0, 0.0)).contains("value=0.25"));
        slider.value = Some(NodeValue::Number(3.0));
        assert!(format_line(0, 0, &slider, (0.0, 0.0)).contains("value=3 "));
        let mut empty = info("AXTextField", None);
        empty.value = Some(NodeValue::Text(String::new()));
        assert!(format_line(0, 0, &empty, (0.0, 0.0)).contains("value=\"\""));
        let mut disabled = info("AXButton", Some("Go"));
        disabled.enabled = Some(false);
        disabled.selected = true;
        let line = format_line(0, 0, &disabled, (0.0, 0.0));
        assert!(line.contains(" disabled") && line.contains(" selected"));
    }

    #[test]
    fn capture_stops_at_node_time_and_depth_limits() {
        let mut infos = vec![info("AXWindow", Some("W"))];
        let mut kids = Vec::new();
        for index in 1..=50 {
            infos.push(info("AXButton", Some(&format!("B{index}"))));
            kids.push(index);
        }
        let mut tree = Fake::new(infos.clone(), &[(0, &kids)]);
        let result = capture(&mut tree, &[(0, None)], 20);
        assert_eq!(result.nodes.len(), 20);
        assert_eq!(result.truncated, Some("node limit"));
        let mut tree = Fake::new(infos, &[(0, &kids)]);
        tree.budget = 5;
        let result = capture(&mut tree, &[(0, None)], 100);
        assert_eq!(result.truncated, Some("time limit"));
        assert!(result.nodes.len() < 6);
        // A chain deeper than MAX_DEPTH is cut without walking further.
        let chain: Vec<_> = (0..MAX_DEPTH + 10)
            .map(|index| info("AXButton", Some(&format!("D{index}"))))
            .collect();
        let links: Vec<(usize, Vec<usize>)> = (0..chain.len() - 1)
            .map(|index| (index, vec![index + 1]))
            .collect();
        let link_refs: Vec<(usize, &[usize])> = links
            .iter()
            .map(|(id, list)| (*id, list.as_slice()))
            .collect();
        let mut tree = Fake::new(chain, &link_refs);
        let result = capture(&mut tree, &[(0, None)], 1000);
        assert_eq!(result.nodes.len(), MAX_DEPTH + 1);
        assert_eq!(result.truncated, Some("depth limit"));
    }

    #[test]
    fn open_menus_are_never_clipped_by_their_window() {
        let mut window = info("AXWindow", Some("W"));
        window.frame = Some(region(0.0, 0.0, 200.0, 100.0));
        let mut button = info("AXButton", Some("Options"));
        button.frame = Some(region(10.0, 80.0, 60.0, 20.0));
        let mut menu = info("AXMenu", None);
        menu.frame = Some(region(10.0, 100.0, 80.0, 60.0));
        let mut item = info("AXMenuItem", Some("Beta"));
        item.frame = Some(region(10.0, 130.0, 80.0, 20.0));
        let mut stray = info("AXButton", Some("Outside"));
        stray.frame = Some(region(300.0, 300.0, 10.0, 10.0));
        let mut tree = Fake::new(
            vec![window, button, menu, item, stray],
            &[(0, &[1, 4]), (1, &[2]), (2, &[3])],
        );
        let result = capture(&mut tree, &[(0, Some(region(0.0, 0.0, 200.0, 100.0)))], 50);
        let titles: Vec<_> = result
            .nodes
            .iter()
            .map(|node| {
                node.info
                    .title
                    .clone()
                    .unwrap_or_else(|| node.info.role.clone())
            })
            .collect();
        assert_eq!(titles, ["W", "Options", "AXMenu", "Beta"]);
        assert_eq!(result.offscreen, 1);
    }

    #[test]
    fn capture_bounds_children_and_scroll_area_clipping() {
        let mut infos = vec![info("AXWindow", Some("W"))];
        let mut scroll = info("AXScrollArea", None);
        scroll.frame = Some(region(0.0, 0.0, 100.0, 100.0));
        infos.push(scroll);
        let mut rows = Vec::new();
        for index in 0..(MAX_CHILDREN + 20) {
            let mut row = info("AXButton", Some(&format!("R{index}")));
            row.frame = Some(region(0.0, index as f64 * 10.0, 100.0, 10.0));
            infos.push(row);
            rows.push(index + 2);
        }
        let mut tree = Fake::new(infos, &[(0, &[1]), (1, &rows)]);
        let result = capture(
            &mut tree,
            &[(0, Some(region(0.0, 0.0, 1000.0, 5000.0)))],
            1000,
        );
        // Ten rows fit inside the scroll area; the rest are off screen.
        assert_eq!(result.nodes.len(), 2 + 10);
        assert_eq!(result.offscreen, MAX_CHILDREN - 10);
        assert_eq!(result.truncated, Some("child limit"));
    }

    #[test]
    fn outline_respects_its_byte_limit_and_drops_unserialised_indexes() {
        let mut nodes: Vec<Captured<usize>> = (0..1000)
            .map(|index| {
                let mut text = info("AXStaticText", None);
                text.value = Some(NodeValue::Text("y".repeat(400)));
                text.description = Some(format!("{index}{}", "d".repeat(150)));
                Captured {
                    node: index,
                    info: text,
                    root: 0,
                    path: vec![index as u16],
                    depth: 1,
                }
            })
            .collect();
        let (text, cut) = outline(&mut nodes, (0.0, 0.0));
        assert!(cut);
        assert!(text.len() <= OUTLINE_LIMIT);
        assert!(nodes.len() > 100 && nodes.len() < 1000);
        assert_eq!(text.lines().count(), nodes.len());
        assert!(text
            .lines()
            .last()
            .unwrap()
            .contains(&format!("[{}]", nodes.len() - 1)));
    }

    fn stored(tree: &mut Fake, index: usize) -> (Vec<usize>, Captured<usize>) {
        let nodes = capture(tree, &[(0, None)], 100).nodes;
        (vec![0], nodes[index].clone())
    }

    #[test]
    fn stale_elements_are_refused_or_reresolved_only_when_safe() {
        let mut tree = window_tree();
        let (roots, send) = stored(&mut tree, 1);
        // Unchanged: the stored reference is used.
        let (node, fresh, again) = resolve(&mut tree, &roots, &send).unwrap();
        assert_eq!((node, again), (2, false));
        assert_eq!(fresh.title.as_deref(), Some("Send"));
        // A moved element keeps its identity.
        tree.infos[2].as_mut().unwrap().frame = Some(region(0.0, 0.0, 9.0, 9.0));
        assert!(resolve(&mut tree, &roots, &send).is_ok());
        // The stored element disappeared but an identical one sits at its path.
        let replacement = tree.infos[2].clone();
        tree.infos.push(replacement);
        tree.infos[2] = None;
        tree.kids.insert(1, vec![6, 3, 4, 5]);
        let (node, _, again) = resolve(&mut tree, &roots, &send).unwrap();
        assert_eq!((node, again), (6, true));
        // A relabelled control at the path is a different control.
        tree.infos[6].as_mut().unwrap().title = Some("Delete".into());
        assert_eq!(resolve(&mut tree, &roots, &send).unwrap_err(), STALE);
        // The stored reference relabelled in place is also stale.
        let mut tree = window_tree();
        let (roots, send) = stored(&mut tree, 1);
        tree.infos[2].as_mut().unwrap().title = Some("Sent".into());
        assert_eq!(resolve(&mut tree, &roots, &send).unwrap_err(), STALE);
        // Anonymous elements are never re-resolved by position.
        let mut anonymous = info("AXButton", None);
        anonymous.actions = vec!["AXPress".into()];
        let mut tree = Fake::new(
            vec![info("AXWindow", Some("W")), anonymous.clone(), anonymous],
            &[(0, &[1])],
        );
        let (roots, item) = stored(&mut tree, 1);
        assert!(!reresolvable(&item.info));
        tree.infos[1] = None;
        tree.kids.insert(0, vec![2]);
        assert_eq!(resolve(&mut tree, &roots, &item).unwrap_err(), STALE);
    }

    #[test]
    fn snapshot_store_scopes_indexes_and_rejects_old_state_ids() {
        let mut store = Store::<u8>::default();
        let snapshot = |window_id| Snapshot {
            id: 0,
            pid: 7,
            window_id,
            window: region(0.0, 0.0, 10.0, 10.0),
            roots: vec![0],
            nodes: vec![Captured {
                node: 1,
                info: info("AXButton", Some("A")),
                root: 0,
                path: vec![0],
                depth: 1,
            }],
        };
        assert!(store
            .lookup("chat", 5, None, 0)
            .err()
            .unwrap()
            .contains("Call appState"));
        let first = store.insert("chat", snapshot(5));
        assert_eq!(store.lookup("chat", 5, Some(first), 0).unwrap().1.node, 1);
        assert!(store.lookup("chat", 5, None, 0).is_ok());
        assert!(store
            .lookup("chat", 5, None, 1)
            .err()
            .unwrap()
            .contains(STALE));
        assert!(
            store.lookup("other", 5, None, 0).is_err(),
            "indexes are per chat"
        );
        let second = store.insert("chat", snapshot(5));
        assert_ne!(first, second);
        assert!(store
            .lookup("chat", 5, Some(first), 0)
            .err()
            .unwrap()
            .starts_with(STALE));
        assert!(store.lookup("chat", 5, Some(second), 0).is_ok());
        for window in 6..6 + SNAPSHOTS_PER_SCOPE as u32 {
            store.insert("chat", snapshot(window));
        }
        assert!(
            store.lookup("chat", 5, None, 0).is_err(),
            "oldest window dropped"
        );
        store.forget(Some("chat"));
        assert!(store.lookup("chat", 6, None, 0).is_err());
        // Anchors follow a moved window.
        let mut moved = snapshot(9);
        moved.window = region(100.0, 200.0, 400.0, 300.0);
        assert_eq!(
            moved.anchor(0, region(150.0, 200.0, 400.0, 300.0)),
            Some((185.0 - 0.0, 230.0))
        );
    }

    #[test]
    fn click_falls_back_from_semantic_actions_to_app_events() {
        let mut button = info("AXButton", Some("Send"));
        button.actions = vec!["AXShowMenu".into(), "AXPress".into()];
        assert_eq!(
            click_plan(&button, false, 1),
            [ClickStep::Perform("AXPress"), ClickStep::Events]
        );
        button.actions = vec!["AXPick".into(), "AXConfirm".into()];
        assert_eq!(
            click_plan(&button, false, 1),
            [
                ClickStep::Perform("AXPick"),
                ClickStep::Perform("AXConfirm"),
                ClickStep::Events
            ]
        );
        button.actions = vec!["AXShowMenu".into()];
        assert_eq!(
            click_plan(&button, true, 1),
            [ClickStep::Perform("AXShowMenu"), ClickStep::Events]
        );
        assert_eq!(click_plan(&button, false, 2), [ClickStep::Events]);
        assert_eq!(click_plan(&button, false, 1), [ClickStep::Events]);
        // A click in a text field focuses it; Return is never sent by a click.
        let mut field = info("AXTextField", None);
        field.actions = vec!["AXConfirm".into()];
        assert_eq!(
            click_plan(&field, false, 1),
            [ClickStep::Focus, ClickStep::Events]
        );
        let row = info("AXRow", None);
        assert_eq!(
            click_plan(&row, false, 1),
            [ClickStep::Select, ClickStep::Events]
        );
    }

    #[test]
    fn keys_map_to_accessibility_actions_where_equivalent() {
        use KeyStep::*;
        use KeyTarget::*;
        let mut field = info("AXTextField", None);
        field.actions = vec!["AXConfirm".into(), "AXCancel".into()];
        assert_eq!(
            key_plan("Enter", false, Some(&field)),
            [
                Perform(Element, "AXConfirm"),
                Perform(DefaultButton, "AXPress"),
                Events
            ]
        );
        assert_eq!(
            key_plan("Escape", false, Some(&field)),
            [
                Perform(Element, "AXCancel"),
                Perform(CancelButton, "AXPress"),
                Events
            ]
        );
        assert_eq!(
            key_plan("Enter", false, None),
            [Perform(DefaultButton, "AXPress"), Events]
        );
        assert_eq!(
            key_plan("Space", false, Some(&field)),
            [Insert(" "), Events]
        );
        assert_eq!(
            key_plan("Backspace", false, Some(&field)),
            [DeleteBackward, Events]
        );
        assert_eq!(
            key_plan("Delete", false, Some(&field)),
            [DeleteForward, Events]
        );
        let area = info("AXTextArea", None);
        assert_eq!(
            key_plan("Enter", false, Some(&area)),
            [Insert("\n"), Events]
        );
        let mut slider = info("AXSlider", None);
        slider.actions = vec!["AXIncrement".into(), "AXDecrement".into()];
        for (key, action) in [
            ("ArrowUp", "AXIncrement"),
            ("ArrowRight", "AXIncrement"),
            ("ArrowDown", "AXDecrement"),
            ("ArrowLeft", "AXDecrement"),
        ] {
            assert_eq!(
                key_plan(key, false, Some(&slider)),
                [Perform(Element, action), Events]
            );
        }
        // Arrows elsewhere move a caret or selection: real key events.
        assert_eq!(key_plan("ArrowDown", false, Some(&field)), [Events]);
        let mut checkbox = info("AXCheckBox", Some("Agree"));
        checkbox.actions = vec!["AXPress".into()];
        assert_eq!(
            key_plan("Space", false, Some(&checkbox)),
            [Perform(Element, "AXPress"), Events]
        );
        // Modifiers, Tab and letters keep the key-event path.
        assert_eq!(key_plan("Enter", true, Some(&field)), [Events]);
        assert_eq!(key_plan("a", false, Some(&field)), [Events]);
        assert_eq!(key_plan("Tab", false, Some(&field)), [Events]);
        // Secure fields are never edited by computing their (unread) value.
        let mut secure = info(SECURE_TEXT_FIELD, None);
        secure.actions = vec!["AXConfirm".into()];
        assert_eq!(key_plan("Backspace", false, Some(&secure)), [Events]);
    }

    #[test]
    fn secondary_actions_are_an_allow_list() {
        assert_eq!(secondary_action(None).unwrap(), "AXShowMenu");
        assert_eq!(secondary_action(Some("ShowMenu")).unwrap(), "AXShowMenu");
        assert_eq!(
            secondary_action(Some("AXIncrement")).unwrap(),
            "AXIncrement"
        );
        for name in ["AXRaise", "Raise", "AXFocused", "", "showmenu"] {
            assert!(secondary_action(Some(name)).is_err(), "{name}");
        }
    }

    #[test]
    fn scroll_amounts_are_bounded_pages() {
        let next = scrollbar_value(0.0, 100.0, 1100.0, 1, 1.0).unwrap();
        assert!((next - 0.09).abs() < 1e-9);
        assert_eq!(scrollbar_value(0.95, 100.0, 1100.0, 2, 1.0), Some(1.0));
        assert_eq!(scrollbar_value(0.05, 100.0, 1100.0, 1, -1.0), Some(0.0));
        assert_eq!(scrollbar_value(0.0, 100.0, 100.0, 1, 1.0), None);
        assert_eq!(scrollbar_value(f64::NAN, 100.0, 900.0, 1, 1.0), None);
        assert_eq!(event_delta(300.0, 1, ScrollDirection::Down), (0, 270));
        assert_eq!(event_delta(300.0, 1, ScrollDirection::Left), (-270, 0));
        assert_eq!(event_delta(5000.0, 10, ScrollDirection::Up), (0, -2000));
        assert_eq!(ScrollDirection::Right.page_action(), "AXScrollRightByPage");
    }

    #[test]
    fn text_edits_use_utf16_ranges_without_splitting_characters() {
        assert_eq!(
            splice_utf16("hello", 5, 0, " you"),
            Some(("hello you".into(), 9))
        );
        assert_eq!(splice_utf16("hello", 0, 5, "bye"), Some(("bye".into(), 3)));
        // 😀 is two UTF-16 units.
        assert_eq!(splice_utf16("a😀b", 3, 0, "!"), Some(("a😀!b".into(), 4)));
        assert_eq!(
            splice_utf16("a😀b", 2, 0, "!"),
            None,
            "inside a surrogate pair"
        );
        assert_eq!(splice_utf16("abc", 4, 0, "!"), None);
        assert_eq!(splice_utf16("abc", 2, 5, "!"), None);
        assert_eq!(char_range("a😀b", 3, true), Some((1, 2)));
        assert_eq!(char_range("a😀b", 1, false), Some((1, 2)));
        assert_eq!(char_range("ab", 0, true), None);
        assert_eq!(char_range("ab", 2, false), None);
        assert_eq!(find_utf16("😀 hello world", "world"), Some((9, 5)));
        assert_eq!(find_utf16("abc", ""), None);
        assert_eq!(find_utf16("abc", "z"), None);
    }

    #[test]
    fn engine_detection_and_switch_restore_bookkeeping() {
        let names = |list: &[&str]| list.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            engine_for(&names(&[
                "Electron Framework.framework",
                "Squirrel.framework"
            ])),
            Some(Engine::Electron)
        );
        assert_eq!(
            engine_for(&names(&["Google Chrome Framework.framework"])),
            Some(Engine::Chromium)
        );
        assert_eq!(engine_for(&names(&["Sparkle.framework"])), None);
        assert_eq!(Engine::Electron.attribute(), "AXManualAccessibility");
        assert_eq!(Engine::Chromium.attribute(), "AXEnhancedUserInterface");

        let mut flags = FlagRegistry::default();
        assert!(!flags.join("a", 10, "/Slack"));
        flags.record("a", 10, "AXManualAccessibility", Some(false), "/Slack");
        assert!(flags.join("b", 10, "/Slack"));
        // One chat ending keeps the switch for the other.
        assert!(flags.release(Some("a")).is_empty());
        assert!(flags.holds(10));
        assert_eq!(
            flags.release(Some("b")),
            [Restore {
                pid: 10,
                attribute: "AXManualAccessibility",
                executable: "/Slack".into()
            }]
        );
        assert!(!flags.holds(10));
        // A switch that was already on is left on.
        flags.record("a", 11, "AXEnhancedUserInterface", Some(true), "/Chrome");
        // An unknown previous value (attribute absent) is restored to off.
        flags.record("a", 12, "AXManualAccessibility", None, "/Notion");
        assert_eq!(
            flags
                .release(None)
                .iter()
                .map(|r| r.pid)
                .collect::<Vec<_>>(),
            [12]
        );
        // A reused PID never inherits or restores the old app's switch.
        flags.record("a", 13, "AXManualAccessibility", Some(false), "/Old");
        assert!(!flags.join("a", 13, "/New"));
        assert!(!flags.holds(13));
        assert!(flags.release(None).is_empty());
    }

    #[test]
    fn tips_match_known_bundles_only() {
        for bundle in [
            "com.tinyspeck.slackmacgap",
            "notion.id",
            "com.microsoft.VSCode",
            "com.google.Chrome",
            "com.apple.finder",
            "com.apple.mail",
            "com.apple.MobileSMS",
            "com.apple.Music",
            "com.spotify.client",
        ] {
            let tips = app_tips(Some(bundle)).unwrap();
            assert!(tips.starts_with("# ") && tips.len() < 2000, "{bundle}");
        }
        assert!(app_tips(Some("com.example.app")).is_none());
        assert!(app_tips(None).is_none());
    }
}
