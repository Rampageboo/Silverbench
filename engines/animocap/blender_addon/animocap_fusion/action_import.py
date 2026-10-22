import datetime

import bpy
from mathutils import Quaternion, Vector

from .constants import CANONICAL_SEMANTICS
from .mapping import validate_mapping
from .schema import validate_document


def canonical_to_blender_vector(value):
    return Vector((value[0], -value[2], value[1]))


def canonical_to_blender_quaternion(value):
    result = Quaternion((value[0], value[1], -value[3], value[2]))
    result.normalize()
    return result


def _rest_local_rotation(pose_bone):
    bone = pose_bone.bone
    matrix = bone.parent.matrix_local.inverted() @ bone.matrix_local if bone.parent else bone.matrix_local
    return matrix.to_quaternion().normalized()


def retarget_local_rotation(canonical_rotation, pose_bone):
    source = canonical_to_blender_quaternion(canonical_rotation)
    rest = _rest_local_rotation(pose_bone)
    result = rest.inverted() @ source @ rest
    result.normalize()
    return result


def retarget_local_translation(canonical_translation, pose_bone, meters_per_unit=1.0):
    if meters_per_unit <= 0.0:
        raise ValueError("scene scale_length must be positive")
    source = canonical_to_blender_vector(canonical_translation) / meters_per_unit
    return _rest_local_rotation(pose_bone).inverted() @ source


def _combined_root_rotation(frame):
    root = Quaternion(frame["root_rotation"])
    local = Quaternion(frame["local_rotations"]["sceneRoot"])
    combined = root @ local
    combined.normalize()
    return tuple(combined)


def _snapshot_pose(armature, mapping):
    return {
        target: (
            armature.pose.bones[target].rotation_mode,
            armature.pose.bones[target].rotation_quaternion.copy(),
            armature.pose.bones[target].location.copy(),
        )
        for target in mapping.values()
    }


def _restore_pose(armature, snapshot):
    for target, (rotation_mode, rotation, location) in snapshot.items():
        pose_bone = armature.pose.bones.get(target)
        if pose_bone is None:
            continue
        pose_bone.rotation_mode = rotation_mode
        pose_bone.rotation_quaternion = rotation
        pose_bone.location = location


def import_selected_action(
    document,
    armature,
    mapping,
    root_motion_mode="PRESERVE",
    action_name="",
    scene=None,
):
    validate_document(document)
    validate_mapping(armature, mapping)
    if root_motion_mode not in {"PRESERVE", "IN_PLACE"}:
        raise ValueError("root_motion_mode must be PRESERVE or IN_PLACE")
    scene = scene or bpy.context.scene
    meters_per_unit = float(scene.unit_settings.scale_length or 1.0)
    frames = sorted(document["selected_frames"], key=lambda value: value["source_frame"])
    if not action_name.strip():
        action_name = f"AniMocap_Selected_{datetime.date.today():%Y%m%d}"

    animation_data = armature.animation_data_create()
    previous_action = animation_data.action
    snapshot = _snapshot_pose(armature, mapping)
    action = None
    previous_quaternions = {}
    try:
        action = bpy.data.actions.new(action_name.strip())
        animation_data.action = action
        for frame in frames:
            source_frame = frame["source_frame"]
            scene.frame_set(source_frame)
            for semantic in CANONICAL_SEMANTICS:
                pose_bone = armature.pose.bones[mapping[semantic]]
                pose_bone.rotation_mode = "QUATERNION"
                rotation_source = (
                    _combined_root_rotation(frame)
                    if semantic == "sceneRoot"
                    else frame["local_rotations"][semantic]
                )
                rotation = retarget_local_rotation(rotation_source, pose_bone)
                previous = previous_quaternions.get(semantic)
                if previous is not None and previous.dot(rotation) < 0.0:
                    rotation.negate()
                previous_quaternions[semantic] = rotation.copy()
                pose_bone.rotation_quaternion = rotation
                pose_bone.keyframe_insert(
                    data_path="rotation_quaternion",
                    frame=source_frame,
                    group=semantic,
                )

            root_bone = armature.pose.bones[mapping["sceneRoot"]]
            root_translation = list(frame["root_translation_m"])
            if root_motion_mode == "IN_PLACE":
                root_translation[0] = 0.0
                root_translation[2] = 0.0
            root_bone.location = retarget_local_translation(
                root_translation, root_bone, meters_per_unit
            )
            root_bone.keyframe_insert(
                data_path="location", frame=source_frame, group="sceneRoot"
            )

            hips_bone = armature.pose.bones[mapping["hips"]]
            hips_bone.location = retarget_local_translation(
                frame["hips_translation_m"], hips_bone, meters_per_unit
            )
            hips_bone.keyframe_insert(
                data_path="location", frame=source_frame, group="hips"
            )
        return action
    except Exception:
        animation_data.action = previous_action
        _restore_pose(armature, snapshot)
        if action is not None and action.users == 0:
            bpy.data.actions.remove(action)
        raise
