# M0 completion report

Date: 2026-08-06
Scope: AniMocap Fusion specification v0.2, M0 only

## Result

M0 is complete as a C++20 foundation. Python is intentionally limited to a
future adapter boundary for pose-estimation ecosystems such as MMPose/RTMPose.
No model, checkpoint, dataset, proprietary character asset, or production
exporter is included.

## Acceptance evidence

| Requirement | Implementation and evidence |
| --- | --- |
| Repository and build | CMake/Ninja project, MSVC wrapper, C++20 core library, CLI, and CTest target |
| Capture Manifest | Strict JSON loader/writer and fail-closed validator; single/multiview/repeat modes |
| Canonical Skeleton | Versioned 23-semantic skeleton, fixed topology, unique semantics/names, strict JSON |
| Canonical Motion | Versioned package with explicit coordinates, units, array dtype/shape, masks, contacts, and provenance |
| 2D keypoints | Typed C++ frame contract with shape, confidence, visibility, override, and identity validation |
| Coordinates | Canonical?Blender vector and quaternion roundtrip tests |
| Quaternion continuity | Hemisphere continuity implementation and sign-flip test |
| FK | Known T-pose head and hand ground-truth checks |
| Serialization | JSON plus NumPy v1 package roundtrip preserves arrays, masks, units, version, provenance, and cameras |
| Fixture | Seeded procedural stick figure, known weak-perspective front/held-out cameras, 3D FK and 2D projection ground truth |
| Determinism | Equal input/seed produces equal directory SHA-256; changed seed changes it |
| CLI | `validate-manifest`, `inspect-motion`, and `generate-fixture` execute successfully |
| Licensing/assets | Vendored JSON source hash and license checked; repository asset gate rejects media; weights and datasets remain unapproved |
| Failure gates | Tests reject unknown/missing/duplicate skeleton fields, invalid manifest shape, invalid quaternions, non-monotonic time, and inconsistent masks |

Validation command:

```powershell
.\tools\build_msvc.ps1
```

Observed result: clean build; `animocap_m0` passed, 100% tests passed.

CLI audit used seed 123 and 31 frames. It produced directory SHA-256
`efd03ce95aef942298389c4e6dc717ba1fe77108b208d2739f85bcfed2736cc8`;
manifest validation and motion inspection both returned `status: valid`.

## Decisions

- C++20 owns contracts, math, package I/O, deterministic fixtures, and CLI.
- Python may be introduced only behind `python/animocap_ml_adapters/` when an
  approved pose model makes that ecosystem the practical choice.
- The explicit 23 semantics in specification v0.2 are authoritative for M0.
  The prose also says 24; that contradiction remains an Owner review item.
- Canonical data is the source of truth. Blender, VRMA, BVH, glTF, FBX, and ML
  systems remain adapters.
- M0 stores only the raw motion variant and reports fields that a future
  exporter cannot preserve instead of silently dropping them.

## Files

- Core API and implementation: `include/animocap/`, `src/`
- Contracts/configuration: `configs/`, `docs/data-contracts.md`
- Tests and fixture input: `tests/`
- Build entrypoints: `CMakeLists.txt`, `CMakePresets.json`,
  `tools/build_msvc.ps1`
- Boundaries: `python/`, `blender_addon/`, `experiments/`
- Governance: `LICENSES.md`, `project-context/`

## Remaining risks and deferred work

- Resolve the specification's 23-versus-24 joint count before M1 changes the
  canonical skeleton.
- Only Windows MSVC/Ninja was verified in M0; other toolchains are unverified.
- Capture Manifest persistence is JSON. YAML support is deferred until a real
  ingest workflow needs it.
- Model selection, inference, temporal refinement, 3D lifting, retargeting,
  Blender UX, exporters, and visual regression are M1 or later.
- The copied collaboration protocol has no `.protocol-lock.json`; its
  distributor version is unknown, so protocol updates must remain blocked until
  a lock is established.

## Git and next action

This report belongs to the initial independent project repository commit; the
delivery message records its immutable Git hash. No remote is configured, so no
push is possible.

Recommended next action: hold the M0 architecture review, decide the canonical
joint-count discrepancy, then authorize M1 model and license evaluation.
