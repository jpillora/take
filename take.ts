// Take is a mini-CLI library for building typescript-based command-line tools.
// Works with Deno, Node.js (with type stripping), and Bun.
// IMPORTANT: All code must stay in 1 file.
// deno-lint-ignore-file no-explicit-any

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";
import {
  spawn as nodeSpawn,
  type SpawnOptions as nodeSpawnOptions,
} from "node:child_process";
import process from "node:process";

let _insertHelpPath: string | null = null;

/**
 * Register a markdown file to receive an auto-generated command reference.
 *
 * On the next {@link Register} call, the command list (and each command's
 * flags) is rendered between `<!-- take:start -->` and `<!-- take:end -->`
 * markers in the file. A relative `path` resolves against the running script's
 * directory; an absolute path is used as-is. If the file or its markers are
 * missing, nothing is written.
 */
export function insertHelp(path: string): void {
  if (isAbsolute(path)) {
    _insertHelpPath = path;
  } else {
    const scriptDir = dirname(process.argv[1] || ".");
    _insertHelpPath = join(scriptDir, path);
  }
}

/**
 * A single command-line flag definition. The type of {@link Flag.initial}
 * determines both the parsed value type and how the flag renders in help.
 */
export type Flag = {
  /** Default value; its type (number, string, boolean, or Date) is the flag type. */
  initial: number | string | boolean | Date;
  /** One-line description shown in `--help` output. */
  description: string;
  /** Optional env var name used as a fallback when the flag is not passed. */
  env?: string;
};

type Flags = Record<string, Flag>;

/**
 * Maps a set of {@link Flag} definitions to the runtime values passed to a
 * command's `run` — each flag becomes a property typed by its `initial` value
 * (number, string, boolean, or Date).
 */
export type FlagValues<T extends Flags> = {
  [P in keyof T]: T[P]["initial"] extends number ? number
    : T[P]["initial"] extends string ? string
    : T[P]["initial"] extends boolean ? boolean
    : T[P]["initial"] extends Date ? Date
    : never;
};

/**
 * A command definition passed to {@link Command}. `F` captures the flag shape
 * so `run` receives strongly-typed flag values.
 */
export type TakeCommand<F extends Flags = Flags> = {
  /** Command name; whitespace-separated for sub-commands, e.g. `"db migrate"`. */
  name: string;
  /** Internal: `name` split into its sub-command parts (populated by Register). */
  names?: string[];
  /** One-line description shown in help listings. */
  description: string;
  /** Optional long-form help shown under this command's own `--help`. */
  help?: string;
  /**
   * When true, the command is omitted from the top-level help listing and from
   * the {@link insertHelp} markdown, but stays fully runnable and still shows
   * its own help via an explicit `<command> --help`. Use for internal or
   * maintenance commands you don't want to advertise.
   */
  hidden?: boolean;
  /** Flag definitions for this command; use `{}` for none. */
  flags: F;
  /** Handler run when the command is invoked, given parsed flags and args. */
  run: (input: CommandInput<F>) => void | Promise<void>;
};

/**
 * Identity helper that captures a flags object's literal type for reuse across
 * commands while keeping each flag's value type inferred.
 */
export function newFlags<F extends Flags>(flags: F): F {
  return flags;
}

/**
 * A {@link TakeCommand} augmented by {@link Command} with type-only helper
 * fields. `flagValues` and `input` are always null at runtime — they exist so
 * their types can be referenced (e.g. `typeof cmd.input`).
 */
export type NewCommand<F extends Flags = Flags> = TakeCommand<F> & {
  /** Type-only handle to the parsed flag values shape. Always null at runtime. */
  flagValues: FlagValues<F>;
  /** Type-only handle to the full `run` input shape. Always null at runtime. */
  input: CommandInput<F>;
  /** The flags' initial/default values, keyed by flag name. */
  flagsInitial: FlagValues<F>;
};

/** The argument object passed to a command's `run` function. */
export type CommandInput<F extends Flags> = {
  /** Parsed flag values, typed from the command's flag definitions. */
  flags: FlagValues<F>;
  /** Positional arguments remaining after flags are parsed. */
  args: string[];
  /** Invoke another command in the same CLI by name, e.g. `await cmd("build")`. */
  cmd: (...args: string[]) => Promise<void>;
  /** The resolved name of the running command. */
  cmdName: string;
  /** Print this command's help (with an optional error message) and exit. */
  help: (msg?: string) => void;
};

/**
 * Abort a command's `run` with a help/usage error. The thrown string is caught
 * by the runner and shown as that command's help error message.
 */
export function help(str: string) {
  throw str;
}

const exit = (...args: any[]) => {
  console.error(...args);
  process.exit(1);
};

type namedFlag = { name: string } & Flag;

type namedFlags = namedFlag[];

function namedFlags(record: Flags): namedFlags {
  return Object.entries(record).map((kv) => ({
    name: kv[0],
    ...kv[1],
  })).toSorted(
    (na, nb) => na.name < nb.name ? -1 : 1,
  );
}

function convert(val: any, type: string) {
  switch (type) {
    case "string":
      return `${val}`;
    case "number": {
      const f = parseFloat(val);
      if (isNaN(f)) {
        throw `expected a number, got: ${val}`;
      }
      return f;
    }
    case "boolean":
      return Boolean(val);
    default:
      throw `unknown type: ${type}`;
  }
}

// helper async node spawn

/**
 * Stdio disposition for a single stream, in Deno.Command style. Lowered onto
 * node's stdio: "piped" → "pipe" (capturable by exec/run), "inherit" → the
 * parent's stream, "null" → "ignore".
 */
export type Stdio = "inherit" | "piped" | "null";

/**
 * Options for {@link spawn}, {@link exec}, and {@link run}. Extends node's
 * child_process `SpawnOptions`, adding a required `program` plus Deno-style
 * `stdin`/`stdout`/`stderr` dispositions (see {@link Stdio}).
 */
export type SpawnOptions =
  & {
    /** The program/executable to run. */
    program: string;
    /** Arguments passed to the program. */
    args?: string[];
    /** Disposition for the child's stdin (see {@link Stdio}). */
    stdin?: Stdio;
    /** Disposition for the child's stdout (see {@link Stdio}). */
    stdout?: Stdio;
    /** Disposition for the child's stderr (see {@link Stdio}). */
    stderr?: Stdio;
  }
  & nodeSpawnOptions;

// toNodeSpawnOptions strips take's own keys and, when any Deno-style
// stdin/stdout/stderr is given, lowers them into node's stdio triple. When none
// are given, node's own `stdio` (or its default piping) is left untouched, so
// exec/run keep capturing output by default.
function toNodeSpawnOptions(options: SpawnOptions): nodeSpawnOptions {
  const { program: _program, args: _args, stdin, stdout, stderr, ...node } =
    options;
  if (stdin !== undefined || stdout !== undefined || stderr !== undefined) {
    const lower = (s: Stdio | undefined): "inherit" | "pipe" | "ignore" =>
      s === "inherit" ? "inherit" : s === "null" ? "ignore" : "pipe";
    node.stdio = [lower(stdin), lower(stdout), lower(stderr)];
  }
  return node;
}

/**
 * Run a program to completion. Resolves when the child exits with code 0, and
 * rejects with the non-zero exit code otherwise. Control output capture via the
 * `stdin`/`stdout`/`stderr` options (see {@link Stdio}).
 */
export async function spawn(options: SpawnOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = nodeSpawn(
      options.program,
      options.args ?? [],
      toNodeSpawnOptions(options),
    );
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(code);
      }
    });
  });
}

/** The outcome of a finished child process from {@link run} or {@link exec}. */
export type RunResult = {
  /** Process exit code (or 1 if it failed to start). */
  code: number;
  /** Captured standard output (empty unless stdout was piped). */
  stdout: string;
  /** Captured standard error (empty unless stderr was piped). */
  stderr: string;
  /** Captured stdout and stderr interleaved in arrival order. */
  combined: string;
  /** Spawn error message, if the process failed to start. */
  error?: string;
  /** True when `code` is 0. */
  success: boolean;
};

/** Handle to a running child process returned by {@link exec}. */
export type ExecResult = {
  /** OS process id (0 if the process failed to start). */
  pid: number;
  /** Spawn error message, if the process failed to start. */
  error?: string;
  /** Await the process and resolve with its {@link RunResult}. */
  wait: () => Promise<RunResult>;
  /** Send a signal to the process to terminate it. */
  kill: (signal: number) => void;
};

/**
 * Start a program and return an {@link ExecResult} handle immediately, exposing
 * its `pid`, a `kill` method, and `wait()` for the final {@link RunResult}.
 * Output is captured by default; use for long-running or concurrent processes.
 */
export function exec(options: SpawnOptions): ExecResult {
  let code = -1;
  let error = "";
  const datas = {
    out: [] as Buffer[],
    err: [] as Buffer[],
    combined: [] as Buffer[],
  };
  const result = {
    get code() {
      return code;
    },
    get stdout() {
      return Buffer.concat(datas.out).toString();
    },
    get stderr() {
      return Buffer.concat(datas.err).toString();
    },
    get combined() {
      return Buffer.concat(datas.combined).toString();
    },
    get error() {
      return error || undefined;
    },
    get success() {
      return code === 0;
    },
  };

  try {
    const child = nodeSpawn(
      options.program,
      options.args ?? [],
      toNodeSpawnOptions(options),
    );

    child.stdout?.on("data", (data) => {
      const buf = Buffer.from(data);
      datas.out.push(buf);
      datas.combined.push(buf);
    });

    child.stderr?.on("data", (data) => {
      const buf = Buffer.from(data);
      datas.err.push(buf);
      datas.combined.push(buf);
    });

    let resolved = false;
    const resultPromise = new Promise<RunResult>((resolve) => {
      const done = (finalCode: number) => {
        if (resolved) {
          return;
        }
        code = finalCode;
        resolved = true;
        resolve(result);
      };

      child.on("error", (err) => {
        error = err.message;
        done(1);
      });

      child.on("close", (c) => {
        done(c ?? 1);
      });
    });

    return {
      pid: child.pid ?? 0,
      wait: () => resultPromise,
      kill: (signal: number) => child.kill(signal),
    };
  } catch (err) {
    code = 1;
    error = err instanceof Error ? err.message : String(err);
    return {
      pid: 0,
      error,
      wait: () => Promise.resolve(result),
      kill: () => {},
    };
  }
}

/**
 * Run a program to completion and resolve with its {@link RunResult}. Unlike
 * {@link spawn}, a non-zero exit is reported in `result.code` rather than
 * thrown. Shorthand for `exec(options).wait()`.
 */
export function run(options: SpawnOptions): Promise<RunResult> {
  return exec(options).wait();
}

/**
 * Run a bash script with inherited stdio, e.g. `await $("ls -la | wc -l")`.
 * Rejects if the script exits non-zero.
 */
export const $ = async (script: string): Promise<void> => {
  await spawn({
    program: "bash",
    args: ["-c", script],
    stdio: "inherit",
  });
};

/**
 * Start a timer and return a `stop` function that yields the elapsed time as a
 * human-readable string (e.g. `"1.50sec"`). The returned function also
 * stringifies to that value, so it drops straight into a template literal:
 * `const t = timer(); ...; console.log(\`done in ${t}\`)`.
 */
export const timer: () => () => string = (() => {
  const scale: [n: number, s: string][] = [
    [1000, "ms"],
    [60, "sec"],
    [60, "min"],
    [24, "hr"],
  ];
  const fmt = (v: number) => {
    for (const s of scale) {
      const n = s[0], u = s[1];
      if (v < n) {
        return `${v.toFixed(2)}${u}${v == 1 || u.endsWith("s") ? "" : "s"}`;
      }
      v /= n;
    }
    throw `??`;
  };
  return () => {
    const t0 = performance.now();
    const stop = () => {
      const t1 = performance.now();
      return fmt(t1 - t0);
    };
    stop.toString = stop; // 🧙‍♂️you may omit the brackets
    return stop;
  };
})();

// Load .env file if it exists
async function loadEnvFile(path: string): Promise<boolean> {
  try {
    const content = await readFile(path, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        // Remove quotes if present
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
    }
    return true;
  } catch {
    return false;
  }
}

const MARKER_START = "<!-- take:start -->";
const MARKER_END = "<!-- take:end -->";

async function _writeInsertHelp(commands: NewCommand<any>[]): Promise<void> {
  if (!_insertHelpPath) return;
  const path = _insertHelpPath;
  // Build markdown list with flags as sub-bullets
  const lines: string[] = [];
  for (const cmd of commands) {
    if (cmd.name === "debug" || cmd.hidden) continue;
    const desc = cmd.description ? ` - ${cmd.description}` : "";
    lines.push(`- \`${cmd.name}\`${desc}`);
    // Add flags as sub-bullets (sorted, matching the CLI --help output, so the
    // generated markdown is deterministic regardless of flag insertion order)
    const shorts = new Set<string>();
    for (const flag of namedFlags(cmd.flags)) {
      const { name } = flag;
      const letter = name[0];
      const shortStr = shorts.has(letter) ? "" : ` \`-${letter}\``;
      shorts.add(letter);
      const typeStr = typeof flag.initial === "boolean"
        ? ""
        : ` <${typeof flag.initial}>`;
      const parts: string[] = [];
      if (flag.env) parts.push(`env=${flag.env}`);
      if (flag.initial) parts.push(`default=${flag.initial}`);
      const extras = parts.length ? ` (${parts.join(" ")})` : "";
      lines.push(
        `  - \`--${name}\`${shortStr}${typeStr} - ${flag.description}${extras}`,
      );
    }
  }
  const content = MARKER_START + "\n" + lines.join("\n") + "\n" + MARKER_END;
  // Read existing file
  let fileContent: string;
  try {
    fileContent = await readFile(path, "utf-8");
  } catch {
    return; // file doesn't exist, nothing to insert into
  }
  // Find markers and replace or append
  const startIdx = fileContent.indexOf(MARKER_START);
  const endIdx = fileContent.indexOf(MARKER_END);
  let newContent: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    newContent = fileContent.substring(0, startIdx) + content +
      fileContent.substring(endIdx + MARKER_END.length);
  } else {
    const sep = fileContent.endsWith("\n") ? "\n" : "\n\n";
    newContent = fileContent + sep + content + "\n";
  }
  if (newContent !== fileContent) {
    await writeFile(path, newContent, "utf-8");
  }
}

/**
 * Build the CLI from a set of {@link Command} definitions and run the one named
 * by `process.argv`. Loads a local `.env`, validates commands, generates
 * `--help`, updates any {@link insertHelp} target, then dispatches. Exits the
 * process on help, validation errors, or a command failure.
 */
export async function Register(...commands: NewCommand<any>[]) {
  // Load .env by default
  await loadEnvFile(".env");
  // Get script name from argv[1]
  const scriptName = basename(process.argv[1] || "cli");
  // validate commands
  if (!Array.isArray(commands)) {
    exit(`CLI(commands) must be an array`);
  }
  if (commands.length === 0) {
    exit(`CLI(commands) must have at least 1 command`);
  }
  const names = new Set();
  for (const c of commands) {
    // validate name
    if (typeof c.name !== "string") {
      exit(`all CLI(commands) must have a "name"`);
    }
    // transform name
    // list out "sub-command" names
    c.names = c.name.trim().split(/\s+/g);
    c.name = c.names.join(" "); // tidy name
    // duplicate check
    if (names.has(c.name)) {
      exit(`duplicate command name: ${c.name}`);
    }
    names.add(c.name);
    // validate function
    if (typeof c.run !== "function") {
      exit(`command "${c.name}" must have a "run" function`);
    }
    // validate flags
    if (!c.flags) {
      exit(`command "${c.name}" must have "flags", you can use {}`);
    }
    if (Array.isArray(c.flags)) {
      exit(`command "${c.name}" flags must be an object, not an array`);
    }
    for (const [name, flag] of Object.entries(c.flags) as [string, Flag][]) {
      if (!flag.description) {
        exit(`command "${c.name}" flag "${name}" must have a "description"`);
      }
    }
  }
  commands.sort((a, b) => (a.name < b.name ? -1 : 1));
  await _writeInsertHelp(commands);
  // helper for joining 2 columns of text
  type Table = { left: string; right: string }[];
  const joinColumns = (table: Table) => {
    const max = table.reduce((m, { left }) => Math.max(m, left.length), 0);
    return table
      .map((item) => {
        if (!item.right) return item.left;
        const pad = " ".repeat(max - item.left.length);
        return `${item.left}${pad} ${item.right}`;
      })
      .join("\n");
  };
  // recursive help text builder for the command tree
  function help(msg?: string) {
    // build command list
    const content = joinColumns(
      commands.filter((cmd) => {
        if (cmd.hidden) return false;
        return cmd.name !== "debug" || process.env.DEBUG === "1";
      }).map((cmd) => ({
        left: ` • ${cmd.name}`,
        right: cmd.description ? `- ${cmd.description}` : "",
      })),
    );
    // print result
    console.error(
      `\n${scriptName} <command> --help\n\n` + "commands:\n" + content + "\n",
    );
    if (msg) {
      console.error("ERROR:", msg);
      console.error("");
    }
    process.exit(msg ? 1 : 0);
  }
  // help text builder for a given command
  function helpFor(cmd: TakeCommand, flagSpecs: namedFlags, msg?: string) {
    // build flag help
    const shorts = new Set();
    const short = (name: string) => {
      const l = name[0];
      if (shorts.has(l)) return "";
      shorts.add(l);
      return `, -${l}`;
    };
    const extras = (flag: Flag) => {
      const { env, initial } = flag;
      const out = [];
      if (env) out.push(`env=${env}`);
      if (initial) out.push(`default=${initial}`);
      return out.length ? ` (${out.join(" ")})` : "";
    };
    const content = joinColumns(
      flagSpecs.map((flag) => ({
        left: ` --${flag.name}${short(flag.name)}${
          typeof flag.initial === "boolean" ? "" : ` <${typeof flag.initial}>`
        }`,
        right: ` ${flag.description || ""}${extras(flag)}`,
      })),
    );
    // print result
    console.error(
      `\n${scriptName} ` +
        cmd.name +
        " <flags>\n\n" +
        "description:\n" +
        cmd.description +
        (cmd.help ? ("\n\nhelp:\n" + cmd.help) : "") +
        "\n\n" +
        "flags:\n" +
        content +
        "\n",
    );
    if (msg) {
      console.error("ERROR:", msg);
      console.error("");
    }
    process.exit(0);
  }
  // run 1 command from the command tree.
  // this function can be called from other commands
  async function cmd(...args: string[]) {
    if (args.length === 0) {
      help();
    }
    // stage 1, find command, split args into names/rest
    let match = null;
    let rest: string[] = [];
    let names = null;
    for (let i = args.length - 1; i >= 0; i--) {
      names = args.slice(0, i + 1);
      rest = args.slice(i + 1);
      const name = names.join(" ");
      match = commands.find((c) => c.name === name);
      if (match) {
        break;
      }
    }
    if (!match) {
      return help(`no matched command: ${args.join(" ")}`);
    }
    // convert command flags into a list
    const flagSpecs = namedFlags(match.flags);
    // always add --help
    flagSpecs.push({
      name: "help",
      initial: false,
      description: "show help",
    });
    // stage 2, init flags, parse rest of args
    const cmdHelp = helpFor.bind(null, match, flagSpecs);
    let nextFlag: namedFlag | null = null;
    // traverse rest arguments, sorting into either flags or cmd-args
    const flagVals: Record<string, any> = {};
    const cmdArgs = [];
    for (const arg of rest) {
      // arg is flag-value
      if (nextFlag) {
        flagVals[nextFlag.name] = convert(arg, typeof nextFlag.initial);
        nextFlag = null;
        continue;
      }
      // arg is command-flag
      const m = /^-(-?)(\S+)$/.exec(arg);
      if (m) {
        const long = Boolean(m[1]);
        const name = m[2];
        const fs = flagSpecs.find((f) => {
          if (!long) {
            const letters = name.split("");
            return letters.includes(f.name[0]);
          }
          return f.name === name;
        });
        if (!fs) {
          return cmdHelp(`unknown flag "${name}"`);
        }
        if (typeof fs.initial === "boolean") {
          flagVals[fs.name] = true;
        } else {
          nextFlag = fs; // collect String/Number flags
        }
        continue;
      }
      // arg is command-arg
      cmdArgs.push(arg);
      continue;
    }
    // missing flag value
    if (nextFlag) {
      cmdHelp(`missing value for flag: ${nextFlag.name}`);
    }
    // help requested
    if (flagVals.help) {
      cmdHelp();
    }
    // set default values
    for (const flag of flagSpecs) {
      const { name, env, initial } = flag;
      if (name in flagVals) {
        continue;
      }
      if (env && process.env[env]) {
        flagVals[name] = convert(process.env[env], typeof initial);
        continue;
      }
      if (initial !== undefined) {
        flagVals[name] = initial;
      }
    }
    // exec targets 'run' function
    const t = timer();
    try {
      await match.run({
        flags: flagVals as FlagValues<typeof match.flags>,
        args: cmdArgs,
        cmd,
        cmdName: match.name,
        help: cmdHelp,
      });
    } catch (err) {
      if (typeof err === "string") {
        cmdHelp(err);
      }
      throw err;
    }
    console.error(`${scriptName} "${match.name}" ran in ${t}`);
  }
  // "root" command
  // process.argv: [node, script, ...args]
  const args = process.argv.slice(2);
  // help intercept
  if (args.length === 0 || args[0] === "-h" || args[0] === "--help") {
    help();
  }
  // normal command execution
  try {
    await cmd(...args);
  } catch (err) {
    if (typeof err === "string") {
      help(err);
    }
    // parse and display error
    const eo = err as Record<string, any>;
    if (eo && typeof eo === "object") {
      // handle command output
      if (typeof eo.code === "number") {
        process.exit(eo.code);
      }
      // handle js error
      const msg = err ? eo.stack || eo.message : `${err}`;
      if (/exit with (\d+)/.test(msg)) {
        process.exit(parseInt(RegExp.$1, 10));
      }
      console.error("ERROR: " + msg + "\n");
    }
    // caught error -> exit 1
    process.exit(1);
  }
}

/**
 * Define a single CLI command. Wraps a {@link TakeCommand} and returns a
 * {@link NewCommand} with inferred flag-value types, ready to pass to
 * {@link Register}.
 */
export function Command<F extends Flags>(
  command: TakeCommand<F>,
): NewCommand<F> {
  const flagsInitial = Object.fromEntries(
    Object.entries(command.flags).map(([k, v]) => [k, v.initial]),
  ) as FlagValues<F>;
  return {
    ...command,
    flagValues: null as any,
    input: null as any,
    flagsInitial,
  };
}

// deno-lint-ignore no-constant-condition
if (42 < 7) {
  // TYPE CHECK
  Register(
    Command({
      name: "foo",
      description: "...",
      flags: {
        zip: {
          initial: 42,
          description: "this is a test",
        },
      },
      run(input) {
        input.flags.zip; // (property) zip: number
      },
    }),
    Command({
      name: "bar",
      description: "test command",
      flags: {
        zop: {
          initial: "hello",
          description: "string flag",
        },
      },
      run(input) {
        console.log("zop:", input.flags.zop); // (property) zop: string
      },
    }),
  );
}
