//! Display copies of large pictures shown in chats.
//!
//! A chat column is at most 800 px wide, yet screenshots are often 2000–3000
//! px. WebKit rescales the full bitmap every frame of a pane resize and keeps
//! it decoded in memory, so chats show a smaller copy made once with ImageIO
//! and cached on disk. The image viewer and Open keep using the original.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use crate::fs::{expand_home, read_binary_file_sync, MAX_PREVIEW_BYTES};

/// Twice the 800 px chat column, so copies stay sharp on Retina screens.
pub(crate) const DEFAULT_DISPLAY_WIDTH: u32 = 1600;
const MIN_DISPLAY_WIDTH: u32 = 64;
const MAX_DISPLAY_WIDTH: u32 = 4096;
const CACHE_DIR: &str = "chat-pictures";
/// The cache is trimmed back to `CACHE_KEEP_BYTES`, oldest first, once it
/// grows past `CACHE_MAX_BYTES`.
const CACHE_MAX_BYTES: u64 = 256 * 1024 * 1024;
const CACHE_KEEP_BYTES: u64 = 192 * 1024 * 1024;
const COPY_EXTENSION: &str = "img";

/// The picture a chat should draw for `path`: a cached copy no wider than
/// `max_width` pixels, or the original when it is already small enough, is
/// not a still image ImageIO can scale, or a copy cannot be made. The path
/// is checked exactly as `read_binary_file` checks it.
#[tauri::command]
pub async fn read_display_image(
    app: AppHandle,
    path: String,
    max_width: Option<u32>,
) -> Result<tauri::ipc::Response, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .ok()
        .map(|dir| dir.join(CACHE_DIR));
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        display_image_bytes(&path, max_width, cache.as_deref())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

pub(crate) fn display_image_bytes(
    path: &str,
    max_width: Option<u32>,
    cache: Option<&Path>,
) -> Result<Vec<u8>, String> {
    let source = expand_home(path);
    let meta = std::fs::metadata(&source).map_err(|e| format!("{}: {e}", source.display()))?;
    if !meta.is_file() {
        return Err("Not a file".into());
    }
    if meta.len() > MAX_PREVIEW_BYTES {
        // Same refusal, in the same words, as the original reader.
        return read_binary_file_sync(path);
    }
    let width = clamp_width(max_width);
    if let Some(cache) = cache {
        if let Some(bytes) = cached_or_new_copy(&source, &meta, width, cache) {
            return Ok(bytes);
        }
    }
    read_binary_file_sync(path)
}

fn clamp_width(max_width: Option<u32>) -> u32 {
    max_width
        .unwrap_or(DEFAULT_DISPLAY_WIDTH)
        .clamp(MIN_DISPLAY_WIDTH, MAX_DISPLAY_WIDTH)
}

/// The cache file name: the path, its size and change time, and the width,
/// so an edited picture or a different width gets a new copy.
fn cache_key(source: &Path, len: u64, modified: Option<SystemTime>, width: u32) -> String {
    let stamp = modified
        .and_then(|time| time.duration_since(SystemTime::UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .unwrap_or_default();
    let mut hash = Sha256::new();
    hash.update(source.to_string_lossy().as_bytes());
    hash.update([0]);
    hash.update(format!("{len}:{stamp}:{width}").as_bytes());
    let digest = hash.finalize();
    let mut name = String::with_capacity(digest.len() * 2 + 4);
    for byte in digest {
        name.push_str(&format!("{byte:02x}"));
    }
    name.push('.');
    name.push_str(COPY_EXTENSION);
    name
}

/// A copy from the cache, or a new one written to it. `None` means draw the
/// original.
fn cached_or_new_copy(
    source: &Path,
    meta: &std::fs::Metadata,
    width: u32,
    cache: &Path,
) -> Option<Vec<u8>> {
    let target = cache.join(cache_key(source, meta.len(), meta.modified().ok(), width));
    if let Ok(bytes) = std::fs::read(&target) {
        if !bytes.is_empty() {
            // Recently drawn copies outlive older ones when the cache is trimmed.
            if let Ok(file) = std::fs::File::options().write(true).open(&target) {
                let _ = file.set_modified(SystemTime::now());
            }
            return Some(bytes);
        }
    }
    let size = platform::pixel_size(source)?;
    let (max_pixel, _) = scaled_size(size, width)?;
    std::fs::create_dir_all(cache).ok()?;
    let partial = cache.join(format!(
        ".{}-{}.partial",
        std::process::id(),
        target.file_name()?.to_string_lossy()
    ));
    let written = platform::write_copy(source, &partial, max_pixel).and_then(|()| {
        std::fs::read(&partial)
            .ok()
            .filter(|bytes| !bytes.is_empty())
    });
    let Some(bytes) = written else {
        let _ = std::fs::remove_file(&partial);
        return None;
    };
    if std::fs::rename(&partial, &target).is_err() {
        let _ = std::fs::remove_file(&partial);
    }
    trim_cache(cache, CACHE_MAX_BYTES, CACHE_KEEP_BYTES);
    Some(bytes)
}

/// The longest side to ask ImageIO for, and the copy's size, when a picture
/// of `size` (as drawn, after its orientation) is wider than `max_width`.
/// `None` means the original is small enough. Never upscales.
pub(crate) fn scaled_size(
    (width, height): (u32, u32),
    max_width: u32,
) -> Option<(u32, (u32, u32))> {
    if width == 0 || height == 0 || width <= max_width {
        return None;
    }
    let scale = f64::from(max_width) / f64::from(width);
    let new_height = ((f64::from(height) * scale).round() as u32).max(1);
    let size = (max_width, new_height);
    Some((size.0.max(size.1), size))
}

/// Removes the least recently used copies once the folder holds more than
/// `max` bytes, until it holds at most `keep`. Stale partial files go too.
fn trim_cache(cache: &Path, max: u64, keep: u64) {
    let Ok(entries) = std::fs::read_dir(cache) else {
        return;
    };
    let mut files: Vec<(SystemTime, u64, PathBuf)> = Vec::new();
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let path = entry.path();
        let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
        let partial = path.extension().is_some_and(|ext| ext == "partial");
        if partial {
            let old = SystemTime::now()
                .duration_since(modified)
                .is_ok_and(|age| age.as_secs() > 3600);
            if old {
                let _ = std::fs::remove_file(&path);
            }
            continue;
        }
        total += meta.len();
        files.push((modified, meta.len(), path));
    }
    if total <= max {
        return;
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    for (_, len, path) in files {
        if total <= keep {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            total = total.saturating_sub(len);
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::c_void;
    use std::os::unix::ffi::OsStrExt;
    use std::path::Path;

    type Cf = *const c_void;

    #[repr(C)]
    struct Opaque {
        _private: [u8; 0],
    }

    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        static kCFBooleanTrue: Cf;
        static kCFBooleanFalse: Cf;
        static kCFTypeDictionaryKeyCallBacks: Opaque;
        static kCFTypeDictionaryValueCallBacks: Opaque;
        fn CFRelease(value: Cf);
        fn CFEqual(a: Cf, b: Cf) -> bool;
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: Cf,
            buffer: *const u8,
            length: isize,
            is_directory: bool,
        ) -> Cf;
        fn CFNumberCreate(allocator: Cf, kind: isize, value: *const c_void) -> Cf;
        fn CFNumberGetValue(number: Cf, kind: isize, value: *mut c_void) -> bool;
        fn CFDictionaryCreate(
            allocator: Cf,
            keys: *const Cf,
            values: *const Cf,
            count: isize,
            key_callbacks: *const Opaque,
            value_callbacks: *const Opaque,
        ) -> Cf;
        fn CFDictionaryGetValue(dictionary: Cf, key: Cf) -> Cf;
        fn CFStringCreateWithCString(
            allocator: Cf,
            text: *const std::ffi::c_char,
            encoding: u32,
        ) -> Cf;
    }

    #[link(name = "ImageIO", kind = "framework")]
    unsafe extern "C" {
        static kCGImagePropertyPixelWidth: Cf;
        static kCGImagePropertyPixelHeight: Cf;
        static kCGImagePropertyOrientation: Cf;
        static kCGImageSourceShouldCache: Cf;
        static kCGImageSourceCreateThumbnailFromImageAlways: Cf;
        static kCGImageSourceCreateThumbnailWithTransform: Cf;
        static kCGImageSourceThumbnailMaxPixelSize: Cf;
        static kCGImageDestinationLossyCompressionQuality: Cf;
        fn CGImageSourceCreateWithURL(url: Cf, options: Cf) -> Cf;
        fn CGImageSourceGetCount(source: Cf) -> usize;
        fn CGImageSourceGetType(source: Cf) -> Cf;
        fn CGImageSourceCopyPropertiesAtIndex(source: Cf, index: usize, options: Cf) -> Cf;
        fn CGImageSourceCreateThumbnailAtIndex(source: Cf, index: usize, options: Cf) -> Cf;
        fn CGImageDestinationCreateWithURL(url: Cf, kind: Cf, count: usize, options: Cf) -> Cf;
        fn CGImageDestinationAddImage(destination: Cf, image: Cf, properties: Cf);
        fn CGImageDestinationFinalize(destination: Cf) -> bool;
    }

    const UTF8: u32 = 0x0800_0100;
    /// kCFNumberSInt64Type
    const SINT64: isize = 4;
    /// kCFNumberFloat64Type
    const FLOAT64: isize = 6;

    struct Owned(Cf);
    impl Owned {
        fn new(value: Cf) -> Option<Self> {
            (!value.is_null()).then_some(Self(value))
        }
    }
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe { CFRelease(self.0) }
        }
    }

    fn file_url(path: &Path) -> Option<Owned> {
        let bytes = path.as_os_str().as_bytes();
        Owned::new(unsafe {
            CFURLCreateFromFileSystemRepresentation(
                std::ptr::null(),
                bytes.as_ptr(),
                bytes.len() as isize,
                false,
            )
        })
    }

    fn string(text: &std::ffi::CStr) -> Option<Owned> {
        Owned::new(unsafe { CFStringCreateWithCString(std::ptr::null(), text.as_ptr(), UTF8) })
    }

    fn dictionary(pairs: &[(Cf, Cf)]) -> Option<Owned> {
        let keys: Vec<Cf> = pairs.iter().map(|(key, _)| *key).collect();
        let values: Vec<Cf> = pairs.iter().map(|(_, value)| *value).collect();
        Owned::new(unsafe {
            CFDictionaryCreate(
                std::ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                pairs.len() as isize,
                &kCFTypeDictionaryKeyCallBacks,
                &kCFTypeDictionaryValueCallBacks,
            )
        })
    }

    fn number_value(dictionary: Cf, key: Cf) -> Option<i64> {
        let number = unsafe { CFDictionaryGetValue(dictionary, key) };
        if number.is_null() {
            return None;
        }
        let mut value: i64 = 0;
        let ok = unsafe { CFNumberGetValue(number, SINT64, (&mut value as *mut i64).cast()) };
        ok.then_some(value)
    }

    /// A source that reads the file lazily and keeps no decoded cache.
    fn open(path: &Path) -> Option<Owned> {
        let url = file_url(path)?;
        let options = dictionary(&[(unsafe { kCGImageSourceShouldCache }, unsafe {
            kCFBooleanFalse
        })])?;
        let source = Owned::new(unsafe { CGImageSourceCreateWithURL(url.0, options.0) })?;
        // Animated GIF, WebP or PNG would lose every frame but the first.
        (unsafe { CGImageSourceGetCount(source.0) } == 1).then_some(source)
    }

    /// The picture's size as drawn, after its EXIF orientation, read from
    /// the file's header without decoding it.
    pub(super) fn pixel_size(path: &Path) -> Option<(u32, u32)> {
        let source = open(path)?;
        let properties = Owned::new(unsafe {
            CGImageSourceCopyPropertiesAtIndex(source.0, 0, std::ptr::null())
        })?;
        let width = number_value(properties.0, unsafe { kCGImagePropertyPixelWidth })?;
        let height = number_value(properties.0, unsafe { kCGImagePropertyPixelHeight })?;
        let orientation =
            number_value(properties.0, unsafe { kCGImagePropertyOrientation }).unwrap_or(1);
        let (width, height) = (u32::try_from(width).ok()?, u32::try_from(height).ok()?);
        // Orientations 5–8 turn the picture a quarter turn.
        Some(if (5..=8).contains(&orientation) {
            (height, width)
        } else {
            (width, height)
        })
    }

    /// Writes a copy whose longest side is `max_pixel`, upright, as JPEG for
    /// photos and PNG for everything else (screenshots keep sharp text).
    pub(super) fn write_copy(source_path: &Path, target: &Path, max_pixel: u32) -> Option<()> {
        let source = open(source_path)?;
        let max = i64::from(max_pixel);
        let max = Owned::new(unsafe {
            CFNumberCreate(std::ptr::null(), SINT64, (&max as *const i64).cast())
        })?;
        let options = dictionary(&[
            (
                unsafe { kCGImageSourceCreateThumbnailFromImageAlways },
                unsafe { kCFBooleanTrue },
            ),
            (
                unsafe { kCGImageSourceCreateThumbnailWithTransform },
                unsafe { kCFBooleanTrue },
            ),
            (unsafe { kCGImageSourceThumbnailMaxPixelSize }, max.0),
        ])?;
        let image =
            Owned::new(unsafe { CGImageSourceCreateThumbnailAtIndex(source.0, 0, options.0) })?;

        let jpeg = string(c"public.jpeg")?;
        let heic = string(c"public.heic")?;
        let kind = unsafe { CGImageSourceGetType(source.0) };
        let photo = !kind.is_null() && unsafe { CFEqual(kind, jpeg.0) || CFEqual(kind, heic.0) };
        let png = string(c"public.png")?;
        let output = if photo { &jpeg } else { &png };
        let quality = 0.9f64;
        let quality = Owned::new(unsafe {
            CFNumberCreate(std::ptr::null(), FLOAT64, (&quality as *const f64).cast())
        })?;
        let properties = dictionary(&[(
            unsafe { kCGImageDestinationLossyCompressionQuality },
            quality.0,
        )])?;

        let url = file_url(target)?;
        let destination = Owned::new(unsafe {
            CGImageDestinationCreateWithURL(url.0, output.0, 1, std::ptr::null())
        })?;
        unsafe { CGImageDestinationAddImage(destination.0, image.0, properties.0) };
        unsafe { CGImageDestinationFinalize(destination.0) }.then_some(())
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    #[cfg(test)]
    unsafe extern "C" {
        fn CGColorSpaceCreateDeviceRGB() -> Cf;
        fn CGBitmapContextCreate(
            data: *mut c_void,
            width: usize,
            height: usize,
            bits_per_component: usize,
            bytes_per_row: usize,
            space: Cf,
            bitmap_info: u32,
        ) -> Cf;
        fn CGBitmapContextCreateImage(context: Cf) -> Cf;
    }

    /// Writes a blank test picture with CoreGraphics, tagged with an EXIF
    /// orientation.
    #[cfg(test)]
    pub(super) fn write_test_picture(
        path: &Path,
        width: usize,
        height: usize,
        kind: &std::ffi::CStr,
        orientation: i64,
    ) {
        unsafe {
            let space = Owned::new(CGColorSpaceCreateDeviceRGB()).unwrap();
            // kCGImageAlphaNoneSkipLast, so JPEG can take it too.
            let context = Owned::new(CGBitmapContextCreate(
                std::ptr::null_mut(),
                width,
                height,
                8,
                0,
                space.0,
                5,
            ))
            .unwrap();
            let image = Owned::new(CGBitmapContextCreateImage(context.0)).unwrap();
            let url = file_url(path).unwrap();
            let kind = string(kind).unwrap();
            let destination = Owned::new(CGImageDestinationCreateWithURL(
                url.0,
                kind.0,
                1,
                std::ptr::null(),
            ))
            .unwrap();
            let number = Owned::new(CFNumberCreate(
                std::ptr::null(),
                SINT64,
                (&orientation as *const i64).cast(),
            ))
            .unwrap();
            let properties = dictionary(&[(kCGImagePropertyOrientation, number.0)]).unwrap();
            CGImageDestinationAddImage(destination.0, image.0, properties.0);
            assert!(CGImageDestinationFinalize(destination.0));
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::Path;

    /// Other systems draw the original.
    pub(super) fn pixel_size(_path: &Path) -> Option<(u32, u32)> {
        None
    }

    pub(super) fn write_copy(_source: &Path, _target: &Path, _max_pixel: u32) -> Option<()> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aven-chat-pictures-{}-{name}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn wide_pictures_scale_to_the_width_and_keep_their_shape() {
        assert_eq!(scaled_size((3000, 1900), 1600), Some((1600, (1600, 1013))));
        // A tall picture asks ImageIO for its height as the longest side.
        assert_eq!(scaled_size((2000, 6000), 1600), Some((4800, (1600, 4800))));
        // A very wide strip keeps at least one row.
        assert_eq!(scaled_size((100_000, 1), 1600), Some((1600, (1600, 1))));
    }

    #[test]
    fn small_or_empty_pictures_are_never_scaled() {
        assert_eq!(scaled_size((1600, 900), 1600), None);
        assert_eq!(scaled_size((800, 5000), 1600), None);
        assert_eq!(scaled_size((0, 100), 1600), None);
        assert_eq!(scaled_size((100, 0), 1600), None);
    }

    #[test]
    fn widths_are_clamped_and_default_to_twice_the_column() {
        assert_eq!(clamp_width(None), DEFAULT_DISPLAY_WIDTH);
        assert_eq!(clamp_width(Some(1)), MIN_DISPLAY_WIDTH);
        assert_eq!(clamp_width(Some(1_000_000)), MAX_DISPLAY_WIDTH);
        assert_eq!(clamp_width(Some(800)), 800);
    }

    #[test]
    fn cache_keys_change_with_the_file_and_the_width() {
        let path = Path::new("/tmp/shot.png");
        let time = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(10);
        let later = time + std::time::Duration::from_nanos(1);
        let key = cache_key(path, 10, Some(time), 1600);
        assert!(key.ends_with(".img"));
        assert_eq!(key, cache_key(path, 10, Some(time), 1600));
        assert_ne!(key, cache_key(path, 11, Some(time), 1600));
        assert_ne!(key, cache_key(path, 10, Some(later), 1600));
        assert_ne!(key, cache_key(path, 10, Some(time), 800));
        assert_ne!(
            key,
            cache_key(Path::new("/tmp/other.png"), 10, Some(time), 1600)
        );
    }

    #[test]
    fn trimming_removes_the_oldest_copies_first() {
        let dir = temp_dir("trim");
        let now = SystemTime::now();
        for (index, name) in ["a.img", "b.img", "c.img"].iter().enumerate() {
            let path = dir.join(name);
            std::fs::write(&path, vec![0u8; 100]).unwrap();
            let file = std::fs::File::options().write(true).open(&path).unwrap();
            file.set_modified(now - std::time::Duration::from_secs(100 - index as u64 * 10))
                .unwrap();
        }
        // Under the limit: nothing goes.
        trim_cache(&dir, 300, 150);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 3);
        trim_cache(&dir, 250, 150);
        assert!(!dir.join("a.img").exists());
        assert!(!dir.join("b.img").exists());
        assert!(dir.join("c.img").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn unreadable_or_unscalable_files_fall_back_to_the_original() {
        let dir = temp_dir("fallback");
        let cache = dir.join("cache");
        let text = dir.join("notes.txt");
        std::fs::write(&text, b"not a picture").unwrap();
        let bytes = display_image_bytes(text.to_str().unwrap(), None, Some(&cache)).unwrap();
        assert_eq!(bytes, b"not a picture");
        // No cache: still the original.
        let bytes = display_image_bytes(text.to_str().unwrap(), None, None).unwrap();
        assert_eq!(bytes, b"not a picture");
        // Same refusals as the original reader.
        assert!(display_image_bytes(dir.to_str().unwrap(), None, None).is_err());
        assert!(
            display_image_bytes(dir.join("missing.png").to_str().unwrap(), None, None).is_err()
        );
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    mod macos {
        use super::*;
        fn write_picture(path: &Path, width: usize, height: usize, kind: &std::ffi::CStr) {
            platform::write_test_picture(path, width, height, kind, 1);
        }

        fn write_oriented_picture(
            path: &Path,
            width: usize,
            height: usize,
            kind: &std::ffi::CStr,
            orientation: i64,
        ) {
            platform::write_test_picture(path, width, height, kind, orientation);
        }

        fn png_size(bytes: &[u8]) -> (u32, u32) {
            assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
            let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
            let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
            (width, height)
        }

        #[test]
        fn wide_screenshots_get_a_cached_copy_at_the_display_width() {
            let dir = temp_dir("copy");
            let cache = dir.join("cache");
            let shot = dir.join("shot.png");
            write_picture(&shot, 3000, 1900, c"public.png");
            assert_eq!(platform::pixel_size(&shot), Some((3000, 1900)));

            let copy = display_image_bytes(shot.to_str().unwrap(), None, Some(&cache)).unwrap();
            assert_eq!(png_size(&copy), (1600, 1013));
            let cached: Vec<_> = std::fs::read_dir(&cache).unwrap().flatten().collect();
            assert_eq!(cached.len(), 1, "one copy, no partial files left");
            assert!(cached[0].file_name().to_string_lossy().ends_with(".img"));

            // A second read comes from the cache, byte for byte.
            let again = display_image_bytes(shot.to_str().unwrap(), None, Some(&cache)).unwrap();
            assert_eq!(again, copy);

            // Another width is another copy.
            let small =
                display_image_bytes(shot.to_str().unwrap(), Some(160), Some(&cache)).unwrap();
            assert_eq!(png_size(&small), (160, 101));
            assert_eq!(std::fs::read_dir(&cache).unwrap().count(), 2);
            std::fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn small_pictures_come_back_unchanged_and_are_not_cached() {
            let dir = temp_dir("small");
            let cache = dir.join("cache");
            let shot = dir.join("small.png");
            write_picture(&shot, 800, 600, c"public.png");
            let original = std::fs::read(&shot).unwrap();
            let bytes = display_image_bytes(shot.to_str().unwrap(), None, Some(&cache)).unwrap();
            assert_eq!(bytes, original);
            assert!(!cache.exists());
            std::fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn photos_stay_jpeg() {
            let dir = temp_dir("photo");
            let cache = dir.join("cache");
            let photo = dir.join("photo.jpg");
            write_picture(&photo, 2400, 1600, c"public.jpeg");
            let bytes = display_image_bytes(photo.to_str().unwrap(), None, Some(&cache)).unwrap();
            assert_eq!(&bytes[..3], &[0xff, 0xd8, 0xff]);
            let mut decoder = jpeg_decoder::Decoder::new(bytes.as_slice());
            decoder.read_info().unwrap();
            let info = decoder.info().unwrap();
            assert_eq!((info.width, info.height), (1600, 1067));
            std::fs::remove_dir_all(&dir).unwrap();
        }

        #[test]
        fn turned_photos_are_measured_and_copied_upright() {
            let dir = temp_dir("turned");
            let cache = dir.join("cache");
            let photo = dir.join("turned.jpg");
            // Stored 3000 wide, drawn a quarter turn round: 1500 wide.
            write_oriented_picture(&photo, 3000, 1500, c"public.jpeg", 6);
            assert_eq!(platform::pixel_size(&photo), Some((1500, 3000)));
            // Already narrow enough once upright: the original comes back.
            let original = std::fs::read(&photo).unwrap();
            let bytes = display_image_bytes(photo.to_str().unwrap(), None, Some(&cache)).unwrap();
            assert_eq!(bytes, original);
            // Narrower still: an upright copy 750 wide and 1500 tall.
            let bytes =
                display_image_bytes(photo.to_str().unwrap(), Some(750), Some(&cache)).unwrap();
            let mut decoder = jpeg_decoder::Decoder::new(bytes.as_slice());
            decoder.read_info().unwrap();
            let info = decoder.info().unwrap();
            assert_eq!((info.width, info.height), (750, 1500));
            std::fs::remove_dir_all(&dir).unwrap();
        }
    }
}
