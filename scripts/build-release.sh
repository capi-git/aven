#!/usr/bin/env bash
# Build a local, ad-hoc-signed Aven release. Never installs or publishes it.
set -euo pipefail

task_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$task_repo_root"

if [[ "$(uname -s)" != Darwin || "$(uname -m)" != arm64 ]]; then
  echo 'Aven release builds currently require an Apple Silicon Mac running natively.' >&2
  exit 1
fi
if (( $# != 0 )); then
  echo 'Usage: CEF_ROOT=/path/to/verified/cef ./scripts/build-release.sh' >&2
  exit 1
fi
: "${CEF_ROOT:?Set CEF_ROOT to the verified pinned macOS arm64 CEF distribution; see docs/CHROMIUM.md}"
: "${CEF_BUILD_DIR:=$task_repo_root/target/chromium}"
: "${CMAKE:=cmake}"
: "${NINJA:=ninja}"
: "${CARGO_BUILD_JOBS:=4}"
export CEF_ROOT CEF_BUILD_DIR CMAKE NINJA CARGO_BUILD_JOBS

for task_tool in node npm cargo rustc python3 "$CMAKE" "$NINJA" codesign ditto xcrun lipo shasum unzip; do
  if ! command -v "$task_tool" >/dev/null 2>&1; then
    echo "Missing build prerequisite: $task_tool. See docs/CHROMIUM.md." >&2
    exit 1
  fi
done
node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22 or newer is required."); process.exit(1); }'
xcrun --find clang >/dev/null

# Verify the engine before compiling, and keep generated bundles under target/.
# Importing the packager reuses its exact pins without executing packaging.
task_version="$(python3 -B - "$task_repo_root" <<'PY'
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

if sys.version_info < (3, 9):
    raise SystemExit('Python 3.9 or newer is required.')
root = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('aven_packager', root / 'scripts/package-chromium.py')
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)
cef = Path(os.environ['CEF_ROOT']).resolve()
packager.require(('#define CEF_VERSION "' + packager.CEF_VERSION + '"') in (cef / 'include/cef_version.h').read_text(), 'CEF header version does not match the pinned distribution')
packager.require(packager.sha(cef / 'Release/Chromium Embedded Framework.framework/Chromium Embedded Framework') == packager.CEF_FRAMEWORK_SHA256, 'CEF framework hash does not match the pinned distribution')
expected_target = (root / 'target').resolve()
actual_target = Path(os.environ.get('CARGO_TARGET_DIR', str(expected_target))).resolve()
packager.require(actual_target == expected_target, 'Use this checkout target/ directory, or unset CARGO_TARGET_DIR')
packager.require(not os.environ.get('CARGO_BUILD_TARGET'), 'Unset CARGO_BUILD_TARGET for this native arm64 release build')
config = json.loads((root / 'src-tauri/tauri.conf.json').read_text())
package = json.loads((root / 'package.json').read_text())
lock = json.loads((root / 'package-lock.json').read_text())
version = package['version']
packager.require(re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version), 'Invalid package version')
packager.require(config['productName'] == 'Aven', 'Expected Aven product name')
packager.require(config['version'] == version and lock['version'] == version and lock['packages']['']['version'] == version, 'JavaScript and Tauri versions must match')
workspace = (root / 'Cargo.toml').read_text().split('[workspace.package]', 1)[1].split('\n[', 1)[0]
packager.require(re.search(r'^version\s*=\s*"' + re.escape(version) + r'"\s*$', workspace, re.M), 'Rust workspace version must match')
print(version)
PY
)"
export CARGO_TARGET_DIR="$task_repo_root/target"

task_app="$task_repo_root/target/release/bundle/macos/Aven.app"
task_release_dir="$task_repo_root/target/releases/v$task_version"

if [[ "${AVEN_SKIP_NPM_CI:-0}" != 1 ]]; then
  npm ci
elif [[ ! -x node_modules/.bin/tauri || ! -x node_modules/.bin/vitest ]]; then
  echo 'AVEN_SKIP_NPM_CI=1 requires dependencies already installed with npm ci.' >&2
  exit 1
fi

./scripts/build-chromium.sh
npm run check:web
cargo test --locked -p monocode --lib

# Tauri creates an intermediate host bundle; the packager signs the complete
# app only after Chromium and all helper executables have been added.
npm run tauri -- build --ci --bundles app --no-sign -- --locked
python3 scripts/generate-third-party-notices.py
python3 scripts/package-chromium.py --app "$task_app" --execute

mkdir -p "$task_release_dir"
task_stage="$(mktemp -d "$task_release_dir/.stage.XXXXXX")"
trap 'rm -rf "$task_stage"' EXIT
task_archive="Aven-$task_version-macos-arm64.zip"
ditto -c -k --norsrc --noextattr --keepParent "$task_app" "$task_stage/$task_archive"
unzip -tq "$task_stage/$task_archive"
cp LICENSE NOTICE THIRD_PARTY_NOTICES.txt "$task_stage/"
(
  cd "$task_stage"
  shasum -a 256 "$task_archive" LICENSE NOTICE THIRD_PARTY_NOTICES.txt > SHA256SUMS
  shasum -a 256 -c SHA256SUMS
)
for task_artifact in "$task_archive" LICENSE NOTICE THIRD_PARTY_NOTICES.txt SHA256SUMS; do
  mv -f "$task_stage/$task_artifact" "$task_release_dir/$task_artifact"
done
if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" || -n "${TAURI_SIGNING_PRIVATE_KEY_PATH:-}" ]]; then
  python3 scripts/package-update.py --app "$task_app" --out "$task_release_dir"
  (
    cd "$task_release_dir"
    shasum -a 256 "Aven-$task_version-macos-arm64.app.tar.gz" \
      "Aven-$task_version-macos-arm64.app.tar.gz.sig" latest.json >> SHA256SUMS
    shasum -a 256 -c SHA256SUMS
  )
fi
printf 'Built Aven %s: %s\n' "$task_version" "$task_release_dir/$task_archive"
printf '%s\n' 'Ad-hoc signed; not notarized. Complete native interaction checks before sharing. Nothing was installed or published.'
