#!/usr/bin/env python3
"""Re-import exported GLB layers in a clean Blender process and summarize them."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REQUIRED_LAYERS = ("character", "mocap_mask")


def _blender_args() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else sys.argv[1:]


def _clear_scene(bpy: Any) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for datablock in list(collection):
            if datablock.users == 0:
                collection.remove(datablock)


def validate_layers(input_dir: Path) -> dict[str, Any]:
    import bpy  # type: ignore

    profile_path = input_dir / "profile.json"
    if not profile_path.is_file():
        raise RuntimeError(f"missing profile: {profile_path}")
    profile = json.loads(profile_path.read_text(encoding="utf-8"))
    bone_map = profile.get("bone_map", {})
    if len(bone_map) != 23:
        raise RuntimeError("profile must map exactly 23 canonical bones")
    exports = profile.get("exports", {})
    for layer in REQUIRED_LAYERS:
        if not exports.get(layer):
            raise RuntimeError(f"profile is missing required {layer} export")
    layer_files = [exports[layer] for layer in REQUIRED_LAYERS]
    if exports.get("effects"):
        layer_files.insert(1, exports["effects"])
    result: dict[str, Any] = {"status": "ok", "layers": {}}
    for filename in layer_files:
        path = input_dir / filename
        if not path.is_file() or path.stat().st_size == 0:
            raise RuntimeError(f"missing or empty GLB: {path}")
        _clear_scene(bpy)
        bpy.ops.import_scene.gltf(filepath=str(path))
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
        armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
        if not meshes:
            raise RuntimeError(f"GLB contains no mesh: {path}")
        if not armatures:
            raise RuntimeError(f"GLB contains no armature: {path}")
        result["layers"][path.stem] = {
            "bytes": path.stat().st_size,
            "mesh_objects": len(meshes),
            "armatures": len(armatures),
            "polygons": sum(len(obj.data.polygons) for obj in meshes),
            "bones": sum(len(obj.data.bones) for obj in armatures),
        }
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args(_blender_args())
    result = validate_layers(args.input_dir.resolve())
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps({
                "schema_version": "1.0.0",
                "kind": "animocap.character_glb_validation",
                **result,
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
