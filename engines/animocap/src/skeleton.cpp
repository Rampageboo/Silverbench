#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <set>
#include <unordered_map>

namespace animocap {
namespace {

using json = nlohmann::json;

struct BoneSpec {
    BoneSemantic semantic;
    int parent;
    Vec3 offset;
};

const std::array<BoneSpec, 23> kDefaultBones{{
    {BoneSemantic::SceneRoot, -1, {0.0, 0.0, 0.0}},
    {BoneSemantic::Hips, 0, {0.0, 0.90, 0.0}},
    {BoneSemantic::Spine, 1, {0.0, 0.12, 0.0}},
    {BoneSemantic::Chest, 2, {0.0, 0.15, 0.0}},
    {BoneSemantic::UpperChest, 3, {0.0, 0.12, 0.0}},
    {BoneSemantic::Neck, 4, {0.0, 0.12, 0.0}},
    {BoneSemantic::Head, 5, {0.0, 0.16, 0.0}},
    {BoneSemantic::LeftShoulder, 4, {0.12, 0.08, 0.0}},
    {BoneSemantic::LeftUpperArm, 7, {0.20, 0.0, 0.0}},
    {BoneSemantic::LeftLowerArm, 8, {0.24, 0.0, 0.0}},
    {BoneSemantic::LeftHand, 9, {0.18, 0.0, 0.0}},
    {BoneSemantic::RightShoulder, 4, {-0.12, 0.08, 0.0}},
    {BoneSemantic::RightUpperArm, 11, {-0.20, 0.0, 0.0}},
    {BoneSemantic::RightLowerArm, 12, {-0.24, 0.0, 0.0}},
    {BoneSemantic::RightHand, 13, {-0.18, 0.0, 0.0}},
    {BoneSemantic::LeftUpperLeg, 1, {0.09, -0.10, 0.0}},
    {BoneSemantic::LeftLowerLeg, 15, {0.0, -0.40, 0.0}},
    {BoneSemantic::LeftFoot, 16, {0.0, -0.40, 0.04}},
    {BoneSemantic::LeftToes, 17, {0.0, 0.0, 0.16}},
    {BoneSemantic::RightUpperLeg, 1, {-0.09, -0.10, 0.0}},
    {BoneSemantic::RightLowerLeg, 19, {0.0, -0.40, 0.0}},
    {BoneSemantic::RightFoot, 20, {0.0, -0.40, 0.04}},
    {BoneSemantic::RightToes, 21, {0.0, 0.0, 0.16}},
}};

void require_exact_keys(const json& value, std::initializer_list<std::string_view> keys, std::string_view label) {
    if (!value.is_object()) {
        throw ContractError(std::string(label) + " must be an object");
    }
    std::set<std::string> expected;
    for (const auto key : keys) expected.emplace(key);
    std::set<std::string> actual;
    for (const auto& [key, unused] : value.items()) {
        (void)unused;
        actual.insert(key);
    }
    if (actual != expected) {
        throw ContractError(std::string(label) + " has missing or unknown fields");
    }
}

Vec3 read_vec3(const json& value, std::string_view label) {
    if (!value.is_array() || value.size() != 3) {
        throw ContractError(std::string(label) + " must contain three numbers");
    }
    Vec3 result{value.at(0).get<double>(), value.at(1).get<double>(), value.at(2).get<double>()};
    if (!std::isfinite(result.x) || !std::isfinite(result.y) || !std::isfinite(result.z)) {
        throw ContractError(std::string(label) + " must be finite");
    }
    return result;
}

}  // namespace

std::string_view to_string(BoneSemantic semantic) {
    static constexpr std::array<std::string_view, 23> names{{
        "sceneRoot", "hips", "spine", "chest", "upperChest", "neck", "head",
        "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
        "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
        "leftUpperLeg", "leftLowerLeg", "leftFoot", "leftToes",
        "rightUpperLeg", "rightLowerLeg", "rightFoot", "rightToes",
    }};
    return names.at(static_cast<std::size_t>(semantic));
}

BoneSemantic bone_semantic_from_string(std::string_view value) {
    for (const auto semantic : required_bone_semantics()) {
        if (to_string(semantic) == value) return semantic;
    }
    throw ContractError("unknown bone semantic: " + std::string(value));
}

const std::vector<BoneSemantic>& required_bone_semantics() {
    static const std::vector<BoneSemantic> values = [] {
        std::vector<BoneSemantic> result;
        result.reserve(kDefaultBones.size());
        for (const auto& bone : kDefaultBones) result.push_back(bone.semantic);
        return result;
    }();
    return values;
}

Skeleton make_default_skeleton() {
    Skeleton result;
    result.bones.reserve(kDefaultBones.size());
    for (const auto& bone : kDefaultBones) {
        result.bones.push_back({bone.semantic, bone.parent, bone.offset});
    }
    return result;
}

void validate_skeleton(const Skeleton& skeleton) {
    if (skeleton.schema_version != kSchemaVersion) throw ContractError("unsupported skeleton schema_version");
    if (skeleton.skeleton_id.empty()) throw ContractError("skeleton_id must not be empty");
    if (skeleton.bones.size() != required_bone_semantics().size()) {
        throw ContractError("canonical skeleton must contain exactly 23 enumerated semantics");
    }

    std::set<BoneSemantic> seen;
    for (std::size_t index = 0; index < skeleton.bones.size(); ++index) {
        const auto& bone = skeleton.bones[index];
        if (!seen.insert(bone.semantic).second) throw ContractError("duplicate bone semantic");
        if (bone.parent >= static_cast<int>(index)) throw ContractError("parent must precede child");
        if (index == 0 && bone.parent != -1) throw ContractError("sceneRoot must not have a parent");
        if (index != 0 && bone.parent < 0) throw ContractError("only sceneRoot may be parentless");
        if (!std::isfinite(bone.rest_offset_m.x) || !std::isfinite(bone.rest_offset_m.y) ||
            !std::isfinite(bone.rest_offset_m.z)) {
            throw ContractError("rest offsets must be finite");
        }
    }
    for (const auto semantic : required_bone_semantics()) {
        if (!seen.contains(semantic)) throw ContractError("missing required bone semantic");
    }

    const auto expected = make_default_skeleton();
    for (const auto& expected_bone : expected.bones) {
        const auto index = bone_index(skeleton, expected_bone.semantic);
        const auto& actual = skeleton.bones[index];
        const auto expected_parent_semantic = expected_bone.parent < 0
            ? BoneSemantic::SceneRoot
            : expected.bones[static_cast<std::size_t>(expected_bone.parent)].semantic;
        if (expected_bone.parent < 0) {
            if (actual.parent != -1) throw ContractError("invalid sceneRoot parent");
        } else if (actual.parent < 0 ||
                   skeleton.bones[static_cast<std::size_t>(actual.parent)].semantic != expected_parent_semantic) {
            throw ContractError("invalid canonical parent topology for " + std::string(to_string(actual.semantic)));
        }
    }
}

std::size_t bone_index(const Skeleton& skeleton, BoneSemantic semantic) {
    for (std::size_t index = 0; index < skeleton.bones.size(); ++index) {
        if (skeleton.bones[index].semantic == semantic) return index;
    }
    throw ContractError("bone semantic missing from skeleton");
}

void save_skeleton_json(const Skeleton& skeleton, const std::filesystem::path& path) {
    validate_skeleton(skeleton);
    json value{
        {"schema_version", skeleton.schema_version},
        {"skeleton_id", skeleton.skeleton_id},
        {"coordinate_system", {
            {"handedness", "right"}, {"up_axis", "Y"}, {"forward_axis", "Z"}, {"unit", "meter"}
        }},
        {"reference_pose", {{"type", "T_POSE"}, {"facing", "+Z"}}},
        {"bones", json::array()},
    };
    for (const auto& bone : skeleton.bones) {
        json parent = nullptr;
        if (bone.parent >= 0) parent = to_string(skeleton.bones[static_cast<std::size_t>(bone.parent)].semantic);
        value["bones"].push_back({
            {"semantic", to_string(bone.semantic)},
            {"parent", parent},
            {"rest_offset_m", {bone.rest_offset_m.x, bone.rest_offset_m.y, bone.rest_offset_m.z}},
        });
    }
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write skeleton: " + path.string());
    output << value.dump(2) << '\n';
}

Skeleton load_skeleton_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read skeleton: " + path.string());
    json value;
    input >> value;
    require_exact_keys(value, {"schema_version", "skeleton_id", "coordinate_system", "reference_pose", "bones"}, "skeleton");
    require_exact_keys(value.at("coordinate_system"), {"handedness", "up_axis", "forward_axis", "unit"}, "coordinate_system");
    require_exact_keys(value.at("reference_pose"), {"type", "facing"}, "reference_pose");
    const auto& coordinates = value.at("coordinate_system");
    if (coordinates.at("handedness") != "right" || coordinates.at("up_axis") != "Y" ||
        coordinates.at("forward_axis") != "Z" || coordinates.at("unit") != "meter") {
        throw ContractError("unsupported coordinate system");
    }
    if (value.at("reference_pose").at("type") != "T_POSE" ||
        value.at("reference_pose").at("facing") != "+Z") {
        throw ContractError("unsupported reference pose");
    }

    Skeleton result;
    result.schema_version = value.at("schema_version").get<std::string>();
    result.skeleton_id = value.at("skeleton_id").get<std::string>();
    const auto& bones = value.at("bones");
    if (!bones.is_array()) throw ContractError("bones must be an array");

    std::unordered_map<std::string, int> indices;
    for (const auto& bone_value : bones) {
        require_exact_keys(bone_value, {"semantic", "parent", "rest_offset_m"}, "bone");
        const auto name = bone_value.at("semantic").get<std::string>();
        const auto semantic = bone_semantic_from_string(name);
        if (indices.contains(name)) throw ContractError("duplicate bone semantic: " + name);
        int parent = -1;
        if (!bone_value.at("parent").is_null()) {
            const auto parent_name = bone_value.at("parent").get<std::string>();
            const auto found = indices.find(parent_name);
            if (found == indices.end()) throw ContractError("parent must precede child: " + parent_name);
            parent = found->second;
        }
        indices.emplace(name, static_cast<int>(result.bones.size()));
        result.bones.push_back({semantic, parent, read_vec3(bone_value.at("rest_offset_m"), "rest_offset_m")});
    }
    validate_skeleton(result);
    return result;
}

}  // namespace animocap
