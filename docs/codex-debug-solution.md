# Codex Debug Solution

## Applicability

This is the environment record for this host: dated observations of what the
runtime actually did, kept out of the protocol so no rule depends on a product,
a parameter, or a default. Apply a symptom only when the current channel,
invocation shape, and observed failure match. It does not override `AGENTS.md`
or the environment's verified Git, model, or effort capabilities. For generic
failure routing, read `docs/ai-workflow/failure-and-debug.md` first.

Every entry carries its date and the invocation path it was taken on, because an
observation from one path establishes nothing about another.

## Record identity

```text
Environment record ID:   env-2026-08-07
Machine alias:           machine-1
Account alias:           account-1
Path-A observed version: 0.144.1
Path-B observed version: unknown
```

Paths are identified by local alias. Define an alias once and never rebind it;
record the observed version separately, because an alias fixes *which path*, not
which version of it. Every observation below names its path, and an observation
that cannot name one is not attributable.

| Alias | What it is |
|---|---|
| `path-A` | Non-interactive invocation. Used operationally for one top-level planning session; production work does not spawn from it. Controlled capability probes may. |
| `path-B` | Interactive application session. Where the execution network runs production work. |

The distinction in `path-A` matters: the probes recorded below did spawn from
it, which is not a contradiction of its operational use but would look like one
without the line.

This buys product-neutrality at a real cost, and the cost should not be talked
around: an alias establishes that two observations came from the same path, not
what that path is. A reader without these definitions cannot judge whether
another machine offers an equivalent path, cannot correlate an observation with
a known upstream change, and cannot detect an alias applied inconsistently.
Applicability outside this project has to be re-established, not inherited.

## Capability status

| Capability | Status |
|---|---|
| Target-state visibility | **Shared mutable workspace**, observed. Uncommitted state is visible across agents, and so are mid-run changes. |
| Creating a session with a chosen model | **Reliable, and available to an agent.** Model, reasoning effort, and the opening task are set together at creation. |
| Changing model or effort mid-session | **Not available.** Both are fixed when the session is created. |
| Cross-session handoff and continuation | `path-B`: **Owner-confirmed on 2026-08-08.** Sessions create, assign, hand off, and continue work across conversations. The task record stores durable evidence and continuity. |
| Runtime enforcement of assigned identity | `path-A`: not enforced. `path-B`: unrecorded. |

Session creation is the route the protocol uses, and this is why: model,
reasoning effort, and the opening task are set together and they hold for the
session's life. Other ways of creating an execution context on this runtime did
not reproduce reliably when the Owner tested them on 2026-08-08, and upstream
issues track the same behaviour, so the protocol names one route rather than a
route with exceptions. The
practical consequence is in `execution-network.md`: a per-role model mapping and
the created-agent message tree are alternatives, not a combination.

Identity enforcement stays unrecorded. It was not probed, and nothing in the
network depends on it.

The MCP channel was retired on 2026-08-07. Symptoms that only existed in the
`codex-user` MCP environment — host permission allow-rules, idle-timeout kills,
total-duration caps, and the MCP tool-shape effort knob — were removed with it
rather than left as traps for a channel nobody runs. `CHANGELOG.md` keeps the
history.

## Diagnosis method (use this before guessing)

- **Control test**: send a trivial call first — write `Reply with exactly:
  PING OK` to a file and pipe it in (see the stdin symptom below for the bash
  and PowerShell forms). If PING passes but the real task fails, the problem is
  the task's content or duration, not the channel.
- **Ground truth for what actually ran**: Codex session rollouts at
  `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*.jsonl`. The `turn_context`
  line shows the real `model` and `effort` per turn; `token_count` events show
  real usage; `patch_apply_end` events prove it was editing files.
- **Model identity check**: a model is a concrete id passed as an override, not
  a workflow, tool, or server. If the brief says one model but the rollout's
  `turn_context.model` says another, the intended model did not run.
- **Capability check**: `codex features list` reports what is actually enabled
  on this build. Read it before concluding a capability is missing.

## Symptom: `codex exec` hangs at "Reading additional input from stdin..."

Cause: no TTY in tool shells.

Fix: pipe the prompt and pass the trailing `-`. Verified 2026-08-07:

```bash
codex exec -C <repo> --skip-git-repo-check -s read-only -o <reply.md> - < <brief.md>
```

PowerShell, which is the primary shell on this host:

```powershell
Get-Content -Raw $briefPath |
    codex exec -C $repoPath --skip-git-repo-check -s read-only -o $replyPath -
```

Use `-Raw`; without it PowerShell pipes the file line by line as objects. Do not
use a here-string for the brief — write it to a file.

Write the brief to a file rather than inlining it. A long brief quoted on the
command line fails on shell quoting long before it fails on content. `-o` writes
the final message to a file, which is what a caller should read; the streamed
output is progress, not the result.

Use `--skip-git-repo-check` outside a Git repository. Use `-s read-only` for any
call that must not change the working tree — planning, review, and probes.

## Symptom: the full brief is rejected instantly while a trivial call passes

Cause observed on the retired MCP/VSCode path: the auto-mode safety classifier
blocked briefs whose content read as "autonomous agent that commits/pushes" —
git commit/push instructions, "never force-push", and similar.

Status on the current channel: **not re-verified**. Treat it as a candidate
explanation, not an established one. If it reproduces, strip Git instructions
from the brief and let Codex leave changes in the working tree while Claude owns
Git; record it as an environment-specific mode under
`docs/ai-workflow/git-execution.md` rather than assuming other hosts behave the
same.

## Symptom: Codex runs but is slow, shallow, low token usage

Cause: reasoning effort lower than the work needs. Naming an effort in the
prompt does nothing — effort is fixed at session creation.

Fix: set it through the channel's own knob (a per-invocation override, or
`~/.codex/config.toml` → `model_reasoning_effort`), then verify the new
rollout's `turn_context`. Never claim the configured effort changed without
current-environment evidence. Signature of the original problem: a long run
whose `reasoning_output_tokens` was tiny while it mechanically applied patches.

See `docs/ai-workflow/codex-effort.md` for tier selection.

## Symptom: Claude intended one model, but the default ran

Cause: the model was named in the prompt instead of passed as a concrete
override. Prompt text alone does not switch models, and resuming a session
cannot change its model. A call with no override silently runs the
`config.toml` default.

Fix: start a new session with an explicit model override.
Verify the next rollout's `turn_context.model` before reporting which model ran.
If the id is rejected, check it against `config.toml` before concluding the
account lacks access.

## Symptom: model id rejected with HTTP 400 on a ChatGPT account

Cause: the id does not exist on this surface, or the account tier does not
expose it. The error is identical in both cases:
`The '<id>' model is not supported when using Codex with a ChatGPT account.`
A guessed id fails the same way a genuinely blocked one does, so a single 400
does not prove the model is unavailable to the account.

Fix: read the real id before probing. `~/.codex/config.toml` → `model` holds
the id the client actually uses, and `enabled-reasoning-efforts` holds the
effort set it was built with. Then confirm against the rollout's
`turn_context`, which records the `model` and `effort` that really ran.

Verified 2026-08-03:

```text
gpt-5.6-sol      accepted (effort max)
gpt-5.6-terra    accepted (effort xhigh)   <- config.toml default
gpt-5.6-luna     accepted (effort max, ultra); rollout confirmed
                 "model":"gpt-5.6-luna" / "effort":"max"
gpt-5.6          HTTP 400 - not a real id on this surface
gpt-5.6-codex    HTTP 400 - not a real id on this surface
```

Effort on the same date: an invalid value returned HTTP 400 listing
`none, minimal, low, medium, high, xhigh, max`, yet `ultra` was also accepted.
Treat that server-side list as indicative, not exhaustive; probe the value you
intend to use.

## Creating an execution context

Verified 2026-08-08 on the path where execution runs.

Creating a **session** is the route this protocol uses. Its model, reasoning
effort, and opening task are set together at creation and hold for the session's
life. A new session starts with runtime and project instructions and repository
access, and nothing of the conversation that created it.

Other ways of creating an execution context on this runtime were tried and did
not reproduce reliably — a setting accepted at creation and then applied only
sometimes. Upstream issues track the same behaviour. They are not recorded in
detail here because nothing in the protocol uses them, and a recorded route
invites someone to take it.

### Two observations about the workspace

Agents sharing a workspace share a **mutable** one: uncommitted state is visible
across them, and so is a change made while another is running. A revision alone
therefore does not identify an uncommitted state, and holding the workspace
still during verification is a physical requirement rather than a courtesy.

Names are convention. `use_agent_identity` is disabled, so an assigned role name
holds because the assignment states it, not because the runtime enforces it.

### The lesson that cost the most

Three findings in this record were wrong the same way: a coordinating agent's
account of what its descendants said was taken as an observation of what
happened. An empty context, a direct message delivered, a model applied — each
was a relayed self-report, and each survived review because it confirmed what
the reader wanted.

Ask the agent that would know. Where that is impossible, record the claim as
reported rather than observed, and do not build on it.
