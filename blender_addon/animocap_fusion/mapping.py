import re

from .constants import CANONICAL_SEMANTICS


ALIASES = {
    "sceneRoot": ("root", "rootbone", "armatureroot", "j_bip_c_root"),
    "hips": ("hips", "pelvis", "mixamorighips", "j_bip_c_hips"),
    "spine": ("spine", "spine1", "mixamorigspine", "j_bip_c_spine"),
    "chest": ("chest", "spine2", "mixamorigspine1", "j_bip_c_chest"),
    "upperChest": ("upperchest", "spine3", "mixamorigspine2", "j_bip_c_upperchest"),
    "neck": ("neck", "mixamorigneck", "j_bip_c_neck"),
    "head": ("head", "mixamorighead", "j_bip_c_head"),
    "leftShoulder": ("leftshoulder", "lshoulder", "mixamorigleftshoulder", "j_bip_l_shoulder"),
    "leftUpperArm": ("leftupperarm", "lupperarm", "mixamorigleftarm", "j_bip_l_upperarm"),
    "leftLowerArm": ("leftlowerarm", "lforearm", "mixamorigleftforearm", "j_bip_l_lowerarm"),
    "leftHand": ("lefthand", "lhand", "mixamoriglefthand", "j_bip_l_hand"),
    "rightShoulder": ("rightshoulder", "rshoulder", "mixamorigrightshoulder", "j_bip_r_shoulder"),
    "rightUpperArm": ("rightupperarm", "rupperarm", "mixamorigrightarm", "j_bip_r_upperarm"),
    "rightLowerArm": ("rightlowerarm", "rforearm", "mixamorigrightforearm", "j_bip_r_lowerarm"),
    "rightHand": ("righthand", "rhand", "mixamorigrighthand", "j_bip_r_hand"),
    "leftUpperLeg": ("leftupperleg", "lthigh", "mixamorigleftupleg", "j_bip_l_upperleg"),
    "leftLowerLeg": ("leftlowerleg", "lshin", "mixamorigleftleg", "j_bip_l_lowerleg"),
    "leftFoot": ("leftfoot", "lfoot", "mixamorigleftfoot", "j_bip_l_foot"),
    "leftToes": ("lefttoes", "ltoe", "mixamoriglefttoebase", "j_bip_l_toebase"),
    "rightUpperLeg": ("rightupperleg", "rthigh", "mixamorigrightupleg", "j_bip_r_upperleg"),
    "rightLowerLeg": ("rightlowerleg", "rshin", "mixamorigrightleg", "j_bip_r_lowerleg"),
    "rightFoot": ("rightfoot", "rfoot", "mixamorigrightfoot", "j_bip_r_foot"),
    "rightToes": ("righttoes", "rtoe", "mixamorigrighttoebase", "j_bip_r_toebase"),
}


class BoneMappingError(ValueError):
    pass


def _normalized(name):
    return re.sub(r"[^a-z0-9]", "", name.casefold())


def auto_map_bones(armature):
    by_normalized = {}
    for bone in armature.data.bones:
        by_normalized.setdefault(_normalized(bone.name), []).append(bone.name)
    result = {}
    for semantic in CANONICAL_SEMANTICS:
        candidates = (semantic,) + ALIASES.get(semantic, ())
        matches = []
        for candidate in candidates:
            matches.extend(by_normalized.get(_normalized(candidate), ()))
        matches = list(dict.fromkeys(matches))
        if len(matches) == 1:
            result[semantic] = matches[0]
    return result


def validate_mapping(armature, mapping):
    if armature is None or armature.type != "ARMATURE":
        raise BoneMappingError("target must be an Armature object")
    missing_semantics = [semantic for semantic in CANONICAL_SEMANTICS if not mapping.get(semantic)]
    if missing_semantics:
        raise BoneMappingError("missing mappings: " + ", ".join(missing_semantics))
    unknown = sorted(set(mapping) - set(CANONICAL_SEMANTICS))
    if unknown:
        raise BoneMappingError("unknown canonical mappings: " + ", ".join(unknown))
    targets = [mapping[semantic] for semantic in CANONICAL_SEMANTICS]
    duplicates = sorted({name for name in targets if targets.count(name) > 1})
    if duplicates:
        raise BoneMappingError("duplicate target bones: " + ", ".join(duplicates))
    absent = sorted(name for name in targets if name not in armature.pose.bones)
    if absent:
        raise BoneMappingError("target bones do not exist: " + ", ".join(absent))
    return mapping
