//! Keeps Aven's dot pointer steady while the mouse moves.
//!
//! The dot is a CSS image cursor (`src/pointer.css`). WebKit sends the page's
//! cursor to the app on every mouse move and builds a fresh `NSCursor` from
//! the image each time. It skips the system's own cursors because they are
//! shared objects, but a fresh image cursor never matches the one showing,
//! so the window server is handed a new cursor image on every move, and the
//! pointer visibly flickers.
//!
//! This wraps `-[NSCursor set]`: a cursor whose hot spot, size and pixels
//! match the one Aven set last is skipped while that one is still showing.
//! "Still showing" is read from the window server's cursor seed, which
//! changes whenever any app (or the system) changes the pointer; without that
//! seed nothing is ever skipped. Every other cursor, and every cursor after
//! the pointer changed elsewhere, is set as before.
#![cfg(target_os = "macos")]

use objc2::runtime::{AnyClass, AnyObject, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSPoint, NSSize};
use std::cell::Cell;
use std::ffi::c_void;
use std::hash::{Hash, Hasher};
use std::sync::OnceLock;

/// What a cursor looks like: its hot spot, size and a hash of its pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Look {
    hot_spot: (u64, u64),
    size: (u64, u64),
    pixels: (usize, usize, usize, u64),
}

/// The cursor Aven set last and the window server's seed right after.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Shown {
    cursor: usize,
    look: Look,
    seed: i32,
}

/// Pure: whether a cursor that looks like `look` would change nothing.
fn unchanged(shown: Option<Shown>, current: usize, seed: Option<i32>, look: Option<Look>) -> bool {
    match (shown, seed, look) {
        (Some(shown), Some(seed), Some(look)) => {
            shown.cursor == current && shown.seed == seed && shown.look == look
        }
        _ => false,
    }
}

type SetImp = unsafe extern "C-unwind" fn(*mut AnyObject, Sel);
type SeedFn = unsafe extern "C" fn() -> i32;

static ORIGINAL_SET: OnceLock<SetImp> = OnceLock::new();
static SEED: OnceLock<Option<SeedFn>> = OnceLock::new();

thread_local! {
    static SHOWN: Cell<Option<Shown>> = const { Cell::new(None) };
}

#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGImageGetWidth(image: *const c_void) -> usize;
    fn CGImageGetHeight(image: *const c_void) -> usize;
    fn CGImageGetBytesPerRow(image: *const c_void) -> usize;
    fn CGImageGetDataProvider(image: *const c_void) -> *const c_void;
    fn CGDataProviderCopyData(provider: *const c_void) -> *const c_void;
}

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    fn CFDataGetLength(data: *const c_void) -> isize;
    fn CFRelease(value: *const c_void);
}

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const std::ffi::c_char) -> *mut c_void;
}

/// `CGSCurrentCursorSeed`, looked up at run time so a system without it only
/// loses the skip.
fn seed() -> Option<i32> {
    let function = SEED.get_or_init(|| {
        // RTLD_DEFAULT
        let handle = -2isize as *mut c_void;
        let symbol = unsafe { dlsym(handle, c"CGSCurrentCursorSeed".as_ptr()) };
        (!symbol.is_null()).then(|| unsafe { std::mem::transmute::<*mut c_void, SeedFn>(symbol) })
    });
    function.map(|function| unsafe { function() })
}

/// How `cursor` looks, or `None` when its image can't be read.
unsafe fn look(cursor: *mut AnyObject) -> Option<Look> {
    if cursor.is_null() {
        return None;
    }
    let hot_spot: NSPoint = msg_send![cursor, hotSpot];
    let image: *mut AnyObject = msg_send![cursor, image];
    if image.is_null() {
        return None;
    }
    let size: NSSize = msg_send![image, size];
    let cg_image: *const c_void = msg_send![
        image,
        CGImageForProposedRect: std::ptr::null_mut::<c_void>(),
        context: std::ptr::null_mut::<AnyObject>(),
        hints: std::ptr::null_mut::<AnyObject>()
    ];
    if cg_image.is_null() {
        return None;
    }
    let provider = CGImageGetDataProvider(cg_image);
    if provider.is_null() {
        return None;
    }
    let data = CGDataProviderCopyData(provider);
    if data.is_null() {
        return None;
    }
    let length = CFDataGetLength(data).max(0) as usize;
    let bytes = CFDataGetBytePtr(data);
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    if !bytes.is_null() {
        std::slice::from_raw_parts(bytes, length).hash(&mut hasher);
    }
    CFRelease(data);
    Some(Look {
        hot_spot: (hot_spot.x.to_bits(), hot_spot.y.to_bits()),
        size: (size.width.to_bits(), size.height.to_bits()),
        pixels: (
            CGImageGetWidth(cg_image),
            CGImageGetHeight(cg_image),
            CGImageGetBytesPerRow(cg_image),
            hasher.finish(),
        ),
    })
}

unsafe extern "C-unwind" fn set(cursor: *mut AnyObject, command: Sel) {
    let Some(original) = ORIGINAL_SET.get() else {
        return;
    };
    let current: *mut AnyObject = msg_send![class!(NSCursor), currentCursor];
    if current == cursor {
        original(cursor, command);
        return;
    }
    let look = look(cursor);
    let skip = unchanged(SHOWN.get(), current as usize, seed(), look);
    #[cfg(debug_assertions)]
    count(skip);
    if skip {
        return;
    }
    original(cursor, command);
    SHOWN.set(match (look, seed()) {
        (Some(look), Some(seed)) => Some(Shown {
            cursor: cursor as usize,
            look,
            seed,
        }),
        _ => None,
    });
}

/// Aven Dev only: how many new cursors were skipped, in the app's log.
#[cfg(debug_assertions)]
fn count(skipped: bool) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SKIPPED: AtomicU64 = AtomicU64::new(0);
    static PASSED: AtomicU64 = AtomicU64::new(0);
    if skipped {
        SKIPPED.fetch_add(1, Ordering::Relaxed);
    } else {
        PASSED.fetch_add(1, Ordering::Relaxed);
    }
    let (skipped, passed) = (
        SKIPPED.load(Ordering::Relaxed),
        PASSED.load(Ordering::Relaxed),
    );
    if (skipped + passed) % 500 == 0 {
        eprintln!("[pointer] new cursors: {skipped} skipped as unchanged, {passed} set");
    }
}

/// Wraps `-[NSCursor set]` once. Call on the main thread before any web view
/// shows a cursor; later calls do nothing.
pub fn install() {
    static INSTALLED: OnceLock<()> = OnceLock::new();
    INSTALLED.get_or_init(|| {
        let class: &AnyClass = class!(NSCursor);
        let Some(method) = class.instance_method(sel!(set)) else {
            return;
        };
        let replacement: Imp = unsafe { std::mem::transmute::<SetImp, Imp>(set as SetImp) };
        let previous = unsafe { method.set_implementation(replacement) };
        let _ = ORIGINAL_SET.set(unsafe { std::mem::transmute::<Imp, SetImp>(previous) });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::NSString;

    const LOOK: Look = Look {
        hot_spot: (1, 2),
        size: (3, 4),
        pixels: (64, 64, 256, 99),
    };

    fn shown() -> Option<Shown> {
        Some(Shown {
            cursor: 7,
            look: LOOK,
            seed: 40,
        })
    }

    #[test]
    fn skips_the_same_look_while_it_still_shows() {
        assert!(unchanged(shown(), 7, Some(40), Some(LOOK)));
    }

    #[test]
    fn sets_after_anything_else_changed_the_pointer() {
        // Another cursor was set since, inside Aven or by the system.
        assert!(!unchanged(shown(), 8, Some(40), Some(LOOK)));
        assert!(!unchanged(shown(), 7, Some(41), Some(LOOK)));
    }

    #[test]
    fn sets_a_different_look_or_when_unsure() {
        let brighter = Look {
            pixels: (64, 64, 256, 100),
            ..LOOK
        };
        assert!(!unchanged(shown(), 7, Some(40), Some(brighter)));
        assert!(!unchanged(None, 7, Some(40), Some(LOOK)));
        assert!(!unchanged(shown(), 7, None, Some(LOOK)));
        assert!(!unchanged(shown(), 7, Some(40), None));
    }

    /// A cursor built the way WebKit builds one from a CSS image.
    fn webkit_cursor(file: &str) -> Retained<AnyObject> {
        let path = format!(
            "{}/../src/assets/pointer/{file}",
            env!("CARGO_MANIFEST_DIR")
        );
        unsafe {
            let path = NSString::from_str(&path);
            let data: *mut AnyObject = msg_send![class!(NSData), dataWithContentsOfFile: &*path];
            assert!(!data.is_null(), "missing {file}");
            let rep: *mut AnyObject = msg_send![class!(NSBitmapImageRep), imageRepWithData: data];
            let cg_image: *const c_void = msg_send![rep, CGImage];
            let image: *mut AnyObject = msg_send![class!(NSImage), alloc];
            let image: *mut AnyObject =
                msg_send![image, initWithCGImage: cg_image, size: NSSize::new(0.0, 0.0)];
            let _: () = msg_send![image, setSize: NSSize::new(32.0, 32.0)];
            let cursor: *mut AnyObject = msg_send![class!(NSCursor), alloc];
            let cursor: *mut AnyObject =
                msg_send![cursor, initWithImage: image, hotSpot: NSPoint::new(16.0, 16.0)];
            let _: () = msg_send![image, release];
            Retained::from_raw(cursor).expect("cursor")
        }
    }

    #[test]
    fn two_copies_of_the_dot_look_the_same() {
        let first = webkit_cursor("dot-dark@2x.png");
        let second = webkit_cursor("dot-dark@2x.png");
        let first_ptr = Retained::as_ptr(&first) as *mut AnyObject;
        let second_ptr = Retained::as_ptr(&second) as *mut AnyObject;
        assert_ne!(first_ptr, second_ptr);
        let first_look = unsafe { look(first_ptr) }.expect("first look");
        assert_eq!(Some(first_look), unsafe { look(second_ptr) });
    }

    #[test]
    fn the_brighter_dot_looks_different() {
        let rest = webkit_cursor("dot-dark@2x.png");
        let press = webkit_cursor("dot-press-dark@2x.png");
        let rest = unsafe { look(Retained::as_ptr(&rest) as *mut AnyObject) };
        let press = unsafe { look(Retained::as_ptr(&press) as *mut AnyObject) };
        assert!(rest.is_some());
        assert_ne!(rest, press);
    }

    #[test]
    fn the_window_server_seed_is_available() {
        assert!(seed().is_some());
    }
}
