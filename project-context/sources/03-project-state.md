# Project State

State that the next session cannot derive from the repository or the codebase
map. Verified 2026-08-04 against branch `main` at
`2dcdc0cabfe58bfc1f86812eb1acca10f87033c8`.

## Recent direction

Work through 2026-07-05 delivered video-first labeling: native video preview
with a responsive fallback playback path, video proxy transcoding with per-file
locks, and async PT image jobs. That was followed by a security-hardening pass
introducing image size limits, PT file safety, and file-operation guards.

## Collaboration protocol

The AI collaboration protocol is installed at `v4.1.1` and tracked (`AGENTS.md`,
`CLAUDE.md`, `OWNER_HANDBOOK.md`, `docs/ai-workflow/`), with installed file
hashes in `.protocol-lock.json`. Updates arrive as pull requests from the
protocol distributor on each release; do not hand-copy protocol files, and do
not merge a pull request titled `BLOCKED` expecting it to install anything —
that kind carries only a report. `docs/codex-debug-solution.md` is an optional
managed file this project has not adopted.

Codex MCP is configured in the environment but no Codex thread has been used on
this project. Execution target is therefore unproven here.

## Codebase map

A graphify map was adopted on 2026-08-04 and covers code only: 3546 nodes,
9198 edges, 153 communities over 361 source files. Its integrity check reported
609 dangling-endpoint edges, 1 self-loop, and 321 collapsed edges, so treat the
map as a navigation aid and verify cited source before relying on a claim.

Design documents under `docs/` are deliberately outside the map. They describe
intent and plans, which belong to project context, not to repository-derived
structure.

## Superseded context

`PROJECTCONTEXT.md` at the project root is the pre-V2 single-file context this
directory replaces. It is retained until the map and this layout have been used
in real work. Do not treat it as a competing source of truth, and do not update
it.
