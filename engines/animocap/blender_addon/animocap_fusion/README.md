# Blender adapter boundary

The headless source-character preparation and synthetic-render adapters are
implemented under `tools/` and `python/animocap_ml_adapters/`. They inspect a
saved Blender/MMD rig, export private GLB analysis layers, and render local
training pairs without saving the source `.blend`.

A native interactive Blender add-on, target-rig playback, arbitrary retargeting,
and baking remain deferred. Blender does not own Canonical Motion and does not
run the capture optimizer.
