// Take is a mini-CLI library for building typescript-based command-line tools
// Works with Deno, Node.js (with type stripping), and Bun
// deno-lint-ignore-file no-explicit-any

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import {
  spawn as nodeSpawn,
  SpawnOptions as nodeSpawnOptions,
} from "node:child_process";
import process from "node:process";

export type Flag = {
  initial: number | string | boolean | Date;
  description: string;
  env?: string;
};

type Flags = Record<string, Flag>;

export type FlagValues<T extends Flags> = {
  [P in keyof T]: T[P]["initial"] extends number ? number
    : T[P]["initial"] extends string ? string
    : T[P]["initial"] extends boolean ? boolean
    : T[P]["initial"] extends Date ? Date
    : never;
};

export type TakeCommand<F extends Flags = Flags> = {
  name: string;
  names?: string[];
  description: string;
  help?: string;
  flags: F;
  run: (input: CommandInput<F>) => void | Promise<void>;
};

export function newFlags<F extends Flags>(flags: F): F {
  return flags;
}

export type NewCommand<F extends Flags = Flags> = TakeCommand<F> & {
  // always null, but can be type-referenced
  flagValues: FlagValues<F>;
  input: CommandInput<F>;
};

export type CommandInput<F extends Flags> = {
  flags: FlagValues<F>;
  args: string[];
  cmd: (...args: string[]) => Promise<void>;
  cmdName: string;
  help: (msg?: string) => void;
};

export function help(str: string) {
  throw str;
}

const exit = (...args: any[]) => {
  console.log(...args);
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
export type SpawnOptions =
  & { program: string; args?: string[] }
  & nodeSpawnOptions;

export async function spawn(options: SpawnOptions): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const child = nodeSpawn(options.program, options.args ?? [], options);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(0);
      } else {
        reject(code);
      }
    });
  });
}

// helper for measuring time
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
        return cmd.name !== "debug" || process.env.DEBUG === "1";
      }).map((cmd) => ({
        left: ` • ${cmd.name}`,
        right: cmd.description ? `- ${cmd.description}` : "",
      })),
    );
    // print result
    console.log(
      `\n${scriptName} <command> --help\n\n` + "commands:\n" + content + "\n",
    );
    if (msg) {
      console.log("ERROR:", msg);
      console.log("");
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
    console.log(
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
      console.log("ERROR:", msg);
      console.log("");
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
    console.log(`${scriptName} "${match.name}" ran in ${t}`);
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
      console.log("ERROR: " + msg + "\n");
    }
    // caught error -> exit 1
    process.exit(1);
  }
}

export function Command<F extends Flags>(
  command: TakeCommand<F>,
): NewCommand<F> {
  return { ...command, flagValues: (null as any), input: (null as any) };
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
