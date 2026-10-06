#!/usr/bin/env bash
set -euo pipefail

bun_path="$HOME/.local/bin/bun"
if [[ ! -x "$bun_path" ]]; then
  curl -fsSL https://bun.com/install | BUN_INSTALL="$HOME/.local" bash >&2
fi

exec "$bun_path" "$@"
