"""Open a disposable Blender UI scene for manual/sidebar verification."""

import pathlib
import sys

import bpy


ADDON_PARENT = pathlib.Path(__file__).resolve().parents[2]
REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
if str(ADDON_PARENT) not in sys.path:
    sys.path.insert(0, str(ADDON_PARENT))

import animocap_fusion  # noqa: E402
from animocap_fusion.constants import CANONICAL_SEMANTICS  # noqa: E402
from animocap_fusion.mapping import auto_map_bones  # noqa: E402
from animocap_fusion.schema import frame_summary, load_document  # noqa: E402
from animocap_fusion.ui import ensure_mapping_rows  # noqa: E402


animocap_fusion.register()
armature_data = bpy.data.armatures.new("AniMocapUiTargetData")
armature = bpy.data.objects.new("AniMocapUiTarget", armature_data)
bpy.context.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
armature.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
parent = None
for index, semantic in enumerate(CANONICAL_SEMANTICS):
    bone = armature_data.edit_bones.new(semantic)
    bone.head = (0.0, index * 0.1, 0.0)
    bone.tail = (0.0, index * 0.1 + 0.08, 0.0)
    bone.parent = parent
    parent = bone
bpy.ops.object.mode_set(mode="OBJECT")

fixture = REPO_ROOT / "tests" / "fixtures" / "selected_frames.animocap-blender.json"
settings = bpy.context.scene.animocap_import
settings.exchange_path = str(fixture)
settings.target_armature = armature
ensure_mapping_rows(settings)
mapping = auto_map_bones(armature)
for item in settings.mappings:
    item.target_bone = mapping.get(item.semantic, "")
settings.file_summary = frame_summary(load_document(fixture))
settings.mapping_status = "23/23 unique mappings"
bpy.context.scene.frame_start = 0
bpy.context.scene.frame_end = 60
print("ANIMOCAP_FOREGROUND_UI_READY")
