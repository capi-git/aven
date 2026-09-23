fn main() {
    println!("cargo:rerun-if-env-changed=CEF_BUILD_DIR");
    println!("cargo:rerun-if-changed=chromium");
    if std::env::var_os("CARGO_FEATURE_CHROMIUM").is_some()
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos")
    {
        let build = std::env::var_os("CEF_BUILD_DIR")
            .map(std::path::PathBuf::from)
            .expect("Chromium build required: run scripts/build-chromium.sh and set CEF_BUILD_DIR");
        let archive = build.join("libsupermono_chromium.a");
        assert!(
            archive.is_file(),
            "Chromium native archive is missing; run scripts/build-chromium.sh"
        );
        println!("cargo:rerun-if-changed={}", archive.display());
        println!("cargo:rustc-link-search=native={}", build.display());
        println!("cargo:rustc-link-lib=static=supermono_chromium");
        println!("cargo:rustc-link-lib=c++");
        println!("cargo:rustc-link-lib=framework=Cocoa");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rustc-link-lib=framework=ImageIO");
        println!("cargo:rustc-link-lib=framework=IOSurface");
        println!("cargo:rustc-link-arg=-Wl,-ObjC");
    }
    // generate_context! embeds icons; cargo ignores them unless we watch here.
    println!("cargo:rerun-if-changed=icons");
    // GNU ld exports every symbol from the Tauri cdylib and blows past the
    // 65535 PE ordinal limit. Hide them; the desktop exe links the rlib.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo::rustc-link-arg-cdylib=-Wl,--exclude-libs=ALL,--exclude-all-symbols");
    }
    tauri_build::build()
}
