# Dependency and Asset License Register

Reviewed: 2026-08-06. This register is an engineering gate, not legal advice.
Code, weights, human-body models, datasets, and generated assets are reviewed
separately; permission for one category never implies permission for another.

| Component | Version / source | Purpose | Code license | Weights / data terms | Commercial use | Redistribution | Runtime required | Notes |
|---|---|---|---|---|---|---|---|---|
| MSVC / C++ standard library | Visual Studio Build Tools 18 | Build and runtime support | Microsoft terms | N/A | Per installation terms | No bundled toolchain | Build only | C++20 core. |
| nlohmann/json | v3.12.0, `55f9368` | JSON contracts | MIT | N/A | Allowed | MIT notice required | Yes, vendored header | Header SHA-256 must equal `aaf127c04cb31c406e5b04a63f1ae89369fccde6d8fa7cdda1ed4f32dfc5de63`. |
| MMPose | 1.3.2 | Pose inference adapter | Apache-2.0 | HRNet COCO and MotionBERT/Human3.6M checkpoints are downloaded to the user cache; upstream dataset terms apply | Code allowed; checkpoint use requires upstream review | Code per Apache-2.0; weights are not redistributed | Optional Python process | Removable adapter; no Python/PyTorch linkage in the C++ core. |
| HRNet-W32 COCO checkpoint | MMPose model alias td-hm_hrnet-w32_8xb64-210e_coco-256x192 | 2D keypoints | MMPose repository terms | COCO-trained checkpoint; review COCO terms for distribution use | Research/local evaluation approved | Not bundled | Optional download | Used because the whole-image path avoids MMDetection custom ops. |
| MotionBERT Human3D checkpoint | MMPose model alias human3d | Monocular depth proposal | MMPose repository terms | Human3.6M-trained checkpoint; upstream dataset terms apply | Research/local evaluation approved | Not bundled | Optional download | Output is quality-gated and falls back to bounded 2.5D when implausible. |
| PyTorch / torchvision | 2.6.0+cu124 / 0.21.0+cu124 | CUDA inference runtime | BSD-style licenses | N/A | Allowed | Not bundled | Optional Python process | Verified with an NVIDIA RTX 2060. |
| VRM 1.0 specification | official VRM Consortium specification | Humanoid semantics | Specification reference | N/A | Reference use | N/A | No | Confirms right-handed Y-up, meters, T-pose, +Z facing. |
| VRMC_vrm_animation 1.0 | official VRM Consortium specification | Future VRMA adapter | Specification reference | N/A | Reference use | N/A | No | glTF extension; `.vrma` recommended. |
| Proprietary character/game assets | none | Out of scope | N/A | Unapproved | No | No | No | Must stay outside the repository or under ignored `private/`. |

## Approval rule

Adding a runtime dependency, model checkpoint, dataset, body model, or media
asset requires a stable source/version, separate license terms, commercial-use
status, redistribution status, review date, and an explicit decision before it
enters a product path.
