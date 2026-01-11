# take

A minimal CLI library for building TypeScript-based command-line tools. Works with Deno, Node.js (with type stripping), and Bun.

## Installation

```bash
deno add jsr:@jpillora/take
```

## Quick Start

1. Write file `dev.ts`

    ```typescript
    #!/usr/bin/env -S deno run --allow-env
    // or execute with bun, or with node

    import { Command, Register } from "@jpillora/take";

    Register(
      Command({
        name: "greet",
        description: "Say hello",
        flags: {},
        run() {
          console.log("Hello, world!");
        },
      })
    );
    ```

2. Make it executable  `chmod +x dev.ts`

3. Run it:

    ```
    ./dev.ts --help

    dev.ts <command> --help

    commands:
     • greet - Say hello

    ./dev.ts greet
    Hello, world!
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

### Subcommands

Use spaces in the name to create nested commands.

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
  Command({
    name: "db seed",
    description: "Seed the database",
    flags: {},
    run() {
      console.log("Seeding database...");
    },
  })
);
```

```bash
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
