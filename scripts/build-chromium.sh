#!/bin/bash
set -euo pipefail
task_repo_root="$(cd "$(dirname "$0")/.." && pwd)"
: "${CEF_ROOT:?Set CEF_ROOT to a verified CEF macOS binary distribution}"
: "${CEF_BUILD_DIR:=$task_repo_root/target/chromium}"
: "${CMAKE:=cmake}"
: "${NINJA:=ninja}"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'The embedded Chromium backend currently requires macOS.' >&2
  exit 1
fi
"$CMAKE" -S "$task_repo_root/src-tauri/chromium" -B "$CEF_BUILD_DIR" -G Ninja \
  -DCMAKE_MAKE_PROGRAM="$NINJA" -DCMAKE_BUILD_TYPE=Release -DCEF_ROOT="$CEF_ROOT" \
  -DPROJECT_ARCH=arm64 -DCMAKE_OSX_ARCHITECTURES=arm64
"$CMAKE" --build "$CEF_BUILD_DIR" --target supermono_chromium --parallel "${CEF_JOBS:-4}"
