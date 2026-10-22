import json
import pathlib
import sys

import bpy
from mathutils import Vector


ADDON_PARENT = pathlib.Path(__file__).resolve().parents[2]
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
if str(ADDON_PARENT) not in sys.path:
    sys.path.insert(0, str(ADDON_PARENT))

from animocap_fusion.action_import import (  # noqa: E402
    _combined_root_rotation,
    import_selected_action,
    retarget_local_rotation,
    retarget_local_translation,
)
from animocap_fusion.constants import CANONICAL_SEMANTICS  # noqa: E402
from animocap_fusion.mapping import BoneMappingError, auto_map_bones  # noqa: E402
from animocap_fusion.schema import load_document  # noqa: E402


FIXTURE = REPO_ROOT / "tests" / "fixtures" / "selected_frames.animocap-blender.json"


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def create_target():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    armature_data = bpy.data.armatures.new("AniMocapTargetData")
    armature = bpy.data.objects.new("AniMocapTarget", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    parent = None
    for index, semantic in enumerate(CANONICAL_SEMANTICS):
        bone = armature_data.edit_bones.new(semantic)
        bone.head = (0.0, index * 0.1, 0.0)
        bone.tail = (0.0, index * 0.1 + 0.08, 0.0)
        if parent is not None:
            bone.parent = parent
        parent = bone
    bpy.ops.object.mode_set(mode="OBJECT")

    mesh = bpy.data.meshes.new("AppearanceMesh")
    mesh.from_pydata([(0.0, 0.0, 0.0), (0.1, 0.0, 0.0), (0.0, 0.1, 0.0)], [], [(0, 1, 2)])
    character = bpy.data.objects.new("AppearanceCharacter", mesh)
    bpy.context.collection.objects.link(character)
    material = bpy.data.materials.new("AppearanceMaterial")
    mesh.materials.append(material)
    modifier = character.modifiers.new("Armature", "ARMATURE")
    modifier.object = armature
    return armature, character, material


def action_fcurves(action):
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    result = []
    for layer in action.layers:
        for strip in layer.strips:
            for channelbag in strip.channelbags:
                result.extend(channelbag.fcurves)
    return result


def action_keyframes(action):
    result = set()
    for fcurve in action_fcurves(action):
        result.update(round(point.co.x) for point in fcurve.keyframe_points)
    return result


def find_fcurve(action, data_path, index):
    for fcurve in action_fcurves(action):
        if fcurve.data_path == data_path and fcurve.array_index == index:
            return fcurve
    raise AssertionError(f"missing F-Curve {data_path}[{index}]")


def main():
    document = load_document(FIXTURE)
    check([frame["source_frame"] for frame in document["selected_frames"]] == [12, 24, 48], "fixture frames")
    armature, character, material = create_target()
    mapping = auto_map_bones(armature)
    check(set(mapping) == set(CANONICAL_SEMANTICS), "auto-map must cover Canonical 23")
    old_action = bpy.data.actions.new("ExistingCharacterAction")
    armature.animation_data_create().action = old_action
    mesh_identity = character.data
    material_identity = material

    action = import_selected_action(
        document,
        armature,
        mapping,
        root_motion_mode="PRESERVE",
        action_name="AniMocap_Selected_Headless",
        scene=bpy.context.scene,
    )
    check(action is not old_action, "a new Action must be active")
    check(bpy.data.actions.get(old_action.name) is old_action, "old Action must be preserved")
    check(action_keyframes(action) == {12, 24, 48}, "only selected source frames may be keyed")
    check(character.data is mesh_identity, "character mesh must be preserved")
    check(character.data.materials[0] is material_identity, "character material must be preserved")

    sample = document["selected_frames"][1]
    left_arm = armature.pose.bones[mapping["leftUpperArm"]]
    expected_rotation = retarget_local_rotation(sample["local_rotations"]["leftUpperArm"], left_arm)
    path = f'pose.bones["{left_arm.name}"].rotation_quaternion'
    for index, expected in enumerate(expected_rotation):
        actual = find_fcurve(action, path, index).evaluate(24)
        check(abs(actual - expected) < 1e-5, f"leftUpperArm quaternion component {index}")
    root = armature.pose.bones[mapping["sceneRoot"]]
    expected_location = retarget_local_translation(sample["root_translation_m"], root, 1.0)
    root_path = f'pose.bones["{root.name}"].location'
    for index, expected in enumerate(expected_location):
        actual = find_fcurve(action, root_path, index).evaluate(24)
        check(abs(actual - expected) < 1e-5, f"root translation component {index}")
    expected_root_rotation = retarget_local_rotation(_combined_root_rotation(sample), root)
    root_rotation_path = f'pose.bones["{root.name}"].rotation_quaternion'
    for index, expected in enumerate(expected_root_rotation):
        actual = find_fcurve(action, root_rotation_path, index).evaluate(24)
        check(abs(actual - expected) < 1e-5, f"root rotation component {index}")
    hips = armature.pose.bones[mapping["hips"]]
    expected_hips = retarget_local_translation(sample["hips_translation_m"], hips, 1.0)
    hips_path = f'pose.bones["{hips.name}"].location'
    for index, expected in enumerate(expected_hips):
        actual = find_fcurve(action, hips_path, index).evaluate(24)
        check(abs(actual - expected) < 1e-5, f"hips translation component {index}")

    first_curve = action_fcurves(action)[0]
    first_curve.keyframe_points[0].interpolation = "LINEAR"
    check(first_curve.keyframe_points[0].interpolation == "LINEAR", "F-Curves must remain editable")

    action_count = len(bpy.data.actions)
    active_before_failure = armature.animation_data.action
    incomplete = dict(mapping)
    incomplete.pop("leftHand")
    try:
        import_selected_action(document, armature, incomplete, action_name="MustNotExist")
        raise AssertionError("missing mapping should fail")
    except BoneMappingError:
        pass
    check(len(bpy.data.actions) == action_count, "mapping failure must not create an Action")
    check(armature.animation_data.action is active_before_failure, "mapping failure must keep active Action")

    in_place = import_selected_action(
        document, armature, mapping, root_motion_mode="IN_PLACE", action_name="AniMocap_InPlace"
    )
    root_x = find_fcurve(in_place, root_path, 0)
    root_y = find_fcurve(in_place, root_path, 1)
    check(abs(root_x.evaluate(24)) < 1e-7 and abs(root_y.evaluate(24)) < 1e-7, "in-place removes horizontal travel")
    print("ANIMOCAP_BLENDER_SELECTED_IMPORT_OK")


if __name__ == "__main__":
    main()
