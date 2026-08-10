"""Render private character-specific RGB, anatomy masks, and COCO keypoints.

Run this module inside Blender. Canonical Motion remains the source of truth;
the Blender scene is only a deterministic rendering adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import random
import shutil
import struct
import sys
from typing import Any, Iterable


COCO_KEYPOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
COCO_TO_CANONICAL = {
    0: "head",
    5: "leftShoulder", 6: "rightShoulder",
    7: "leftLowerArm", 8: "rightLowerArm",
    9: "leftHand", 10: "rightHand",
    11: "leftUpperLeg", 12: "rightUpperLeg",
    13: "leftLowerLeg", 14: "rightLowerLeg",
    15: "leftFoot", 16: "rightFoot",
}
COCO_SKELETON = [
    [16, 14], [14, 12], [17, 15], [15, 13], [12, 13], [6, 12],
    [7, 13], [6, 7], [6, 8], [7, 9], [8, 10], [9, 11],
]
CANONICAL_SEMANTICS = [
    "sceneRoot", "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
    "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
]


def _arguments(argv: list[str]) -> list[str]:
    return argv[argv.index("--") + 1 :] if "--" in argv else argv[1:]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_motion(path: Path) -> str:
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(file_path.relative_to(path).as_posix().encode("utf-8"))
        digest.update(bytes.fromhex(_sha256_file(file_path)))
    return digest.hexdigest()


def _project_normalized_to_pixel(
    normalized: tuple[float, float, float], width: int, height: int
) -> tuple[float, float, bool]:
    x, y, depth = normalized
    visible = depth > 0.0 and 0.0 <= x <= 1.0 and 0.0 <= y <= 1.0
    return x * width, (1.0 - y) * height, visible


def _select_frames(frame_count: int, count: int, seed: int) -> list[int]:
    if frame_count < 1 or count < 1:
        raise ValueError("frame_count and count must be positive")
    if count >= frame_count:
        return list(range(frame_count))
    rng = random.Random(seed)
    cells = [index * frame_count / count for index in range(count + 1)]
    selected = []
    for index in range(count):
        first = int(math.floor(cells[index]))
        last = max(first, int(math.ceil(cells[index + 1])) - 1)
        selected.append(rng.randint(first, min(last, frame_count - 1)))
    return sorted(set(selected))


def _load_profile(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if value.get("role") != "source_character_reference":
        raise RuntimeError("synthetic rendering requires a source_character_reference profile")
    if len(value.get("bone_map", {})) != 23:
        raise RuntimeError("character profile must map exactly 23 canonical bones")
    for layer in ("character", "mocap_mask"):
        filename = value.get("exports", {}).get(layer)
        if not filename or not (path.parent / filename).is_file():
            raise RuntimeError(f"character profile is missing {layer} GLB")
    return value


def _load_motion(path: Path) -> dict[str, Any]:
    import numpy as np

    manifest = json.loads((path / "manifest.json").read_text(encoding="utf-8"))
    arrays = manifest["arrays"]
    result: dict[str, Any] = {"manifest": manifest}
    for key in (
        "scene_root_translation_m", "scene_root_rotation_wxyz",
        "local_rotations_wxyz", "hips_translation_m",
    ):
        result[key] = np.load(path / arrays[key])
    return result


def _clear_scene(bpy: Any) -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)


def _import_layer(bpy: Any, path: Path, layer: str) -> dict[str, Any]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    objects = [item for item in bpy.context.scene.objects if item not in before]
    armatures = [item for item in objects if item.type == "ARMATURE"]
    if len(armatures) != 1:
        raise RuntimeError(f"{layer} GLB must import exactly one armature")
    for item in objects:
        item["animocap_layer"] = layer
    return {"objects": objects, "armature": armatures[0]}


def _animocap_quaternion_to_blender(value: Iterable[float]) -> tuple[float, ...]:
    w, x, y, z = [float(component) for component in value]
    return (w, x, -z, y)


def _animocap_vector_to_blender(value: Iterable[float]) -> tuple[float, ...]:
    x, y, z = [float(component) for component in value]
    return (x, -z, y)


def _canonical_positions(
    skeleton: dict[str, Any], motion: dict[str, Any], frame: int
) -> list[Any]:
    from mathutils import Quaternion, Vector

    rotations = motion["local_rotations_wxyz"][frame]
    scene_rotation = Quaternion(_animocap_quaternion_to_blender(
        motion["scene_root_rotation_wxyz"][frame]
    ))
    root_translation = Vector(_animocap_vector_to_blender(
        motion["scene_root_translation_m"][frame]
    ))
    hips_translation = Vector(_animocap_vector_to_blender(
        motion["hips_translation_m"][frame]
    ))
    positions: list[Any] = []
    global_rotations: list[Any] = []
    indices = {bone["semantic"]: index for index, bone in enumerate(skeleton["bones"])}
    for index, bone in enumerate(skeleton["bones"]):
        local = Quaternion(_animocap_quaternion_to_blender(rotations[index]))
        parent = -1 if bone["parent"] is None else indices[bone["parent"]]
        rest = Vector(_animocap_vector_to_blender(bone["rest_offset_m"]))
        if parent < 0:
            positions.append(root_translation + rest)
            global_rotations.append(scene_rotation @ local)
            continue
        if bone["semantic"] == "hips":
            rest += hips_translation
        positions.append(positions[parent] + global_rotations[parent] @ rest)
        global_rotations.append(global_rotations[parent] @ local)
    return positions


def _apply_motion_frame(
    bpy: Any,
    armature: Any,
    bone_map: dict[str, str],
    skeleton: dict[str, Any],
    motion: dict[str, Any],
    frame: int,
) -> None:
    from mathutils import Vector

    for pose_bone in armature.pose.bones:
        pose_bone.matrix_basis.identity()
    armature.location = (0.0, 0.0, 0.0)
    bpy.context.view_layer.update()
    targets = _canonical_positions(skeleton, motion, frame)
    children: list[int | None] = [None] * len(CANONICAL_SEMANTICS)
    indices = {bone["semantic"]: index for index, bone in enumerate(skeleton["bones"])}
    for child, bone in enumerate(skeleton["bones"]):
        parent = -1 if bone["parent"] is None else indices[bone["parent"]]
        if parent >= 0 and children[parent] is None:
            children[parent] = child

    hips = armature.pose.bones.get(bone_map["hips"])
    if hips is not None:
        hips_matrix = hips.matrix.copy()
        hips_matrix.translation += Vector(_animocap_vector_to_blender(
            motion["hips_translation_m"][frame]
        ))
        hips.matrix = hips_matrix
        bpy.context.view_layer.update()

    for parent, child in enumerate(children):
        if child is None:
            continue
        parent_bone = armature.pose.bones.get(bone_map[CANONICAL_SEMANTICS[parent]])
        child_bone = armature.pose.bones.get(bone_map[CANONICAL_SEMANTICS[child]])
        if parent_bone is None or child_bone is None:
            continue
        current = child_bone.head - parent_bone.head
        target = targets[child] - targets[parent]
        if current.length <= 1e-9 or target.length <= 1e-9:
            continue
        delta = current.normalized().rotation_difference(target.normalized())
        rotation = delta @ parent_bone.matrix.to_quaternion()
        desired = rotation.to_matrix().to_4x4()
        desired.translation = parent_bone.head.copy()
        parent_bone.matrix = desired
        bpy.context.view_layer.update()


def _set_layer_visibility(layers: dict[str, dict[str, Any]], visible: set[str]) -> None:
    for name, layer in layers.items():
        for item in layer["objects"]:
            item.hide_render = name not in visible


def _strip_nondeterministic_png_metadata(path: Path) -> None:
    """Remove Blender timestamps/render-duration chunks without touching pixels."""
    data = path.read_bytes()
    signature = b"\x89PNG\r\n\x1a\n"
    if not data.startswith(signature):
        raise RuntimeError(f"render is not a PNG: {path}")
    kept = bytearray(signature)
    offset = len(signature)
    volatile = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}
    while offset < len(data):
        if offset + 12 > len(data):
            raise RuntimeError(f"truncated PNG: {path}")
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        end = offset + 12 + length
        if end > len(data):
            raise RuntimeError(f"invalid PNG chunk length: {path}")
        chunk_type = data[offset + 4:offset + 8]
        if chunk_type not in volatile:
            kept.extend(data[offset:end])
        offset = end
        if chunk_type == b"IEND":
            break
    path.write_bytes(kept)


def _configure_scene(bpy: Any, width: int, height: int) -> Any:
    scene = bpy.context.scene
    # The enum remained BLENDER_EEVEE in the Blender 5.2 LTS build used by the
    # project even though the UI calls it Eevee Next. Prefer the newer enum
    # when a distribution exposes it, then fall back without version guessing.
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world.color = (0.0, 0.0, 0.0)
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    if background is not None:
        background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
        background.inputs["Strength"].default_value = 0.08
    camera_data = bpy.data.cameras.new("AniMocapCamera")
    camera = bpy.data.objects.new("AniMocapCamera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    camera_data.lens = 55.0
    light_data = bpy.data.lights.new("AniMocapKey", type="AREA")
    light_data.energy = 900.0
    light_data.shape = "DISK"
    light_data.size = 4.0
    light = bpy.data.objects.new("AniMocapKey", light_data)
    light.location = (3.0, -4.0, 5.0)
    scene.collection.objects.link(light)
    fill_data = bpy.data.lights.new("AniMocapFill", type="AREA")
    fill_data.energy = 500.0
    fill_data.size = 5.0
    fill = bpy.data.objects.new("AniMocapFill", fill_data)
    fill.location = (-3.0, 1.5, 3.5)
    scene.collection.objects.link(fill)
    return camera


def _mask_override_material(bpy: Any) -> Any:
    material = bpy.data.materials.new("AniMocapSyntheticMaskOverride")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    emission.inputs["Strength"].default_value = 1.0
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def _aim_camera(camera: Any, target: Any, yaw: float, pitch: float, distance: float) -> None:
    from mathutils import Vector

    horizontal = distance * math.cos(pitch)
    camera.location = target + Vector((
        horizontal * math.sin(yaw),
        -horizontal * math.cos(yaw),
        distance * math.sin(pitch),
    ))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def _annotation(
    bpy: Any, camera: Any, armature: Any, bone_map: dict[str, str],
    width: int, height: int, image_id: int,
) -> dict[str, Any]:
    from bpy_extras.object_utils import world_to_camera_view

    keypoints: list[float | int] = []
    visible: list[tuple[float, float]] = []
    for coco_index in range(len(COCO_KEYPOINTS)):
        semantic = COCO_TO_CANONICAL.get(coco_index)
        if semantic is None:
            keypoints.extend([0.0, 0.0, 0])
            continue
        pose_bone = armature.pose.bones.get(bone_map[semantic])
        if pose_bone is None:
            keypoints.extend([0.0, 0.0, 0])
            continue
        point = armature.matrix_world @ pose_bone.head
        projected = world_to_camera_view(bpy.context.scene, camera, point)
        x, y, is_visible = _project_normalized_to_pixel(
            (float(projected.x), float(projected.y), float(projected.z)), width, height
        )
        keypoints.extend([x, y, 2 if is_visible else 0])
        if is_visible:
            visible.append((x, y))
    if len(visible) < 8:
        raise RuntimeError("rendered frame has fewer than eight visible body keypoints")
    xs = [point[0] for point in visible]
    ys = [point[1] for point in visible]
    left, top = max(0.0, min(xs) - 16.0), max(0.0, min(ys) - 16.0)
    right, bottom = min(width, max(xs) + 16.0), min(height, max(ys) + 16.0)
    return {
        "id": image_id, "image_id": image_id, "category_id": 1,
        "iscrowd": 0, "area": (right - left) * (bottom - top),
        "bbox": [left, top, right - left, bottom - top],
        "num_keypoints": len(visible), "keypoints": keypoints,
    }


def render_dataset(
    profile_path: Path,
    motions: list[Path],
    held_out: list[Path],
    output: Path,
    frames_per_motion: int,
    seed: int,
    width: int,
    height: int,
    include_effects: bool,
    force: bool,
    motion_ids: list[str] | None = None,
    held_out_ids: list[str] | None = None,
) -> dict[str, Any]:
    import bpy
    from mathutils import Vector

    profile_path = profile_path.resolve()
    profile = _load_profile(profile_path)
    skeleton = json.loads(
        (profile_path.parent / profile["canonical_skeleton"]).read_text(
            encoding="utf-8"
        )
    )
    if [bone.get("semantic") for bone in skeleton.get("bones", [])] != CANONICAL_SEMANTICS:
        raise RuntimeError("profile skeleton must contain the canonical 23 bones in order")
    motion_paths = [path.resolve() for path in motions]
    held_out_paths = [path.resolve() for path in held_out]
    overlap = set(motion_paths) & set(held_out_paths)
    if overlap:
        raise RuntimeError(f"held-out motion was also provided for training: {next(iter(overlap))}")
    motion_hashes = {str(path): _sha256_motion(path) for path in motion_paths}
    held_out_hashes = {_sha256_motion(path) for path in held_out_paths}
    if set(motion_hashes.values()) & held_out_hashes:
        raise RuntimeError("held-out motion content matches a training motion")
    if motion_ids is not None and len(motion_ids) != len(motion_paths):
        raise RuntimeError("--motion-id count must match --motion count")
    if held_out_ids is not None and len(held_out_ids) != len(held_out_paths):
        raise RuntimeError("--held-out-motion-id count must match held-out motions")
    resolved_motion_ids = motion_ids or list(motion_hashes.values())
    resolved_held_out_ids = held_out_ids or sorted(held_out_hashes)
    if set(resolved_motion_ids) & set(resolved_held_out_ids):
        raise RuntimeError("held-out source motion id was also provided for training")
    if output.exists():
        if not force:
            raise RuntimeError(f"refusing to overwrite synthetic dataset: {output}")
        shutil.rmtree(output)
    rgb_directory = output / "images"
    mask_directory = output / "masks"
    rgb_directory.mkdir(parents=True)
    mask_directory.mkdir(parents=True)

    _clear_scene(bpy)
    exports = profile["exports"]
    layers = {
        "character": _import_layer(bpy, profile_path.parent / exports["character"], "character"),
        "mocap_mask": _import_layer(bpy, profile_path.parent / exports["mocap_mask"], "mocap_mask"),
    }
    if include_effects and exports.get("effects"):
        layers["effects"] = _import_layer(
            bpy, profile_path.parent / exports["effects"], "effects"
        )
    camera = _configure_scene(bpy, width, height)
    mask_override = _mask_override_material(bpy)
    rng = random.Random(seed)
    images: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    image_id = 1
    for motion_index, path in enumerate(motion_paths):
        motion = _load_motion(path)
        frame_count = int(motion["manifest"]["frame_count"])
        for frame in _select_frames(frame_count, frames_per_motion, seed + motion_index):
            for layer in layers.values():
                _apply_motion_frame(
                    bpy, layer["armature"], profile["bone_map"], skeleton,
                    motion, frame,
                )
            bpy.context.view_layer.update()
            hips = layers["character"]["armature"].pose.bones[profile["bone_map"]["hips"]]
            target = layers["character"]["armature"].matrix_world @ hips.head
            yaw = rng.uniform(-math.pi, math.pi)
            pitch = rng.uniform(math.radians(-10.0), math.radians(14.0))
            _aim_camera(camera, target + Vector((0.0, 0.0, 0.25)), yaw, pitch, rng.uniform(5.0, 6.5))
            bpy.context.view_layer.update()
            annotation = _annotation(
                bpy, camera, layers["character"]["armature"], profile["bone_map"],
                width, height, image_id,
            )
            filename = f"synthetic_{image_id:08d}.png"
            mask_filename = f"synthetic_{image_id:08d}_mask.png"
            visible_rgb = {"character"}
            if "effects" in layers and rng.random() < 0.25:
                visible_rgb.add("effects")
            _set_layer_visibility(layers, visible_rgb)
            bpy.context.scene.render.filepath = str(rgb_directory / filename)
            bpy.ops.render.render(write_still=True)
            _strip_nondeterministic_png_metadata(rgb_directory / filename)
            _set_layer_visibility(layers, {"mocap_mask"})
            bpy.context.view_layer.material_override = mask_override
            bpy.context.scene.render.filepath = str(mask_directory / mask_filename)
            bpy.ops.render.render(write_still=True)
            _strip_nondeterministic_png_metadata(mask_directory / mask_filename)
            bpy.context.view_layer.material_override = None
            images.append({
                "id": image_id, "file_name": filename, "width": width, "height": height,
                "source_motion_sha256": motion_hashes[str(path)], "source_frame": frame,
                "mask_file": f"masks/{mask_filename}",
            })
            annotations.append(annotation)
            image_id += 1

    document = {
        "info": {"description": "AniMocap private synthetic character keypoints", "version": "1.0.0"},
        "licenses": [], "images": images, "annotations": annotations,
        "categories": [{
            "id": 1, "name": "person", "supercategory": "person",
            "keypoints": COCO_KEYPOINTS, "skeleton": COCO_SKELETON,
        }],
    }
    (output / "annotations.json").write_text(
        json.dumps(document, ensure_ascii=False), encoding="utf-8"
    )
    manifest = {
        "schema_version": "1.0.0", "kind": "animocap.character_synthetic_dataset",
        "privacy": "private-local-only", "seed": seed,
        "profile_sha256": _sha256_file(profile_path),
        "motion_sha256": list(motion_hashes.values()),
        "held_out_motion_sha256": sorted(held_out_hashes),
        "motion_ids": resolved_motion_ids,
        "held_out_motion_ids": resolved_held_out_ids,
        "motion_identity_declared": bool(
            motion_ids is not None and
            (not held_out_paths or held_out_ids is not None)
        ),
        "blender_version": bpy.app.version_string, "images": len(images),
    }
    (output / "dataset.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def self_test() -> None:
    assert _project_normalized_to_pixel((0.25, 0.75, 1.0), 800, 600) == (200.0, 150.0, True)
    assert _project_normalized_to_pixel((-0.1, 0.5, 1.0), 800, 600)[2] is False
    assert _select_frames(100, 10, 7) == _select_frames(100, 10, 7)
    assert len(_select_frames(100, 10, 7)) == 10
    print(json.dumps({"status": "ok", "projection": "top-left-pixels"}))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", type=Path)
    parser.add_argument("--motion", type=Path, action="append", default=[])
    parser.add_argument("--held-out-motion", type=Path, action="append", default=[])
    parser.add_argument("--motion-id", action="append")
    parser.add_argument("--held-out-motion-id", action="append")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--frames-per-motion", type=int, default=120)
    parser.add_argument("--seed", type=int, default=20260810)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--include-effects", action="store_true")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(_arguments(sys.argv))
    if args.self_test:
        self_test()
        return 0
    if not args.profile or not args.motion or not args.output:
        parser.error("--profile, at least one --motion, and --output are required")
    manifest = render_dataset(
        args.profile, args.motion, args.held_out_motion, args.output.resolve(),
        max(1, args.frames_per_motion), args.seed, max(128, args.width),
        max(128, args.height), args.include_effects, args.force,
        args.motion_id, args.held_out_motion_id,
    )
    print(json.dumps({"event": "complete", **manifest}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
