# CHANGELOG — v4

- Said where the freshness validator stops. It compares
  `source_revision_represented`; a codebase map keeps `represented_revision`
  under its own key and stays outside that comparison on purpose, because an
  on-query rebuild makes the map current when it is read. Pulling it in would
  fail every adopted map between sessions. The dangerous half was already
  covered: a map claiming `status: current` on a manual trigger has no
  checkable revision and fails.
- Restored the named exemption to the Collaboration default, which the
  independent-judgment rewrite had dropped. "Codex normally implements"
  describes a division; "material code changes should normally go to Codex, and
  name the exemption when they do not" is the instruction that fires while the
  handoff is still being decided. The three grounds and the obligation to cite
  one are back, alongside the independent-judgment text that replaced them.
- Added the receiver-side check on a finished brief: sufficient if it says what
  to do without the sending conversation, safe if it still leaves room to reach
  the opposite conclusion. A brief written against the rule list rather than
  against the receiver passes every field check and still lands wrong.
- Closed the last competing handoff schema. `codex-model-routing.md` carried its
  own list of what an escalation carries forward, so a host reading it and
  `capability-routing.md` together stacked two enumerations and could satisfy
  neither compactly. It now defers, as `codex-mcp-effort.md` already did.
- Said that a documented default is not an Owner decision. Module routing fires
  on recognizing a topic, which fails exactly when the topic is misread as an
  Owner question — a Git-ownership default answered in `git-execution.md` gets
  asked upward instead. Escalation now checks the routed module first.
- Named the package's own scope: collaboration relationships, evidence
  standards, and handoff boundaries. Expression belongs to the host and project
  instructions, so the package no longer carries style rules and says that its
  silence there is deliberate rather than an omission a reader should fill.
- Removed the ceremony from packets. A handoff no longer opens with `From/to`,
  which the metadata rule two paragraphs above already said to include only when
  it affects execution, and collapsed roles are named in ordinary words instead
  of a prescribed sample line. What a claim must establish is unchanged.
- Stopped restating in `CLAUDE.md` the contract it routes to. It pointed at the
  minimum sufficient brief in `capability-routing.md` and then repeated it, and
  it carried an Owner-escalation rule that is not Claude-specific and already
  lives in `OWNER_HANDBOOK.md`.

- Preserved the Claude-plans/Codex-implements default while protecting Codex's
  independent choice of implementation and verification method. Handoffs
  transfer the minimum sufficient contract, not a prescribed reasoning path or
  expected conclusion. Research Packets remain final research deliverables
  rather than a default intermediate format.
- Added a low-cost task-start route preflight, a canonical minimum-sufficient
  brief, an explicit route fallback ladder, and clear precedence for explicit
  Owner executor assignments.
- Added a distributable Project Context freshness validator that scans the full
  facts file, rejects stale represented revisions and unsupported handwritten
  `current` claims, plus evidence qualification and minimum measurement hygiene.

- Made committing the ordinary case: the host that made a change commits it.
  `codex-git` and `claude-git` become the arrangement a project adopts when two
  hosts work one tree at the same time, and a project that adopts one says so,
  which removes a rule that forbade inferring an assignment the protocol never
  recorded anywhere.
- Named the missing-lock state in branch currency. A repository with no
  `.protocol-lock.json` is not current; its version is unknown and distribution
  will not replace files it cannot prove it installed, so every later release
  blocks until the lock exists. Automation records where it is installed,
  because automation living outside the repository does not travel with a clone.
- Said when to adopt `project-context/`: at the first fact that passes both
  tests, not at project start, and not for work that fits one session. Empty
  headings read as questions already answered.
- Left the Owner report shape in `OWNER_HANDBOOK.md` only; `packets.md` defers
  to it rather than restating it in different words.

- Made an on-demand rebuild the default way a map stays true: when only agents
  read it, rebuild immediately before querying instead of maintaining freshness
  between sessions, and route that rebuild to the executor model. Automatic
  triggers now require something outside an agent session to read the map, and
  must record that hooks install per clone. Added `maintainer`,
  `update_trigger`, and `automation_authorized` to the `codebase_map` record.

- Named when to commission external research instead of only how to consume its
  result: exhausted repair cycles, approach comparison, contesting a plan, an
  unestablished domain, and offloading long external search from the engineering
  context. Stated the disqualifying cases and made repeated failure route into
  `research-integration.md`.

- Compressed the optional workflow modules around judgment instead of
  checklists, removed repeated role/authority/reporting text, and reduced the
  affected runtime documentation by about 60%. Project Context no longer persists
  transient model, thread, effort, or review state. Detailed verified debug
  evidence remains available only on demand.

- Slimmed the default runtime instructions to a short working agreement and
  on-demand module router. Removed duplicated role, Git, safety, packet, and
  process detail from `AGENTS.md`; reduced `CLAUDE.md` to optional coordination
  routing. Reframed Project Context as durable goals, confirmed decisions, and
  active boundaries, explicitly excluding task/process logs and routine
  progress.
- Restored one lightweight collaboration default: Claude may orchestrate, while
  material code changes preferentially go to Codex for implementation and
  verification; small or uneconomical handoffs may stay with Claude.

- Named canonical owners for the codebase-map storage boundary, distinct
  implementation/review/verification/acceptance claims, Research Packet
  consumption boundary, and default role assignments; retained their short
  root restatements with explicit deferral.
- Kept host-named Git values and Codex module/debug filenames as documented
  compatibility identifiers pending a coordinated consumer migration.
- Made `tools/sync-protocol` the primary mechanical update path, documented
  `.protocol-lock.json`, aligned Project Context routing fields with the
  luna/sol model vocabulary, removed stale Research transport wording, and
  removed duplicate changelog entries.

- Replaced `gpt-5.3-codex-spark` routing with a two-role model policy verified
  on 2026-08-03: `gpt-5.6-luna` at `max` executes already-decided work, and
  `gpt-5.6-sol` at `medium`/`high`/`xhigh` owns design, ambiguity, and work
  that must adapt. Routing is by whether a decision remains, not task size.
  Every dispatch must name its model; an unnamed call runs the `config.toml`
  default and is not a routing decision.
- Corrected the effort contract. `max` is a valid tier — the previous "Never
  use `max`" rule was wrong — and the accepted set is
  `none/minimal/low/medium/high/xhigh/ultra/max`, server-validated and
  account-dependent.
- Removed `communication-protocol-source.md`, which had become a restatement of
  the root rules, capability routing, project context, and research
  integration after the PNG layer was deleted.
- Added the single-host role-collapse rule: roles collapse but do not
  disappear, and a claim that lost independence must be labelled as such.
  Clarified that Git mode names an execution environment rather than a role,
  and that the package defaults are the assignment absent an active brief.
- Made `security-and-destructive-actions.md` the canonical Owner-approval list;
  the root summary and Owner Handbook now restate it without widening it.

- Made codebase-map maintenance follow the assigned map maintainer and the
  configured update trigger. Map freshness and health are acceptance gates only
  when map output informed the task, mapped corpus changed, or the active brief
  requires current map state.
- Removed the Dense Context/PNG transport and answer-blind handoff contract.
  Research Requests and Packets now use native text, and Project Context stores
  routed native source modules without generated PNG mirrors.

- Converted the Owner Handbook to concise English, compressed the root runtime
  rules and stable model-routing policy, and split rare packet templates out of
  the common packet module.
- Added a concise Owner Handbook separating autonomous engineering work from
  product, permission, destructive-action, privacy, cost, and release gates.
- Compressed the codebase-map and Project Context rules, moved V2-to-V3
  migration detail out of the normal loading path, and replaced repeated Map
  packet fields with one reusable Context Artifact Record. Provider operations
  now live exclusively in the provider Skill.
- Introduced Project Context Lite V3. Removed the default persistent
  `system-map`, moved repository-derived topology and as-built architecture to
  the adopted codebase map, and retained only authority-bearing intent,
  normative architecture decisions, project state, decisions, risks, exact
  facts, and research policy.
- Added a safe V2-to-V3 migration order that verifies the replacement map or
  source-inspection fallback before deleting or archiving structural context.
- Added an optional, provider-neutral codebase-map workflow with a verified
  Graphify `0.9.31` profile. Provider installation is user/machine-level while
  maps, freshness, semantic-data boundaries, hooks, generated artifacts, and
  Git policy remain project-owned.
- Added query-first/source-verify routing, incremental-maintenance evidence,
  explicit cross-project global-map controls, and map fields in engineering
  packets and project context.
- Made the current implementer the default map maintainer and the integration
  acceptor the default freshness acceptor. Added initial-build, task-start,
  stabilized-change-set update, handoff, and acceptance lifecycle rules so
  agents maintain maps proactively without rebuilding after every edit.
- Separated engineering role, host, and authority. Claude/Codex assignments are
  now stable project defaults with explicit per-work-item overrides rather than
  universal model identities.
- Added compatibility preflight, revision- and repository-bound handoffs,
  host-neutral implementation evidence, bounded parallel-work leases, and
  clean-context review guidance.
- Split reviewer verdict, executed verification, and integration acceptance
  into distinct reportable states. Research remains host-neutral and does not
  route coding agents.
- Split the Research Skill and its bundled research contract, packet schemas,
  answer-blind handoff references, and optional Dense Context tool into the
  separate `chatgpt-research-skill` repository. The engineering protocol no
  longer requires project `AGENTS.md` or research workflow files merely to run
  Research. The Research Skill accepts caller-supplied context and sources;
  project-specific research profiles remain project-owned.
- Moved Codex Researcher rendering out of the restricted browser process. The
  browser now stages the completed answer without spawning a child process;
  `dense_create_handoff_from_staged_file` renders and automatically paginates
  it in the MCP process, then deletes the raw staging file. This avoids
  `spawn EPERM` without weakening local permissions. Dense Context is now
  version `0.3.2`.
- Added answer-blind timed status checks for long Pro research: Codex may check
  only `not_started`, `started`, `generating`, or `completed` every 300 seconds,
  then publish exactly one PNG bundle on completion. Dense Context no longer
  imposes a default Researcher or handoff deadline; explicit caller timeouts
  remain available. The Dense Context package and server are now version
  `0.3.1`.
- Added incremental ChatGPT Project Source synchronization: deterministic
  manifest and hash checks run before model work, the current task agent owns
  small clear updates, and a low-cost Source Curator receives only bounded
  changed content for batch or semantic curation.
- Documented the verified ChatGPT-account availability limit in
  `codex-model-routing.md`: `gpt-5.3-codex-spark` is rejected with HTTP 400
  ("not supported when using Codex with a ChatGPT account") on the `codex-user`
  MCP channel, so Spark routing requires a compatible account or surface;
  otherwise mark Execution target `not available` and route to ordinary Codex.
- Added Codex Desktop host-specific concurrent orchestration for the persistent
  Browser plugin Playwright tab and `dense_wait_for_handoff`.
- Added the optional `run-chatgpt-research` Codex Skill package. It routes into
  the canonical Research modules, enforces Browser answer-blind PNG receipt,
  and keeps authority, safety, checkpoints, and Research Packet definitions in
  the protocol rather than duplicating them.
- Changed the shared Research handoff contract to require concurrent publisher
  and receiver startup while allowing Claude Code and Codex to use separate
  browser adapters.
- Live-verified the Codex composition path: the MCP wait began before bundle
  creation, resumed in the same composed call, returned a verified PNG image
  block, and exposed an unknown proof only through the image.
- Live-tested the Instant Researcher workflow in a real ChatGPT Project and
  fixed two host-integration defects found during the run: UTF-8 stdin was
  misread by Windows PowerShell, and browser runtimes without a global
  `process` object could not create bundles.
- Synchronized the MCP server's reported version with package version `0.3.0`
  and added regression coverage for version reporting, UTF-8 rendering, and
  process-free runtime defaults.
- Added Research to `owner-direct`: Codex may commission ChatGPT Researcher
  without Claude as intermediary and receives replies through the automatic
  answer-blind PNG handoff. Ordinary Owner-to-ChatGPT conversation remains
  outside the MCP workflow.
- Added the automatic Research receive chain:
  `waitAndCreateAssistantHandoff` waits inside the browser adapter and publishes
  without returning raw reply text, while `dense_wait_for_handoff` blocks once,
  verifies the bundle, and resumes the receiving agent with a native envelope
  plus PNG pages.
- Simplified `AGENTS.md` into shared native authority and `CLAUDE.md` into
  Claude-only routing behavior; both use the host-supported image reader for
  the shared communication PNG rather than relying on literal `@png` parsing.

- Added ChatGPT Researcher as a first-class research and proposal-evaluation
  role with domain authority, Research Decisions, documented Research
  Overrides, and a three-key Researcher/Claude/Codex validation model.
- Added the original project-local research routing module with ChatGPT Project
  bootstrap, naming, project instructions, problem-discovery and
  proposal-evaluation modes, milestone/checkpoint execution, source
  boundaries, model-profile abstraction, GitHub research, and loop limits.
- Added a standalone ChatGPT Research Project instruction that can be pasted
  into Project Settings and distinguishes Owner-facing conversation from
  agent-to-agent research.
- Required answer-blind Researcher capture: browser operators may probe only
  generation state and must render the completed reply through
  `browser-context-to-png.mjs` without first reading the response body.
- Added structured Research Request, Clarification Bundle, Research Packet, and
  Research Override templates.
- Replaced monolithic `PROJECTCONTEXT.md` with modular `project-context/` V2:
  native routing and exact-facts YAML, canonical source modules, and selective
  PNG modules generated from those sources.
- Added `communication-protocol.png` and its canonical source to distinguish
  natural Owner-facing conversation from dense agent-to-agent exchange.
- Made the dense PNG renderer automatically crop unused horizontal pixels after
  wrapping, with regression coverage for hard-wrapped Markdown.
- Added smallest-sufficient-design rules for development and a materiality
  threshold for review so speculative architecture, style preference, and
  implausible edge cases do not block delivery.
- Identified the Spark execution target concretely as OpenAI's GPT-5.3-Codex-
  Spark model, invoked through the Codex MCP tool with a `model` override
  (`model: "gpt-5.3-codex-spark"`) rather than a separate server or tool, with
  per-environment availability verified by probe the way effort is verified.
- Added `docs/ai-workflow/codex-model-routing.md` as the full model-selection
  policy for Spark versus higher-capability Codex, including escalation,
  handoff, brief, result, acceptance, and parallel-worker rules.
- Added Claude routing guidance for Spark versus ordinary Codex execution
  targets, including platform availability and escalation boundaries.
- Clarified that Spark is the `gpt-5.3-codex-spark` Codex model, added model
  fields to packets, and documented how to verify Spark in Codex debug rollouts.
- Preserved the Claude Codex-debug pointer.
- Replaced generic effort routing with the exact MCP `config` structure.
- Documented that effort is selected when `codex` creates a new thread.
- Documented that `codex-reply` cannot change effort.
- Added Effort Upgrade Handoff Packet.
- Added thread ID and effort verification fields to reports.
- Removed `max` from valid Codex reasoning-effort choices.
- Marked `xhigh` as model-dependent.
- Added guidance to use one MCP server with per-thread configuration.
- Scoped Git execution mode to each Claude/Codex execution environment rather
  than to the repository, with per-host verification metadata.
- Split Codex self-review behavior between `codex-git` and `claude-git`.
- Made the Codex debug-document pointer conditional on existence and relevance.
- Added modular Project Context Delta reporting, context authority precedence,
  and lifecycle rules for active gotchas.
- Clarified that Claude evaluates project context after every round but updates
  only durable changed modules, and made completion Git ownership fields work in
  both execution modes.
- Added an `owner-direct` task coordination mode so Codex can safely execute
  occasional Owner-assigned tasks without an active Claude routing round.
- Added capability routing for sub-agents, specialized tools, and independent
  verification, with bounded delegation and shared-state safety rules.
- Modularized the protocol: root files now hold always-on authority and safety
  rules, while effort, Git, capability, packet, context, debug, and destructive
  workflows load from `docs/ai-workflow/` only when triggered.
- Integrated `docs/codex-debug-solution.md` as an optional, environment-specific
  debug record and reconciled its Git/effort guidance with capability detection.
