//! Handle CLI discovery before initializing the desktop app or its browser.
use std::ffi::OsString;

const HELP: &str = "Aven — one UI for every agent harness

Usage: monocode [COMMAND]

  (no arguments)             Open the Aven desktop app
  -h, --help                 Show this help without opening the app
  -V, --version              Show the installed version
  control --help             Show orchestration control commands
  --supermono-browser --help Show in-app browser commands

Browser and orchestration commands use the scoped connection supplied by Aven.
";

#[derive(Debug, PartialEq)]
enum Startup {
    Desktop,
    Control,
    Browser,
    Help,
    Version,
    Invalid,
}

fn classify(args: &[OsString], macos: bool) -> Startup {
    let Some(first) = args.first().and_then(|arg| arg.to_str()) else {
        return if args.is_empty() {
            Startup::Desktop
        } else {
            Startup::Invalid
        };
    };
    match first {
        "control" => Startup::Control,
        "--supermono-browser" => Startup::Browser,
        "--help" | "-h" | "help" if args.len() == 1 => Startup::Help,
        "--version" | "-V" if args.len() == 1 => Startup::Version,
        // Older LaunchServices versions pass a process serial number when
        // opening an app from Finder. Only that exact invocation opens the UI.
        value if macos && args.len() == 1 && is_process_serial_number(value) => Startup::Desktop,
        _ => Startup::Invalid,
    }
}

fn is_process_serial_number(value: &str) -> bool {
    value
        .strip_prefix("-psn_")
        .and_then(|value| value.split_once('_'))
        .is_some_and(|(high, low)| {
            [high, low]
                .iter()
                .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        })
}

/// Return an exit code for discovery/errors; only desktop and scoped commands
/// continue to their existing entry points. Never echo arbitrary arguments,
/// which may contain an agent's credentials or private request data.
pub fn run_startup_cli() -> Option<i32> {
    match classify(
        &std::env::args_os().skip(1).collect::<Vec<_>>(),
        cfg!(target_os = "macos"),
    ) {
        Startup::Desktop | Startup::Control | Startup::Browser => None,
        Startup::Help => {
            print!("{HELP}");
            Some(0)
        }
        Startup::Version => {
            println!("Aven {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        Startup::Invalid => {
            eprintln!("Unsupported command or arguments. Run monocode --help for usage.");
            Some(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route(args: &[&str], macos: bool) -> Startup {
        classify(&args.iter().map(OsString::from).collect::<Vec<_>>(), macos)
    }

    #[test]
    fn discovery_commands_never_launch_the_desktop() {
        for flag in ["--help", "-h", "help"] {
            assert_eq!(route(&[flag], false), Startup::Help);
        }
        for flag in ["--version", "-V"] {
            assert_eq!(route(&[flag], false), Startup::Version);
        }
    }

    #[test]
    fn existing_scoped_commands_keep_ownership_of_their_arguments() {
        for args in [vec![], vec!["--help"], vec!["list"], vec!["--unknown"]] {
            let mut control = vec!["control"];
            control.extend(&args);
            assert_eq!(route(&control, true), Startup::Control);
            let mut browser = vec!["--supermono-browser"];
            browser.extend(&args);
            assert_eq!(route(&browser, true), Startup::Browser);
        }
    }

    #[test]
    fn only_normal_launches_and_macos_process_serial_numbers_open_the_desktop() {
        assert_eq!(route(&[], false), Startup::Desktop);
        assert_eq!(route(&[], true), Startup::Desktop);
        assert_eq!(route(&["-psn_0_12345"], true), Startup::Desktop);
        assert_eq!(route(&["-psn_0_12345"], false), Startup::Invalid);
        for args in [
            vec!["-psn_"],
            vec!["-psn_1_"],
            vec!["-psn_a_2"],
            vec!["-psn_1_2_3"],
            vec!["-psn_0_12345", "--help"],
            vec!["--help", "list"],
            vec!["--version", "list"],
            vec!["--supermono-browesr"],
            vec!["--type=renderer"],
            vec!["list"],
            vec![""],
        ] {
            assert_eq!(route(&args, true), Startup::Invalid, "{args:?}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn non_unicode_arguments_cannot_launch_the_desktop() {
        use std::os::unix::ffi::OsStringExt;
        assert_eq!(
            classify(&[OsString::from_vec(vec![0xff])], true),
            Startup::Invalid
        );
    }
}
