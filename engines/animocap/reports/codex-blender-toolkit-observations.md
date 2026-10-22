# Codex Blender Toolkit observations

Observed on 2026-08-08 with Blender 5.2.0 LTS, Codex Blender Toolkit 0.5.0,
and the Silver Wolf MMD scene. These are reproducible observations from this
project, not a complete product review.

## High-impact gaps

### The Blender MCP tools were not exposed to the active Codex host

The Blender add-on bridge was healthy on `127.0.0.1:9877`, but no Blender tool
appeared in the active tool catalog. The session had to read the add-on source,
extract the configured token, and speak the authenticated newline-delimited TCP
protocol directly. This bypasses normal tool discovery, schemas, confirmation
handling, and provenance in the host UI.

Desired behavior: expose the bridge as a normal MCP server whenever the add-on
is running, or provide a first-class reconnect/discovery action.

### Armature validation produced a false-positive failure

`armature.validate` reported 624 `bone_parent_cycle` errors for a 632-bone MMD
armature. A separate traversal of every returned `parent` relation found zero
cycles and zero missing parents. Blender itself also prevents a normal rest-bone
parent cycle. The current result makes the validator unusable as a gate for this
class of MMD rig.

Desired behavior: distinguish rest-bone parent topology from constraint,
additional-transform, dummy, and shadow relationships; include one concrete
cycle path when reporting a cycle.

### Narrow object inspection still returned the entire scene

`object.inspect` with `object_name` returned all 934 objects before the requested
`object_detail`. One call produced roughly 236k tokens of tool output. This is
slow, obscures the requested data, and risks the bridge response-size limit.

Desired behavior: make `object_name` an exclusive detail query, or add a
`fields`/`summary_only` projection.

### No atomic semantic layer export

`interchange.export` can export selected objects, scenes, or collections, and
`mesh.separate` can split by material/loose part/selection. There is no single
non-destructive operation that groups material subsets into semantic layers
such as `character`, `effects`, and `mocap_mask`, exports them, and restores the
source state. A monolithic skinned MMD mesh therefore requires custom Blender
Python or a long sequence of duplicate/separate/select/export/cleanup calls.
The custom fallback also hit a Blender 5.2 API change while removing copied
shape keys, so this route carries version-compatibility work that a maintained
toolkit operation could centralize.

Desired behavior: add a transient export-layer tool accepting material names or
regexes, optional flat-mask material, armature inclusion, and multiple output
files without altering the saved scene.

## Performance and feedback limitations

### Per-client concurrency is capped at four without client-side queuing

A batch of seven read-only material inspections completed four calls and
returned `BridgeBusyError` for the remaining three (`client_inflight_limit=4`).
The failed calls had to be retried manually.

Desired behavior: queue bounded read-only calls, or publish a client helper that
automatically respects `retry_after_ms` and preserves request order.

### Long operations provide no progress events

The bridge protocol returns one final JSON line. A viewport screenshot attempted
while Blender was minimized waited about 17 seconds and then returned only a
timeout. There was no intermediate state indicating that a viewport draw was
required. The same protocol shape leaves long exports without useful progress.

Desired behavior: emit queued/started/progress/waiting-for-viewport states, or
provide a polling job API for screenshot, topology, export, and render calls.

### Viewport screenshots require a drawable foreground viewport

`scene.screenshot` is described as not changing visible UI state, but two orbit
captures timed out while Blender was minimized with `Timed out waiting for the
active 3D viewport to draw`. Both succeeded immediately after bringing Blender
to the foreground.

Desired behavior: support an offscreen GPU context, or fail immediately with a
specific `viewport_not_drawable` recovery instruction.

### Topology inspection fails the whole request when the budget is low

`mesh.inspect(include_topology=true, max_elements=250000)` rejected the model
because analysis required 294,495 edge/loop elements. Counts, bounds, materials,
and other inexpensive fields were discarded with the topology failure.

Desired behavior: return the inexpensive summary plus a truncated/omitted
topology diagnostic and the required budget.

## Integration/tooling mismatch

The bundled Computer Use instructions require `sky.documentation(...)`, but the
runtime `sky` object did not provide that function. `sky.list_windows()` and
`sky.list_apps()` then failed with `EnumWindows failed: The system cannot find
the path specified`. The session used direct Win32 enumeration and capture as a
fallback. This is outside the Blender add-on itself but materially affected the
ability to activate and inspect Blender.

The same missing `sky.documentation` method and `EnumWindows` failure were
reproduced while visually testing AniMocap's character-profile import UI. This
confirms the limitation is not specific to one Blender window or process.

Desired behavior: version the Computer Use instructions with the runtime API and
include a working target-window fallback.

## Useful capabilities that did work

- Authenticated loopback bridge health and capability discovery.
- Scene, material-slot, skin-weight, pose-constraint, and armature inspection.
- Independent orbit screenshots after the viewport was foregrounded.
- Clear dry-run/confirmation schemas for mutating mesh and interchange tools.
- Skin validation correctly ignored two MMD metadata groups and reported the
  deform-weight binding as valid.
