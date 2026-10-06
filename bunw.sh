#!/usr/bin/env bash
set -euo pipefail

bun_path="$HOME/.local/bin/bun"
if [[ ! -x "$bun_path" ]]; then
  curl -fsSL https://bun.com/install | BUN_INSTALL="$HOME/.local" bash >&2
fi

# Resolve imports from Bun's shared cache without creating node_modules.
export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/bun}"
exec "$bun_path" --install=force "$@"
