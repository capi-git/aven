#!/usr/bin/env python3
"""Read-only preflight for an Aven notarized release with automatic updates; never reads signing secrets."""
import argparse
import json
from pathlib import Path
import plistlib
import re
import subprocess
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def merge(base, override):
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value
    return base


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="Public Tauri release config override")
    parser.add_argument("--app", type=Path, help="Final packaged macOS app to verify")
    args = parser.parse_args()
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    if args.config:
        merge(config, json.loads(args.config.read_text()))
    checks = []

    def record(name, passed, detail):
        checks.append({"check": name, "passed": bool(passed), "detail": detail})

    bundle = config.get("bundle", {})
    signing = bundle.get("macOS", {}).get("signingIdentity", "")
    updater = config.get("plugins", {}).get("updater", {})
    record("Developer ID configured", isinstance(signing, str) and signing.startswith("Developer ID Application:"),
           "Use a stable Developer ID Application identity for distributed builds.")
    record("Final Chromium updater packager configured", (ROOT / "scripts/package-update.py").is_file(),
           "Sign the complete Chromium app archive after packaging; do not ship Tauri's intermediate host bundle.")
    record("Updater public key configured", bool(str(updater.get("pubkey", "")).strip()),
           "Only the updater public key belongs in app configuration; keep private keys outside the repository.")
    endpoints = updater.get("endpoints", [])
    valid_endpoints = isinstance(endpoints, list) and bool(endpoints) and all(
        isinstance(url, str) and urlparse(url).scheme == "https" and urlparse(url).netloc
        and not urlparse(url).username and not urlparse(url).password
        and "hardbeat920/monocode" not in url.lower() for url in endpoints
    )
    record("Aven update feed configured", valid_endpoints,
           "Use an HTTPS release feed owned by Aven, never another application's feed.")
    marker = (ROOT / "src/lib/personalBuild.ts").read_text()
    record("Manual-only updater guard reviewed", not re.search(r"IS_PERSONAL_BUILD\s*=\s*true\b", marker),
           "The current guard intentionally prevents downloading upstream builds. Replace it only when a Aven feed is configured and verified.")

    if args.app:
        info_path = args.app / "Contents/Info.plist"
        if not info_path.is_file():
            record("App bundle exists", False, "Select the final packaged .app.")
        else:
            info = plistlib.loads(info_path.read_bytes())
            record("Bundle identity and version", info.get("CFBundleIdentifier") == config.get("identifier")
                   and info.get("CFBundleShortVersionString") == config.get("version"),
                   "The installed/update identity and version must match the release configuration.")
            commands = [
                ("Strict bundle signature", ["codesign", "--verify", "--deep", "--strict", str(args.app)]),
                ("Stapled notarization ticket", ["xcrun", "stapler", "validate", str(args.app)]),
            ]
            for name, command in commands:
                result = subprocess.run(command, capture_output=True, text=True)
                record(name, result.returncode == 0, "Passed." if result.returncode == 0 else "Verification did not pass.")
            signature = subprocess.run(["codesign", "-dv", "--verbose=2", str(args.app)], capture_output=True, text=True)
            record("Final app has Developer ID signature", signature.returncode == 0
                   and "Authority=Developer ID Application:" in signature.stderr
                   and "TeamIdentifier=not set" not in signature.stderr,
                   "Ad-hoc signatures change identity between builds and are unsuitable for the release channel.")
            record("Bundled Chromium runtime", (args.app / "Contents/Frameworks/Chromium Embedded Framework.framework").exists(),
                   "A plain Tauri bundle does not include Aven's browser runtime.")
    else:
        record("Final packaged app verified", False, "Pass --app after packaging and notarization.")
    ready = all(check["passed"] for check in checks)
    print(json.dumps({"configuration_ready": ready, "checks": checks,
                      "scope": "Configuration and packaging only; does not certify crash-free operation, update delivery, or website compatibility."}, indent=2))
    return 0 if ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
