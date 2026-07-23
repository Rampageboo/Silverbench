# Code Review Configuration

This file defines project-specific settings for the reusable code review workflow.

## Report output paths

Audit report:

`doc/review/reports/full-software-risk-audit.md`

Fix plan:

`doc/review/reports/fix-plan.md`

Fix log:

`doc/review/reports/fix-log.md`

## Folders and files that should NOT be audited as application code

Do not audit these as application code:

- `agent-workflows/`
- `doc/review/reports/`
- `.git/`
- `node_modules/`
- `dist/`
- `build/`
- `coverage/`
- `.next/`
- `.nuxt/`
- `.turbo/`
- `.cache/`
- `vendor/`
- generated files
- lock files, unless dependency/security review requires checking them

## Application code review scope

Audit the real application code, configuration, scripts, backend logic, frontend logic, API routes, authentication logic, data handling logic, state management, file handling, database logic, deployment configuration, and test coverage where relevant.

## Validation commands

Before inventing commands, inspect the project files first.

Look for available commands in files such as:

- `package.json`
- `pnpm-lock.yaml`
- `yarn.lock`
- `requirements.txt`
- `pyproject.toml`
- `Cargo.toml`
- `go.mod`
- `Makefile`
- CI configuration files

Use the most relevant available checks, such as:

- tests
- type checks
- lint checks
- build commands
- targeted reproduction steps

If no automated validation exists, write clear manual verification steps.

## Important project rule

The files in `agent-workflows/` are reusable workflow instructions.

Do not treat `agent-workflows/` as application code.
Do not report bugs, security issues, architecture issues, or style issues about the workflow prompt files.