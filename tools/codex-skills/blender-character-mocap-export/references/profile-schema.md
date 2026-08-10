# Profile schema

## Export config

```json
{
  "profile_id": "character_v1",
  "armature": "Armature",
  "meshes": ["BodyMesh", "FaceMesh"],
  "proportion_policy": "similar_reference",
  "bone_map": {
    "hips": "hips",
    "head": "head"
  },
  "effect_material_patterns": ["(^|_)vfx($|_)", "wing", "weapon"],
  "mocap_exclude_material_patterns": ["hair", "skirt", "cape", "tail"],
  "allow_empty_effects": false,
  "low_confidence_threshold": 0.55
}
```

The legacy singular `mesh` remains accepted. `bone_map` may be partial when
standard MMD/VRM aliases resolve the remaining semantics; explicit entries
always win. `low_confidence_threshold` must be greater than zero and no greater
than one. Set `allow_empty_effects` only for a genuinely effect-free model.

Regex matching is Unicode-aware and case-insensitive. Effect materials are automatically excluded from the mocap mask, so they need not be repeated under `mocap_exclude_material_patterns`.

## Generated profile

The generated backward-compatible v1.1 `profile.json` records:

- `role: source_character_reference` and `proportion_policy` (default
  `similar_reference`);
- source Blender file, mesh list, unit scale, exporter version, and source/config
  SHA-256 hashes;
- the exact 23-entry canonical-to-source bone map plus explicit/alias resolution
  method and confidence;
- character, effect, and mocap-mask material slots with polygon counts;
- generated GLB and canonical skeleton filenames;
- low-confidence threshold and validated deterministic constraint policy.

Existing v1.0 profiles remain loadable and retain exact-reference behavior.

`skeleton.json` uses AniMocap's strict 23-bone canonical schema. It retains canonical T-pose directions while replacing each non-root vector length with the measured source-rig distance between mapped joints.

## Layer meaning

| Layer | Includes | Excludes |
|---|---|---|
| character | Body, fitted clothing, hair, ordinary accessories | VFX and independently floating pieces |
| effects | VFX, floating weapons, wings, effect overlays | Body geometry |
| mocap mask | Anatomy-following body/clothes/boots/gloves | Effects plus long hair, skirts, capes, tails, weapons, wings |

The mask is exported with one flat white material and without morph targets. Character/effect exports are analysis assets, not guaranteed production-ready interchange files.
