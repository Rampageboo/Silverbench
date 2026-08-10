#!/usr/bin/env python3
"""Export character, effect, and anatomy-mask GLBs plus an AniMocap profile.

Run inside Blender with ``--python ... -- --config ... --output-dir ...``.
``--self-test`` runs without Blender and validates the deterministic classifiers.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import sys
from typing import Any, Iterable


EXPORTER_VERSION = "1.1.0"

CANONICAL_BONES: tuple[tuple[str, str | None, tuple[float, float, float]], ...] = (
    ("sceneRoot", None, (0.0, 0.0, 0.0)),
    ("hips", "sceneRoot", (0.0, 0.90, 0.0)),
    ("spine", "hips", (0.0, 0.12, 0.0)),
    ("chest", "spine", (0.0, 0.15, 0.0)),
    ("upperChest", "chest", (0.0, 0.12, 0.0)),
    ("neck", "upperChest", (0.0, 0.12, 0.0)),
    ("head", "neck", (0.0, 0.16, 0.0)),
    ("leftShoulder", "upperChest", (0.12, 0.08, 0.0)),
    ("leftUpperArm", "leftShoulder", (0.20, 0.0, 0.0)),
    ("leftLowerArm", "leftUpperArm", (0.24, 0.0, 0.0)),
    ("leftHand", "leftLowerArm", (0.18, 0.0, 0.0)),
    ("rightShoulder", "upperChest", (-0.12, 0.08, 0.0)),
    ("rightUpperArm", "rightShoulder", (-0.20, 0.0, 0.0)),
    ("rightLowerArm", "rightUpperArm", (-0.24, 0.0, 0.0)),
    ("rightHand", "rightLowerArm", (-0.18, 0.0, 0.0)),
    ("leftUpperLeg", "hips", (0.09, -0.10, 0.0)),
    ("leftLowerLeg", "leftUpperLeg", (0.0, -0.40, 0.0)),
    ("leftFoot", "leftLowerLeg", (0.0, -0.40, 0.04)),
    ("leftToes", "leftFoot", (0.0, 0.0, 0.16)),
    ("rightUpperLeg", "hips", (-0.09, -0.10, 0.0)),
    ("rightLowerLeg", "rightUpperLeg", (0.0, -0.40, 0.0)),
    ("rightFoot", "rightLowerLeg", (0.0, -0.40, 0.04)),
    ("rightToes", "rightFoot", (0.0, 0.0, 0.16)),
)

MMD_ALIASES: dict[str, tuple[str, ...]] = {
    "sceneRoot": ("全ての親", "操作中心", "root", "Root"),
    "hips": ("腰", "下半身", "センター", "hips", "Hips"),
    "spine": ("上半身", "spine", "Spine"),
    "chest": ("上半身1", "chest", "Chest"),
    "upperChest": ("上半身2", "upper_chest", "UpperChest"),
    "neck": ("首", "neck", "Neck"),
    "head": ("頭", "head", "Head"),
    "leftShoulder": ("肩.L", "左肩", "shoulder.L", "LeftShoulder"),
    "leftUpperArm": ("腕.L", "左腕", "upper_arm.L", "LeftUpperArm"),
    "leftLowerArm": ("ひじ.L", "左ひじ", "forearm.L", "LeftLowerArm"),
    "leftHand": ("手首.L", "左手首", "hand.L", "LeftHand"),
    "rightShoulder": ("肩.R", "右肩", "shoulder.R", "RightShoulder"),
    "rightUpperArm": ("腕.R", "右腕", "upper_arm.R", "RightUpperArm"),
    "rightLowerArm": ("ひじ.R", "右ひじ", "forearm.R", "RightLowerArm"),
    "rightHand": ("手首.R", "右手首", "hand.R", "RightHand"),
    "leftUpperLeg": ("足.L", "左足", "thigh.L", "LeftUpperLeg"),
    "leftLowerLeg": ("ひざ.L", "左ひざ", "shin.L", "LeftLowerLeg"),
    "leftFoot": ("足首.L", "左足首", "foot.L", "LeftFoot"),
    "leftToes": ("つま先.L", "左つま先", "toe.L", "LeftToes"),
    "rightUpperLeg": ("足.R", "右足", "thigh.R", "RightUpperLeg"),
    "rightLowerLeg": ("ひざ.R", "右ひざ", "shin.R", "RightLowerLeg"),
    "rightFoot": ("足首.R", "右足首", "foot.R", "RightFoot"),
    "rightToes": ("つま先.R", "右つま先", "toe.R", "RightToes"),
}

DEFAULT_EFFECT_PATTERNS = (
    r"(^|[_ .-])(vfx|fx|effect)([_ .-]|$)",
    r"特效",
    r"光翼",
    r"翼骨",
    r"floating[_ .-]?(weapon|blade)",
)

DEFAULT_EXCLUDE_PATTERNS = (
    r"hair|髪|头发|頭髮",
    r"skirt|下擺|下摆|裙",
    r"cape|cloak|披风|披風",
    r"tail|尾",
    r"weapon|武器|刀|剑|劍|枪|槍",
    r"wing|翼",
)


def _arguments(argv: list[str]) -> list[str]:
    if "--" in argv:
        return argv[argv.index("--") + 1 :]
    return argv[1:]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    result = parser.parse_args(_arguments(argv))
    if not result.self_test and (result.config is None or result.output_dir is None):
        parser.error("--config and --output-dir are required inside Blender")
    return result


def _matches(name: str, patterns: Iterable[str]) -> bool:
    return any(re.search(pattern, name, flags=re.IGNORECASE) for pattern in patterns)


def classify_slots(
    slots: list[dict[str, Any]],
    effect_patterns: Iterable[str],
    exclude_patterns: Iterable[str],
) -> dict[str, list[dict[str, Any]]]:
    effects = [slot for slot in slots if _matches(slot["name"], effect_patterns)]
    effect_indices = {(slot.get("mesh", ""), slot["index"]) for slot in effects}
    character = [
        slot for slot in slots
        if (slot.get("mesh", ""), slot["index"]) not in effect_indices
    ]
    mask = [
        slot
        for slot in character
        if not _matches(slot["name"], exclude_patterns)
    ]
    return {"character": character, "effects": effects, "mocap_mask": mask}


def _length(vector: Iterable[float]) -> float:
    values = list(vector)
    return math.sqrt(sum(value * value for value in values))


def _scaled_direction(
    template: tuple[float, float, float], target_length: float
) -> list[float]:
    template_length = _length(template)
    if template_length <= 1e-12 or target_length <= 1e-12:
        return [0.0, 0.0, 0.0]
    return [component * target_length / template_length for component in template]


def self_test() -> None:
    slots = [
        {"mesh": "Body", "index": 0, "name": "Skin", "polygon_count": 100},
        {"mesh": "Body", "index": 1, "name": "Long_Hair", "polygon_count": 30},
        {"mesh": "Body", "index": 2, "name": "VFX_Wing", "polygon_count": 20},
        {"mesh": "Face", "index": 2, "name": "Face", "polygon_count": 40},
    ]
    layers = classify_slots(slots, DEFAULT_EFFECT_PATTERNS, DEFAULT_EXCLUDE_PATTERNS)
    assert [(item["mesh"], item["index"]) for item in layers["character"]] == [
        ("Body", 0), ("Body", 1), ("Face", 2)
    ]
    assert [item["index"] for item in layers["effects"]] == [2]
    assert [(item["mesh"], item["index"]) for item in layers["mocap_mask"]] == [
        ("Body", 0), ("Face", 2)
    ]
    assert abs(_length(_scaled_direction((1.0, 0.0, 0.0), 0.25)) - 0.25) < 1e-12
    print(json.dumps({"status": "ok", "exporter_version": EXPORTER_VERSION}))


def _load_config(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    required = ("profile_id", "armature")
    missing = [key for key in required if not isinstance(value.get(key), str) or not value[key]]
    if missing:
        raise RuntimeError(f"missing non-empty config fields: {', '.join(missing)}")
    mesh_value = value.get("meshes", value.get("mesh"))
    if isinstance(mesh_value, str):
        meshes = [mesh_value]
    elif isinstance(mesh_value, list) and all(
        isinstance(item, str) and item for item in mesh_value
    ):
        meshes = list(dict.fromkeys(mesh_value))
    else:
        raise RuntimeError("config requires a non-empty mesh or meshes list")
    if not meshes:
        raise RuntimeError("config requires at least one mesh")
    value["meshes"] = meshes
    threshold = float(value.get("low_confidence_threshold", 0.55))
    if not 0.0 < threshold <= 1.0:
        raise RuntimeError("low_confidence_threshold must be in (0, 1]")
    policy = value.get("proportion_policy", "similar_reference")
    if policy not in ("similar_reference", "exact_reference"):
        raise RuntimeError("proportion_policy must be similar_reference or exact_reference")
    value["low_confidence_threshold"] = threshold
    value["proportion_policy"] = policy
    return value


def _slot_records(mesh: Any, mesh_name: str) -> list[dict[str, Any]]:
    counts = [0] * len(mesh.materials)
    for polygon in mesh.polygons:
        if 0 <= polygon.material_index < len(counts):
            counts[polygon.material_index] += 1
    return [
        {
            "mesh": mesh_name,
            "index": index,
            "name": material.name if material is not None else f"slot_{index}",
            "polygon_count": counts[index],
        }
        for index, material in enumerate(mesh.materials)
    ]


def _resolve_bones(
    armature: Any, explicit: dict[str, str]
) -> tuple[dict[str, str], dict[str, dict[str, Any]]]:
    available = set(armature.data.bones.keys())
    result: dict[str, str] = {}
    resolution: dict[str, dict[str, Any]] = {}
    for semantic, _parent, _template in CANONICAL_BONES:
        candidates = (explicit[semantic],) if semantic in explicit else MMD_ALIASES[semantic]
        match = next((name for name in candidates if name in available), None)
        if match is None:
            raise RuntimeError(
                f"could not map canonical bone {semantic}; tried {', '.join(candidates)}"
            )
        result[semantic] = match
        explicit_match = semantic in explicit
        resolution[semantic] = {
            "source_bone": match,
            "resolution": "explicit" if explicit_match else "alias",
            "confidence": 1.0 if explicit_match else 0.8,
        }
    return result, resolution


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _animocap_position(blender_vector: Any, unit_scale: float) -> tuple[float, float, float]:
    return (
        float(blender_vector.x) * unit_scale,
        float(blender_vector.z) * unit_scale,
        -float(blender_vector.y) * unit_scale,
    )


def _profile_skeleton(armature: Any, bone_map: dict[str, str], profile_id: str) -> dict[str, Any]:
    unit_scale = float(armature.users_scene[0].unit_settings.scale_length) if armature.users_scene else 1.0
    if not math.isfinite(unit_scale) or unit_scale <= 0.0:
        unit_scale = 1.0
    positions: dict[str, tuple[float, float, float]] = {}
    for semantic, source_name in bone_map.items():
        source_bone = armature.data.bones[source_name]
        positions[semantic] = _animocap_position(
            armature.matrix_world @ source_bone.head_local, unit_scale
        )

    bones: list[dict[str, Any]] = []
    for semantic, parent, template in CANONICAL_BONES:
        if parent is None:
            offset = [0.0, 0.0, 0.0]
        else:
            measured = [
                positions[semantic][axis] - positions[parent][axis]
                for axis in range(3)
            ]
            measured_length = _length(measured)
            if measured_length <= 1e-6:
                raise RuntimeError(f"mapped bone {semantic} has zero measured length")
            offset = _scaled_direction(template, measured_length)
        bones.append({"semantic": semantic, "parent": parent, "rest_offset_m": offset})
    return {
        "schema_version": "1.0.0",
        "skeleton_id": profile_id,
        "coordinate_system": {
            "handedness": "right",
            "up_axis": "Y",
            "forward_axis": "Z",
            "unit": "meter",
        },
        "reference_pose": {"type": "T_POSE", "facing": "+Z"},
        "bones": bones,
    }


def _remove_shape_keys(mesh_object: Any) -> None:
    """Remove copied shape keys through the object API (Blender 4.x/5.x)."""
    if mesh_object.data.shape_keys is not None:
        mesh_object.shape_key_clear()


def _filter_mesh(bmesh: Any, mesh: Any, keep_indices: set[int]) -> int:
    working = bmesh.new()
    try:
        working.from_mesh(mesh)
        unwanted = [face for face in working.faces if face.material_index not in keep_indices]
        if unwanted:
            bmesh.ops.delete(working, geom=unwanted, context="FACES")
        loose = [vertex for vertex in working.verts if not vertex.link_faces]
        if loose:
            bmesh.ops.delete(working, geom=loose, context="VERTS")
        working.to_mesh(mesh)
        mesh.update()
        return len(mesh.polygons)
    finally:
        working.free()


def _flat_mask_material(bpy: Any) -> Any:
    material = bpy.data.materials.new("AniMocap_MocapMask")
    material.use_nodes = True
    principled = material.node_tree.nodes.get("Principled BSDF")
    if principled is not None:
        principled.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        principled.inputs["Roughness"].default_value = 1.0
    return material


def _gltf_material_copy(bpy: Any, source: Any) -> Any:
    """Build a portable PBR view of an MMD/custom-node material."""
    material = bpy.data.materials.new(f"AniMocap_{source.name}")
    material.use_nodes = True
    material.diffuse_color = source.diffuse_color
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    principled.inputs["Base Color"].default_value = source.diffuse_color
    principled.inputs["Roughness"].default_value = 0.8
    principled.inputs["Metallic"].default_value = 0.0
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    image_nodes = [
        node for node in (source.node_tree.nodes if source.node_tree else [])
        if node.type == "TEX_IMAGE" and node.image is not None
    ]
    base_node = next(
        (node for node in image_nodes if "base" in node.name.casefold()),
        next((node for node in image_nodes if "toon" not in node.name.casefold()), None),
    )
    if base_node is not None:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = base_node.image
        texture.interpolation = base_node.interpolation
        links.new(texture.outputs["Color"], principled.inputs["Base Color"])
        if "Alpha" in texture.outputs and "Alpha" in principled.inputs:
            links.new(texture.outputs["Alpha"], principled.inputs["Alpha"])
    return material


def _gltf_kwargs(bpy: Any, output_path: Path) -> dict[str, Any]:
    requested = {
        "filepath": str(output_path),
        "export_format": "GLB",
        "use_selection": True,
        "export_animations": False,
        "export_skins": True,
        "export_morph": False,
        "export_apply": False,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
    }
    supported = {
        prop.identifier for prop in bpy.ops.export_scene.gltf.get_rna_type().properties
    }
    return {key: value for key, value in requested.items() if key in supported}


def _export_layer(
    bpy: Any,
    bmesh: Any,
    source_meshes: list[Any],
    source_armature: Any,
    keep_indices: dict[str, set[int]],
    output_path: Path,
    layer_name: str,
    flat_mask: bool,
) -> int:
    armature_data = source_armature.data.copy()
    armature_copy = source_armature.copy()
    armature_copy.data = armature_data
    armature_copy.name = f"AniMocap_{layer_name}_armature"
    armature_copy.hide_viewport = False
    armature_copy.hide_render = False
    bpy.context.scene.collection.objects.link(armature_copy)
    mesh_copies: list[Any] = []
    mesh_data_blocks: list[Any] = []
    mask_material = _flat_mask_material(bpy) if flat_mask else None
    portable_materials: dict[Any, Any] = {}
    polygon_count = 0
    for source_mesh in source_meshes:
        selected_indices = keep_indices.get(source_mesh.name, set())
        if not selected_indices:
            continue
        mesh_copy = source_mesh.copy()
        mesh_data = source_mesh.data.copy()
        mesh_copy.data = mesh_data
        _remove_shape_keys(mesh_copy)
        mesh_copy.name = f"AniMocap_{layer_name}_{source_mesh.name}"
        mesh_copy.parent = armature_copy
        mesh_copy.matrix_parent_inverse = source_mesh.matrix_parent_inverse.copy()
        mesh_copy.hide_viewport = False
        mesh_copy.hide_render = False
        bpy.context.scene.collection.objects.link(mesh_copy)
        for modifier in mesh_copy.modifiers:
            if modifier.type == "ARMATURE":
                modifier.object = armature_copy
        mesh_polygons = _filter_mesh(bmesh, mesh_data, selected_indices)
        if mesh_polygons == 0:
            bpy.data.objects.remove(mesh_copy, do_unlink=True)
            if mesh_data.users == 0:
                bpy.data.meshes.remove(mesh_data)
            continue
        polygon_count += mesh_polygons
        mesh_copies.append(mesh_copy)
        mesh_data_blocks.append(mesh_data)
        if mask_material is not None:
            mesh_data.materials.clear()
            mesh_data.materials.append(mask_material)
            for polygon in mesh_data.polygons:
                polygon.material_index = 0
        else:
            for index, source_material in enumerate(list(mesh_data.materials)):
                if source_material is None:
                    continue
                material_key = source_material.as_pointer()
                portable = portable_materials.get(material_key)
                if portable is None:
                    portable = _gltf_material_copy(bpy, source_material)
                    portable_materials[material_key] = portable
                mesh_data.materials[index] = portable

    if polygon_count == 0:
        bpy.data.objects.remove(armature_copy, do_unlink=True)
        if armature_data.users == 0:
            bpy.data.armatures.remove(armature_data)
        if mask_material is not None and mask_material.users == 0:
            bpy.data.materials.remove(mask_material)
        raise RuntimeError(f"{layer_name} export contains no polygons")

    bpy.ops.object.select_all(action="DESELECT")
    armature_copy.select_set(True)
    for mesh_copy in mesh_copies:
        mesh_copy.select_set(True)
    bpy.context.view_layer.objects.active = mesh_copies[0]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    result = bpy.ops.export_scene.gltf(**_gltf_kwargs(bpy, output_path))
    if "FINISHED" not in result:
        raise RuntimeError(f"Blender GLTF exporter did not finish for {layer_name}")

    for mesh_copy in mesh_copies:
        bpy.data.objects.remove(mesh_copy, do_unlink=True)
    bpy.data.objects.remove(armature_copy, do_unlink=True)
    for mesh_data in mesh_data_blocks:
        if mesh_data.users == 0:
            bpy.data.meshes.remove(mesh_data)
    if armature_data.users == 0:
        bpy.data.armatures.remove(armature_data)
    if mask_material is not None and mask_material.users == 0:
        bpy.data.materials.remove(mask_material)
    for material in portable_materials.values():
        if material.users == 0:
            bpy.data.materials.remove(material)
    return polygon_count


def run_export(
    config_path: Path, output_dir: Path, dry_run: bool, force: bool = False
) -> dict[str, Any]:
    import bpy  # type: ignore
    import bmesh  # type: ignore

    config = _load_config(config_path)
    armature = bpy.data.objects.get(config["armature"])
    if armature is None or armature.type != "ARMATURE":
        raise RuntimeError(f"armature object not found: {config['armature']}")
    mesh_objects = [bpy.data.objects.get(name) for name in config["meshes"]]
    invalid_meshes = [
        name for name, mesh in zip(config["meshes"], mesh_objects)
        if mesh is None or mesh.type != "MESH"
    ]
    if invalid_meshes:
        raise RuntimeError(f"mesh object not found: {', '.join(invalid_meshes)}")
    source_meshes = [mesh for mesh in mesh_objects if mesh is not None]
    unskinned_meshes = [
        mesh.name for mesh in source_meshes
        if not any(
            modifier.type == "ARMATURE" and modifier.object == armature
            for modifier in mesh.modifiers
        )
    ]
    if unskinned_meshes:
        raise RuntimeError(
            "mesh is not skinned to the configured armature: " +
            ", ".join(unskinned_meshes)
        )

    slots = [
        slot
        for mesh in source_meshes
        for slot in _slot_records(mesh.data, mesh.name)
    ]
    effect_patterns = tuple(config.get("effect_material_patterns") or DEFAULT_EFFECT_PATTERNS)
    exclude_patterns = tuple(
        config.get("mocap_exclude_material_patterns") or DEFAULT_EXCLUDE_PATTERNS
    )
    layers = classify_slots(slots, effect_patterns, exclude_patterns)
    if not layers["character"]:
        raise RuntimeError("character material layer is empty")
    if not layers["effects"] and not bool(config.get("allow_empty_effects", False)):
        raise RuntimeError("effect material layer is empty; refine effect_material_patterns")
    if not layers["mocap_mask"]:
        raise RuntimeError("mocap mask material layer is empty")

    bone_map, bone_map_resolution = _resolve_bones(
        armature, dict(config.get("bone_map", {}))
    )
    skeleton = _profile_skeleton(armature, bone_map, config["profile_id"])
    output_dir = output_dir.resolve()
    profile_path = output_dir / "profile.json"
    if profile_path.exists() and not force:
        raise RuntimeError(
            f"refusing to overwrite existing character profile: {profile_path}"
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    skeleton_path = output_dir / "skeleton.json"
    skeleton_path.write_text(
        json.dumps(skeleton, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    exports = {
        "character": "character.glb",
        "effects": "effects.glb",
        "mocap_mask": "mocap_mask.glb",
    }
    polygon_counts = {
        layer: sum(slot["polygon_count"] for slot in layer_slots)
        for layer, layer_slots in layers.items()
    }
    if not dry_run:
        for layer_name in ("character", "effects", "mocap_mask"):
            if layer_name == "effects" and not layers[layer_name]:
                exports[layer_name] = None
                continue
            keep: dict[str, set[int]] = {}
            for slot in layers[layer_name]:
                keep.setdefault(slot["mesh"], set()).add(slot["index"])
            polygon_counts[layer_name] = _export_layer(
                bpy,
                bmesh,
                source_meshes,
                armature,
                keep,
                output_dir / exports[layer_name],
                layer_name,
                flat_mask=layer_name == "mocap_mask",
            )

    unit_scale = float(bpy.context.scene.unit_settings.scale_length)
    source_blend = Path(bpy.data.filepath).resolve()
    if not source_blend.is_file():
        raise RuntimeError("the source character must be a saved .blend file")
    profile = {
        "schema_version": "1.1.0",
        "profile_id": config["profile_id"],
        "role": "source_character_reference",
        "proportion_policy": config["proportion_policy"],
        "exporter_version": EXPORTER_VERSION,
        "source": {
            "blend": str(source_blend),
            "armature": armature.name,
            "meshes": [mesh.name for mesh in source_meshes],
            "blender_version": bpy.app.version_string,
            "unit_scale_length": unit_scale,
            "mtime_ns": source_blend.stat().st_mtime_ns,
        },
        "source_hashes": {
            "blend_sha256": _sha256_file(source_blend),
            "config_sha256": _sha256_file(config_path.resolve()),
        },
        "bone_map": bone_map,
        "bone_map_resolution": bone_map_resolution,
        "layers": layers,
        "polygon_counts": polygon_counts,
        "exports": exports,
        "canonical_skeleton": skeleton_path.name,
        "constraint_policy": {
            "mode": "low_confidence_bone_length",
            "low_confidence_threshold": config["low_confidence_threshold"],
            "preserve_high_confidence_observations": True,
        },
        "dry_run": dry_run,
    }
    profile_path.write_text(
        json.dumps(profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"status": "ok", "profile": str(profile_path), **polygon_counts}))
    return profile


def main() -> int:
    args = parse_args(sys.argv)
    if args.self_test:
        self_test()
        return 0
    run_export(args.config, args.output_dir, args.dry_run, args.force)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
