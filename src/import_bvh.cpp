#include "animocap/export.hpp"

#include "animocap/hash.hpp"
#include "animocap/math.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace animocap {
namespace {

constexpr double kPi = 3.141592653589793238462643383279502884;
constexpr std::size_t kBoneCount = 23;

struct BvhJoint {
    BoneSemantic semantic{};
    std::optional<BoneSemantic> parent;
    Vec3 offset{};
    std::vector<std::string> channels;
};

struct BvhDocument {
    std::array<std::optional<BvhJoint>, kBoneCount> joints;
    std::vector<BoneSemantic> channel_order;
};

std::size_t semantic_slot(BoneSemantic semantic) {
    return static_cast<std::size_t>(semantic);
}

void expect(std::istream& input, std::string_view expected) {
    std::string actual;
    if (!(input >> actual) || actual != expected) {
        throw ContractError(
            "invalid BVH: expected " + std::string(expected) +
            (actual.empty() ? "" : ", found " + actual));
    }
}

BoneSemantic parse_semantic(std::string name) {
    if (!name.empty() && name.front() >= 'A' && name.front() <= 'Z') {
        name.front() = static_cast<char>(name.front() - 'A' + 'a');
    }
    try {
        return bone_semantic_from_string(name);
    } catch (const ContractError&) {
        throw ContractError(
            "unsupported BVH joint '" + name +
            "'; expected AniMocap canonical humanoid joint names");
    }
}

void parse_end_site(std::istream& input) {
    expect(input, "Site");
    expect(input, "{");
    expect(input, "OFFSET");
    double unused{};
    if (!(input >> unused >> unused >> unused)) {
        throw ContractError("invalid BVH End Site offset");
    }
    expect(input, "}");
}

void parse_joint(
    std::istream& input,
    std::string_view kind,
    std::optional<BoneSemantic> parent,
    BvhDocument& document
) {
    std::string name;
    if (!(input >> name)) throw ContractError("invalid BVH joint declaration");
    const auto semantic = parse_semantic(name);
    if (semantic == BoneSemantic::SceneRoot) {
        throw ContractError("BVH hierarchy must start at Hips, not SceneRoot");
    }
    if (kind == "ROOT" && semantic != BoneSemantic::Hips) {
        throw ContractError("BVH ROOT must use the canonical Hips joint");
    }
    const auto slot = semantic_slot(semantic);
    if (document.joints[slot]) {
        throw ContractError("duplicate BVH joint: " + name);
    }

    expect(input, "{");
    expect(input, "OFFSET");
    BvhJoint joint;
    joint.semantic = semantic;
    joint.parent = parent;
    if (!(input >> joint.offset.x >> joint.offset.y >> joint.offset.z) ||
        !std::isfinite(joint.offset.x) || !std::isfinite(joint.offset.y) ||
        !std::isfinite(joint.offset.z)) {
        throw ContractError("invalid BVH joint offset: " + name);
    }
    expect(input, "CHANNELS");
    std::size_t channel_count{};
    if (!(input >> channel_count) || channel_count > 9U) {
        throw ContractError("invalid BVH channel count: " + name);
    }
    joint.channels.resize(channel_count);
    for (auto& channel : joint.channels) {
        if (!(input >> channel)) throw ContractError("truncated BVH channels");
    }
    document.joints[slot] = joint;
    document.channel_order.push_back(semantic);

    while (true) {
        std::string token;
        if (!(input >> token)) throw ContractError("truncated BVH hierarchy");
        if (token == "}") break;
        if (token == "JOINT") {
            parse_joint(input, token, semantic, document);
        } else if (token == "End") {
            parse_end_site(input);
        } else {
            throw ContractError("invalid BVH hierarchy token: " + token);
        }
    }
}

Quat rotation_channel(std::string_view channel, double degrees) {
    const double radians = degrees * kPi / 180.0;
    if (channel == "Xrotation") return from_axis_angle({1.0, 0.0, 0.0}, radians);
    if (channel == "Yrotation") return from_axis_angle({0.0, 1.0, 0.0}, radians);
    if (channel == "Zrotation") return from_axis_angle({0.0, 0.0, 1.0}, radians);
    throw ContractError("unsupported BVH rotation channel: " + std::string(channel));
}

double offset_length(const Vec3& value) {
    return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

MotionPackage make_package(
    const std::filesystem::path& input_path,
    const BvhDocument& document,
    std::istream& input
) {
    expect(input, "MOTION");
    expect(input, "Frames:");
    std::size_t frame_count{};
    if (!(input >> frame_count) || frame_count == 0U) {
        throw ContractError("BVH must contain at least one frame");
    }
    expect(input, "Frame");
    expect(input, "Time:");
    double frame_time{};
    if (!(input >> frame_time) || !std::isfinite(frame_time) || frame_time <= 0.0) {
        throw ContractError("BVH Frame Time must be positive");
    }

    auto skeleton = make_default_skeleton();
    skeleton.skeleton_id = "animocap_bvh_import_v1";
    double largest_offset{};
    for (const auto& value : document.joints) {
        if (value) largest_offset = std::max(largest_offset, offset_length(value->offset));
    }
    const double unit_scale = largest_offset > 3.0 ? 0.01 : 1.0;

    const auto expected = make_default_skeleton();
    for (const auto semantic : required_bone_semantics()) {
        if (semantic == BoneSemantic::SceneRoot) continue;
        const auto& parsed = document.joints[semantic_slot(semantic)];
        if (!parsed) {
            throw ContractError(
                "BVH is missing canonical joint: " + std::string(to_string(semantic)));
        }
        const auto index = bone_index(skeleton, semantic);
        const auto expected_parent = expected.bones[index].parent < 0
            ? BoneSemantic::SceneRoot
            : expected.bones[static_cast<std::size_t>(expected.bones[index].parent)].semantic;
        const auto actual_parent = parsed->parent.value_or(BoneSemantic::SceneRoot);
        if (actual_parent != expected_parent) {
            throw ContractError(
                "unsupported BVH parent topology for " + std::string(to_string(semantic)));
        }
        const Vec3 imported_offset{
            parsed->offset.x * unit_scale,
            parsed->offset.y * unit_scale,
            parsed->offset.z * unit_scale,
        };
        if (semantic != BoneSemantic::Hips || offset_length(imported_offset) > 1e-6) {
            skeleton.bones[index].rest_offset_m = imported_offset;
        }
    }
    validate_skeleton(skeleton);

    MotionPackage result;
    result.skeleton = skeleton;
    auto& motion = result.motion;
    motion.skeleton_id = skeleton.skeleton_id;
    motion.fps = 1.0 / frame_time;
    motion.frame_count = frame_count;
    motion.joint_count = skeleton.bones.size();
    motion.time_s.reserve(frame_count);
    motion.scene_root_translation_m.reserve(frame_count);
    motion.scene_root_rotation.assign(frame_count, {});
    motion.local_rotations.assign(frame_count * motion.joint_count, {});
    motion.hips_translation_m.assign(frame_count, {});
    motion.confidence.assign(frame_count * motion.joint_count, 1.0f);
    motion.valid_mask.assign(frame_count * motion.joint_count, 1U);
    motion.foot_contacts.assign(frame_count * 2U, 0U);

    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        std::vector<Quat> rotations(motion.joint_count);
        Vec3 root_position{};
        for (const auto semantic : document.channel_order) {
            const auto& joint = *document.joints[semantic_slot(semantic)];
            Quat rotation{};
            for (const auto& channel : joint.channels) {
                double value{};
                if (!(input >> value) || !std::isfinite(value)) {
                    throw ContractError("truncated or invalid BVH motion values");
                }
                const bool position_channel = channel == "Xposition" ||
                    channel == "Yposition" || channel == "Zposition";
                if (position_channel && semantic != BoneSemantic::Hips) {
                    throw ContractError("BVH position channels are only supported on Hips");
                }
                if (channel == "Xposition") root_position.x = value * unit_scale;
                else if (channel == "Yposition") root_position.y = value * unit_scale;
                else if (channel == "Zposition") root_position.z = value * unit_scale;
                else if (channel.ends_with("rotation")) {
                    rotation = normalize(multiply(rotation, rotation_channel(channel, value)));
                } else {
                    throw ContractError("unsupported BVH channel: " + channel);
                }
            }
            rotations[bone_index(skeleton, semantic)] = rotation;
        }
        const auto hips_rotation = rotations[hips];
        motion.time_s.push_back(static_cast<double>(frame) * frame_time);
        motion.scene_root_translation_m.push_back(
            root_position - rotate(hips_rotation, skeleton.bones[hips].rest_offset_m));
        for (std::size_t joint = 0; joint < motion.joint_count; ++joint) {
            motion.local_rotations[frame * motion.joint_count + joint] = rotations[joint];
        }
    }
    const auto source_hash = sha256_file(input_path);
    motion.provenance.code_version = ANIMOCAP_VERSION;
    motion.provenance.config_sha256 = source_hash;
    motion.provenance.source_sha256 = {source_hash};
    motion.provenance.model_id = "bvh-import";
    validate_motion(motion, result.skeleton);
    return result;
}

}  // namespace

MotionPackage import_bvh(const std::filesystem::path& input_path) {
    std::ifstream input(input_path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read BVH file: " + input_path.string());
    expect(input, "HIERARCHY");
    expect(input, "ROOT");
    BvhDocument document;
    parse_joint(input, "ROOT", BoneSemantic::SceneRoot, document);
    return make_package(input_path, document, input);
}

}  // namespace animocap
