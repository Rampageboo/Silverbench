# Codex MCP Effort and Thread Lifecycle

Read this module when creating or continuing a Codex MCP thread, selecting
reasoning effort, or upgrading effort.

## Supported effort

```text
minimal | low | medium | high | xhigh
```

`xhigh` is model-dependent. Never use `max`. Use the lowest adequate effort:

- `minimal` / `low`: mechanical named-file edits and trivial documentation.
- `medium`: routine implementation, focused tests, straightforward fixes.
- `high`: difficult debugging, multi-file workflows, persistence, API/schema,
  concurrency, security-sensitive work, or bounded refactors.
- `xhigh`: unusually difficult reasoning, ambiguous root cause, high-impact
  architecture/migration, severe risk, or repeated failed approaches.

Do not over-scan minimal/low/medium tasks or under-investigate high/xhigh tasks.

## Correct new-thread configuration

Effort is set when `codex` creates a new thread:

```json
{
  "prompt": "Implement the requested feature.",
  "cwd": "C:\\path\\to\\project",
  "config": {
    "model_reasoning_effort": "high"
  }
}
```

Do not use a top-level `effort` field. Prompt text describing an effort does
not prove that runtime configuration changed. When call details are available,
verify an equivalent `config.model_reasoning_effort` payload. If verification
is unavailable, report configured effort as `unknown`.

## Reply behavior

`codex-reply` continues an existing thread using its `threadId`. It cannot
override model, config, or reasoning effort. Never claim effort changed during
a reply.

## Effort upgrade

When current effort is insufficient:

1. Ask the existing thread for an Effort Upgrade Handoff Packet.
2. Start a new thread with the required nested config.
3. Supply the handoff, `PROJECTCONTEXT.md`, repository/Git ownership state,
   completed and remaining work, tests, failures, commits, and decisions.
4. Tell the new thread not to repeat completed work.
5. Record the new thread ID and effort-verification status.

Prefer one MCP server with per-new-thread configuration. Separate permanent
servers are only a fallback when the client cannot reliably pass nested config.

Use the packet template in `packets.md`.
