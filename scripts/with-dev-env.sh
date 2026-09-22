#!/usr/bin/env bash
# Use optional, machine-local build paths without storing them in this checkout.
set -euo pipefail
task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_config="${AVEN_DEV_ENV_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/aven/development.env}"
if [[ -f "$task_config" ]]; then
  source "$task_config"
fi
export CEF_BUILD_DIR="${CEF_BUILD_DIR:-$task_root/target/chromium}"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
cd "$task_root"
exec "$@"
