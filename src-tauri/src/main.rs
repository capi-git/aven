#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if let Some(code) = aven_lib::run_startup_cli() {
        std::process::exit(code);
    }
    if std::env::args().nth(1).as_deref() == Some("control") {
        std::process::exit(aven_lib::control_cli::run(
            std::env::args().skip(2).collect(),
        ));
    }
    if let Some(code) = aven_lib::run_browser_cli() {
        std::process::exit(code);
    }
    #[cfg(all(debug_assertions, target_os = "macos"))]
    aven_lib::ensure_macos_dev_bundle();
    aven_lib::run()
}
