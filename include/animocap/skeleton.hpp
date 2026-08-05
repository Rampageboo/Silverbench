#pragma once

#include "animocap/types.hpp"

#include <cstddef>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

namespace animocap {

enum class BoneSemantic {
    SceneRoot,
    Hips,
    Spine,
    Chest,
    UpperChest,
    Neck,
    Head,
    LeftShoulder,
    LeftUpperArm,
    LeftLowerArm,
    LeftHand,
    RightShoulder,
    RightUpperArm,
    RightLowerArm,
    RightHand,
    LeftUpperLeg,
    LeftLowerLeg,
    LeftFoot,
    LeftToes,
    RightUpperLeg,
    RightLowerLeg,
    RightFoot,
    RightToes,
};

struct Bone {
    BoneSemantic semantic{};
    int parent{-1};
    Vec3 rest_offset_m{};
};

struct Skeleton {
    std::string schema_version{kSchemaVersion};
    std::string skeleton_id{"animocap_canonical_v1"};
    std::vector<Bone> bones;
};

std::string_view to_string(BoneSemantic semantic);
BoneSemantic bone_semantic_from_string(std::string_view value);
const std::vector<BoneSemantic>& required_bone_semantics();
Skeleton make_default_skeleton();
void validate_skeleton(const Skeleton& skeleton);
std::size_t bone_index(const Skeleton& skeleton, BoneSemantic semantic);
void save_skeleton_json(const Skeleton& skeleton, const std::filesystem::path& path);
Skeleton load_skeleton_json(const std::filesystem::path& path);

}  // namespace animocap
