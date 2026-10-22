#include "animocap/blender_exchange.hpp"

#include "animocap/contracts.hpp"
#include "animocap/hash.hpp"
#include "animocap/math.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <fstream>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace animocap {
namespace {

using json = nlohmann::json;

json vec3_json(const Vec3& value) {
    return json::array({value.x, value.y, value.z});
}

json quat_json(const Quat& value) {
    const auto normalized = normalize(value);
    return json::array({normalized.w, normalized.x, normalized.y, normalized.z});
}

std::string canonical_motion_sha256(const MotionPackage& package) {
    const auto& motion = package.motion;
    json bones = json::array();
    for (const auto& bone : package.skeleton.bones) {
        bones.push_back({
            {"semantic", std::string(to_string(bone.semantic))},
            {"parent", bone.parent},
            {"rest_offset_m", vec3_json(bone.rest_offset_m)},
        });
    }
    json document{
        {"skeleton_id", package.skeleton.skeleton_id},
        {"bones", std::move(bones)},
        {"fps", motion.fps},
        {"frame_count", motion.frame_count},
        {"time_s", motion.time_s},
        {"scene_root_translation_m", json::array()},
        {"scene_root_rotation", json::array()},
        {"local_rotations", json::array()},
        {"hips_translation_m", json::array()},
    };
    for (const auto& value : motion.scene_root_translation_m)
        document["scene_root_translation_m"].push_back(vec3_json(value));
    for (const auto& value : motion.scene_root_rotation)
        document["scene_root_rotation"].push_back(quat_json(value));
    for (const auto& value : motion.local_rotations)
        document["local_rotations"].push_back(quat_json(value));
    for (const auto& value : motion.hips_translation_m)
        document["hips_translation_m"].push_back(vec3_json(value));
    const auto serialized = document.dump();
    const std::vector<unsigned char> bytes(serialized.begin(), serialized.end());
    return sha256_bytes(std::span<const unsigned char>(bytes));
}

bool has_blender_exchange_suffix(const std::filesystem::path& path) {
    constexpr std::string_view suffix = ".animocap-blender.json";
    const auto filename = path.filename().string();
    return filename.size() >= suffix.size() &&
        filename.compare(filename.size() - suffix.size(), suffix.size(), suffix) == 0;
}

}  // namespace

void export_blender_selected_frames(
    const MotionPackage& package,
    const std::vector<std::size_t>& selected_frames,
    const std::filesystem::path& output,
    const BlenderSelectedFrameExportOptions& options
) {
    validate_skeleton(package.skeleton);
    validate_motion(package.motion, package.skeleton);
    if (!has_blender_exchange_suffix(output)) {
        throw ContractError("Blender selected-frame export must use .animocap-blender.json");
    }
    if (selected_frames.empty()) {
        throw ContractError("Blender selected-frame export requires at least one frame");
    }
    if (std::filesystem::exists(output) && !options.overwrite) {
        throw std::runtime_error("refusing to overwrite Blender selected-frame export: " +
                                 output.string());
    }

    std::vector<std::size_t> frames = selected_frames;
    std::sort(frames.begin(), frames.end());
    frames.erase(std::unique(frames.begin(), frames.end()), frames.end());
    for (const auto frame : frames) {
        if (frame >= package.motion.frame_count) {
            throw ContractError("Blender selected frame is outside Canonical Motion");
        }
    }

    json selected = json::array();
    for (const auto frame : frames) {
        json rotations = json::object();
        for (const auto semantic : required_bone_semantics()) {
            const auto joint = bone_index(package.skeleton, semantic);
            rotations[std::string(to_string(semantic))] = quat_json(
                package.motion.local_rotations[frame * package.motion.joint_count + joint]);
        }
        selected.push_back({
            {"source_frame", frame},
            {"time_s", package.motion.time_s[frame]},
            {"root_translation_m", vec3_json(package.motion.scene_root_translation_m[frame])},
            {"root_rotation", quat_json(package.motion.scene_root_rotation[frame])},
            {"hips_translation_m", vec3_json(package.motion.hips_translation_m[frame])},
            {"local_rotations", std::move(rotations)},
        });
    }

    const json document{
        {"schema", 1},
        {"source_motion_sha256", canonical_motion_sha256(package)},
        {"fps", package.motion.fps},
        {"selected_frames", std::move(selected)},
        {"skeleton_id", package.skeleton.skeleton_id},
        {"coordinate_contract", {
            {"unit", "meter"},
            {"handedness", "right"},
            {"up_axis", "Y"},
            {"forward_axis", "Z"},
            {"source", "canonical"},
        }},
    };

    if (!output.parent_path().empty())
        std::filesystem::create_directories(output.parent_path());
    std::ofstream stream(output, std::ios::binary | std::ios::trunc);
    if (!stream) throw std::runtime_error("cannot create Blender selected-frame export");
    stream << document.dump(2) << '\n';
    if (!stream) throw std::runtime_error("cannot write Blender selected-frame export");
}

}  // namespace animocap
