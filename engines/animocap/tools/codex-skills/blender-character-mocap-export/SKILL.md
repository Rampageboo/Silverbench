---
name: blender-character-mocap-export
description: Prepare a rigged Blender character for character-specific motion capture. Use when Codex must separate character geometry from VFX, weapons, wings, hair, skirts, capes, or other pose-confusing accessories; export independent GLB layers; create an anatomy-only mocap mask; map a Blender/MMD/VRM armature to AniMocap's canonical humanoid skeleton; or apply a character profile as a low-confidence bone-length prior.
---

# Blender Character Mocap Export

Create a v1.1 non-overwriting reference package from a saved rigged character:

- `character.glb`: visible character without VFX pieces.
- optional `effects.glb`: VFX, floating weapons, wings, and effect overlays.
- `mocap_mask.glb`: anatomy-focused white geometry that excludes pose-confusing accessories.

Also create `skeleton.json`, compatible with AniMocap's canonical skeleton loader, and `profile.json`, which records the source bone/material mapping and confidence policy.

## Workflow

1. Work on a saved `.blend`; never save exporter changes back into it.
2. Inspect the armature, every participating skinned mesh, material slots, and deform groups.
3. Create a JSON config with exact source object names in `meshes`, explicit canonical bone names when aliases are ambiguous, a `similar_reference` or `exact_reference` proportion policy, and material regexes.
4. Keep ordinary hair and clothing in `character.glb`, but add long hair, skirts, capes, tails, weapons, wings, and VFX to `mocap_exclude_material_patterns`.
5. Put only true VFX/floating pieces in `effect_material_patterns`; do not classify by bounding-box size alone.
6. Run the exporter in Blender background mode so the source scene remains unchanged:

```powershell
& "C:\Program Files\Blender Foundation\Blender\blender.exe" `
  --background "C:\path\character.blend" `
  --python "<skill>\scripts\export_character_layers.py" -- `
  --config "C:\path\profile-config.json" `
  --output-dir "C:\path\private\character_profiles\character"
```

7. Re-import the generated GLBs in a clean Blender process with
   `scripts/validate_glb_layers.py --input-dir <export-dir>`. Prefer the guided
   repository wrapper `tools/prepare_character_reference.ps1`, which also checks
   the source file hash and timestamp.
8. Check `profile.json` for non-empty character/effect/mask polygon counts and all 23 canonical bone mappings.
9. Load `skeleton.json` only as a low-confidence prior. Preserve high-confidence observations and manual corrections.

## Classification rules

- Treat the character layer and mocap mask as different products. The character layer preserves appearance; the mask preserves only geometry useful for locating joints.
- Prefer explicit material names over broad regexes for models with unclear naming.
- Exclude large rigid appendages even when parented to the torso. Their transforms are not evidence for shoulder, elbow, wrist, hip, knee, or ankle location.
- Keep small fitted garments, gloves, and boots in the mask when they follow the underlying limb closely.
- Fail when the character layer is empty. Omit the effects export only when the
  config explicitly allows an empty effect layer, and keep the profile and
  validator consistent about that omission.

## Character prior

- Map only the canonical 23 joints. Ignore physics, twist, helper, shadow, dummy, facial, cloth, hair, weapon, and wing bones.
- Convert Blender Z-up coordinates to AniMocap right-handed Y-up, +Z-forward coordinates.
- Preserve AniMocap's canonical T-pose directions and replace only bone lengths with measurements from the source rig.
- Under `similar_reference`, use video bone length when both endpoints meet the
  configured threshold in at least 10 frames and 5% of the sequence; otherwise
  apply bounded rig support only to low-confidence endpoints. `exact_reference`
  always uses the rig length. Never move a high-confidence endpoint.
- Recompute profile refinement from the immutable smoothed observations and
  reapply sparse manual corrections; never stack profile optimizations.
- Keep Qwen/VLM recovery sparse and downstream of deterministic pose inference; never use it as the per-frame bone constraint.

## Verification

- Run `python scripts/export_character_layers.py --self-test`.
- Run the skill validator after edits.
- Re-import every GLB and confirm it contains both a mesh and armature.
- For a real export, verify the source `.blend` timestamp and dirty state are unchanged.
- Keep proprietary models, textures, and generated GLBs under an ignored `private/` or `outputs/` path.

Read [references/profile-schema.md](references/profile-schema.md) when authoring or validating a config/profile.
