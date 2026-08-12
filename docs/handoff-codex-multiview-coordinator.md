# AniMocap_Fusion 多视角关节错误：Coordinator Handoff

## Coordinator_to_Community

- **receiver**: `Community:multiview-diagnosis`
- **model**: `Sol / high effort`
- **base revision**: `f010b8af4cce8cea4f25f3c61d2eb4822c32eade` (`main`)
- **stage**: causal diagnosis only; any product fix requires a new Coordinator assignment

### direction

在相同三视图、相同 403 帧和相同 revision 上，区分尾部关节错误来自组合增强开关、逐帧尺度、pin/连续性顺序，还是输入检测失败。不得把未经实验支持的 A2-A5 方案写成已确认主因。

### focus nodes

- `solve_directional_multiview()`
- `align_view()`
- `triangulate_joint()`
- `estimate_pixels_per_meter()`
- `stabilize_pose_with_animation_curves()`
- `pin_reference_image_plane()`

### read hints

- `src/cli.cpp:249-260`
- `src/multiview.cpp:344-355, 702-728, 1203-1281, 1356-1430`
- `tests/test_main.cpp`
- `outputs/alignment-common-qa-20260812-0240/`
- `outputs/FrontLeft-1786531924229/poses/`
- `project-context/sources/04-decisions.md`
- `project-context/sources/05-risks-and-gotchas.md`
- `docs/ai-workflow/failure-and-debug.md`

### write lease

Only write the combination-diagnosis scope:

- `tests/diagnostics/combination/`
- `tools/diagnostics/combination/`
- `outputs/handoff-multiview-combination-*`

Do not modify `src/`, `include/`, product defaults, import files, `_mmengine_temp/`, `input_audit/`, `joint10/`, or baseline outputs.

### boundary

- Fixed views: `front_left(-45°)`, `front(0° reference)`, `front_right(+45°)`.
- Fixed 403 common frames and 23 joints.
- No per-frame hold, smoothing/interpolation over reference frames `159-183`, or independent solve+average.
- Do not widen visibility bounds or recalibrate confidence without labelled held-out evidence.
- Jitter is a diagnostic signal, not accuracy proof.

### acceptance

1. Reproduce the current combination/enhanced baseline and record command, exit status, revision, worktree status, and output paths.
2. Run one-at-a-time ablations for `enable_view_visibility_weighting`, `enable_temporal_view_reliability`, `enable_animation_curve_stabilization`, and `require_reference_consensus_for_anchor`; a test-only harness is allowed inside the lease.
3. Report full metrics and metrics excluding joint `10` plus reference frames `159-183` inclusive.
4. For each R1/R2/R3, provide prediction, falsifier, and a distinguishing result against at least one competing explanation.
5. Emit reproducible JSON with producer, command, revision, worktree status, input/output paths and hashes, options, full/filtered metrics, and per-joint/per-frame spikes.
6. Do not claim a root cause or fix until these evidence conditions are met.

### evidence

Observed baseline signals: enhanced p99 `0.2181`, max `0.9015`; combination p99 `0.19474`, max `0.79355`; `166` conflicts, with joint `10` contributing `95`; reference window `159-183`; `9190` reference anchors; curve jitter-after `0.0141058`. These values require producer/command/revision/hash provenance before reuse.

### stop and report

After two no-improvement cycles under one hypothesis, stop and switch to a discriminating experiment. Escalate if yaw differs from manifest by more than `25°`, reproduction fails, or the proposed result only removes the symptom. Return exactly: `result`, `changed paths`, `evidence`, `boundary impacts`, `blockers`, `integration order`.

## Coordinator next route

After Community reports, create one implementation handoff at a time. Any shared `src/multiview.cpp` integration has one integration owner and is serialized. Operator handles Git/release only after explicit publish authorization.
