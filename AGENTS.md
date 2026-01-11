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

Currently no test files exist. When adding tests:
- Create test files with `_test.ts` suffix
- Use Deno's built-in testing framework
- Run tests with `deno test`

## Contributing

- Always run `deno lint` before committing
- Ensure type checking passes with `deno check cli.ts`
- Update this AGENTS.md file if new commands or workflows are added