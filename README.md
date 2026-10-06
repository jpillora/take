# take

A minimal CLI library for building TypeScript-based command-line tools. Works with Deno, Node.js (with type stripping), and Bun.

## Installation

```bash
deno add jsr:@jpillora/take
```

### npm / Node.js

```bash
npm install @jpillora/take
```

### Bun

```bash
bun add @jpillora/take
```

## Quick Start

Run this once from your project's directory:

```bash
curl -fsSL https://take.jpillora.com/setup.sh | bash
```

The setup script:

- Installs Bun at `~/.local/bin/bun` if it is missing.
- Creates an executable `dev.ts` that imports `.dev/greet.ts` directly.
- Creates `.dev/greet.ts` as a working example.
- Runs `./dev.ts greet`, which prints `dev.ts is setup and working 🎉`.

Existing `dev.ts` and `.dev/greet.ts` files are preserved. Setup prints each
action it performs. It requires Bash, curl, and `env -S`; installing Bun also
requires unzip.

```bash
$ ./dev.ts greet
dev.ts is setup and working 🎉

$ ./dev.ts --help
```

The generated shebang points to your local Bun executable, so running `dev.ts`
doesn't fetch a remote wrapper. Bun auto-installs imported packages such as
`@jpillora/take` into its shared cache, with no local `node_modules`,
`package.json`, or lockfile required. Set `BUN_INSTALL_CACHE_DIR` to override
Bun's default cache at `~/.bun/install/cache`.

Add commands as TypeScript files under `.dev`, each exporting a default command:

```typescript
// .dev/build.ts
import { Command } from "@jpillora/take";

export default Command({
  name: "build",
  description: "Build the project",
  flags: {},
  run() {
    console.log("Building...");
  },
});
```

Import and register each command in `dev.ts`:

```typescript
import { Register } from "@jpillora/take";
import greet from "./.dev/greet.ts";
import build from "./.dev/build.ts";

await Register(greet, build);
```

Then run `./dev.ts build`. Imports resolve relative to `dev.ts`, so it also works
when called from another directory.

## Output Streams

`take` writes all of its own output — help text, command timings, and
validation/runtime errors — to **stderr**. Your command's `run` function owns
**stdout**, so piping a command's real output stays clean and free of take's
diagnostics:

```bash
$ ./dev.ts export > data.json   # only your command's stdout lands in the file;
                                # take's timing line still shows on the terminal
```

## Examples

### String Flag

```typescript
Command({
  name: "greet",
  description: "Greet someone by name",
  flags: {
    name: {
      initial: "world",
      description: "Name to greet",
    },
  },
  run({ flags }) {
    // typescript infers flag types from initial:
    //   (property) name: string
    console.log(`Hello, ${flags.name}!`);
  },
});
```

```bash
$ ./dev.ts greet --name Alice
Hello, Alice!
```

### Number Flag

```typescript
Command({
  name: "repeat",
  description: "Repeat a message N times",
  flags: {
    count: {
      initial: 3,
      description: "Number of repetitions",
    },
  },
  run({ flags }) {
    for (let i = 0; i < flags.count; i++) {
      console.log("Hello!");
    }
  },
});
```

```bash
$ ./dev.ts repeat --count 5
```

### Boolean Flag

```typescript
Command({
  name: "build",
  description: "Build the project",
  flags: {
    minify: {
      initial: false,
      description: "Minify the output",
    },
  },
  run({ flags }) {
    if (flags.minify) {
      console.log("Building with minification...");
    } else {
      console.log("Building...");
    }
  },
});
```

```bash
$ ./dev.ts build --minify
```

Flag keys are written naturally in TypeScript and converted to flag-case on the
command line. The key remains unchanged in the handler, so `fooBar` is invoked
as `--foo-bar` and read as `flags.fooBar`. Initialisms are handled too, for
example `HTTPServer` becomes `--http-server`.

### Environment Variable Fallback

Flags can read from environment variables when not provided on the command line.

```typescript
Command({
  name: "deploy",
  description: "Deploy the application",
  flags: {
    token: {
      initial: "",
      description: "API token",
      env: "DEPLOY_TOKEN",
    },
  },
  run({ flags }) {
    if (!flags.token) {
      throw "token is required";
    }
    console.log("Deploying with token...");
  },
});
```

```bash
$ DEPLOY_TOKEN=secret ./dev.ts deploy
# or
$ ./dev.ts deploy --token secret
```

### Additional Help Text

```typescript
Command({
  name: "migrate",
  description: "Run database migrations",
  help: `
This command runs pending database migrations.
Make sure your DATABASE_URL is set correctly.

Examples:
  ./dev.ts migrate --dry-run
  ./dev.ts migrate --target 5`,
  flags: {
    dryRun: {
      initial: false,
      description: "Preview changes without applying",
    },
    target: {
      initial: 0,
      description: "Target migration version (0 = latest)",
    },
  },
  run({ flags }) {
    // migration logic
  },
});
```

### Hidden Commands

Set `hidden: true` to omit a command from the top-level `--help` listing (and
from any generated `insertHelp` markdown). The command still runs, and its own
help is still available via an explicit `<command> --help`. Useful for internal
or maintenance commands you don't want to advertise.

```typescript
await Register(
  Command({
    name: "build",
    description: "Build the project",
    flags: {},
    run() {
      console.log("Building...");
    },
  }),
  Command({
    name: "internal",
    description: "Internal maintenance task",
    hidden: true,
    flags: {},
    run() {
      console.log("Running internal task...");
    },
  })
);
```

```bash
# hidden from the top-level listing:
$ ./dev.ts --help

dev.ts <command> --help

commands:
 • build - Build the project

# ...but still runnable:
$ ./dev.ts internal
Running internal task...

# ...and its own help still works:
$ ./dev.ts internal --help

dev.ts internal <flags>

description:
Internal maintenance task

flags:
 --help, -h  show help
```

### Generated Command Reference

`insertHelp` writes the visible command tree and its flags between
`<!-- take:start -->` and `<!-- take:end -->` markers in a markdown file. Groups
and nested commands are rendered as nested list items:

```typescript
import { insertHelp } from "@jpillora/take";

insertHelp("README.md");
```

To generate only the command list, omit the per-command flag entries:

```typescript
insertHelp("README.md", { flags: false });
```

Hidden commands are excluded in both modes.

### Positional Arguments

Non-flag arguments are available in `args`.

```typescript
Command({
  name: "copy",
  description: "Copy files to destination",
  flags: {},
  run({ args }) {
    const [source, dest] = args;
    if (!source || !dest) {
      throw "usage: copy <source> <dest>";
    }
    console.log(`Copying ${source} to ${dest}`);
  },
});
```

```bash
$ ./dev.ts copy file.txt backup/
```

### Groups

Use `Group` to organize related commands. Its first argument can be a name or an
options object, followed by one or more commands or nested groups.

```typescript
import { Command, Group, Register } from "@jpillora/take";

await Register(
  Group(
    {
      name: "db",
      description: "Database commands",
    },
    Command({
      name: "migrate",
      description: "Run database migrations",
      flags: {},
      run() {
        console.log("Running migrations...");
      },
    }),
    Command({
      name: "seed",
      description: "Seed the database",
      flags: {},
      run() {
        console.log("Seeding database...");
      },
    }),
  ),
);
```

The options form also accepts `hidden` to hide the entire group from help
listings while keeping its commands runnable. Running a group with no child, or
with `--help`, prints help for that group's complete subtree.

For compact definitions and backwards compatibility, whitespace in a command
name creates groups automatically. This defines the same command path as a
`Group("db", ...)` containing `Command({ name: "migrate", ... })`:

```typescript
await Register(
  Command({
    name: "db migrate",
    description: "Run database migrations",
    flags: {},
    run() {
      console.log("Running migrations...");
    },
  }),
);
```

Automatic and explicit groups with the same path are merged, so both forms can
be mixed. Names with more than one space create deeper groups. A path cannot be
both a runnable command and a group—for example, `foo` and `foo bar` cannot both
be registered.

```bash
$ ./dev.ts --help       # lists the db group
$ ./dev.ts db --help    # lists migrate and seed
$ ./dev.ts db migrate
$ ./dev.ts db seed
```

### Calling Other Commands

Use `cmd` to invoke other registered commands programmatically.

```typescript
Command({
  name: "all",
  description: "Run build, test, and deploy",
  flags: {},
  async run({ cmd }) {
    await cmd("build", "--minify");
    await cmd("test");
    await cmd("deploy");
  },
});
```

### Show Help Programmatically

```typescript
Command({
  name: "process",
  description: "Process input files",
  flags: {},
  run({ args, help }) {
    if (args.length === 0) {
      help("no input files provided");
    }
    // process files...
  },
});
```

### Usage History

Command usage logging is disabled by default. Enable it once in your entrypoint:

```typescript
import { logCommandUsage } from "@jpillora/take";

logCommandUsage();
```

When enabled, take appends one JSONL record for each top-level command
invocation to:

```text
$HOME/.local/state/take/<sha256-of-absolute-entrypoint-path>.jsonl
```

Each record contains the resolved command name, resolved flag values, the
number of positional arguments, and an ISO timestamp:

```json
{"command":"foo bar","flags":{"fooBar":true},"argCount":3,"timestamp":"2026-09-02T01:23:45.678Z"}
```

Positional argument contents are never stored. Flag values are stored, so pass
sensitive values as positional arguments if they should not appear in history.
History is best-effort: an unavailable or unwritable state directory never
prevents the command from running.

### Timer Utility

Measure execution time with the built-in timer.

```typescript
import { Command, Register, timer } from "@jpillora/take";

Command({
  name: "slow",
  description: "A slow operation",
  flags: {},
  run() {
    const t = timer();
    // ... do work ...
    console.log(`Completed in ${t}`); // "Completed in 1.23sec"
  },
});
```

### Spawn Utility

Run external commands with a Promise-based wrapper.

```typescript
import { Command, Register, spawn } from "@jpillora/take";

Command({
  name: "lint",
  description: "Run the linter",
  flags: {
    fix: {
      initial: false,
      description: "Auto-fix issues",
    },
  },
  async run({ flags }) {
    await spawn({
      program: "deno",
      args: flags.fix ? ["lint", "--fix"] : ["lint"],
      stdio: "inherit",
    });
  },
});
```

## License

MIT
