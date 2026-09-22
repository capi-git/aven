#!/usr/bin/env python3
"""Sign an updater archive of the final Chromium app; never installs or publishes."""
import argparse
import datetime
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
RELEASES = "https://github.com/capi-git/aven/releases/download"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not os.environ.get("TAURI_SIGNING_PRIVATE_KEY") and not os.environ.get("TAURI_SIGNING_PRIVATE_KEY_PATH"):
        raise SystemExit("Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH outside the repository.")
    config = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    info = plistlib.loads((args.app / "Contents/Info.plist").read_bytes())
    version = config["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", version):
        raise SystemExit("Invalid release version")
    if info.get("CFBundleIdentifier") != config["identifier"] or info.get("CFBundleShortVersionString") != version:
        raise SystemExit("App identity/version differs from release configuration")
    if not (args.app / "Contents/Frameworks/Chromium Embedded Framework.framework").exists():
        raise SystemExit("Package Chromium before creating update artifacts")
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(args.app)], check=True)
    args.out.mkdir(parents=True, exist_ok=True)
    name = f"Aven-{version}-macos-arm64.app.tar.gz"
    # No xattrs or AppleDouble files. Preserve executable bits and framework
    # symlinks; updater expects one top-level .app directory.
    with tempfile.TemporaryDirectory(prefix=".update-", dir=args.out) as tmp:
        archive = Path(tmp) / name
        with tarfile.open(archive, "w:gz", dereference=False) as tar:
            tar.add(args.app, arcname="Aven.app")
        result = subprocess.run(
            [str(ROOT / "node_modules/.bin/tauri"), "signer", "sign", str(archive)],
            cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        if result.returncode:
            raise SystemExit("Update signing failed; private-key diagnostics suppressed.")
        signature = Path(str(archive) + ".sig")
        if not signature.is_file() or not signature.read_text().strip():
            raise SystemExit("Signer did not produce a signature")
        subprocess.run([
            "cargo", "run", "--locked", "--release", "-p", "monocode", "--example", "verify_update", "--",
            str(ROOT / "src-tauri/tauri.conf.json"), str(archive), str(signature),
        ], cwd=ROOT, check=True)
        changelog = (ROOT / "CHANGELOG.md").read_text()
        section = re.search(r"^## \[" + re.escape(version) + r"\].*?\n(.*?)(?=^## |\Z)", changelog, re.M | re.S)
        manifest = {
            "version": version,
            "notes": section.group(1).strip() if section else f"Aven {version}",
            "pub_date": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "platforms": {"darwin-aarch64": {
                "signature": signature.read_text().strip(),
                "url": f"{RELEASES}/v{version}/{name}",
            }},
        }
        for item in (archive, signature):
            item.replace(args.out / item.name)
        (args.out / "latest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Created signed Aven {version} update artifacts.")


if __name__ == "__main__":
    main()
