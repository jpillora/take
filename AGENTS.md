# take - Agent Instructions

This document contains instructions for automated tools and agents working with the take CLI library.

## Project Overview

**take** is a minimal CLI library for building TypeScript-based command-line tools with Deno. It provides type-safe command definitions, automatic help generation, environment variable support, and performance timing utilities.

## Technology Stack

- **Runtime**: Deno
- **Language**: TypeScript
- **Package Manager**: None (Deno handles dependencies)
- **Linting**: Deno's built-in linter
- **Testing**: Deno's built-in test runner

## Development Commands

### Linting
```bash
deno lint
```
Runs Deno's built-in linter to check code style and potential issues.

### Type Checking
```bash
deno check cli.ts
```
Performs TypeScript type checking on the main library file.

### Testing
```bash
deno test
```
Runs the test suite using Deno's built-in test runner.

### Running the CLI
```bash
deno run --allow-env cli.ts <command>
```
Runs the CLI library with the specified command. The `--allow-env` flag is needed for environment variable access.

### Building/Publishing
```bash
deno publish
```
Publishes the package to JSR (JavaScript Registry) when ready for release.

## File Structure

- `bunw.sh` (on `ghpages`) - Bun wrapper; installs into `~/.local` when needed
- `setup.sh` (on `ghpages`) - One-time setup for Bun, `dev.ts`, and `.dev/greet.ts`
- `cli.ts` - Main library file containing all CLI functionality
- `README.md` - Project documentation and usage examples
- `deno.json` - Deno configuration and package metadata
- `.github/workflows/lint.yml` - GitHub Actions workflow for CI/CD

## Code Style

- Uses Deno's default linting rules
- Follows TypeScript strict mode
- No external dependencies (pure Deno stdlib)
- Exports are explicitly typed for JSR compatibility

## Testing

For changes to the Bun bootstrap wrapper, run `bash -n bunw.sh` in the `ghpages`
worktree. Serve that worktree with `python3 -m http.server 8000 --bind 127.0.0.1`
to test the remote shebang locally, covering both an existing `~/.local/bin/bun`
and a missing executable. Use a bare `@jpillora/take` import to verify packages
resolve from the shared Bun cache without creating local `node_modules`.

For changes to `setup.sh`, run `bash -n setup.sh` in the `ghpages` worktree. Test
`curl -fsSL http://127.0.0.1:8000/setup.sh | bash` in a temporary project with
both an existing and a missing Bun executable. Check that setup creates the
starter files, runs the greeting, and preserves existing files on a second run.

Currently no test files exist. When adding tests:
- Create test files with `_test.ts` suffix
- Use Deno's built-in testing framework
- Run tests with `deno test`

## Contributing

- Always run `deno lint` before committing
- Ensure type checking passes with `deno check cli.ts`
- Update this AGENTS.md file if new commands or workflows are added
