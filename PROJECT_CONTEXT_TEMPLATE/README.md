# Project Context Template

Copy this directory to `project-context/` when initializing a consuming
project. Keep the directory name lowercase with a hyphen for reliable
cross-platform paths.

Normal task startup reads `index.yaml` and, only when route discovery needs it,
the adoption/routing metadata in `exact-facts.yaml`. Read exact fact values when
they matter, then load only the source modules whose `read_when` matches the
task.

Before relying on revision-bound facts, and after editing this file, run
`python tools/validate_project_context.py project-context/exact-facts.yaml
--repo .`. The check scans the whole file so a newly stale adjacent fact cannot
remain trusted merely because it was not the edited field. It compares
`source_revision_represented`; the map's `represented_revision` carries its own
on-query freshness rule, described in `docs/ai-workflow/project-context.md`.

This is the Project Context Lite V3 template. Repository-derived components,
symbols, calls, imports, dependencies, data/control paths, impact relationships,
and as-built architecture belong to the adopted codebase map, not these source
modules. `docs/ai-workflow/codebase-map.md` is the canonical owner of this
boundary. Without an adopted map, inspect source on demand rather than
restoring a duplicated persistent system map.

When the project adopts Graphify or another codebase map, fill the
`codebase_map` record in `exact-facts.yaml`. `update_trigger` defaults to
`on-query`, meaning the map is rebuilt immediately before it is read; name an
automatic trigger and who authorized it only when something outside an agent
session reads the map. Keep the graph, report,
visualization, cache, and provider memory under the project's separate artifact
policy; do not copy them into these context modules.

Project context is persistent project memory for long-term goals, confirmed
decisions, and active boundaries. It is not a transcript, task/process log,
packet archive, or replacement for current instructions and verified repository
evidence.
