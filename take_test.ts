import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { Command, exec, Group, run, spawn } from "./take.ts";

Deno.test("insertHelp - creates markers in file without them", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# My Project\n\nSome docs.\n");

  // Script uses relative path — insertHelp resolves relative to dirname(argv[1])
  // which is the temp dir where the script lives
  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md");
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {
          watch: { initial: false, description: "Watch for changes" },
          output: { initial: "dist", description: "Output directory" },
        },
        run() {},
      }),
      Command({
        name: "test",
        description: "Run tests",
        flags: {
          verbose: { initial: false, description: "Show detailed output" },
        },
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  // Pass --help so Register exits after writing help to file
  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("<!-- take:start -->"), true, "Should contain start marker");
  assertEquals(content.includes("<!-- take:end -->"), true, "Should contain end marker");
  assertEquals(content.includes("- `build` - Build the project"), true);
  assertEquals(
    content.includes("  - `--watch` `-w` - Watch for changes"),
    true,
  );
  assertEquals(
    content.includes(
      "  - `--output` `-o` <string> - Output directory (default=dist)",
    ),
    true,
  );
  assertEquals(content.includes("- `test` - Run tests"), true);
  assertEquals(
    content.includes("  - `--verbose` `-v` - Show detailed output"),
    true,
  );
  // Original content still present
  assertEquals(content.includes("# My Project"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - replaces existing markers", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  const initial = `# Docs

<!-- take:start -->
- \`old-command\` - Old stuff
<!-- take:end -->

## Footer
`;
  await Deno.writeTextFile(file, initial);

  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md");
    await Register(
      Command({
        name: "deploy",
        description: "Deploy the app",
        flags: {
          prod: { initial: false, description: "Deploy to production" },
        },
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("old-command"), false, "Old content should be replaced");
  assertEquals(content.includes("- `deploy` - Deploy the app"), true);
  assertEquals(
    content.includes("  - `--prod` `-p` - Deploy to production"),
    true,
  );
  assertEquals(content.includes("## Footer"), true);
  assertEquals(
    content.split("<!-- take:start -->").length,
    2,
    "Exactly one start marker",
  );
  assertEquals(
    content.split("<!-- take:end -->").length,
    2,
    "Exactly one end marker",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - skips debug commands", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# Docs\n");

  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md");
    await Register(
      Command({
        name: "debug",
        description: "Debug internals",
        flags: {},
        run() {},
      }),
      Command({
        name: "serve",
        description: "Start server",
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("`debug`"), false, "debug command should be skipped");
  assertEquals(content.includes("- `serve` - Start server"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - no-op when file does not exist", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("nonexistent.md");
    await Register(
      Command({
        name: "hello",
        description: "Say hello",
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  // File should still not exist (insertHelp doesn't create files)
  let exists = true;
  try {
    await Deno.stat(join(dir, "nonexistent.md"));
  } catch {
    exists = false;
  }
  assertEquals(exists, false, "File should not have been created");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - sorts flags deterministically regardless of insertion order", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# Docs\n");

  // Flags declared in reverse-alphabetical insertion order; output must be sorted
  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md");
    await Register(
      Command({
        name: "build",
        description: "Build it",
        flags: {
          zebra: { initial: false, description: "z flag" },
          mango: { initial: false, description: "m flag" },
          alpha: { initial: false, description: "a flag" },
        },
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  const idxAlpha = content.indexOf("--alpha");
  const idxMango = content.indexOf("--mango");
  const idxZebra = content.indexOf("--zebra");
  assertEquals(idxAlpha > -1 && idxMango > -1 && idxZebra > -1, true);
  assertEquals(
    idxAlpha < idxMango && idxMango < idxZebra,
    true,
    "flags should be sorted alphabetically (alpha, mango, zebra)",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - handles absolute path", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# Docs\n");

  // Use absolute path directly
  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("${file}");
    await Register(
      Command({
        name: "build",
        description: "Build it",
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("- `build` - Build it"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("insertHelp - flags false generates only visible commands", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# Docs\n");

  const script = `
    import { Command, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md", { flags: false });
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {
          dryRun: { initial: false, description: "Preview the build" },
        },
        run() {},
      }),
      Command({
        name: "secret",
        description: "Hidden maintenance",
        hidden: true,
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  await cmd.output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("- `build` - Build the project"), true);
  assertEquals(content.includes("secret"), false);
  assertEquals(content.includes("--dry-run"), false);

  await Deno.remove(dir, { recursive: true });
});

// --- groups ---

Deno.test("groups - explicit groups scope help and dispatch nested commands", async () => {
  const dir = await Deno.makeTempDir();
  const script = `
    import { Command, Group, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Group(
        {
          name: "tools",
          description: "Tool commands",
        },
        Command({
          name: "build",
          description: "Build the project",
          flags: {},
          run({ cmdName }) { console.log(cmdName); },
        }),
        Group("nested", Command({
          name: "run",
          description: "Run the nested tool",
          flags: {},
          run({ cmdName }) { console.log(cmdName); },
        })),
      ),
      Command({
        name: "plain",
        description: "A root command",
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);
  const invoke = (args: string[]) =>
    new Deno.Command("deno", {
      args: ["run", "--allow-all", scriptFile, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();

  const rootHelp = await invoke(["--help"]);
  const rootOutput = new TextDecoder().decode(rootHelp.stderr);
  assertEquals(rootHelp.code, 0);
  assertEquals(rootOutput.includes(" • tools - Tool commands"), true);
  assertEquals(rootOutput.includes(" • plain - A root command"), true);
  assertEquals(rootOutput.includes(" • build"), false);

  const groupHelp = await invoke(["tools", "--help"]);
  const groupOutput = new TextDecoder().decode(groupHelp.stderr);
  assertEquals(groupHelp.code, 0);
  assertEquals(groupOutput.includes("tools <command> --help"), true);
  assertEquals(groupOutput.includes("Tool commands"), false);
  assertEquals(groupOutput.includes(" • build"), true);
  assertEquals(groupOutput.includes("- Build the project"), true);
  assertEquals(groupOutput.includes(" • nested"), true);
  assertEquals(groupOutput.includes("   • run"), true);
  assertEquals(groupOutput.includes("- Run the nested tool"), true);
  assertEquals(groupOutput.includes(" • plain"), false);

  const implicitHelp = await invoke(["tools", "nested"]);
  const implicitOutput = new TextDecoder().decode(implicitHelp.stderr);
  assertEquals(implicitHelp.code, 0);
  assertEquals(implicitOutput.includes("tools nested <command> --help"), true);
  assertEquals(implicitOutput.includes(" • run - Run the nested tool"), true);

  const command = await invoke(["tools", "nested", "run"]);
  assertEquals(command.code, 0);
  assertEquals(
    new TextDecoder().decode(command.stdout).trim(),
    "tools nested run",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - spaced commands create and merge automatic groups", async () => {
  const dir = await Deno.makeTempDir();
  const script = `
    import { Command, Group, Register } from "${Deno.cwd()}/take.ts";
    const migrate = Command({
      name: "  db   migrate  ",
      description: "Run migrations",
      flags: {},
      run({ cmdName }) { console.log("PATH=" + cmdName); },
    });
    await Register(
      migrate,
      Command({
        name: "db seed run",
        description: "Seed the database",
        flags: {},
        run({ cmdName }) { console.log("PATH=" + cmdName); },
      }),
      Group({ name: "db", description: "Database commands" }, Command({
        name: "status",
        description: "Show database status",
        flags: {},
        run({ cmdName }) { console.log("PATH=" + cmdName); },
      })),
    );
    console.log("NAME=" + migrate.name);
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);
  const invoke = (args: string[]) =>
    new Deno.Command("deno", {
      args: ["run", "--allow-all", scriptFile, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();

  const rootHelp = await invoke(["--help"]);
  const rootOutput = new TextDecoder().decode(rootHelp.stderr);
  assertEquals(rootOutput.includes(" • db - Database commands"), true);
  assertEquals(rootOutput.includes("db migrate"), false);

  const groupHelp = await invoke(["db", "--help"]);
  const groupOutput = new TextDecoder().decode(groupHelp.stderr);
  assertEquals(groupOutput.includes(" • migrate - Run migrations"), true);
  assertEquals(groupOutput.includes(" • seed"), true);
  assertEquals(groupOutput.includes("   • run"), true);
  assertEquals(groupOutput.includes("- Seed the database"), true);
  assertEquals(groupOutput.includes(" • status"), true);
  assertEquals(groupOutput.includes("- Show database status"), true);

  const migrateRun = await invoke(["db", "migrate"]);
  assertEquals(migrateRun.code, 0);
  const migrateOutput = new TextDecoder().decode(migrateRun.stdout);
  assertEquals(migrateOutput.includes("PATH=db migrate"), true);
  assertEquals(migrateOutput.includes("NAME=  db   migrate  "), true);

  const seedRun = await invoke(["db", "seed", "run"]);
  assertEquals(seedRun.code, 0);
  assertEquals(
    new TextDecoder().decode(seedRun.stdout).includes("PATH=db seed run"),
    true,
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - programmatic cmd supports split and full nested names", async () => {
  const dir = await Deno.makeTempDir();
  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "all",
        description: "Run all commands",
        flags: {},
        async run({ cmd }) {
          await cmd("foo bar");
          await cmd("foo", "baz");
        },
      }),
      Command({
        name: "foo bar",
        description: "Run bar",
        flags: {},
        run({ cmdName }) { console.log(cmdName); },
      }),
      Command({
        name: "foo baz",
        description: "Run baz",
        flags: {},
        run({ cmdName }) { console.log(cmdName); },
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);
  const result = await new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "all"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout).trim().split("\n"),
    ["foo bar", "foo baz"],
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - hidden groups and hidden-only automatic groups stay runnable", async () => {
  const dir = await Deno.makeTempDir();
  const script = `
    import { Command, Group, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "visible",
        description: "Visible command",
        flags: {},
        run() {},
      }),
      Group({ name: "secret", hidden: true }, Command({
        name: "wipe",
        description: "Wipe data",
        flags: {},
        run({ cmdName }) { console.log(cmdName); },
      })),
      Command({
        name: "internal clean",
        description: "Clean internals",
        hidden: true,
        flags: {},
        run({ cmdName }) { console.log(cmdName); },
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);
  const invoke = (args: string[]) =>
    new Deno.Command("deno", {
      args: ["run", "--allow-all", scriptFile, ...args],
      stdout: "piped",
      stderr: "piped",
    }).output();

  const rootHelp = await invoke(["--help"]);
  const rootOutput = new TextDecoder().decode(rootHelp.stderr);
  assertEquals(rootOutput.includes("visible"), true);
  assertEquals(rootOutput.includes("secret"), false);
  assertEquals(rootOutput.includes("internal"), false);

  const secretHelp = await invoke(["secret", "--help"]);
  assertEquals(
    new TextDecoder().decode(secretHelp.stderr).includes(" • wipe - Wipe data"),
    true,
  );
  const secretRun = await invoke(["secret", "wipe"]);
  assertEquals(
    new TextDecoder().decode(secretRun.stdout).trim(),
    "secret wipe",
  );
  const internalRun = await invoke(["internal", "clean"]);
  assertEquals(
    new TextDecoder().decode(internalRun.stdout).trim(),
    "internal clean",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - insertHelp renders a recursive command tree", async () => {
  const dir = await Deno.makeTempDir();
  const file = join(dir, "README.md");
  await Deno.writeTextFile(file, "# Docs\n");
  const script = `
    import { Command, Group, Register, insertHelp } from "${Deno.cwd()}/take.ts";
    insertHelp("README.md");
    await Register(
      Group({ name: "db", description: "Database commands" },
        Command({
          name: "migrate",
          description: "Run migrations",
          flags: {
            dryRun: { initial: false, description: "Preview migration" },
          },
          run() {},
        }),
        Group("seed", Command({
          name: "run",
          description: "Seed the database",
          flags: {},
          run() {},
        })),
      ),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);
  await new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  }).output();

  const content = await Deno.readTextFile(file);
  assertEquals(content.includes("- `db` - Database commands"), true);
  assertEquals(content.includes("  - `migrate` - Run migrations"), true);
  assertEquals(
    content.includes("    - `--dry-run` `-d` - Preview migration"),
    true,
  );
  assertEquals(content.includes("  - `seed`"), true);
  assertEquals(content.includes("    - `run` - Seed the database"), true);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - reject command/group collisions and duplicate groups", async () => {
  const dir = await Deno.makeTempDir();
  const collisionScript = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    const command = (name: string) => Command({
      name,
      description: name,
      flags: {},
      run() {},
    });
    await Register(command("foo"), command("foo bar"));
  `;
  const duplicateScript = `
    import { Command, Group, Register } from "${Deno.cwd()}/take.ts";
    const command = (name: string) => Command({
      name,
      description: name,
      flags: {},
      run() {},
    });
    await Register(
      Group("foo", command("bar")),
      Group("foo", command("baz")),
    );
  `;

  for (
    const [name, script, message] of [
      [
        "collision.ts",
        collisionScript,
        "command and group share the same name: foo",
      ],
      ["duplicate.ts", duplicateScript, "duplicate group name: foo"],
    ]
  ) {
    const scriptFile = join(dir, name);
    await Deno.writeTextFile(scriptFile, script);
    const result = await new Deno.Command("deno", {
      args: ["run", "--allow-all", scriptFile, "--help"],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 1);
    assertEquals(
      new TextDecoder().decode(result.stderr).includes(message),
      true,
    );
  }

  await Deno.remove(dir, { recursive: true });
});

Deno.test("groups - Group exposes normalized string and options forms", () => {
  const child = Group(
    "child",
    Command({
      name: "leaf",
      description: "Leaf",
      flags: {},
      run() {},
    }),
  );
  const parent = Group(
    { name: "parent", description: "Parent", hidden: true },
    child,
  );
  assertEquals(child.name, "child");
  assertEquals(child.kind, "group");
  assertEquals(child.children.length, 1);
  assertEquals(parent.name, "parent");
  assertEquals(parent.description, "Parent");
  assertEquals(parent.hidden, true);
});

// --- flag case ---

Deno.test("flags - camelCase keys use flag-case on the command line", async () => {
  const dir = await Deno.makeTempDir();
  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {
          fooBar: { initial: false, description: "Enable foo bar" },
          outputDir: { initial: "dist", description: "Output directory" },
        },
        run({ flags }) {
          console.log(JSON.stringify({
            fooBar: flags.fooBar,
            outputDir: flags.outputDir,
          }));
        },
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const runCommand = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-all",
      scriptFile,
      "build",
      "--foo-bar",
      "--output-dir",
      "custom",
    ],
    stdout: "piped",
    stderr: "piped",
  });
  const result = await runCommand.output();
  assertEquals(result.code, 0);
  assertEquals(
    new TextDecoder().decode(result.stdout).trim(),
    JSON.stringify({ fooBar: true, outputDir: "custom" }),
  );

  const helpCommand = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "build", "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  const helpResult = await helpCommand.output();
  const helpOutput = new TextDecoder().decode(helpResult.stderr);
  assertEquals(helpOutput.includes("--foo-bar"), true);
  assertEquals(helpOutput.includes("--fooBar"), false);
  assertEquals(helpOutput.includes("--output-dir"), true);

  await Deno.remove(dir, { recursive: true });
});

// --- usage history ---

Deno.test("usage - dev.ts appends privacy-safe JSONL records", async () => {
  const dir = await Deno.makeTempDir();
  const home = join(dir, "home");
  const scriptFile = join(dir, "dev.ts");
  const script = `
    import { Command, Register, logCommandUsage } from "${Deno.cwd()}/take.ts";
    logCommandUsage();
    await Register(
      Command({
        name: "foo bar",
        description: "Test usage history",
        flags: {
          fooBar: { initial: false, description: "Enable foo bar" },
        },
        run() {},
      }),
    );
  `;
  await Deno.writeTextFile(scriptFile, script);

  const invoke = (args: string[]) =>
    new Deno.Command("deno", {
      args: [
        "run",
        "--allow-all",
        scriptFile,
        "foo",
        "bar",
        "--foo-bar",
        ...args,
      ],
      env: { HOME: home },
      stdout: "piped",
      stderr: "piped",
    }).output();

  const first = await invoke(["first-secret", "second-secret", "third-secret"]);
  const second = await invoke(["fourth-secret"]);
  assertEquals(first.code, 0);
  assertEquals(second.code, 0);

  const hash = createHash("sha256").update(resolve(scriptFile)).digest("hex");
  const logFile = join(home, ".local", "state", "take", `${hash}.jsonl`);
  const content = await Deno.readTextFile(logFile);
  const lines = content.trimEnd().split("\n");
  assertEquals(lines.length, 2, "each invocation should append one record");

  const { timestamp, ...record } = JSON.parse(lines[0]);
  assertEquals(record, {
    command: "foo bar",
    flags: { fooBar: true },
    argCount: 3,
  });
  assertEquals(typeof timestamp, "string");
  assertEquals(Number.isNaN(Date.parse(timestamp)), false);
  assertEquals(content.includes("first-secret"), false);
  assertEquals(content.includes("second-secret"), false);
  assertEquals(content.includes("third-secret"), false);
  assertEquals(content.includes("fourth-secret"), false);

  await Deno.remove(dir, { recursive: true });
});

Deno.test("usage - command logging is disabled by default", async () => {
  const dir = await Deno.makeTempDir();
  const home = join(dir, "home");
  const scriptFile = join(dir, "dev.ts");
  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {},
        run() {},
      }),
    );
  `;
  await Deno.writeTextFile(scriptFile, script);

  const result = await new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "build"],
    env: { HOME: home },
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(result.code, 0);

  let stateDirExists = true;
  try {
    await Deno.stat(join(home, ".local", "state", "take"));
  } catch {
    stateDirExists = false;
  }
  assertEquals(stateDirExists, false);

  await Deno.remove(dir, { recursive: true });
});

// --- hidden commands ---

Deno.test("hidden - excluded from root-level help listing", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {},
        run() {},
      }),
      Command({
        name: "secret",
        description: "A hidden maintenance command",
        hidden: true,
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  // take writes its own output (help, timings, errors) to stderr
  const { stderr } = await cmd.output();
  const out = new TextDecoder().decode(stderr);

  assertEquals(out.includes("build"), true, "visible command should be listed");
  assertEquals(
    out.includes("secret"),
    false,
    "hidden command should not appear in root-level help",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("hidden - still shown via explicit <command> --help", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "secret",
        description: "A hidden maintenance command",
        hidden: true,
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "secret", "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  // take writes its own output (help, timings, errors) to stderr
  const { stderr } = await cmd.output();
  const out = new TextDecoder().decode(stderr);

  assertEquals(out.includes("secret"), true, "explicit help should name the command");
  assertEquals(
    out.includes("A hidden maintenance command"),
    true,
    "explicit help should show the description",
  );

  await Deno.remove(dir, { recursive: true });
});

// --- output streams: take's own output goes to stderr ---

Deno.test("output - take diagnostics go to stderr, command owns stdout", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "emit",
        description: "Write to stdout",
        flags: {},
        run() {
          console.log("COMMAND_OUTPUT");
        },
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "emit"],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);

  // The command's own output stays on stdout, uncontaminated...
  assertEquals(out.includes("COMMAND_OUTPUT"), true);
  assertEquals(out.includes("ran in"), false, "timing must not be on stdout");
  // ...while take's timing line lands on stderr.
  assertEquals(err.includes("ran in"), true, "timing must be on stderr");

  await Deno.remove(dir, { recursive: true });
});

Deno.test("output - help is written to stderr, stdout stays empty", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "build",
        description: "Build the project",
        flags: {},
        run() {},
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "--help"],
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);

  assertEquals(out, "", "stdout should be empty for --help");
  assertEquals(
    err.includes("build - Build the project"),
    true,
    "help should be written to stderr",
  );

  await Deno.remove(dir, { recursive: true });
});

Deno.test("output - errors are written to stderr, stdout stays empty", async () => {
  const dir = await Deno.makeTempDir();

  const script = `
    import { Command, Register } from "${Deno.cwd()}/take.ts";
    await Register(
      Command({
        name: "boom",
        description: "Throws an error",
        flags: {},
        run() {
          throw new Error("kaboom");
        },
      }),
    );
  `;
  const scriptFile = join(dir, "test_script.ts");
  await Deno.writeTextFile(scriptFile, script);

  const cmd = new Deno.Command("deno", {
    args: ["run", "--allow-all", scriptFile, "boom"],
    stdout: "piped",
    stderr: "piped",
  });
  const { code, stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout);
  const err = new TextDecoder().decode(stderr);

  assertEquals(code, 1);
  assertEquals(out, "", "stdout should be empty on error");
  assertEquals(err.includes("kaboom"), true, "error should be written to stderr");

  await Deno.remove(dir, { recursive: true });
});

// --- spawn / exec / run + Deno-style stdio ---

Deno.test("run - stdout/stderr piped are captured", async () => {
  const r = await run({
    program: "bash",
    args: ["-c", "echo out; echo err 1>&2"],
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(r.code, 0);
  assertEquals(r.success, true);
  assertEquals(r.stdout.trim(), "out");
  assertEquals(r.stderr.trim(), "err");
  assertEquals(r.combined.includes("out") && r.combined.includes("err"), true);
});

Deno.test("run - captures by default when no stdio is given", async () => {
  const r = await run({ program: "bash", args: ["-c", "echo defaulted"] });
  assertEquals(r.stdout.trim(), "defaulted");
  assertEquals(r.code, 0);
});

Deno.test("run - nonzero exit is reported (not thrown)", async () => {
  const r = await run({
    program: "bash",
    args: ["-c", "exit 3"],
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(r.code, 3);
  assertEquals(r.success, false);
});

Deno.test("run - stdout=inherit is not captured, code still returned", async () => {
  // inherit streams to this process's stdout; run captures nothing.
  const r = await run({
    program: "bash",
    args: ["-c", "echo streamed; exit 4"],
    stdout: "inherit",
    stderr: "inherit",
  });
  assertEquals(r.stdout, "");
  assertEquals(r.stderr, "");
  assertEquals(r.code, 4);
});

Deno.test("run - stdout=null is not captured", async () => {
  const r = await run({
    program: "bash",
    args: ["-c", "echo hidden 1>&2; echo hidden"],
    stdout: "null",
    stderr: "null",
  });
  assertEquals(r.stdout, "");
  assertEquals(r.stderr, "");
  assertEquals(r.code, 0);
});

Deno.test("exec - exposes pid and an awaitable result", async () => {
  const e = exec({
    program: "bash",
    args: ["-c", "echo hi"],
    stdout: "piped",
    stderr: "piped",
  });
  assertEquals(typeof e.pid, "number");
  const r = await e.wait();
  assertEquals(r.stdout.trim(), "hi");
  assertEquals(r.code, 0);
});

Deno.test("spawn - resolves (void) on success", async () => {
  const result = await spawn({
    program: "bash",
    args: ["-c", "exit 0"],
    stdout: "null",
    stderr: "null",
  });
  assertEquals(result, undefined);
});

Deno.test("spawn - rejects with the exit code on failure", async () => {
  let rejected: unknown = "not-rejected";
  try {
    await spawn({
      program: "bash",
      args: ["-c", "exit 7"],
      stdout: "null",
      stderr: "null",
    });
  } catch (code) {
    rejected = code;
  }
  assertEquals(rejected, 7);
});
