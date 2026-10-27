//! Typing on the simulator: characters and Mac keys as USB HID keyboard
//! usages (page 7) on a US layout. Characters a US keyboard cannot type
//! (accents, emoji, other scripts) go through the device's pasteboard instead.
// The iPhone pane runs on macOS only; other builds keep the shared parts.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

/// Left Shift and Left Command (GUI).
pub(crate) const SHIFT: u32 = 0xE1;
pub(crate) const COMMAND: u32 = 0xE3;
/// The `v` key, for Command-V.
pub(crate) const KEY_V: u32 = 0x19;

/// The key a US keyboard types `c` with.
pub(crate) fn key_for_char(c: char) -> Option<(u32, bool)> {
    const DIGITS: &str = "1234567890";
    const SHIFTED_DIGITS: &str = "!@#$%^&*()";
    const PUNCTUATION: &str = "-=[]\\;'`,./";
    const SHIFTED_PUNCTUATION: &str = "_+{}|:\"~<>?";
    const PUNCTUATION_USAGES: [u32; 11] = [
        0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38,
    ];
    match c {
        'a'..='z' => Some((0x04 + (c as u32 - 'a' as u32), false)),
        'A'..='Z' => Some((0x04 + (c as u32 - 'A' as u32), true)),
        '\n' | '\r' => Some((0x28, false)),
        '\t' => Some((0x2B, false)),
        ' ' => Some((0x2C, false)),
        _ => {
            if let Some(index) = DIGITS.find(c) {
                return Some((0x1E + index as u32, false));
            }
            if let Some(index) = SHIFTED_DIGITS.find(c) {
                return Some((0x1E + index as u32, true));
            }
            if let Some(index) = PUNCTUATION.find(c) {
                return Some((PUNCTUATION_USAGES[index], false));
            }
            SHIFTED_PUNCTUATION
                .find(c)
                .map(|index| (PUNCTUATION_USAGES[index], true))
        }
    }
}

/// A Mac key by its physical position (virtual key code) as the same key on
/// a USB keyboard. Modifiers travel separately, so iOS composes characters
/// itself, including Option's dead keys (Option-E, E types é).
pub(crate) fn key_for_mac_keycode(code: u16) -> Option<u32> {
    const LETTERS: [(u16, char); 26] = [
        (0, 'a'),
        (11, 'b'),
        (8, 'c'),
        (2, 'd'),
        (14, 'e'),
        (3, 'f'),
        (5, 'g'),
        (4, 'h'),
        (34, 'i'),
        (38, 'j'),
        (40, 'k'),
        (37, 'l'),
        (46, 'm'),
        (45, 'n'),
        (31, 'o'),
        (35, 'p'),
        (12, 'q'),
        (15, 'r'),
        (1, 's'),
        (17, 't'),
        (32, 'u'),
        (9, 'v'),
        (13, 'w'),
        (7, 'x'),
        (16, 'y'),
        (6, 'z'),
    ];
    if let Some((_, letter)) = LETTERS.iter().find(|(key, _)| *key == code) {
        return Some(0x04 + (*letter as u32 - 'a' as u32));
    }
    Some(match code {
        18 => 0x1E, // 1
        19 => 0x1F,
        20 => 0x20,
        21 => 0x21,
        23 => 0x22,  // 5
        22 => 0x23,  // 6
        26 => 0x24,  // 7
        28 => 0x25,  // 8
        25 => 0x26,  // 9
        29 => 0x27,  // 0
        36 => 0x28,  // Return
        53 => 0x29,  // Escape
        51 => 0x2A,  // Delete (backspace)
        48 => 0x2B,  // Tab
        49 => 0x2C,  // Space
        27 => 0x2D,  // -
        24 => 0x2E,  // =
        33 => 0x2F,  // [
        30 => 0x30,  // ]
        42 => 0x31,  // backslash
        41 => 0x33,  // ;
        39 => 0x34,  // '
        50 => 0x35,  // `
        43 => 0x36,  // ,
        47 => 0x37,  // .
        44 => 0x38,  // /
        117 => 0x4C, // Forward Delete
        115 => 0x4A, // Home
        119 => 0x4D, // End
        116 => 0x4B, // Page Up
        121 => 0x4E, // Page Down
        123 => 0x50, // Left
        124 => 0x4F, // Right
        125 => 0x51, // Down
        126 => 0x52, // Up
        75 => 0x54,  // keypad /
        67 => 0x55,  // keypad *
        78 => 0x56,  // keypad -
        69 => 0x57,  // keypad +
        76 => 0x58,  // keypad Enter
        83 => 0x59,  // keypad 1
        84 => 0x5A,
        85 => 0x5B,
        86 => 0x5C,
        87 => 0x5D,
        88 => 0x5E,
        89 => 0x5F,
        91 => 0x60,
        92 => 0x61, // keypad 9
        82 => 0x62, // keypad 0
        65 => 0x63, // keypad .
        81 => 0x67, // keypad =
        _ => return None,
    })
}

/// Splits text for typing: words a US keyboard can type key by key, and
/// words with other characters, which go through the pasteboard whole (so
/// iOS's smart insert never adds a space inside a word).
pub(crate) fn typing_plan(text: &str) -> Vec<(bool, String)> {
    let mut plan: Vec<(bool, String)> = Vec::new();
    let mut word = String::new();
    let flush = |word: &mut String, plan: &mut Vec<(bool, String)>| {
        if word.is_empty() {
            return;
        }
        let typeable = word.chars().all(|c| key_for_char(c).is_some());
        match plan.last_mut() {
            Some((true, last)) if typeable => last.push_str(word),
            _ => plan.push((typeable, word.clone())),
        }
        word.clear();
    };
    for c in text.chars() {
        if c.is_whitespace() && key_for_char(c).is_some() {
            flush(&mut word, &mut plan);
            match plan.last_mut() {
                Some((true, last)) => last.push(c),
                _ => plan.push((true, c.to_string())),
            }
        } else {
            word.push(c);
        }
    }
    flush(&mut word, &mut plan);
    plan
}

/// Named keys an agent can press.
pub(crate) fn key_for_name(name: &str) -> Option<u32> {
    Some(match name.to_ascii_lowercase().as_str() {
        "enter" | "return" => 0x28,
        "tab" => 0x2B,
        "backspace" | "delete" => 0x2A,
        "escape" | "esc" => 0x29,
        "forwarddelete" => 0x4C,
        "arrowleft" | "left" => 0x50,
        "arrowright" | "right" => 0x4F,
        "arrowdown" | "down" => 0x51,
        "arrowup" | "up" => 0x52,
        "space" => 0x2C,
        "home" => 0x4A,
        "end" => 0x4D,
        "pageup" => 0x4B,
        "pagedown" => 0x4E,
        _ => return None,
    })
}

#[no_mangle]
pub extern "C" fn aven_ios_sim_key_for_mac_keycode(code: u16) -> u32 {
    key_for_mac_keycode(code).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_letters_digits_and_shifted_symbols() {
        assert_eq!(key_for_char('a'), Some((0x04, false)));
        assert_eq!(key_for_char('Z'), Some((0x1D, true)));
        assert_eq!(key_for_char('1'), Some((0x1E, false)));
        assert_eq!(key_for_char('0'), Some((0x27, false)));
        assert_eq!(key_for_char('!'), Some((0x1E, true)));
        assert_eq!(key_for_char('@'), Some((0x1F, true)));
        assert_eq!(key_for_char('-'), Some((0x2D, false)));
        assert_eq!(key_for_char('?'), Some((0x38, true)));
        assert_eq!(key_for_char('"'), Some((0x34, true)));
        assert_eq!(key_for_char(' '), Some((0x2C, false)));
        assert_eq!(key_for_char('\n'), Some((0x28, false)));
    }

    #[test]
    fn leaves_other_scripts_to_the_pasteboard() {
        for c in ['é', 'ß', '€', '日', '😀', '\u{7f}'] {
            assert_eq!(key_for_char(c), None, "{c}");
        }
        assert!("Hello Aven 123!".chars().all(|c| key_for_char(c).is_some()));
    }

    #[test]
    fn maps_mac_keys_by_position() {
        assert_eq!(key_for_mac_keycode(0), Some(0x04)); // a
        assert_eq!(key_for_mac_keycode(6), Some(0x1D)); // z
        assert_eq!(key_for_mac_keycode(14), Some(0x08)); // e
        assert_eq!(key_for_mac_keycode(18), Some(0x1E)); // 1
        assert_eq!(key_for_mac_keycode(29), Some(0x27)); // 0
        assert_eq!(key_for_mac_keycode(36), Some(0x28));
        assert_eq!(key_for_mac_keycode(51), Some(0x2A));
        assert_eq!(key_for_mac_keycode(50), Some(0x35)); // `
        assert_eq!(key_for_mac_keycode(123), Some(0x50));
        assert_eq!(key_for_mac_keycode(92), Some(0x61));
        assert_eq!(key_for_mac_keycode(122), None); // F1
        assert_eq!(aven_ios_sim_key_for_mac_keycode(122), 0);
        // Every typeable character's key has a position.
        for code in 0..128u16 {
            if let Some(usage) = key_for_mac_keycode(code) {
                assert!((0x04..=0x67).contains(&usage), "{code}");
            }
        }
    }

    #[test]
    fn pastes_whole_words_that_need_the_pasteboard() {
        assert_eq!(
            typing_plan("Hello Aven 123"),
            vec![(true, "Hello Aven 123".into())]
        );
        assert_eq!(
            typing_plan("Hello café au lait"),
            vec![
                (true, "Hello ".into()),
                (false, "café".into()),
                (true, " au lait".into())
            ]
        );
        assert_eq!(typing_plan("日本"), vec![(false, "日本".into())]);
        assert_eq!(
            typing_plan(" é."),
            vec![(true, " ".into()), (false, "é.".into())]
        );
        assert!(typing_plan("").is_empty());
    }

    #[test]
    fn names_keys_for_agents() {
        assert_eq!(key_for_name("Enter"), Some(0x28));
        assert_eq!(key_for_name("ArrowDown"), Some(0x51));
        assert_eq!(key_for_name("F13"), None);
    }
}
