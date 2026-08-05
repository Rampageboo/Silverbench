# Dependency and Asset License Register

Reviewed: 2026-08-06. This register is an engineering gate, not legal advice.
Code, weights, human-body models, datasets, and generated assets are reviewed
separately; permission for one category never implies permission for another.

| Component | Version / source | Purpose | Code license | Weights / data terms | Commercial use | Redistribution | Runtime required | Notes |
|---|---|---|---|---|---|---|---|---|
| MSVC / C++ standard library | Visual Studio Build Tools 18 | Build and runtime support | Microsoft terms | N/A | Per installation terms | No bundled toolchain | Build only | C++20 core. |
| nlohmann/json | v3.12.0, `55f9368` | JSON contracts | MIT | N/A | Allowed | MIT notice required | Yes, vendored header | Header SHA-256 must equal `aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63`. |
| MMPose | official repository; version not selected | Future Python 2D pose adapter | Apache-2.0 | **Not selected; review each checkpoint and training dataset separately** | Code allowed; weights unapproved | Code per Apache-2.0; weights unapproved | No (M0) | Disabled, removable adapter boundary. |
| RTMPose / RTMW weights | not selected | Future 2D pose baseline | Depends on implementation | Unapproved until exact artifact and dataset provenance are recorded | Unknown | Unknown | No (M0) | No weights downloaded or stored in M0. |
| VRM 1.0 specification | official VRM Consortium specification | Humanoid semantics | Specification reference | N/A | Reference use | N/A | No | Confirms right-handed Y-up, meters, T-pose, +Z facing. |
| VRMC_vrm_animation 1.0 | official VRM Consortium specification | Future VRMA adapter | Specification reference | N/A | Reference use | N/A | No | glTF extension; `.vrma` recommended. |
| Proprietary character/game assets | none | Out of scope | N/A | Unapproved | No | No | No | Must stay outside the repository or under ignored `private/`. |

## Approval rule

Adding a runtime dependency, model checkpoint, dataset, body model, or media
asset requires a stable source/version, separate license terms, commercial-use
status, redistribution status, review date, and an explicit decision before it
enters a product path.
