//! Whether Control is held right now, for the recent switcher (⌃⇥).
//!
//! The switcher opens the card picked when ⌃ is let go. A focused browser
//! page keeps its own key-up events, so the window never hears that; while
//! the switcher is open the page asks here instead. `None` where the state
//! cannot be read, and the window's own key-up is all there is.

#[tauri::command]
pub fn control_key_held() -> Option<bool> {
    held()
}

#[cfg(target_os = "macos")]
fn held() -> Option<bool> {
    /// `NSEventModifierFlagControl`.
    const CONTROL: usize = 1 << 18;
    // `+[NSEvent modifierFlags]` is the keyboard's state now, whichever
    // view has the keys.
    let flags: usize = unsafe { objc2::msg_send![objc2::class!(NSEvent), modifierFlags] };
    Some(flags & CONTROL != 0)
}

#[cfg(windows)]
fn held() -> Option<bool> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_CONTROL};
    // The keyboard's state now, whichever window has the keys: the high
    // bit is set while the key is down.
    let state = unsafe { GetAsyncKeyState(i32::from(VK_CONTROL)) };
    Some(state < 0)
}

#[cfg(not(any(target_os = "macos", windows)))]
fn held() -> Option<bool> {
    None
}
