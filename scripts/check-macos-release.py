#!/usr/bin/env python3
"""Read-only preflight for an Aven notarized release with automatic updates; never reads signing secrets."""
import argparse
import importlib.util
import json
from pathlib import Path
import plistlib
import re
import subprocess
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
SIGNING_SPEC = importlib.util.spec_from_file_location("aven_release_signing", ROOT / "scripts/release-signing.py")
release_signing = importlib.util.module_from_spec(SIGNING_SPEC)
SIGNING_SPEC.loader.exec_module(release_signing)


def merge(base, override):
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value
    return base


def check_release(config, app=None):
    checks = []

    def record(name, passed, detail):
        checks.append({"check": name, "passed": bool(passed), "detail": detail})

    updater = config.get("plugins", {}).get("updater", {})
    try:
        policy = release_signing.policy()
        record("Developer ID configured", config.get("identifier") == policy["bundleId"],
               "The final Chromium app uses scripts/release-signing.json, team " + policy["teamId"]
               + " and bundle " + policy["bundleId"] + ". Tauri's intermediate bundle is not the release signer.")
        try:
            release_signing.preflight()
            record("Developer ID identity available", True, "A valid identity matches the configured release team.")
        except (RuntimeError, OSError, ValueError) as error:
            record("Developer ID identity available", False, str(error))
    except (RuntimeError, OSError, ValueError) as error:
        record("Developer ID configured", False, str(error))
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

    if app:
        info_path = app / "Contents/Info.plist"
        if not info_path.is_file():
            record("App bundle exists", False, "Select the final packaged .app.")
        else:
            info = plistlib.loads(info_path.read_bytes())
            record("Bundle identity and version", info.get("CFBundleIdentifier") == config.get("identifier")
                   and info.get("CFBundleShortVersionString") == config.get("version"),
                   "The installed/update identity and version must match the release configuration.")
            try:
                release_signing.verify(app)
                record("Final app signing contract", True,
                       "Strict signature, expected team and identifiers, stable requirements, timestamps, and hardened runtime passed for Aven and Chromium helpers.")
            except (RuntimeError, OSError, ValueError) as error:
                record("Final app signing contract", False, str(error))
            try:
                result = subprocess.run(["xcrun", "stapler", "validate", str(app)], capture_output=True, text=True)
                record("Stapled notarization ticket", result.returncode == 0,
                       "Passed." if result.returncode == 0 else "Notarization ticket validation did not pass; Developer ID signing alone is insufficient.")
            except OSError:
                record("Stapled notarization ticket", False, "The macOS stapler tool is unavailable.")
            record("Bundled Chromium runtime", (app / "Contents/Frameworks/Chromium Embedded Framework.framework").exists(),
                   "A plain Tauri bundle does not include Aven's browser runtime.")
    else:
        record("Final packaged app verified", False, "Pass --app after packaging and notarization.")
    ready = all(check["passed"] for check in checks)
    return {"configuration_ready": ready, "checks": checks,
            "scope": "Configuration, signing identity, and notarization ticket only; does not certify crash-free operation, update delivery, or website compatibility."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, help="Public Tauri release config override")
    parser.add_argument("--app", type=Path, help="Final packaged macOS app to verify")
    args = parser.parse_args()
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    if args.config:
        merge(config, json.loads(args.config.read_text()))
    report = check_release(config, args.app)
    print(json.dumps(report, indent=2))
    return 0 if report["configuration_ready"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
