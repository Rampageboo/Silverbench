# Profile schema

## Export config

```json
{
  "profile_id": "character_v1",
  "armature": "Armature",
  "mesh": "CharacterMesh",
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

`bone_map` may be partial when standard MMD/VRM aliases resolve the remaining semantics. Explicit entries always win.

Regex matching is Unicode-aware and case-insensitive. Effect materials are automatically excluded from the mocap mask, so they need not be repeated under `mocap_exclude_material_patterns`.

## Generated profile

`profile.json` records:

- source Blender file, object names, unit scale, and exporter version;
- canonical-to-source bone map;
- character, effect, and mocap-mask material slots with polygon counts;
- generated GLB and canonical skeleton filenames;
- low-confidence threshold and deterministic constraint policy.

`skeleton.json` uses AniMocap's strict 23-bone canonical schema. It retains canonical T-pose directions while replacing each non-root vector length with the measured source-rig distance between mapped joints.

## Layer meaning

| Layer | Includes | Excludes |
|---|---|---|
| character | Body, fitted clothing, hair, ordinary accessories | VFX and independently floating pieces |
| effects | VFX, floating weapons, wings, effect overlays | Body geometry |
| mocap mask | Anatomy-following body/clothes/boots/gloves | Effects plus long hair, skirts, capes, tails, weapons, wings |

The mask is exported with one flat white material and without morph targets. Character/effect exports are analysis assets, not guaranteed production-ready interchange files.
