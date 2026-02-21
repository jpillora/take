import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { join } from "node:path";

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
