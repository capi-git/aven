//! The pointer size the system asks for, so Aven's dot pointer can give way
//! to the system's own when someone has enlarged it (Accessibility › Display
//! › Pointer size on a Mac). A read of one preference; nothing is changed.

/// 1 is the system's smallest pointer; the Mac's slider goes up to 4.
#[tauri::command]
pub fn system_pointer_scale() -> f64 {
    normalize(read())
}

fn normalize(value: Option<f64>) -> f64 {
    match value {
        Some(scale) if scale.is_finite() && scale >= 1.0 => scale.min(4.0),
        _ => 1.0,
    }
}

#[cfg(target_os = "macos")]
fn read() -> Option<f64> {
    use std::ffi::{c_char, c_void, CStr};
    type Cf = *const c_void;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFPreferencesCopyAppValue(key: Cf, application: Cf) -> Cf;
        fn CFStringCreateWithCString(allocator: Cf, text: *const c_char, encoding: u32) -> Cf;
        fn CFRelease(value: Cf);
        fn CFGetTypeID(value: Cf) -> usize;
        fn CFNumberGetTypeID() -> usize;
        fn CFNumberGetValue(number: Cf, kind: isize, output: *mut c_void) -> bool;
    }
    const UTF8: u32 = 0x0800_0100;
    /// kCFNumberDoubleType
    const DOUBLE: isize = 13;

    unsafe fn string(text: &CStr) -> Cf {
        CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8)
    }

    unsafe {
        let key = string(c"mouseDriverCursorSize");
        let domain = string(c"com.apple.universalaccess");
        let value = if key.is_null() || domain.is_null() {
            std::ptr::null()
        } else {
            CFPreferencesCopyAppValue(key, domain)
        };
        if !key.is_null() {
            CFRelease(key);
        }
        if !domain.is_null() {
            CFRelease(domain);
        }
        if value.is_null() {
            return None;
        }
        let mut scale = 0_f64;
        let read = CFGetTypeID(value) == CFNumberGetTypeID()
            && CFNumberGetValue(value, DOUBLE, std::ptr::from_mut(&mut scale).cast());
        CFRelease(value);
        read.then_some(scale)
    }
}

#[cfg(not(target_os = "macos"))]
fn read() -> Option<f64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_or_odd_value_is_the_normal_pointer() {
        assert_eq!(normalize(None), 1.0);
        assert_eq!(normalize(Some(f64::NAN)), 1.0);
        assert_eq!(normalize(Some(0.0)), 1.0);
        assert_eq!(normalize(Some(-2.0)), 1.0);
    }

    #[test]
    fn an_enlarged_pointer_reads_as_its_size() {
        assert_eq!(normalize(Some(1.0)), 1.0);
        assert_eq!(normalize(Some(1.75)), 1.75);
        assert_eq!(normalize(Some(9.0)), 4.0);
    }

    #[test]
    fn this_machine_answers_with_a_usable_size() {
        let scale = system_pointer_scale();
        assert!((1.0..=4.0).contains(&scale));
    }
}
