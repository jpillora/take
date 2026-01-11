#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env --allow-run
import { Command, Register, spawn } from "../take.ts";

Register(
  Command({
    name: "lint",
    description: "Run linting for the take project",
    flags: {
      fix: {
        initial: false,
        description: "Automatically fix linting issues",
      },
    },
    async run({ flags }) {
      console.log("Running linting...");
      await spawn({
        program: "deno",
        args: flags.fix ? ["lint", "--fix"] : ["lint"],
      });
    },
  }),
);
