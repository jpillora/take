#!/usr/bin/env bash
set -euo pipefail
set -o noclobber

bun_path="$HOME/.local/bin/bun"
if [[ ! -x "$bun_path" ]]; then
  printf 'Installing Bun at %s\n' "$bun_path"
  curl -fsSL https://bun.com/install | BUN_INSTALL="$HOME/.local" bash >&2
fi

if [[ ! -e ./dev.ts && ! -L ./dev.ts ]]; then
  {
    printf '#!/usr/bin/env -S "%s" --install=force\n' "$bun_path"
    cat <<'TS'
import { Register } from "@jpillora/take";
import greet from "./.dev/greet.ts";

await Register(greet);
TS
  } > ./dev.ts
  chmod +x ./dev.ts
  printf 'Created ./dev.ts\n'
fi

if [[ ! -e .dev/greet.ts && ! -L .dev/greet.ts ]]; then
  mkdir -p .dev
  cat > .dev/greet.ts <<'TS'
import { Command } from "@jpillora/take";

export default Command({
  name: "greet",
  description: "Check the dev.ts setup",
  flags: {},
  run() {
    console.log("dev.ts is setup and working 🎉");
  },
});
TS
  printf 'Created .dev/greet.ts\n'
fi

printf 'Running ./dev.ts greet\n'
exec ./dev.ts greet
