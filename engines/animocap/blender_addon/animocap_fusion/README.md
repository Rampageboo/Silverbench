# AniMocap Fusion selected-frame importer

This Blender add-on imports `*.animocap-blender.json` as a new editable Action.
AniMocap owns capture, correction, and source-frame selection. Blender owns
F-Curves, interpolation, handles, smoothing, easing, and the character's mesh,
materials, modifiers, and appearance.

## Install and use

1. Install or add `blender_addon/animocap_fusion` as a Blender add-on.
2. Open `View3D > Sidebar > AniMocap`.
3. Choose the selected-frame JSON and click **Load and validate**.
4. Choose the target Armature and click **Auto-map 23 bones**.
5. Resolve every missing or duplicate mapping. Helper, twist, facial, cloth,
   hair, weapon, and wing bones are intentionally not mapped.
6. Choose **Preserve** or **In place** Root Motion and click **Create new
   Action**.

The importer validates the complete file and all 23 unique mappings before it
creates an Action. Any later import error restores the previously active Action
and removes the incomplete new Action. A blank Action name produces
`AniMocap_Selected_YYYYMMDD`; Blender adds its normal numeric suffix if needed.

Only `source_frame` values in the JSON receive keys. Root and Hips translation
are imported in scene units; canonical right-handed Y-up/+Z-forward values are
converted to Blender right-handed Z-up/-Y-forward. Local rotations are
converted through each target bone's rest-local basis. **In place** removes
horizontal scene-root travel but preserves vertical motion.

The mapping/import does not modify meshes, materials, vertex groups, modifiers,
constraints, or the source `.blend`. It does not bake IK or constraint rigs;
map the canonical semantics to the deform/playback bones that should own the
Action.

## Modules

- `schema.py`: strict schema 1 validation; no Blender dependency.
- `mapping.py`: Canonical 23 auto-mapping and fail-closed diagnostics.
- `action_import.py`: coordinate conversion and transactional Action creation.
- `ui.py`: Blender properties, operators, and sidebar panel only.

## Headless verification

```powershell
& "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe" `
  --background --factory-startup --python-exit-code 1 `
  --python blender_addon\animocap_fusion\tests\headless_import_test.py
```

The test proves exact frames 12/24/48, editable F-Curves, preservation of the
old Action and character appearance data, numeric coordinate conversion, Root
Motion behavior, and fail-closed missing mapping.

The separate source-character preparation and synthetic-render adapters remain
under `tools/` and `python/animocap_ml_adapters/`; those workflows inspect a
saved Blender/MMD rig without saving exporter changes back into the `.blend`.
