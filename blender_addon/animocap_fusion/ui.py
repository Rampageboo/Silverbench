import bpy
from bpy.props import CollectionProperty, EnumProperty, PointerProperty, StringProperty
from bpy.types import Operator, Panel, PropertyGroup

from .action_import import import_selected_action
from .constants import CANONICAL_SEMANTICS
from .mapping import BoneMappingError, auto_map_bones, validate_mapping
from .schema import ExchangeValidationError, frame_summary, load_document


def _armature_poll(_self, obj):
    return obj is not None and obj.type == "ARMATURE"


class ANIMOCAP_PG_bone_mapping(PropertyGroup):
    semantic: StringProperty()
    target_bone: StringProperty()


class ANIMOCAP_PG_import_settings(PropertyGroup):
    exchange_path: StringProperty(name="Selected-frame file", subtype="FILE_PATH")
    target_armature: PointerProperty(
        name="Target Armature", type=bpy.types.Object, poll=_armature_poll
    )
    root_motion_mode: EnumProperty(
        name="Root Motion",
        items=(
            ("PRESERVE", "Preserve", "Keep scene-root translation"),
            ("IN_PLACE", "In place", "Remove horizontal scene-root travel"),
        ),
        default="PRESERVE",
    )
    action_name: StringProperty(
        name="Action name",
        description="Blank uses AniMocap_Selected_YYYYMMDD",
    )
    mappings: CollectionProperty(type=ANIMOCAP_PG_bone_mapping)
    file_summary: StringProperty(options={"HIDDEN"})
    mapping_status: StringProperty(options={"HIDDEN"})


def ensure_mapping_rows(settings):
    existing = {item.semantic: item.target_bone for item in settings.mappings}
    settings.mappings.clear()
    for semantic in CANONICAL_SEMANTICS:
        item = settings.mappings.add()
        item.semantic = semantic
        item.target_bone = existing.get(semantic, "")


def settings_mapping(settings):
    return {item.semantic: item.target_bone for item in settings.mappings}


class ANIMOCAP_OT_validate_file(Operator):
    bl_idname = "animocap.validate_selected_file"
    bl_label = "Load and validate"
    bl_description = "Validate the selected AniMocap Blender exchange file"

    def execute(self, context):
        settings = context.scene.animocap_import
        try:
            document = load_document(bpy.path.abspath(settings.exchange_path))
            ensure_mapping_rows(settings)
            settings.file_summary = frame_summary(document)
            self.report({"INFO"}, settings.file_summary)
            return {"FINISHED"}
        except ExchangeValidationError as error:
            settings.file_summary = ""
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class ANIMOCAP_OT_auto_map(Operator):
    bl_idname = "animocap.auto_map_bones"
    bl_label = "Auto-map 23 bones"

    def execute(self, context):
        settings = context.scene.animocap_import
        if settings.target_armature is None:
            self.report({"ERROR"}, "Choose a target Armature first")
            return {"CANCELLED"}
        ensure_mapping_rows(settings)
        found = auto_map_bones(settings.target_armature)
        for item in settings.mappings:
            item.target_bone = found.get(item.semantic, item.target_bone)
        try:
            validate_mapping(settings.target_armature, settings_mapping(settings))
            settings.mapping_status = "23/23 unique mappings"
            self.report({"INFO"}, settings.mapping_status)
        except BoneMappingError as error:
            settings.mapping_status = str(error)
            self.report({"WARNING"}, settings.mapping_status)
        return {"FINISHED"}


class ANIMOCAP_OT_import_selected(Operator):
    bl_idname = "animocap.import_selected_action"
    bl_label = "Create new Action"
    bl_description = "Create a new Action using only the selected source frames"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.animocap_import
        try:
            document = load_document(bpy.path.abspath(settings.exchange_path))
            action = import_selected_action(
                document,
                settings.target_armature,
                settings_mapping(settings),
                settings.root_motion_mode,
                settings.action_name,
                context.scene,
            )
            settings.file_summary = frame_summary(document)
            self.report({"INFO"}, f"Created {action.name}; {settings.file_summary}")
            return {"FINISHED"}
        except (ExchangeValidationError, BoneMappingError, ValueError, RuntimeError) as error:
            self.report({"ERROR"}, str(error))
            return {"CANCELLED"}


class ANIMOCAP_PT_selected_import(Panel):
    bl_label = "AniMocap Selected Frames"
    bl_idname = "ANIMOCAP_PT_selected_import"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "AniMocap"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.animocap_import
        layout.prop(settings, "exchange_path")
        layout.operator(ANIMOCAP_OT_validate_file.bl_idname)
        if settings.file_summary:
            layout.label(text=settings.file_summary, icon="KEY_HLT")
        layout.separator()
        layout.prop(settings, "target_armature")
        layout.operator(ANIMOCAP_OT_auto_map.bl_idname)
        if not settings.mappings:
            ensure_mapping_rows(settings)
        box = layout.box()
        box.label(text="Canonical 23 mapping")
        armature = settings.target_armature
        for item in settings.mappings:
            row = box.row(align=True)
            row.label(text=item.semantic)
            if armature is not None:
                row.prop_search(item, "target_bone", armature.data, "bones", text="")
            else:
                row.prop(item, "target_bone", text="")
        mapping_status = settings.mapping_status
        if armature is not None:
            try:
                validate_mapping(armature, settings_mapping(settings))
                mapping_status = "23/23 unique mappings"
            except BoneMappingError as error:
                mapping_status = str(error)
        if mapping_status:
            layout.label(
                text=mapping_status,
                icon="CHECKMARK" if mapping_status.startswith("23/23") else "ERROR",
            )
        layout.prop(settings, "root_motion_mode")
        layout.prop(settings, "action_name")
        layout.operator(ANIMOCAP_OT_import_selected.bl_idname, icon="ACTION")


CLASSES = (
    ANIMOCAP_PG_bone_mapping,
    ANIMOCAP_PG_import_settings,
    ANIMOCAP_OT_validate_file,
    ANIMOCAP_OT_auto_map,
    ANIMOCAP_OT_import_selected,
    ANIMOCAP_PT_selected_import,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.animocap_import = PointerProperty(type=ANIMOCAP_PG_import_settings)


def unregister():
    del bpy.types.Scene.animocap_import
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)
