# AniMocap_Fusion joint10 异常隔离

## Coordinator_to_Community

- **receiver**: `Community:multiview-joint10-isolation`
- **model**: `Fast / gpt-5.6-luna / medium`
- **base revision**: `f010b8af4cce8cea4f25f3c61d2eb4822c32eade` (`main`)
- **stage**: diagnosis and diagnostic tooling only; no product fix

### direction

专门隔离 reference frames `159-183` 中 joint `10` 的异常：确认它是单一视图输入异常、三视图共同异常、可见性/置信度权重误判、三角化残差选择，还是 reference-anchor/conflict 记录造成的表象。不得用全局指标掩盖该局部异常。

### focus nodes

- `triangulate_joint()` residuals, robust weights, and selected solution
- `joint_view_visibility_weight()` and temporal visibility state
- reference-anchor consensus and conflict recording
- per-view pose sequences and fused/comparison outputs

### read hints

- `src/multiview.cpp:588-1065`
- `src/multiview.cpp:1254-1437`
- `include/animocap/multiview.hpp:35-95`
- `outputs/alignment-common-qa-20260812-0240/multiview-diagnostics.json`
- `outputs/alignment-common-qa-20260812-0240/{fused_pose_sequence.json,comparison_pose_sequence.json}`
- `outputs/FrontLeft-1786531924229/poses/{front,front_left,front_right}/pose_sequence.json`
- `project-context/sources/04-decisions.md`
- `project-context/sources/05-risks-and-gotchas.md`

### write lease

Only add or modify `tests/diagnostics/joint10/`, `tools/diagnostics/joint10/`, and `outputs/handoff-multiview-joint10-*`. Do not modify `src/`, `include/`, product defaults, import files, `_mmengine_temp/`, other Community workspaces, or baseline outputs.

### boundary

Keep the same three views, 403 common frames, 23 joints, and existing inputs. Analyze joint10 and at least one nearby control joint. Report full and filtered metrics excluding joint10 and frames `159-183` inclusive. Do not add holds, smoothing, interpolation, independent solve+average, or visibility-bound changes. Jitter alone is not a fix.

### acceptance

1. Reproduce conflict concentration and exact per-view frames/joints contributing to joint10 conflicts.
2. Emit a local trace for frames `159-183`: raw observations, confidence/visibility factors, residuals, selected/fused position, and anchor status when available.
3. Run at least two discriminating diagnostics separating input disagreement from weighting/selection behavior without changing product source.
4. Compare joint10 with a nearby control joint and state whether the anomaly is isolated or systemic.
5. Produce reproducible JSON with producer, command, revision, status, paths/hashes, options, full/filtered metrics, and spikes; conclude confirmed, falsified, unresolved, or blocked.

### stop and report

Stop after two no-improvement attempts under one hypothesis. Escalate if reproduction fails or `src/`/`include/` changes are required. Return exactly: `result`, `changed paths`, `evidence`, `boundary impacts`, `blockers`, `integration order`.
