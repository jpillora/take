import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "node:path";
import { exec, run, spawn } from "./take.ts";

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
