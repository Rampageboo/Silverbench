# AniMocap_Fusion 多视角输入与帧语义审计

## Coordinator_to_Community

- **receiver**: `Community:multiview-input-audit`
- **model**: `Fast / gpt-5.6-luna / medium`
- **base revision**: `f010b8af4cce8cea4f25f3c61d2eb4822c32eade` (`main`)
- **stage**: diagnosis and diagnostic tooling only; no product fix

### direction

判定关节错误是否由输入检测、source-frame 映射、共同时间窗、相机/坐标约定或 manifest 语义造成。必须把“输入本身错”与“融合器解释输入错”分开，并给出可证伪的结果。

### focus nodes

- `align_view()` and common-interval trimming
- source-frame mapping consumed by aligned samples and reference comparison
- `triangulate_joint()` observation ordering and view identity
- `estimate_pixels_per_meter()` scale estimation
- `outputs/alignment-common-qa-20260812-0240/motion.amotion/manifest.json`

### read hints

- `src/multiview.cpp:1203-1281`
- `src/multiview.cpp:702-728`
- `src/multiview.cpp:730-1065`
- `outputs/alignment-common-qa-20260812-0240/multiview-diagnostics.json`
- `outputs/alignment-common-qa-20260812-0240/motion.amotion/{manifest.json,provenance.json}`
- `outputs/FrontLeft-1786531924229/poses/{front,front_left,front_right}/pose_sequence.json`
- `project-context/sources/04-decisions.md`
- `project-context/sources/05-risks-and-gotchas.md`

### write lease

Only add or modify `tests/diagnostics/input_audit/`, `tools/diagnostics/input_audit/`, and `outputs/handoff-multiview-input-*`. Do not modify `src/`, `include/`, product defaults, import files, `_mmengine_temp/`, other Community workspaces, or baseline outputs.

### boundary

Keep the same three views, 403 common frames, 23 joints, and existing pose inputs. Do not add holds, smoothing, interpolation, independent solve+average, or visibility-bound changes. Do not infer accuracy from jitter alone.

### acceptance

1. Reproduce or falsify view order, yaw, frame count, joint count, FPS, coordinate system, and source paths.
2. Emit a frame-map audit covering common frame, source frame, timestamp, and view identity for all 403 frames.
3. Compare raw versus mapped joint10 values around frames `159-183` and identify whether the reference-comparison lookup changes.
4. Check scale units and per-frame pixels-per-meter inputs for finite values and view-consistent units.
5. Produce reproducible JSON with producer, command, revision, status, paths/hashes, checks, and falsifiers; conclude confirmed, falsified, unresolved, or blocked.

### stop and report

Stop after two no-improvement attempts under one hypothesis. Escalate if reproduction fails or `src/`/`include/` changes are required. Return exactly: `result`, `changed paths`, `evidence`, `boundary impacts`, `blockers`, `integration order`.
