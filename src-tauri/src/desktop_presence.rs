//! Agent presence for native desktop control: which chat is acting, the
//! user's Pause/Stop controls, per-app consent, and yielding to the user.
//!
//! All decisions live in the pure [`Presence`] state machine below so they can
//! be unit tested. The macOS bar and input monitor are thin adapters that only
//! render [`Presence::model`] and report user input; they never decide policy.
//! Nothing here ever stores typed text or key names: steps are derived from
//! the request's action alone.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use crate::desktop_control::Request;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::time::{Duration, Instant};

/// The bar fades this long after an agent's last action.
pub(crate) const IDLE_FADE: Duration = Duration::from_secs(4);
/// How long "Stopped" stays visible after the user stops an agent.
pub(crate) const STOP_NOTICE: Duration = Duration::from_millis(2500);
/// Genuine user input this soon after an agent action pauses agents.
pub(crate) const YIELD_WINDOW: Duration = Duration::from_millis(1500);
/// Shared-pointer control yields only to sustained use: a bump or a single
/// nudge of the mouse is ignored. The user must keep using the mouse or
/// keyboard for this long, with no gap longer than `SUSTAINED_GAP`.
pub(crate) const SUSTAINED_INPUT: Duration = Duration::from_secs(3);
pub(crate) const SUSTAINED_GAP: Duration = Duration::from_millis(500);
/// An unanswered consent prompt expires after this long.
pub(crate) const CONSENT_TIMEOUT: Duration = Duration::from_secs(90);
/// Two Escape presses this close together stop the acting agent.
pub(crate) const ESC_INTERVAL: Duration = Duration::from_millis(700);
/// Written to kCGEventSourceUserData on every event Aven posts ("AVEN").
pub(crate) const EVENT_MARKER: i64 = 0x4156_454E;

pub(crate) const PAUSED_BY_USER: &str = "Paused by the user. Wait, then retry.";
pub(crate) const PAUSED_USER_ACTIVE: &str =
    "Paused because the user is using their Mac. Wait, then retry.";
pub(crate) const STOPPED: &str = "The user stopped desktop control for this chat. Do not retry on your own; ask the user in the chat. If they agree, your next desktop action asks them for permission again.";
pub(crate) const NO_ANSWER: &str =
    "No answer from the user. Ask in the chat before trying again; do not retry in a loop.";
pub(crate) const CONSENT_BUSY: &str =
    "Aven is waiting for the user to answer another desktop request. Wait, then retry.";
pub(crate) const CANCELLED: &str =
    "The desktop request was cancelled before the user answered. Observe the desktop before retrying.";
pub(crate) const SCREEN_LOCKED: &str = "The Mac is locked. Desktop control is paused until the user unlocks; keep working in Aven's browser or code, or wait.";
pub(crate) const SESSION_AWAY: &str = "The user's Mac session is not on screen (another user may be signed in). Desktop control is paused until the user returns; keep working in Aven's browser or code, or wait.";
const TARGET_CHANGED: &str =
    "The target app changed while waiting for the user. Take a fresh screenshot and retry.";
const INTERRUPTED: &str =
    "The user interrupted this action. Take a fresh screenshot before retrying.";
const INTERRUPTED_SUFFIX: &str =
    " This action was interrupted; take a fresh screenshot before retrying.";

const FALLBACK_NAME: &str = "An agent";
const UNKNOWN_APP_NAME: &str = "your Mac";
const ANY_APP_KEY: &str = "*";
const RESUME_KEY: &str = "\u{0}resume";
const TITLE_LIMIT: usize = 60;
const APP_NAME_LIMIT: usize = 60;

/// Neutral for an unknown agent; near-white for monochrome provider marks.
const NEUTRAL: [f64; 3] = [0.62, 0.64, 0.68];
const MONOCHROME: [f64; 3] = [0.86, 0.86, 0.88];
const PAUSED_COLOR: [f64; 3] = [1.0, 0.70, 0.25];

/// Harness ID, short name, and the colour used for its provider mark in
/// src/assets/providers (Claude #D97757, the Codex gradient's middle stop
/// #7A9DFF, omp's violet stop). Marks drawn in currentColor are monochrome.
const PROVIDERS: &[(&str, &str, [f64; 3])] = &[
    ("claude", "Claude", [0.851, 0.467, 0.341]),
    ("codex", "Codex", [0.478, 0.616, 1.0]),
    ("cursor", "Cursor", MONOCHROME),
    ("grok", "Grok", MONOCHROME),
    ("opencode", "OpenCode", MONOCHROME),
    ("pi", "Pi", MONOCHROME),
    ("omp", "omp", [0.55, 0.37, 0.93]),
    ("fx", "fx", MONOCHROME),
];

/// Supplied by the frontend once per user turn when it binds a chat's scope.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ActorInput {
    #[serde(default)]
    pub harness: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

/// Who is acting: shown in the bar and (later) on the agent pointer.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Actor {
    /// Provider name, or "An agent".
    pub name: String,
    /// The chat's title, when known.
    pub title: Option<String>,
    /// sRGB components, 0 to 1.
    pub color: [f64; 3],
}

impl Actor {
    pub(crate) fn fallback() -> Self {
        Self {
            name: FALLBACK_NAME.into(),
            title: None,
            color: NEUTRAL,
        }
    }
}

/// Removes control and bidirectional-override characters, collapses
/// whitespace and truncates with an ellipsis. Empty input becomes None.
fn clean_label(value: &str, limit: usize) -> Option<String> {
    let words: Vec<&str> = value.split_whitespace().collect();
    let joined = words.join(" ");
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
    if cleaned.is_empty() {
        return None;
    }
    if cleaned.chars().count() <= limit {
        return Some(cleaned.to_owned());
    }
    let mut short: String = cleaned.chars().take(limit - 1).collect();
    short.truncate(short.trim_end().len());
    short.push('…');
    Some(short)
}

pub(crate) fn resolve_actor(input: &ActorInput) -> Actor {
    let provider = input.harness.as_deref().and_then(|harness| {
        PROVIDERS
            .iter()
            .find(|(id, _, _)| id.eq_ignore_ascii_case(harness.trim()))
    });
    let (name, color) =
        provider.map_or((FALLBACK_NAME, NEUTRAL), |(_, name, color)| (*name, *color));
    Actor {
        name: name.into(),
        title: input
            .title
            .as_deref()
            .and_then(|title| clean_label(title, TITLE_LIMIT)),
        color,
    }
}

/// A short live description of the current action. Derived only from the
/// action's kind: it never contains typed text, key names or coordinates.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Looking,
    Moving,
    Clicking,
    Typing,
    PressingKey,
    Scrolling,
    Dragging,
    SwitchingApps,
    SettingValue,
    SelectingText,
    OpeningMenu,
}

impl Step {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::Looking => "Looking at the screen",
            Self::Moving => "Moving the pointer",
            Self::Clicking => "Clicking",
            Self::Typing => "Typing",
            Self::PressingKey => "Pressing a key",
            Self::Scrolling => "Scrolling",
            Self::Dragging => "Dragging",
            Self::SwitchingApps => "Switching apps",
            Self::SettingValue => "Setting a value",
            Self::SelectingText => "Selecting text",
            Self::OpeningMenu => "Opening a menu",
        }
    }

    /// The bar's step text. `element` is an element's title (never its value
    /// or anything typed), already sanitised and bounded.
    pub(crate) fn describe(self, element: Option<&str>) -> String {
        let Some(element) = element.filter(|label| !label.is_empty()) else {
            return self.label().into();
        };
        match self {
            Self::Clicking => format!("Clicking \u{201c}{element}\u{201d}"),
            Self::Typing => format!("Typing in \u{201c}{element}\u{201d}"),
            Self::PressingKey => format!("Pressing a key in \u{201c}{element}\u{201d}"),
            Self::Scrolling => format!("Scrolling \u{201c}{element}\u{201d}"),
            Self::SettingValue => format!("Setting \u{201c}{element}\u{201d}"),
            Self::SelectingText => format!("Selecting text in \u{201c}{element}\u{201d}"),
            Self::OpeningMenu => format!("Opening the menu for \u{201c}{element}\u{201d}"),
            _ => self.label().into(),
        }
    }
}

pub(crate) fn step_for(request: &Request) -> Option<Step> {
    Some(match request {
        Request::Status {} => return None,
        Request::Windows {} | Request::Screenshot { .. } | Request::AppState { .. } => {
            Step::Looking
        }
        Request::Move { .. } => Step::Moving,
        Request::Click { .. } => Step::Clicking,
        Request::Type { .. } | Request::TypeText { .. } => Step::Typing,
        Request::Press { .. } | Request::PressKey { .. } => Step::PressingKey,
        Request::Scroll { .. } => Step::Scrolling,
        Request::Drag { .. } => Step::Dragging,
        Request::Activate { .. } => Step::SwitchingApps,
        Request::SetValue { .. } => Step::SettingValue,
        Request::SelectText { .. } => Step::SelectingText,
        Request::SecondaryAction { .. } => Step::OpeningMenu,
    })
}

/// Input changes the user's desktop (including focus); observation does not.
pub(crate) fn is_input(request: &Request) -> bool {
    step_for(request).is_some_and(|step| step != Step::Looking)
}

/// The app an input action would affect. `key` is a bundle ID when known.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AppIdentity {
    pub key: String,
    pub name: String,
}

impl AppIdentity {
    pub(crate) fn new(key: &str, name: &str) -> Self {
        let key = key.trim();
        Self {
            key: if key.is_empty() {
                ANY_APP_KEY.into()
            } else {
                key.chars().take(512).collect()
            },
            name: clean_label(name, APP_NAME_LIMIT).unwrap_or_else(|| UNKNOWN_APP_NAME.into()),
        }
    }

    fn any() -> Self {
        Self {
            key: ANY_APP_KEY.into(),
            name: UNKNOWN_APP_NAME.into(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Pause {
    ByUser,
    UserActive,
}

impl Pause {
    fn message(self) -> &'static str {
        match self {
            Self::ByUser => PAUSED_BY_USER,
            Self::UserActive => PAUSED_USER_ACTIVE,
        }
    }
}

/// The user's login session, as macOS reports it. Desktop control observes
/// and acts only while it is `Active`: on the console and unlocked.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Session {
    #[default]
    Active,
    /// The screen is locked: keys could reach the login window's password field.
    Locked,
    /// Another user's session is on screen, or no GUI session could be read.
    Away,
}

impl Session {
    /// Interprets CGSessionCopyCurrentDictionary: whether it returned a
    /// dictionary, kCGSessionOnConsoleKey and "CGSSessionScreenIsLocked".
    /// Anything unreadable fails closed.
    pub(crate) fn from_dictionary(
        present: bool,
        on_console: Option<bool>,
        screen_locked: Option<bool>,
    ) -> Self {
        if !present || on_console != Some(true) {
            Self::Away
        } else if screen_locked == Some(true) {
            Self::Locked
        } else {
            Self::Active
        }
    }

    pub(crate) fn refusal(self) -> Option<&'static str> {
        match self {
            Self::Active => None,
            Self::Locked => Some(SCREEN_LOCKED),
            Self::Away => Some(SESSION_AWAY),
        }
    }
}

/// A lock reported by the screen-lock notification. CoreGraphics can lag
/// behind it, so a read that still says `Active` must not undo it.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum LockLatch {
    #[default]
    Clear,
    /// Notified; no read has shown the session unavailable yet.
    Notified,
    /// Notified, and a later read showed it unavailable: a read of `Active`
    /// after this is a real unlock (even if its notification never arrives).
    Observed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PromptKind {
    App(AppIdentity),
    /// A stopped chat wants to observe or act again.
    Resume,
}

impl PromptKind {
    fn key(&self) -> &str {
        match self {
            Self::App(app) => &app.key,
            Self::Resume => RESUME_KEY,
        }
    }

    fn declined(&self) -> String {
        match self {
            Self::App(app) => format!(
                "The user declined desktop control of {}. Do not retry; ask the user in the chat.",
                app.name
            ),
            Self::Resume => "The user declined to let this chat use their Mac again. Do not retry; ask the user in the chat.".into(),
        }
    }
}

struct Prompt {
    id: u64,
    scope: String,
    kind: PromptKind,
    deadline: Instant,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Outcome {
    Allowed,
    Declined(String),
    NoAnswer,
    Cancelled,
    /// The Mac locked (or left the console) while the prompt was open.
    Unavailable(&'static str),
}

impl Outcome {
    fn into_result(self) -> Result<(), String> {
        match self {
            Self::Allowed => Ok(()),
            Self::Declined(message) => Err(message),
            Self::NoAnswer => Err(NO_ANSWER.into()),
            Self::Cancelled => Err(CANCELLED.into()),
            Self::Unavailable(message) => Err(message.into()),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Admission {
    Go,
    /// Wait for this prompt's answer, then admit the request again.
    Ask(u64),
    Refuse(String),
}

struct Activity {
    scope: String,
    app: Option<String>,
    step: Step,
    /// The target element's title for element actions.
    element: Option<String>,
    input: bool,
    shared_input: bool,
    target_pid: Option<i32>,
    in_flight: bool,
    last: Instant,
    stopped: bool,
}

/// Held by one admitted action. Input checks it before every native event.
#[derive(Clone, Debug)]
pub(crate) struct Ticket {
    scope: String,
    epoch: u64,
    input: bool,
}

impl Ticket {
    #[cfg(test)]
    fn for_test(scope: &str, input: bool) -> Self {
        Self {
            scope: scope.into(),
            epoch: 0,
            input,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum UserEvent {
    Pointer,
    Key,
    Escape,
}

/// Classifies one CoreGraphics event from the listen tap. Events carrying
/// Aven's marker, or posted by this process, are never user input.
pub(crate) fn classify(
    kind: u32,
    user_data: i64,
    source_pid: i64,
    own_pid: i64,
    key_code: i64,
    autorepeat: bool,
) -> Option<UserEvent> {
    if user_data == EVENT_MARKER || (own_pid > 0 && source_pid == own_pid) {
        return None;
    }
    match kind {
        // Mouse down/up/moved/dragged for left, right and other buttons, and
        // scroll wheel (kCGEventLeftMouseDown..kCGEventRightMouseDragged = 1-7,
        // kCGEventScrollWheel = 22, kCGEventOtherMouse* = 25-27).
        1..=7 | 22 | 25..=27 => Some(UserEvent::Pointer),
        // kCGEventKeyDown; 53 is the Escape virtual key code.
        10 if key_code == 53 && !autorepeat => Some(UserEvent::Escape),
        10 => Some(UserEvent::Key),
        // kCGEventFlagsChanged (modifier keys).
        12 => Some(UserEvent::Key),
        _ => None,
    }
}

/// Detects Escape pressed twice within [`ESC_INTERVAL`].
#[derive(Default)]
pub(crate) struct EscDetector {
    last: Option<Instant>,
}

impl EscDetector {
    pub(crate) fn press(&mut self, now: Instant) -> bool {
        match self.last {
            Some(last) if now.saturating_duration_since(last) <= ESC_INTERVAL => {
                self.last = None;
                true
            }
            _ => {
                self.last = Some(now);
                false
            }
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum InputEffect {
    None,
    Paused,
    Stopped(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BarKind {
    Acting,
    Paused,
    Consent,
    Stopped,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ButtonAction {
    Pause,
    Resume,
    Stop(String),
    Allow(u64),
    Deny(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ButtonStyle {
    Plain,
    Prominent,
    Destructive,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct BarButton {
    pub label: &'static str,
    pub action: ButtonAction,
    pub style: ButtonStyle,
}

/// Everything the native bar draws. Built from state; never from input text.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct BarModel {
    pub kind: BarKind,
    pub color: [f64; 3],
    pub title: String,
    pub detail: String,
    /// Left to right.
    pub buttons: Vec<BarButton>,
}

#[derive(Default)]
pub(crate) struct Presence {
    actors: HashMap<String, Actor>,
    allowed: HashMap<String, HashSet<String>>,
    /// Declined apps per chat, until the user's next message in that chat.
    denied: HashMap<String, HashSet<String>>,
    stopped: HashSet<String>,
    paused: Option<Pause>,
    activity: Option<Activity>,
    prompt: Option<Prompt>,
    resolved: HashMap<u64, Outcome>,
    next_prompt: u64,
    epoch: u64,
    esc: EscDetector,
    session: Session,
    lock: LockLatch,
    /// Start and latest event of the user's current run of input.
    user_run: Option<(Instant, Instant)>,
}

impl Presence {
    /// `actor` is supplied once per user turn. A new turn also clears that
    /// chat's earlier refusals, so the user can change their mind in chat.
    pub(crate) fn bind(&mut self, scope: &str, actor: Option<Actor>) {
        if let Some(actor) = actor {
            self.actors.insert(scope.into(), actor);
            self.denied.remove(scope);
        }
    }

    /// Ends a chat's scope (unbind, window close), or all scopes with None.
    pub(crate) fn forget(&mut self, scope: Option<&str>) {
        let matches = |id: &str| scope.is_none_or(|scope| scope == id);
        self.actors.retain(|id, _| !matches(id));
        self.allowed.retain(|id, _| !matches(id));
        self.denied.retain(|id, _| !matches(id));
        self.stopped.retain(|id| !matches(id));
        if self
            .prompt
            .as_ref()
            .is_some_and(|prompt| matches(&prompt.scope))
        {
            if let Some(prompt) = self.prompt.take() {
                self.resolved.insert(prompt.id, Outcome::Cancelled);
            }
        }
        if self
            .activity
            .as_ref()
            .is_some_and(|activity| matches(&activity.scope))
        {
            self.activity = None;
            if self.paused == Some(Pause::UserActive) {
                self.paused = None;
            }
        }
        if scope.is_none() {
            self.paused = None;
            self.epoch = self.epoch.wrapping_add(1);
        }
    }

    pub(crate) fn actor(&self, scope: &str) -> Actor {
        self.actors
            .get(scope)
            .cloned()
            .unwrap_or_else(Actor::fallback)
    }

    /// Decides whether a request may run now. `ask` is the Settings toggle;
    /// `may_prompt` is false on the re-admission after an answer, so one
    /// request never shows more than one prompt.
    pub(crate) fn admit(
        &mut self,
        scope: &str,
        input: bool,
        app: Option<&AppIdentity>,
        ask: bool,
        may_prompt: bool,
        now: Instant,
    ) -> Admission {
        // Nobody can answer a prompt at the lock screen, and observation would
        // only capture it: refuse before any prompt, bar or native call.
        if let Some(refusal) = self.session.refusal() {
            return Admission::Refuse(refusal.into());
        }
        if input && self.prompt.is_some() {
            return Admission::Refuse(CONSENT_BUSY.into());
        }
        if input {
            if let Some(pause) = self.paused {
                return Admission::Refuse(pause.message().into());
            }
        }
        let stopped = self.stopped.contains(scope);
        let kind = if input && ask {
            let app = app.cloned().unwrap_or_else(AppIdentity::any);
            // Every approval, including the shared pointer and bringing an
            // app forward, lasts for this chat until the user stops it.
            if !stopped
                && self
                    .allowed
                    .get(scope)
                    .is_some_and(|allowed| allowed.contains(&app.key))
            {
                return Admission::Go;
            }
            PromptKind::App(app)
        } else if stopped {
            PromptKind::Resume
        } else {
            return Admission::Go;
        };
        if self
            .denied
            .get(scope)
            .is_some_and(|denied| denied.contains(kind.key()))
        {
            return Admission::Refuse(kind.declined());
        }
        if !may_prompt {
            return Admission::Refuse(TARGET_CHANGED.into());
        }
        if self.prompt.is_some() {
            return Admission::Refuse(CONSENT_BUSY.into());
        }
        self.next_prompt = self.next_prompt.wrapping_add(1);
        let id = self.next_prompt;
        self.prompt = Some(Prompt {
            id,
            scope: scope.into(),
            kind,
            deadline: now + CONSENT_TIMEOUT,
        });
        Admission::Ask(id)
    }

    /// Applies the user's answer to one prompt. Stale IDs are ignored.
    pub(crate) fn answer(&mut self, id: u64, allow: bool) -> bool {
        if self.prompt.as_ref().is_none_or(|prompt| prompt.id != id) {
            return false;
        }
        let Some(prompt) = self.prompt.take() else {
            return false;
        };
        let outcome = if allow {
            self.stopped.remove(&prompt.scope);
            if let PromptKind::App(app) = &prompt.kind {
                self.allowed
                    .entry(prompt.scope.clone())
                    .or_default()
                    .insert(app.key.clone());
            }
            Outcome::Allowed
        } else {
            self.denied
                .entry(prompt.scope.clone())
                .or_default()
                .insert(prompt.kind.key().into());
            Outcome::Declined(prompt.kind.declined())
        };
        self.resolved.insert(id, outcome);
        true
    }

    /// The waiter's view of its prompt: None while it is still open.
    pub(crate) fn take_outcome(&mut self, id: u64, now: Instant) -> Option<Outcome> {
        if let Some(outcome) = self.resolved.remove(&id) {
            return Some(outcome);
        }
        match &self.prompt {
            Some(prompt) if prompt.id == id && now < prompt.deadline => None,
            Some(prompt) if prompt.id == id => {
                self.prompt = None;
                Some(Outcome::NoAnswer)
            }
            _ => Some(Outcome::Cancelled),
        }
    }

    /// Withdraws a prompt whose requester has gone away.
    pub(crate) fn withdraw(&mut self, id: u64) {
        if self.prompt.as_ref().is_some_and(|prompt| prompt.id == id) {
            self.prompt = None;
        }
        self.resolved.remove(&id);
    }

    pub(crate) fn begin(
        &mut self,
        scope: &str,
        step: Step,
        app: Option<String>,
        now: Instant,
    ) -> Ticket {
        let app = app.or_else(|| {
            self.activity
                .as_ref()
                .filter(|activity| activity.scope == scope)
                .and_then(|activity| activity.app.clone())
        });
        let input = step != Step::Looking;
        if step == Step::Looking && self.paused.is_some() {
            return Ticket {
                scope: scope.into(),
                epoch: self.epoch,
                input: false,
            };
        }
        self.activity = Some(Activity {
            scope: scope.into(),
            app,
            step,
            element: None,
            input,
            shared_input: true,
            target_pid: None,
            in_flight: true,
            last: now,
            stopped: false,
        });
        Ticket {
            scope: scope.into(),
            epoch: self.epoch,
            input,
        }
    }

    pub(crate) fn set_delivery(&mut self, ticket: &Ticket, shared: bool, pid: Option<i32>) {
        if let Some(activity) = self
            .activity
            .as_mut()
            .filter(|activity| activity.scope == ticket.scope)
        {
            activity.shared_input = shared;
            activity.target_pid = pid;
        }
    }

    /// Publishes the element an action targets. Only its title is shown.
    pub(crate) fn set_element(&mut self, ticket: &Ticket, element: Option<String>) {
        if let Some(activity) = self
            .activity
            .as_mut()
            .filter(|activity| activity.scope == ticket.scope)
        {
            activity.element = element;
        }
    }

    /// Whether this chat may already use an app without asking: it allowed
    /// that app and has not been stopped since. Never prompts.
    pub(crate) fn has_app_consent(&self, scope: &str, key: &str) -> bool {
        !self.stopped.contains(scope)
            && self
                .allowed
                .get(scope)
                .is_some_and(|allowed| allowed.contains(key))
    }

    /// Whether changes to apps on this chat's behalf are held: desktop
    /// control is paused, the chat was stopped, or the session is not
    /// active. Observation still runs; it just changes nothing.
    pub(crate) fn changes_held(&self, scope: &str) -> bool {
        self.paused.is_some() || self.stopped.contains(scope) || self.session != Session::Active
    }

    pub(crate) fn forget_approval(&mut self, scope: &str, key: &str) {
        if let Some(allowed) = self.allowed.get_mut(scope) {
            allowed.remove(key);
        }
    }

    pub(crate) fn end(&mut self, ticket: &Ticket, now: Instant) {
        if let Some(activity) = self.activity.as_mut() {
            if activity.scope == ticket.scope && !activity.stopped {
                activity.in_flight = false;
                activity.last = now;
            }
        }
    }

    /// Records the login session. Leaving `Active` interrupts in-flight
    /// actions at their next check (drags release their button on that error
    /// path), cancels an open prompt and hides the bar. Returns whether the
    /// session changed.
    pub(crate) fn set_session(&mut self, session: Session) -> bool {
        if self.session == session {
            return false;
        }
        let was_active = self.session == Session::Active;
        self.session = session;
        if let (true, Some(refusal)) = (was_active, session.refusal()) {
            self.epoch = self.epoch.wrapping_add(1);
            if let Some(prompt) = self.prompt.take() {
                self.resolved
                    .insert(prompt.id, Outcome::Unavailable(refusal));
            }
        }
        true
    }

    /// The session as recorded, after any lock notification.
    pub(crate) fn session(&self) -> Session {
        self.session
    }

    /// Records a CoreGraphics session read. After a lock notification, a
    /// read of `Active` is stale until a read has shown the session
    /// unavailable (or the unlock notification arrives): only unavailable
    /// states are recorded over the notified lock. Returns whether the
    /// recorded session changed.
    pub(crate) fn observe_session(&mut self, read: Session) -> bool {
        match (self.lock, read) {
            (LockLatch::Clear, read) => self.set_session(read),
            (LockLatch::Notified, Session::Active) => false,
            (LockLatch::Observed, Session::Active) => {
                self.lock = LockLatch::Clear;
                self.set_session(Session::Active)
            }
            (_, unavailable) => {
                self.lock = LockLatch::Observed;
                self.set_session(unavailable)
            }
        }
    }

    /// The screen-lock notification, with a session read taken at the same
    /// time. It records a lock even when that read has not caught up.
    pub(crate) fn notify_locked(&mut self, read: Session) -> bool {
        if read == Session::Active {
            self.lock = LockLatch::Notified;
            self.set_session(Session::Locked)
        } else {
            self.lock = LockLatch::Observed;
            self.set_session(read)
        }
    }

    /// The screen-unlock notification ends a notified lock; the read taken
    /// with it is recorded as is (a later read corrects a lagging one).
    pub(crate) fn notify_unlocked(&mut self, read: Session) -> bool {
        self.lock = LockLatch::Clear;
        self.set_session(read)
    }

    /// Called before every native event of an admitted action.
    pub(crate) fn check(&self, ticket: &Ticket) -> Result<(), String> {
        if let Some(refusal) = self.session.refusal() {
            return Err(if ticket.input {
                format!("{refusal}{INTERRUPTED_SUFFIX}")
            } else {
                refusal.into()
            });
        }
        if self.stopped.contains(&ticket.scope) {
            return Err(STOPPED.into());
        }
        if !ticket.input {
            return Ok(());
        }
        if let Some(pause) = self.paused {
            return Err(format!("{}{INTERRUPTED_SUFFIX}", pause.message()));
        }
        if self.epoch != ticket.epoch {
            return Err(INTERRUPTED.into());
        }
        Ok(())
    }

    pub(crate) fn pause(&mut self, reason: Pause) {
        if self.paused.is_none() {
            self.paused = Some(reason);
            self.epoch = self.epoch.wrapping_add(1);
        }
    }

    pub(crate) fn resume(&mut self) {
        self.paused = None;
    }

    /// Revokes a chat's desktop control (input and observation) until the
    /// user allows it again through a prompt. In-flight input stops at its
    /// next check; drags release their button on that error path.
    pub(crate) fn stop(&mut self, scope: &str, now: Instant) {
        self.stopped.insert(scope.into());
        self.allowed.remove(scope);
        self.epoch = self.epoch.wrapping_add(1);
        // A pause caused by the user's own activity existed only to yield to
        // them; the agent it held back is now stopped. A manual pause stays.
        if self.paused == Some(Pause::UserActive) {
            self.paused = None;
        }
        if self
            .prompt
            .as_ref()
            .is_some_and(|prompt| prompt.scope == scope)
        {
            if let Some(prompt) = self.prompt.take() {
                self.resolved
                    .insert(prompt.id, Outcome::Declined(STOPPED.into()));
            }
        }
        if let Some(activity) = self.activity.as_mut() {
            if activity.scope == scope {
                activity.stopped = true;
                activity.in_flight = false;
                activity.last = now;
            }
        }
    }

    fn acting_recently(&self, now: Instant) -> bool {
        self.activity.as_ref().is_some_and(|activity| {
            !activity.stopped
                && (activity.in_flight || now.saturating_duration_since(activity.last) < IDLE_FADE)
        })
    }

    /// Genuine user input reported by the listen tap.
    #[cfg(test)]
    fn user_input(&mut self, event: UserEvent, now: Instant) -> InputEffect {
        self.user_input_in_app(event, now, None)
    }

    pub(crate) fn user_input_in_app(
        &mut self,
        event: UserEvent,
        now: Instant,
        frontmost_pid: Option<i32>,
    ) -> InputEffect {
        // Typing at the lock screen is not working alongside an agent.
        if self.session != Session::Active {
            return InputEffect::None;
        }
        if event == UserEvent::Escape && (self.acting_recently(now) || self.paused.is_some()) {
            if let Some(scope) = self
                .activity
                .as_ref()
                .filter(|activity| !activity.stopped)
                .map(|activity| activity.scope.clone())
            {
                if self.esc.press(now) {
                    self.stop(&scope, now);
                    return InputEffect::Stopped(scope);
                }
            }
        }
        if self.prompt.is_some() || self.paused.is_some() {
            return InputEffect::None;
        }
        // Once the user has allowed an agent, only the bar's Pause/Stop (or Esc
        // twice) stops it. App-directed and element input never touch the
        // user's pointer or keyboard, so the user's own clicks and typing, even
        // in the same app, must not pause it. Only shared-pointer input, where
        // both would steer one cursor, yields to the user.
        let _ = frontmost_pid;
        // A run of user input continues while events keep arriving within
        // SUSTAINED_GAP of each other.
        let started = match self.user_run {
            Some((start, last)) if now.saturating_duration_since(last) <= SUSTAINED_GAP => start,
            _ => now,
        };
        self.user_run = Some((started, now));
        let sustained = now.saturating_duration_since(started) >= SUSTAINED_INPUT;
        let yield_now = sustained
            && self.activity.as_ref().is_some_and(|activity| {
                !activity.stopped
                    && activity.input
                    && activity.shared_input
                    && (activity.in_flight
                        || now.saturating_duration_since(activity.last) <= YIELD_WINDOW)
            });
        if yield_now {
            self.pause(Pause::UserActive);
            return InputEffect::Paused;
        }
        InputEffect::None
    }

    pub(crate) fn model(&self, now: Instant) -> Option<BarModel> {
        // Never draw over the lock screen or another user's session.
        if self.session != Session::Active {
            return None;
        }
        if let Some(prompt) = &self.prompt {
            let actor = self.actor(&prompt.scope);
            let shared = matches!(&prompt.kind,PromptKind::App(app) if app.key.starts_with("pointer:") || app.key.starts_with("focus:"));
            let title = match &prompt.kind {
                PromptKind::App(app) => format!("{} wants to use {}", actor.name, app.name),
                PromptKind::Resume => format!("{} wants to use your Mac again", actor.name),
            };
            return Some(BarModel {
                kind: BarKind::Consent,
                color: actor.color,
                title,
                detail: if shared {
                    if matches!(&prompt.kind,PromptKind::App(app) if app.key.starts_with("focus:"))
                    {
                        "Brings this app forward · For this chat".into()
                    } else {
                        "Your mouse and keyboard · For this chat".into()
                    }
                } else {
                    actor.title.map_or_else(
                        || "For this chat".into(),
                        |title| format!("For this chat · {title}"),
                    )
                },
                buttons: vec![
                    BarButton {
                        label: "Don\u{2019}t Allow",
                        action: ButtonAction::Deny(prompt.id),
                        style: ButtonStyle::Plain,
                    },
                    BarButton {
                        label: "Allow for chat",
                        action: ButtonAction::Allow(prompt.id),
                        style: ButtonStyle::Prominent,
                    },
                ],
            });
        }
        if let Some(activity) = self.activity.as_ref().filter(|activity| {
            activity.stopped && now.saturating_duration_since(activity.last) < STOP_NOTICE
        }) {
            let actor = self.actor(&activity.scope);
            return Some(BarModel {
                kind: BarKind::Stopped,
                color: actor.color,
                title: format!("Stopped {}", actor.name),
                detail: "It can\u{2019}t use your Mac until you allow it again".into(),
                buttons: vec![],
            });
        }
        let current = self.activity.as_ref().filter(|activity| !activity.stopped);
        if let Some(pause) = self.paused {
            let actor = current.map(|activity| self.actor(&activity.scope));
            let name = actor.as_ref().map_or(FALLBACK_NAME, |actor| &actor.name);
            let (title, detail) = match pause {
                Pause::UserActive => (
                    "Paused \u{2014} you\u{2019}re using your Mac".to_owned(),
                    format!("{name} will wait until you resume"),
                ),
                Pause::ByUser => ("Paused".to_owned(), format!("{name} is waiting")),
            };
            let mut buttons = vec![BarButton {
                label: "Resume",
                action: ButtonAction::Resume,
                style: ButtonStyle::Prominent,
            }];
            if let Some(activity) = current {
                buttons.push(BarButton {
                    label: "Stop",
                    action: ButtonAction::Stop(activity.scope.clone()),
                    style: ButtonStyle::Destructive,
                });
            }
            return Some(BarModel {
                kind: BarKind::Paused,
                color: PAUSED_COLOR,
                title,
                detail,
                buttons,
            });
        }
        let activity = current.filter(|activity| {
            activity.in_flight || now.saturating_duration_since(activity.last) < IDLE_FADE
        })?;
        let actor = self.actor(&activity.scope);
        let app = activity.app.as_deref().unwrap_or(UNKNOWN_APP_NAME);
        Some(BarModel {
            kind: BarKind::Acting,
            color: actor.color,
            title: format!("{} is using {app}", actor.name),
            detail: {
                let step = activity.step.describe(activity.element.as_deref());
                match &actor.title {
                    Some(title) => format!("{step} \u{b7} {title}"),
                    None => step,
                }
            },
            buttons: vec![
                BarButton {
                    label: "Pause",
                    action: ButtonAction::Pause,
                    style: ButtonStyle::Plain,
                },
                BarButton {
                    label: "Stop",
                    action: ButtonAction::Stop(activity.scope.clone()),
                    style: ButtonStyle::Destructive,
                },
            ],
        })
    }

    /// When the model next changes without any event (fade, notice, expiry).
    pub(crate) fn next_refresh(&self, now: Instant) -> Option<Duration> {
        let mut due = Vec::new();
        if let Some(prompt) = &self.prompt {
            due.push(prompt.deadline);
        }
        if let Some(activity) = &self.activity {
            if activity.stopped {
                due.push(activity.last + STOP_NOTICE);
            } else if !activity.in_flight && self.paused.is_none() {
                due.push(activity.last + IDLE_FADE);
            }
        }
        due.into_iter()
            .filter(|when| *when > now)
            .min()
            .map(|when| when - now)
    }

    #[cfg(test)]
    fn prompt_id(&self) -> Option<u64> {
        self.prompt.as_ref().map(|prompt| prompt.id)
    }
}

/// Places the bar inside a screen's visible area (top-left coordinates):
/// top-centre by default, or bottom-centre when `prefer_bottom` is set or
/// the top position would cover a point the agent is about to use. None when
/// neither position keeps every point clear.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Frame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub(crate) const BAR_MARGIN: f64 = 10.0;
/// Points this close to the bar count as on it.
pub(crate) const BAR_CLEARANCE: f64 = 8.0;

impl Frame {
    pub(crate) fn covers(&self, point: (f64, f64)) -> bool {
        point.0 >= self.x - BAR_CLEARANCE
            && point.0 < self.x + self.width + BAR_CLEARANCE
            && point.1 >= self.y - BAR_CLEARANCE
            && point.1 < self.y + self.height + BAR_CLEARANCE
    }
}

pub(crate) fn place_bar(
    visible: Frame,
    width: f64,
    height: f64,
    prefer_bottom: bool,
    avoid: &[(f64, f64)],
) -> Option<(Frame, bool)> {
    let width = width.min((visible.width - BAR_MARGIN * 2.0).max(1.0));
    let x = (visible.x + (visible.width - width) / 2.0).round();
    let top = Frame {
        x,
        y: (visible.y + BAR_MARGIN).round(),
        width,
        height,
    };
    let bottom = Frame {
        y: (visible.y + visible.height - BAR_MARGIN - height).round(),
        ..top
    };
    let clear = |frame: &Frame| !avoid.iter().any(|point| frame.covers(*point));
    let order = if prefer_bottom {
        [(bottom, true), (top, false)]
    } else {
        [(top, false), (bottom, true)]
    };
    order.into_iter().find(|(frame, _)| clear(frame))
}

static STATE: OnceLock<Mutex<Presence>> = OnceLock::new();
static CHANGED: Condvar = Condvar::new();

fn lock() -> MutexGuard<'static, Presence> {
    STATE
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// Mutates shared presence state and wakes any consent waiter.
pub(crate) fn with<T>(operation: impl FnOnce(&mut Presence) -> T) -> T {
    let result = operation(&mut lock());
    CHANGED.notify_all();
    result
}

/// Blocks a socket worker (never the main thread) until the user answers,
/// the prompt expires, or `alive` reports that the chat's scope has ended.
/// `alive` may read the login session from CoreGraphics, so it runs without
/// the presence lock held; an answer that arrives meanwhile still wins.
pub(crate) fn wait_for_answer(id: u64, alive: impl Fn() -> bool) -> Result<(), String> {
    loop {
        let alive = alive();
        let mut state = lock();
        let now = Instant::now();
        if let Some(outcome) = state.take_outcome(id, now) {
            drop(state);
            CHANGED.notify_all();
            return outcome.into_result();
        }
        if !alive {
            state.withdraw(id);
            drop(state);
            CHANGED.notify_all();
            return Err(CANCELLED.into());
        }
        let remaining = state.prompt.as_ref().map_or(Duration::ZERO, |prompt| {
            prompt.deadline.saturating_duration_since(now)
        });
        let (state, _) = CHANGED
            .wait_timeout(state, remaining.min(Duration::from_millis(250)))
            .unwrap_or_else(|error| error.into_inner());
        drop(state);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn actor(harness: &str, title: Option<&str>) -> Actor {
        resolve_actor(&ActorInput {
            harness: Some(harness.into()),
            title: title.map(Into::into),
        })
    }

    fn safari() -> AppIdentity {
        AppIdentity::new("com.apple.Safari", "Safari")
    }

    fn request(value: serde_json::Value) -> Request {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn actors_resolve_provider_names_colours_and_fallback() {
        let claude = actor("claude", Some("  Fix the\nlogin   form "));
        assert_eq!(claude.name, "Claude");
        assert_eq!(claude.title.as_deref(), Some("Fix the login form"));
        assert_eq!(claude.color, [0.851, 0.467, 0.341]);
        assert_eq!(actor("Codex", None).name, "Codex");
        for (id, name) in [
            ("grok", "Grok"),
            ("pi", "Pi"),
            ("opencode", "OpenCode"),
            ("cursor", "Cursor"),
        ] {
            assert_eq!(actor(id, None).name, name);
        }
        for input in [
            ActorInput::default(),
            ActorInput {
                harness: Some("unknown-harness".into()),
                title: Some("\u{202e}\u{200b}  ".into()),
            },
        ] {
            let resolved = resolve_actor(&input);
            assert_eq!(resolved.name, "An agent");
            assert_eq!(resolved.title, None);
            assert_eq!(resolved.color, NEUTRAL);
        }
        assert_eq!(Presence::default().actor("missing"), Actor::fallback());
        let long = actor("pi", Some(&"word ".repeat(40))).title.unwrap();
        assert!(long.chars().count() <= TITLE_LIMIT && long.ends_with('…'));
        assert!(
            serde_json::from_value::<ActorInput>(json!({"harness":"claude","extra":1})).is_err()
        );
        assert!(
            serde_json::from_value::<ActorInput>(json!({"harness":"claude","title":"T"})).is_ok()
        );
    }

    #[test]
    fn bound_actor_is_shown_and_cleared_when_the_scope_ends() {
        let mut presence = Presence::default();
        presence.bind("chat", Some(actor("claude", Some("Plan trip"))));
        // A refresh without an actor keeps the previous one.
        presence.bind("chat", None);
        let now = Instant::now();
        presence.begin("chat", Step::Clicking, Some("Safari".into()), now);
        let model = presence.model(now).unwrap();
        assert_eq!(model.title, "Claude is using Safari");
        assert_eq!(model.detail, "Clicking \u{b7} Plan trip");
        presence.forget(Some("chat"));
        assert_eq!(presence.actor("chat"), Actor::fallback());
        assert!(presence.model(now).is_none());
    }

    #[test]
    fn step_labels_come_from_the_action_and_never_contain_typed_text_or_keys() {
        let secret = "hunter2 SECRET-é";
        let cases = [
            (json!({"action":"type","text":secret}), "Typing"),
            (
                json!({"action":"press","key":"K","modifiers":["cmd"]}),
                "Pressing a key",
            ),
            (json!({"action":"click","x":1,"y":2}), "Clicking"),
            (
                json!({"action":"scroll","x":1,"y":2,"deltaY":3}),
                "Scrolling",
            ),
            (
                json!({"action":"drag","from":{"x":1,"y":2},"to":{"x":3,"y":4}}),
                "Dragging",
            ),
            (json!({"action":"move","x":1,"y":2}), "Moving the pointer"),
            (json!({"action":"screenshot"}), "Looking at the screen"),
            (json!({"action":"windows"}), "Looking at the screen"),
            (
                json!({"action":"activate","app":"Safari"}),
                "Switching apps",
            ),
        ];
        for (value, label) in cases {
            let request = request(value);
            let step = step_for(&request).unwrap();
            assert_eq!(step.label(), label);
            let mut presence = Presence::default();
            presence.bind("chat", Some(actor("claude", Some("Notes"))));
            let now = Instant::now();
            presence.begin("chat", step, Some("TextEdit".into()), now);
            let model = presence.model(now).unwrap();
            for text in [&model.title, &model.detail] {
                assert!(!text.contains("hunter2") && !text.contains("SECRET"));
                assert!(!text.contains(" K") && !text.contains("cmd"));
            }
        }
        assert!(step_for(&request(json!({"action":"status"}))).is_none());
        assert!(!is_input(&request(
            json!({"action":"appState","windowId":3})
        )));
        for value in [
            json!({"action":"click","windowId":3,"element":1}),
            json!({"action":"typeText","windowId":3,"text":secret}),
            json!({"action":"pressKey","windowId":3,"key":"Enter"}),
            json!({"action":"setValue","windowId":3,"element":1,"value":secret}),
            json!({"action":"selectText","windowId":3,"element":1,"text":secret}),
            json!({"action":"secondaryAction","windowId":3,"element":1}),
            json!({"action":"scroll","windowId":3,"element":1,"direction":"down"}),
        ] {
            assert!(is_input(&request(value.clone())), "{value}");
        }
        assert!(!is_input(&request(json!({"action":"screenshot"}))));
        assert!(!is_input(&request(json!({"action":"windows"}))));
        assert!(is_input(&request(json!({"action":"activate","pid":4}))));
        assert!(is_input(&request(json!({"action":"type","text":"x"}))));
    }

    #[test]
    fn consent_allow_is_remembered_per_chat_and_app() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let id = match presence.admit("chat", true, Some(&safari()), true, true, now) {
            Admission::Ask(id) => id,
            other => panic!("{other:?}"),
        };
        let model = presence.model(now).unwrap();
        assert_eq!(model.kind, BarKind::Consent);
        assert_eq!(model.title, "An agent wants to use Safari");
        assert_eq!(model.buttons[1].action, ButtonAction::Allow(id));
        assert!(presence.take_outcome(id, now).is_none());
        assert!(!presence.answer(id + 1, true), "stale answers are ignored");
        assert!(presence.answer(id, true));
        assert_eq!(presence.take_outcome(id, now), Some(Outcome::Allowed));
        assert_eq!(
            presence.admit("chat", true, Some(&safari()), true, false, now),
            Admission::Go
        );
        // Another app, and another chat, each need their own answer.
        let notes = AppIdentity::new("com.apple.Notes", "Notes");
        assert!(matches!(
            presence.admit("chat", true, Some(&notes), true, true, now),
            Admission::Ask(_)
        ));
        presence.prompt = None;
        assert!(matches!(
            presence.admit("other", true, Some(&safari()), true, true, now),
            Admission::Ask(_)
        ));
    }

    #[test]
    fn consent_decline_timeout_and_busy_prompt_return_clear_errors() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let Admission::Ask(id) = presence.admit("chat", true, Some(&safari()), true, true, now)
        else {
            panic!()
        };
        assert_eq!(
            presence.admit("other", true, Some(&safari()), true, true, now),
            Admission::Refuse(CONSENT_BUSY.into())
        );
        assert!(presence.answer(id, false));
        let Some(Outcome::Declined(message)) = presence.take_outcome(id, now) else {
            panic!()
        };
        assert!(message.starts_with("The user declined desktop control of Safari."));
        // Repeated attempts in the same turn do not prompt again.
        assert_eq!(
            presence.admit("chat", true, Some(&safari()), true, true, now),
            Admission::Refuse(message)
        );
        // The user's next message in that chat lets the agent ask again.
        presence.bind("chat", Some(Actor::fallback()));
        let Admission::Ask(id) = presence.admit("chat", true, Some(&safari()), true, true, now)
        else {
            panic!()
        };
        assert!(presence
            .take_outcome(id, now + CONSENT_TIMEOUT - Duration::from_millis(1))
            .is_none());
        assert_eq!(
            presence.take_outcome(id, now + CONSENT_TIMEOUT),
            Some(Outcome::NoAnswer)
        );
        assert_eq!(Outcome::NoAnswer.into_result().unwrap_err(), NO_ANSWER);
        assert!(NO_ANSWER.starts_with("No answer from the user."));
        assert!(presence.model(now).is_none());
    }

    #[test]
    fn consent_is_cleared_when_the_scope_is_unbound() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let Admission::Ask(id) = presence.admit("chat", true, Some(&safari()), true, true, now)
        else {
            panic!()
        };
        presence.forget(Some("chat"));
        assert_eq!(presence.take_outcome(id, now), Some(Outcome::Cancelled));
        // An earlier allow does not survive a rebind of the same scope.
        let Admission::Ask(id) = presence.admit("chat", true, Some(&safari()), true, true, now)
        else {
            panic!()
        };
        presence.answer(id, true);
        presence.forget(Some("chat"));
        assert!(matches!(
            presence.admit("chat", true, Some(&safari()), true, true, now),
            Admission::Ask(_)
        ));
    }

    #[test]
    fn observation_and_disabled_consent_never_prompt() {
        let mut presence = Presence::default();
        let now = Instant::now();
        assert_eq!(
            presence.admit("chat", false, None, true, true, now),
            Admission::Go
        );
        assert_eq!(
            presence.admit("chat", true, Some(&safari()), false, true, now),
            Admission::Go
        );
        // Unknown target apps share one "your Mac" consent.
        let Admission::Ask(_) = presence.admit("chat", true, None, true, true, now) else {
            panic!()
        };
        assert_eq!(
            presence.model(now).unwrap().title,
            "An agent wants to use your Mac"
        );
    }

    #[test]
    fn pause_refuses_input_but_allows_observation_until_resume() {
        let mut presence = Presence::default();
        let now = Instant::now();
        presence.pause(Pause::ByUser);
        assert_eq!(
            presence.admit("chat", true, Some(&safari()), false, true, now),
            Admission::Refuse(PAUSED_BY_USER.into())
        );
        assert_eq!(PAUSED_BY_USER, "Paused by the user. Wait, then retry.");
        assert_eq!(
            presence.admit("chat", false, None, true, true, now),
            Admission::Go
        );
        let looking = presence.begin("chat", Step::Looking, None, now);
        assert!(presence.check(&looking).is_ok());
        presence.resume();
        assert_eq!(
            presence.admit("chat", true, Some(&safari()), false, true, now),
            Admission::Go
        );
    }

    #[test]
    fn pause_and_stop_interrupt_in_flight_input() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let ticket = presence.begin("chat", Step::Dragging, None, now);
        assert!(presence.check(&ticket).is_ok());
        presence.pause(Pause::ByUser);
        assert!(presence
            .check(&ticket)
            .unwrap_err()
            .starts_with(PAUSED_BY_USER));
        presence.resume();
        // A pause and resume during the action still interrupts it.
        assert_eq!(presence.check(&ticket).unwrap_err(), INTERRUPTED);
        let ticket = presence.begin("chat", Step::Typing, None, now);
        presence.stop("other", now);
        assert_eq!(presence.check(&ticket).unwrap_err(), INTERRUPTED);
        let ticket = presence.begin("chat", Step::Looking, None, now);
        presence.stop("chat", now);
        assert_eq!(presence.check(&ticket).unwrap_err(), STOPPED);
        let other = Ticket::for_test("other", false);
        assert_eq!(presence.check(&other).unwrap_err(), STOPPED);
        let unrelated = Ticket::for_test("third", false);
        assert!(presence.check(&unrelated).is_ok());
    }

    #[test]
    fn session_dictionary_fails_closed() {
        assert_eq!(
            Session::from_dictionary(true, Some(true), None),
            Session::Active
        );
        assert_eq!(
            Session::from_dictionary(true, Some(true), Some(false)),
            Session::Active
        );
        assert_eq!(
            Session::from_dictionary(true, Some(true), Some(true)),
            Session::Locked
        );
        // Fast user switching: another session owns the screen.
        assert_eq!(
            Session::from_dictionary(true, Some(false), None),
            Session::Away
        );
        assert_eq!(
            Session::from_dictionary(true, Some(false), Some(true)),
            Session::Away
        );
        // No GUI session, or an unreadable console flag.
        assert_eq!(Session::from_dictionary(false, None, None), Session::Away);
        assert_eq!(
            Session::from_dictionary(true, None, Some(false)),
            Session::Away
        );
        assert_eq!(Session::Active.refusal(), None);
        assert_eq!(Session::Locked.refusal(), Some(SCREEN_LOCKED));
        assert_eq!(Session::Away.refusal(), Some(SESSION_AWAY));
    }

    #[test]
    fn lock_notifications_outlast_lagging_session_reads() {
        let mut presence = Presence::default();
        // Ordinary reads are recorded as they are.
        assert!(presence.observe_session(Session::Locked));
        assert!(presence.observe_session(Session::Active));
        assert_eq!(presence.session(), Session::Active);
        // Notified while CoreGraphics still says Active: locked, and every
        // later Active read is stale until macOS confirms the unlock.
        assert!(presence.notify_locked(Session::Active));
        assert_eq!(presence.session(), Session::Locked);
        for _ in 0..3 {
            assert!(!presence.observe_session(Session::Active));
            assert_eq!(presence.session(), Session::Locked);
        }
        // The read catches up (Locked), then the user unlocks without the
        // notification arriving: the Active read after it is real.
        assert!(!presence.observe_session(Session::Locked));
        assert!(presence.observe_session(Session::Active));
        assert_eq!(presence.session(), Session::Active);
        // Unavailable states may be recorded over a notified lock.
        assert!(presence.notify_locked(Session::Active));
        assert!(presence.observe_session(Session::Away));
        assert_eq!(presence.session(), Session::Away);
        // The unlock notification ends the latch; a lagging Locked read
        // with it is corrected by the next read.
        assert!(presence.notify_unlocked(Session::Locked));
        assert_eq!(presence.session(), Session::Locked);
        assert!(presence.observe_session(Session::Active));
        assert_eq!(presence.session(), Session::Active);
        // A notification whose read already shows the lock needs no wait.
        assert!(presence.notify_locked(Session::Locked));
        assert!(presence.observe_session(Session::Active));
        // A lock notification also cancels an open prompt.
        let app = AppIdentity::new("com.example:1", "Example");
        let Admission::Ask(id) =
            presence.admit("chat", true, Some(&app), true, true, Instant::now())
        else {
            panic!("expected a prompt");
        };
        assert!(presence.notify_locked(Session::Active));
        assert!(presence.prompt.is_none());
        assert!(presence.resolved.contains_key(&id));
    }

    #[test]
    fn locked_session_refuses_every_request_before_any_prompt_or_bar() {
        let mut presence = Presence::default();
        let now = Instant::now();
        presence.begin("chat", Step::Clicking, Some("Safari".into()), now);
        assert!(presence.model(now).is_some());
        assert!(presence.set_session(Session::Locked));
        assert!(!presence.set_session(Session::Locked));
        // Input with app consent on, shared input, and observation are all
        // refused without opening a prompt.
        for (input, ask) in [(true, true), (true, false), (false, false)] {
            assert_eq!(
                presence.admit("chat", input, Some(&safari()), ask, true, now),
                Admission::Refuse(SCREEN_LOCKED.into())
            );
        }
        assert_eq!(presence.prompt_id(), None);
        // The bar never draws over the lock screen, even mid-action.
        assert_eq!(presence.model(now), None);
        // Typing the password is not user activity to yield to.
        assert_eq!(presence.user_input(UserEvent::Key, now), InputEffect::None);
        assert_eq!(
            presence.user_input(UserEvent::Escape, now),
            InputEffect::None
        );
        assert_eq!(
            presence.user_input(UserEvent::Escape, now),
            InputEffect::None
        );
        assert!(presence.paused.is_none() && presence.stopped.is_empty());
        assert!(presence.set_session(Session::Away));
        assert_eq!(
            presence.admit("chat", false, None, false, true, now),
            Admission::Refuse(SESSION_AWAY.into())
        );
        assert!(presence.set_session(Session::Active));
        assert_eq!(presence.session, Session::Active);
        assert!(matches!(
            presence.admit("chat", true, Some(&safari()), true, true, now),
            Admission::Ask(_)
        ));
        assert!(presence.model(now).is_some());
    }

    #[test]
    fn locking_interrupts_in_flight_actions_and_cancels_the_open_prompt() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let Admission::Ask(id) = presence.admit("asker", true, Some(&safari()), true, true, now)
        else {
            panic!("expected a prompt");
        };
        let drag = presence.begin("chat", Step::Dragging, None, now);
        let look = Ticket::for_test("chat", false);
        assert!(presence.check(&drag).is_ok());
        presence.set_session(Session::Locked);
        let error = presence.check(&drag).unwrap_err();
        assert!(error.starts_with(SCREEN_LOCKED) && error.ends_with(INTERRUPTED_SUFFIX));
        assert_eq!(presence.check(&look).unwrap_err(), SCREEN_LOCKED);
        // The waiter learns why its prompt went away; nobody answered it.
        assert_eq!(presence.prompt_id(), None);
        let outcome = presence.take_outcome(id, now).unwrap();
        assert_eq!(outcome.into_result().unwrap_err(), SCREEN_LOCKED);
        assert!(!presence.answer(id, true));
        assert!(!presence.has_app_consent("asker", &safari().key));
        // Unlocking never resumes an interrupted action.
        presence.set_session(Session::Active);
        assert_eq!(presence.check(&drag).unwrap_err(), INTERRUPTED);
        assert!(presence.check(&look).is_ok());
        let next = presence.begin("chat", Step::Typing, None, now);
        assert!(presence.check(&next).is_ok());
        // Leaving the console interrupts too; moving between unavailable
        // states keeps the action refused with the latest reason.
        presence.set_session(Session::Away);
        assert!(presence.check(&next).unwrap_err().starts_with(SESSION_AWAY));
        presence.set_session(Session::Locked);
        assert!(presence
            .check(&next)
            .unwrap_err()
            .starts_with(SCREEN_LOCKED));
        presence.set_session(Session::Active);
        assert_eq!(presence.check(&next).unwrap_err(), INTERRUPTED);
    }

    #[test]
    fn stop_revokes_input_and_observation_until_the_user_allows_again() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let Admission::Ask(id) = presence.admit("chat", true, Some(&safari()), true, true, now)
        else {
            panic!()
        };
        presence.answer(id, true);
        presence.take_outcome(id, now);
        presence.begin("chat", Step::Clicking, Some("Safari".into()), now);
        presence.stop("chat", now);
        assert_eq!(presence.model(now).unwrap().kind, BarKind::Stopped);
        // Observation asks to resume; input asks for the app again.
        let Admission::Ask(id) = presence.admit("chat", false, None, true, true, now) else {
            panic!()
        };
        assert_eq!(
            presence.model(now).unwrap().title,
            "An agent wants to use your Mac again"
        );
        presence.answer(id, true);
        presence.take_outcome(id, now);
        assert_eq!(
            presence.admit("chat", false, None, true, true, now),
            Admission::Go
        );
        assert!(matches!(
            presence.admit("chat", true, Some(&safari()), true, true, now),
            Admission::Ask(_)
        ));
        // With app consent off, a stopped chat still needs a resume answer.
        let mut presence = Presence::default();
        presence.stop("chat", now);
        assert!(matches!(
            presence.admit("chat", true, Some(&safari()), false, true, now),
            Admission::Ask(_)
        ));
        let id = presence.prompt_id().unwrap();
        presence.answer(id, false);
        assert!(matches!(
            presence.admit("chat", false, None, false, true, now),
            Admission::Refuse(message) if message.contains("declined to let this chat")
        ));
    }

    #[test]
    fn readmission_after_an_answer_never_shows_a_second_prompt() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let notes = AppIdentity::new("com.apple.Notes", "Notes");
        assert_eq!(
            presence.admit("chat", true, Some(&notes), true, false, now),
            Admission::Refuse(TARGET_CHANGED.into())
        );
        assert!(presence.prompt.is_none());
    }

    #[test]
    fn esc_twice_quickly_is_detected_and_slow_presses_are_not() {
        let start = Instant::now();
        let mut esc = EscDetector::default();
        assert!(!esc.press(start));
        assert!(esc.press(start + Duration::from_millis(300)));
        // A completed double press starts over.
        assert!(!esc.press(start + Duration::from_millis(400)));
        assert!(!esc.press(start + Duration::from_millis(1200)));
        assert!(esc.press(start + Duration::from_millis(1200) + ESC_INTERVAL));
    }

    #[test]
    fn user_input_classification_ignores_aven_events() {
        let own = 4242;
        assert_eq!(classify(1, 0, 0, own, 0, false), Some(UserEvent::Pointer));
        assert_eq!(classify(5, 0, 0, own, 0, false), Some(UserEvent::Pointer));
        assert_eq!(classify(22, 0, 0, own, 0, false), Some(UserEvent::Pointer));
        assert_eq!(classify(10, 0, 0, own, 0, false), Some(UserEvent::Key));
        assert_eq!(classify(12, 0, 0, own, 0, false), Some(UserEvent::Key));
        assert_eq!(classify(10, 0, 0, own, 53, false), Some(UserEvent::Escape));
        assert_eq!(classify(10, 0, 0, own, 53, true), Some(UserEvent::Key));
        assert_eq!(classify(11, 0, 0, own, 53, false), None, "key up");
        assert_eq!(classify(0, 0, 0, own, 0, false), None);
        for kind in [1, 5, 6, 10, 12, 22] {
            assert_eq!(classify(kind, EVENT_MARKER, 0, own, 53, false), None);
            assert_eq!(classify(kind, 0, own, own, 53, false), None);
            assert!(classify(kind, EVENT_MARKER + 1, 77, own, 0, false).is_some());
        }
    }

    /// Feeds the user's input every 100 ms from `from` to `to` inclusive and
    /// returns the effect of the last event.
    fn feed(presence: &mut Presence, event: UserEvent, from: Instant, to: Instant) -> InputEffect {
        let mut at = from;
        loop {
            let effect = presence.user_input(event, at);
            if at >= to {
                return effect;
            }
            at = (at + Duration::from_millis(100)).min(to);
        }
    }

    #[test]
    fn user_input_during_or_just_after_an_action_pauses_agents() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let ms = Duration::from_millis;
        assert_eq!(
            presence.user_input(UserEvent::Pointer, now),
            InputEffect::None
        );
        presence.user_run = None;
        let ticket = presence.begin("chat", Step::Clicking, None, now);
        // A single touch is ignored; three seconds of continuous use pauses.
        assert_eq!(
            presence.user_input(UserEvent::Pointer, now),
            InputEffect::None
        );
        assert!(presence.check(&ticket).is_ok());
        assert_eq!(
            feed(
                &mut presence,
                UserEvent::Pointer,
                now,
                now + SUSTAINED_INPUT
            ),
            InputEffect::Paused
        );
        assert!(presence
            .check(&ticket)
            .unwrap_err()
            .starts_with(PAUSED_USER_ACTIVE));
        let model = presence.model(now).unwrap();
        assert_eq!(model.title, "Paused \u{2014} you\u{2019}re using your Mac");
        assert_eq!(model.buttons[0].action, ButtonAction::Resume);
        assert_eq!(presence.user_input(UserEvent::Key, now), InputEffect::None);
        presence.resume();
        presence.end(&ticket, now);
        // A run that began during an action and carries on just after it ends
        // still yields.
        let t = now + ms(10_000);
        presence.user_run = None;
        let ticket = presence.begin("chat", Step::Clicking, None, t);
        presence.end(&ticket, t + ms(2_000));
        assert_eq!(
            feed(&mut presence, UserEvent::Key, t + ms(100), t + ms(3_100)),
            InputEffect::Paused
        );
        presence.resume();
        // Once the agent has been idle past the yield window, use is not a conflict.
        let idle = t + ms(2_000) + YIELD_WINDOW + Duration::from_millis(1);
        presence.user_run = None;
        assert_eq!(
            feed(
                &mut presence,
                UserEvent::Pointer,
                idle,
                idle + SUSTAINED_INPUT
            ),
            InputEffect::None
        );
        // Observation alone does not make the user's input a conflict.
        let mut presence = Presence::default();
        presence.begin("chat", Step::Looking, None, now);
        assert_eq!(
            presence.user_input(UserEvent::Pointer, now),
            InputEffect::None
        );
        // Neither does moving toward a consent prompt.
        let mut presence = Presence::default();
        presence.begin("chat", Step::Clicking, None, now);
        presence.admit("chat", true, None, true, true, now);
        assert_eq!(
            presence.user_input(UserEvent::Pointer, now),
            InputEffect::None
        );
    }

    #[test]
    fn escape_twice_stops_the_acting_chat() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let ticket = presence.begin("chat", Step::Typing, None, now);
        // A single Esc is a brief touch; it does not pause on its own.
        assert_eq!(
            presence.user_input(UserEvent::Escape, now),
            InputEffect::None
        );
        assert_eq!(
            presence.user_input(UserEvent::Escape, now + Duration::from_millis(200)),
            InputEffect::Stopped("chat".into())
        );
        assert_eq!(presence.check(&ticket).unwrap_err(), STOPPED);
        assert!(
            presence.paused.is_none(),
            "an automatic pause ends with the stop"
        );
        assert_eq!(presence.model(now).unwrap().kind, BarKind::Stopped);
        // Nothing acting: Escape belongs to the user's apps.
        let mut presence = Presence::default();
        assert_eq!(
            presence.user_input(UserEvent::Escape, now),
            InputEffect::None
        );
        assert_eq!(
            presence.user_input(UserEvent::Escape, now),
            InputEffect::None
        );
    }

    #[test]
    fn the_bar_fades_after_idle_and_reports_when_to_refresh() {
        let mut presence = Presence::default();
        let now = Instant::now();
        let ticket = presence.begin("chat", Step::Scrolling, Some("Finder".into()), now);
        assert!(presence.next_refresh(now).is_none(), "in flight");
        presence.end(&ticket, now);
        assert_eq!(presence.next_refresh(now), Some(IDLE_FADE));
        assert!(presence
            .model(now + IDLE_FADE - Duration::from_millis(1))
            .is_some());
        assert!(presence.model(now + IDLE_FADE).is_none());
        // A later observation keeps the app name the chat was using.
        let looking = presence.begin("chat", Step::Looking, None, now + IDLE_FADE);
        let model = presence.model(now + IDLE_FADE).unwrap();
        assert_eq!(model.title, "An agent is using Finder");
        assert_eq!(model.detail, "Looking at the screen");
        presence.end(&looking, now + IDLE_FADE);
        presence.stop("chat", now);
        assert_eq!(presence.next_refresh(now), Some(STOP_NOTICE));
        assert!(presence.model(now + STOP_NOTICE).is_none());
    }

    #[test]
    fn button_actions_match_each_bar_state() {
        let mut presence = Presence::default();
        let now = Instant::now();
        presence.begin("chat", Step::Clicking, None, now);
        let acting = presence.model(now).unwrap();
        assert_eq!(
            acting.buttons.iter().map(|b| &b.action).collect::<Vec<_>>(),
            [&ButtonAction::Pause, &ButtonAction::Stop("chat".into())]
        );
        assert_eq!(acting.buttons[1].style, ButtonStyle::Destructive);
        presence.pause(Pause::ByUser);
        let paused = presence.model(now).unwrap();
        assert_eq!(paused.title, "Paused");
        assert_eq!(paused.color, PAUSED_COLOR);
        assert_eq!(paused.buttons[0].label, "Resume");
        // Without a current agent there is nothing to stop.
        presence.activity = None;
        assert_eq!(presence.model(now).unwrap().buttons.len(), 1);
    }

    #[test]
    fn bar_placement_prefers_top_and_moves_clear_of_agent_targets() {
        let screen = Frame {
            x: -1440.0,
            y: 25.0,
            width: 1440.0,
            height: 875.0,
        };
        let (top, bottom) = place_bar(screen, 400.0, 46.0, false, &[]).unwrap();
        assert!(!bottom);
        assert_eq!(
            top,
            Frame {
                x: -920.0,
                y: 35.0,
                width: 400.0,
                height: 46.0
            }
        );
        let target = (-720.0, 60.0);
        let (moved, bottom) = place_bar(screen, 400.0, 46.0, false, &[target]).unwrap();
        assert!(bottom && !moved.covers(target));
        assert_eq!(moved.y, 25.0 + 875.0 - 10.0 - 46.0);
        // Sticky bottom placement returns to the top only when needed.
        let (frame, bottom) = place_bar(screen, 400.0, 46.0, true, &[]).unwrap();
        assert!(bottom && frame == moved);
        let (frame, bottom) = place_bar(screen, 400.0, 46.0, true, &[(-720.0, 860.0)]).unwrap();
        assert!(!bottom && frame == top);
        assert!(place_bar(screen, 400.0, 46.0, false, &[target, (-720.0, 860.0)]).is_none());
        // Clearance extends a few points around the visible pill.
        assert!(top.covers((top.x - 4.0, top.y)));
        assert!(!top.covers((top.x - BAR_CLEARANCE - 1.0, top.y)));
        // A narrow screen never places the bar outside it.
        let narrow = Frame {
            width: 300.0,
            ..screen
        };
        let (frame, _) = place_bar(narrow, 400.0, 46.0, false, &[]).unwrap();
        assert!(frame.x >= narrow.x && frame.x + frame.width <= narrow.x + narrow.width);
    }

    #[test]
    fn waiting_returns_the_users_answer_or_cancels_with_the_scope() {
        let id = with(|presence| {
            presence.forget(None);
            match presence.admit(
                "wait-test",
                true,
                Some(&safari()),
                true,
                true,
                Instant::now(),
            ) {
                Admission::Ask(id) => id,
                other => panic!("{other:?}"),
            }
        });
        let answer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            with(|presence| presence.answer(id, true));
        });
        assert!(wait_for_answer(id, || true).is_ok());
        answer.join().unwrap();
        let id = with(|presence| {
            match presence.admit(
                "wait-test-2",
                true,
                Some(&safari()),
                true,
                true,
                Instant::now(),
            ) {
                Admission::Ask(id) => id,
                other => panic!("{other:?}"),
            }
        });
        assert_eq!(wait_for_answer(id, || false).unwrap_err(), CANCELLED);
        assert!(with(|presence| presence.prompt.is_none()));
        // `alive` runs without the presence lock: it may read shared state
        // (or the slow session) without blocking answers or deadlocking.
        let id = with(|presence| {
            match presence.admit(
                "wait-test-3",
                true,
                Some(&safari()),
                true,
                true,
                Instant::now(),
            ) {
                Admission::Ask(id) => id,
                other => panic!("{other:?}"),
            }
        });
        let answer = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            with(|presence| presence.answer(id, true));
        });
        assert!(wait_for_answer(
            id,
            || with(|presence| presence.session() == Session::Active)
        )
        .is_ok());
        answer.join().unwrap();
        with(|presence| presence.forget(None));
    }
    #[test]
    fn app_delivery_never_yields_to_the_users_own_input() {
        let now = Instant::now();
        let mut state = Presence::default();
        let ticket = state.begin("chat", Step::Typing, Some("Notes".into()), now);
        state.set_delivery(&ticket, false, Some(42));
        // Other apps, and the very app the agent is driving: clicks, typing
        // and movement all leave an allowed agent running.
        for (event, front) in [
            (UserEvent::Pointer, Some(99)),
            (UserEvent::Pointer, Some(42)),
            (UserEvent::Key, Some(42)),
        ] {
            assert_eq!(
                state.user_input_in_app(event, now, front),
                InputEffect::None
            );
            assert!(state.check(&ticket).is_ok());
        }
        // Only the user's explicit Pause stops it; resuming does not revive the
        // interrupted action.
        state.pause(Pause::ByUser);
        assert!(state.check(&ticket).is_err());
        state.resume();
        assert!(
            state.check(&ticket).is_err(),
            "resuming must not revive an interrupted action"
        );
    }

    #[test]
    fn shared_pointer_yields_only_to_sustained_user_input() {
        let start = Instant::now();
        let mut state = Presence::default();
        let ticket = state.begin("chat", Step::Clicking, Some("Notes".into()), start);
        state.set_delivery(&ticket, true, Some(42));
        let at = |ms: u64, state: &mut Presence| {
            let now = start + Duration::from_millis(ms);
            // Keep the agent's action current so only the user's run decides.
            state.activity.as_mut().unwrap().last = now;
            state.user_input_in_app(UserEvent::Pointer, now, Some(99))
        };
        // A bump, then a pause longer than the gap: the run restarts.
        assert_eq!(at(0, &mut state), InputEffect::None);
        assert_eq!(at(200, &mut state), InputEffect::None);
        assert_eq!(at(1_000, &mut state), InputEffect::None);
        assert!(state.check(&ticket).is_ok());
        // Continuous movement for just under three seconds is still ignored.
        let mut t = 1_000;
        while t < 3_900 {
            t += 100;
            assert_eq!(at(t, &mut state), InputEffect::None, "at {t} ms");
        }
        assert!(state.check(&ticket).is_ok());
        // Three seconds of continuous movement pauses shared control.
        assert_eq!(at(4_000, &mut state), InputEffect::Paused);
        assert!(state.check(&ticket).is_err());
    }

    #[test]
    fn shared_pointer_and_focus_approvals_last_for_the_chat_until_stopped() {
        let mut state = Presence::default();
        let now = Instant::now();
        for app in [
            AppIdentity::new("pointer:42", "Notes with your mouse and keyboard"),
            AppIdentity::new("focus:42", "Notes"),
        ] {
            let Admission::Ask(id) = state.admit("chat", true, Some(&app), true, true, now) else {
                panic!()
            };
            let model = state.model(now).unwrap();
            assert!(model.detail.ends_with("For this chat"));
            assert_eq!(model.buttons[1].label, "Allow for chat");
            state.answer(id, true);
            assert_eq!(state.take_outcome(id, now), Some(Outcome::Allowed));
            // Later commands in this chat go ahead without asking again.
            for _ in 0..3 {
                assert_eq!(
                    state.admit("chat", true, Some(&app), true, true, now),
                    Admission::Go
                );
            }
            // Another chat still needs its own answer.
            assert!(matches!(
                state.admit("other", true, Some(&app), true, true, now),
                Admission::Ask(_)
            ));
            state.prompt = None;
        }
        // Stop revokes them; the next command asks to resume first.
        state.stop("chat", now);
        assert!(!matches!(
            state.admit(
                "chat",
                true,
                Some(&AppIdentity::new("pointer:42", "Notes")),
                true,
                true,
                now
            ),
            Admission::Go
        ));
    }

    #[test]
    fn observations_while_paused_do_not_replace_the_stopped_agent() {
        let now = Instant::now();
        let mut state = Presence::default();
        state.bind("a", Some(actor("claude", None)));
        let ticket = state.begin("a", Step::Clicking, Some("Notes".into()), now);
        state.pause(Pause::ByUser);
        state.begin("b", Step::Looking, None, now);
        let model = state.model(now).unwrap();
        assert!(model.detail.contains("Claude"));
        assert!(model
            .buttons
            .iter()
            .any(|b| b.action == ButtonAction::Stop("a".into())));
        assert!(state.check(&ticket).is_err());
    }
    #[test]
    fn another_agents_pending_prompt_blocks_previously_allowed_input() {
        let now = Instant::now();
        let mut state = Presence::default();
        let app = safari();
        let Admission::Ask(id) = state.admit("a", true, Some(&app), true, true, now) else {
            panic!()
        };
        state.answer(id, true);
        state.take_outcome(id, now);
        assert!(matches!(
            state.admit("b", true, Some(&app), true, true, now),
            Admission::Ask(_)
        ));
        assert_eq!(
            state.admit("a", true, Some(&app), true, true, now),
            Admission::Refuse(CONSENT_BUSY.into())
        );
        assert_eq!(
            state.admit("a", false, None, true, true, now),
            Admission::Go
        );
    }
    #[test]
    fn finishing_the_interrupted_chat_clears_only_an_automatic_pause() {
        for reason in [Pause::UserActive, Pause::ByUser] {
            let now = Instant::now();
            let mut state = Presence::default();
            state.begin("chat", Step::Clicking, None, now);
            state.pause(reason);
            state.forget(Some("chat"));
            assert_eq!(
                state.paused,
                if reason == Pause::ByUser {
                    Some(reason)
                } else {
                    None
                }
            );
        }
    }

    #[test]
    fn element_steps_name_the_control_but_never_its_value_or_typed_text() {
        let now = Instant::now();
        let secret = "hunter2 SECRET";
        for (value, expected) in [
            (
                json!({"action":"click","windowId":3,"element":1}),
                "Clicking \u{201c}Send\u{201d}",
            ),
            (
                json!({"action":"typeText","windowId":3,"element":1,"text":secret}),
                "Typing in \u{201c}Send\u{201d}",
            ),
            (
                json!({"action":"setValue","windowId":3,"element":1,"value":secret}),
                "Setting \u{201c}Send\u{201d}",
            ),
            (
                json!({"action":"selectText","windowId":3,"element":1,"text":secret}),
                "Selecting text in \u{201c}Send\u{201d}",
            ),
            (
                json!({"action":"secondaryAction","windowId":3,"element":1}),
                "Opening the menu for \u{201c}Send\u{201d}",
            ),
            (
                json!({"action":"pressKey","windowId":3,"element":1,"key":"Enter"}),
                "Pressing a key in \u{201c}Send\u{201d}",
            ),
        ] {
            let mut state = Presence::default();
            let step = step_for(&request(value)).unwrap();
            let ticket = state.begin("chat", step, Some("Mail".into()), now);
            state.set_element(&ticket, Some("Send".into()));
            let model = state.model(now).unwrap();
            assert_eq!(model.detail, expected);
            assert!(!model.detail.contains("hunter2") && !model.title.contains("SECRET"));
        }
        // Without a label the generic step text is used, and a new action
        // never inherits the previous element.
        let mut state = Presence::default();
        let ticket = state.begin("chat", Step::Clicking, None, now);
        state.set_element(&ticket, Some("Send".into()));
        state.begin("chat", Step::SettingValue, None, now);
        assert_eq!(state.model(now).unwrap().detail, "Setting a value");
        // Another chat's ticket cannot relabel the current activity.
        let other = Ticket::for_test("other", true);
        state.set_element(&other, Some("Delete".into()));
        assert_eq!(state.model(now).unwrap().detail, "Setting a value");
    }

    #[test]
    fn app_consent_is_read_without_prompting_and_ends_with_stop() {
        let now = Instant::now();
        let slack = AppIdentity::new("com.tinyspeck.slackmacgap:9", "Slack");
        let mut state = Presence::default();
        assert!(!state.has_app_consent("chat", &slack.key));
        let Admission::Ask(id) = state.admit("chat", true, Some(&slack), true, true, now) else {
            panic!("expected a prompt");
        };
        assert!(
            !state.has_app_consent("chat", &slack.key),
            "not before an answer"
        );
        assert!(state.answer(id, true));
        assert!(state.has_app_consent("chat", &slack.key));
        assert!(!state.has_app_consent("other", &slack.key), "per chat");
        assert!(
            !state.has_app_consent("chat", "com.tinyspeck.slackmacgap:10"),
            "per process"
        );
        // Pause, a lock or a stop hold app changes (such as turning on an
        // accessibility switch) without forgetting the consent.
        assert!(!state.changes_held("chat"));
        state.pause(Pause::ByUser);
        assert!(state.changes_held("chat") && state.changes_held("other"));
        assert!(state.has_app_consent("chat", &slack.key));
        state.resume();
        assert!(!state.changes_held("chat"));
        state.pause(Pause::UserActive);
        assert!(state.changes_held("chat"));
        state.resume();
        state.set_session(Session::Locked);
        assert!(state.changes_held("chat"));
        state.set_session(Session::Active);
        assert!(!state.changes_held("chat"));
        state.stop("chat", now);
        assert!(!state.has_app_consent("chat", &slack.key));
        assert!(state.changes_held("chat"));
        assert!(!state.changes_held("other"));
    }

    #[test]
    fn element_actions_are_input_for_consent_pause_and_yield() {
        let now = Instant::now();
        let mail = AppIdentity::new("com.apple.mail:9", "Mail");
        let click = request(json!({"action":"click","windowId":3,"element":1}));
        let observe = request(json!({"action":"appState","windowId":3}));
        let mut state = Presence::default();
        // App consent is asked before the first element action in an app.
        assert!(matches!(
            state.admit("chat", is_input(&click), Some(&mail), true, true, now),
            Admission::Ask(_)
        ));
        state.prompt = None;
        // appState is observation: no prompt, and allowed while paused.
        assert_eq!(
            state.admit("chat", is_input(&observe), None, true, true, now),
            Admission::Go
        );
        state.pause(Pause::ByUser);
        assert_eq!(
            state.admit("chat", is_input(&click), Some(&mail), false, true, now),
            Admission::Refuse(PAUSED_BY_USER.into())
        );
        assert_eq!(
            state.admit("chat", is_input(&observe), None, true, true, now),
            Admission::Go
        );
        state.resume();
        // The user working in the same app leaves an allowed element action
        // running; only the bar's Pause or Stop interrupts it.
        let ticket = state.begin("chat", step_for(&click).unwrap(), Some("Mail".into()), now);
        state.set_delivery(&ticket, false, Some(9));
        assert_eq!(
            state.user_input_in_app(UserEvent::Pointer, now, Some(9)),
            InputEffect::None
        );
        assert!(state.check(&ticket).is_ok());
        // Stop revokes it until the user allows the chat again.
        state.stop("chat", now);
        assert_eq!(state.check(&ticket).unwrap_err(), STOPPED);
    }
}
