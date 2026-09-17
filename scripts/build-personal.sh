#!/usr/bin/env bash
# Compatibility entry point; public builds use the same release pipeline.
set -euo pipefail
exec "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/build-release.sh" "$@"
