# AniMocap Fusion

AniMocap Fusion is a local-first motion reconstruction project for anime and
game humanoids. Its source of truth is a versioned Canonical Humanoid Motion
package; Blender rigs, VRMA, BVH, glTF, FBX, and ML models are adapters around
that representation.

The core is C++20. Python is reserved for future ML adapters such as
MMPose/RTMPose when their ecosystem makes Python the pragmatic boundary.

This repository currently implements **M0 only**: contracts, coordinate
conventions, deterministic synthetic fixtures, validation, and license gates.
It intentionally contains no model inference, downloaded weights, proprietary
assets, production retargeting, or full Blender UI.

## Build and test

Requires Visual Studio C++ Build Tools on Windows. The wrapper initializes the
MSVC environment, configures CMake/Ninja, builds, and runs CTest.

```powershell
.\tools\build_msvc.ps1
.\build\windows-ninja\animocap.exe generate-fixture --output reports\fixture
.\build\windows-ninja\animocap.exe validate-manifest tests\fixtures\capture.single.json
.\build\windows-ninja\animocap.exe inspect-motion reports\fixture\motion.amotion
```

## M0 contracts

- Canonical coordinates: right-handed, Y-up, +Z forward, meters.
- Reference pose: T-pose facing +Z.
- Rotations: parent-local quaternions in `[w, x, y, z]` order.
- Translation: `sceneRoot` world motion plus local `hips` motion.
- Canonical skeleton: the 23 semantics explicitly enumerated by specification
  v0.2. The prose says 24, but lists only 23; the enumerated contract is used
  until the M0 architecture review resolves the discrepancy.
- Validation is fail-closed: unknown fields and semantics, malformed arrays,
  duplicate bones, invalid quaternions, and non-monotonic time are rejected.
- Fixture generation is deterministic and contains no proprietary assets.

## Repository map

```text
configs/                    Versioned skeleton and solver configuration
include/animocap/            Public C++ contracts and math API
src/                         C++ implementation and CLI
tests/                       Contract, math, package, determinism, and asset gates
blender_addon/               Deferred Blender adapter boundary (M3+)
python/                      Deferred ML adapter boundary (M1+)
tools/synthetic_dataset/     M0 procedural fixture entrypoint
experiments/                 Research-only work; never a runtime dependency
reports/                     Generated reports and M0 completion evidence
project-context/             Durable product decisions and boundaries
third_party/                 Audited vendored source dependencies
```

See `PROJECTCONTEXT.md` for the durable-context compatibility entrypoint and
`reports/m0-completion.md` for M0 evidence.
