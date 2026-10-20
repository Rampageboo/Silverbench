# Decisions

## Resolved

- **Git execution mode: `claude-git`.** Claude owns status, diff, branch,
  commit, and push on this workstation; Codex runs no Git command here. This
  was the standing assumption and is now recorded as the decision. Revisit only
  when Codex is actually onboarded on this machine.
- **Protocol files are tracked.** The earlier open question about whether to
  commit `AGENTS.md`, `CLAUDE.md`, and `docs/ai-workflow/` is closed; they are
  in the repository and updated through distributor pull requests on release.
- **Codebase map adopted, code-only, local.** graphify runs AST extraction with
  no semantic pass, so no project content leaves the machine. Artifacts are
  ignored by Git except `GRAPH_REPORT.md`.
- **Design documents stay out of the map.** `docs/*.md` are plans and audits.
  They inform this context directory; duplicating them into the map would
  create two structural summaries of the same project.

## Pending

- **Execution target for implementation work.** Codex MCP is configured but
  unproven on this project. Until a real task runs through it, treat the
  execution target as unknown rather than assuming Codex is available.
- **Retirement of `PROJECTCONTEXT.md`.** Delete it only after the V3 layout and
  the map have carried real work; that is an Owner call on timing.
- **Legacy frontend disposition.** Decided 2026-10-20 by the Owner: `legacy/qt/`,
  `legacy/web/`, the React classic video and image label pages, and the backend
  code only they used are removed. The "Legacy assign" (hard-link assign) tool
  is not part of that decision.
