#include "animocap/export.hpp"

#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>
#include <string>
#include <vector>

namespace animocap {
namespace {

using json = nlohmann::json;
constexpr std::uint32_t kGlbMagic = 0x46546c67U;
constexpr std::uint32_t kGlbVersion = 2U;
constexpr std::uint32_t kJsonChunk = 0x4e4f534aU;
constexpr std::uint32_t kBinaryChunk = 0x004e4942U;
constexpr std::uint32_t kFloatComponent = 5126U;

void append_u32(std::vector<std::uint8_t>& bytes, std::uint32_t value) {
    bytes.push_back(static_cast<std::uint8_t>(value & 0xffU));
    bytes.push_back(static_cast<std::uint8_t>((value >> 8U) & 0xffU));
    bytes.push_back(static_cast<std::uint8_t>((value >> 16U) & 0xffU));
    bytes.push_back(static_cast<std::uint8_t>((value >> 24U) & 0xffU));
}

void append_float(std::vector<std::uint8_t>& bytes, float value) {
    std::uint32_t bits{};
    static_assert(sizeof(bits) == sizeof(value));
    std::memcpy(&bits, &value, sizeof(value));
    append_u32(bytes, bits);
}

void align_four(std::vector<std::uint8_t>& bytes, std::uint8_t padding = 0U) {
    while (bytes.size() % 4U != 0U) bytes.push_back(padding);
}

std::string node_name(BoneSemantic semantic) {
    std::string result(to_string(semantic));
    if (!result.empty() && result.front() >= 'a' && result.front() <= 'z') {
        result.front() = static_cast<char>(result.front() - 'a' + 'A');
    }
    return result;
}

struct GltfBinaryBuilder {
    std::vector<std::uint8_t> bytes;
    json buffer_views = json::array();
    json accessors = json::array();

    std::size_t add_accessor(
        const std::vector<float>& values,
        std::size_t count,
        std::string_view type,
        const std::optional<std::pair<float, float>>& range = {}
    ) {
        align_four(bytes);
        const auto offset = bytes.size();
        for (const auto value : values) append_float(bytes, value);
        const auto view = buffer_views.size();
        buffer_views.push_back({
            {"buffer", 0},
            {"byteOffset", offset},
            {"byteLength", bytes.size() - offset},
        });
        json accessor{
            {"bufferView", view},
            {"componentType", kFloatComponent},
            {"count", count},
            {"type", type},
        };
        if (range) {
            accessor["min"] = {range->first};
            accessor["max"] = {range->second};
        }
        const auto index = accessors.size();
        accessors.push_back(std::move(accessor));
        return index;
    }
};

}  // namespace

void export_vrma(
    const MotionPackage& package,
    const std::filesystem::path& output_path,
    const VrmaExportOptions& options
) {
    validate_motion(package.motion, package.skeleton);
    if (output_path.empty()) throw ContractError("VRMA output path must not be empty");
    auto extension = output_path.extension().string();
    std::transform(extension.begin(), extension.end(), extension.begin(), [](unsigned char value) {
        return static_cast<char>(std::tolower(value));
    });
    if (extension != ".vrma") throw ContractError("VRMA output path must use the .vrma extension");
    if (std::filesystem::exists(output_path) && !options.overwrite) {
        throw std::runtime_error("refusing to overwrite existing VRMA file: " + output_path.string());
    }

    const auto& skeleton = package.skeleton;
    const auto& motion = package.motion;
    const auto scene_root = bone_index(skeleton, BoneSemantic::SceneRoot);
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    if (skeleton.bones[hips].parent != static_cast<int>(scene_root)) {
        throw ContractError("VRMA export requires hips to be a direct child of sceneRoot");
    }

    json nodes = json::array();
    nodes.push_back({{"name", "Root"}, {"children", json::array()}});
    std::vector<std::size_t> node_indices(skeleton.bones.size(), 0);
    for (std::size_t joint = 0; joint < skeleton.bones.size(); ++joint) {
        if (joint == scene_root) continue;
        node_indices[joint] = nodes.size();
        const auto& offset = skeleton.bones[joint].rest_offset_m;
        nodes.push_back({
            {"name", node_name(skeleton.bones[joint].semantic)},
            {"translation", {offset.x, offset.y, offset.z}},
        });
    }
    nodes[0]["children"].push_back(node_indices[hips]);
    for (std::size_t joint = 0; joint < skeleton.bones.size(); ++joint) {
        if (joint == scene_root || joint == hips) continue;
        const auto parent = static_cast<std::size_t>(skeleton.bones[joint].parent);
        auto& parent_node = nodes[node_indices[parent]];
        if (!parent_node.contains("children")) parent_node["children"] = json::array();
        parent_node["children"].push_back(node_indices[joint]);
    }

    json human_bones = json::object();
    for (std::size_t joint = 0; joint < skeleton.bones.size(); ++joint) {
        if (joint == scene_root) continue;
        human_bones[std::string(to_string(skeleton.bones[joint].semantic))] = {
            {"node", node_indices[joint]},
        };
    }

    GltfBinaryBuilder binary;
    std::vector<float> times;
    times.reserve(motion.frame_count);
    const double first_time = motion.time_s.front();
    for (const auto time : motion.time_s) times.push_back(static_cast<float>(time - first_time));
    const auto time_accessor = binary.add_accessor(
        times, motion.frame_count, "SCALAR",
        std::pair<float, float>{times.front(), times.back()});

    json samplers = json::array();
    json channels = json::array();
    const auto local = [&](std::size_t frame, std::size_t joint) -> const Quat& {
        return motion.local_rotations[frame * motion.joint_count + joint];
    };
    for (std::size_t joint = 0; joint < skeleton.bones.size(); ++joint) {
        if (joint == scene_root) continue;
        std::vector<Quat> rotations;
        rotations.reserve(motion.frame_count);
        for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
            if (joint == hips) {
                const auto world = normalize(multiply(
                    motion.scene_root_rotation[frame], local(frame, scene_root)));
                rotations.push_back(normalize(multiply(world, local(frame, hips))));
            } else {
                rotations.push_back(local(frame, joint));
            }
        }
        enforce_quaternion_continuity(rotations);
        std::vector<float> values;
        values.reserve(rotations.size() * 4U);
        for (const auto& rotation : rotations) {
            values.insert(values.end(), {
                static_cast<float>(rotation.x), static_cast<float>(rotation.y),
                static_cast<float>(rotation.z), static_cast<float>(rotation.w),
            });
        }
        const auto output_accessor = binary.add_accessor(
            values, motion.frame_count, "VEC4");
        const auto sampler = samplers.size();
        samplers.push_back({
            {"input", time_accessor}, {"output", output_accessor}, {"interpolation", "LINEAR"},
        });
        channels.push_back({
            {"sampler", sampler},
            {"target", {{"node", node_indices[joint]}, {"path", "rotation"}}},
        });
    }

    std::vector<float> translations;
    translations.reserve(motion.frame_count * 3U);
    for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
        const auto world = normalize(multiply(
            motion.scene_root_rotation[frame], local(frame, scene_root)));
        const Vec3 hips_local = skeleton.bones[hips].rest_offset_m + motion.hips_translation_m[frame];
        const Vec3 position = motion.scene_root_translation_m[frame] +
            skeleton.bones[scene_root].rest_offset_m + rotate(world, hips_local);
        translations.insert(translations.end(), {
            static_cast<float>(position.x), static_cast<float>(position.y),
            static_cast<float>(position.z),
        });
    }
    const auto translation_accessor = binary.add_accessor(
        translations, motion.frame_count, "VEC3");
    const auto translation_sampler = samplers.size();
    samplers.push_back({
        {"input", time_accessor}, {"output", translation_accessor}, {"interpolation", "LINEAR"},
    });
    channels.push_back({
        {"sampler", translation_sampler},
        {"target", {{"node", node_indices[hips]}, {"path", "translation"}}},
    });

    json document{
        {"asset", {{"version", "2.0"}, {"generator", "AniMocap Fusion " ANIMOCAP_VERSION}}},
        {"extensionsUsed", {"VRMC_vrm_animation"}},
        {"extensionsRequired", {"VRMC_vrm_animation"}},
        {"extensions", {{"VRMC_vrm_animation", {
            {"specVersion", "1.0"},
            {"humanoid", {{"humanBones", std::move(human_bones)}}},
        }}}},
        {"scene", 0},
        {"scenes", {{{"nodes", {0}}}}},
        {"nodes", std::move(nodes)},
        {"animations", {{{
            "name", "AniMocap Motion"
        }, {
            "samplers", std::move(samplers)
        }, {
            "channels", std::move(channels)
        }}}},
        {"bufferViews", std::move(binary.buffer_views)},
        {"accessors", std::move(binary.accessors)},
        {"buffers", {{{"byteLength", binary.bytes.size()}}}},
    };

    auto json_text = document.dump();
    while (json_text.size() % 4U != 0U) json_text.push_back(' ');
    align_four(binary.bytes);
    const std::uint64_t total_size = 12ULL + 8ULL + json_text.size() + 8ULL + binary.bytes.size();
    if (total_size > std::numeric_limits<std::uint32_t>::max()) {
        throw ContractError("VRMA output exceeds the GLB 4 GiB limit");
    }
    std::vector<std::uint8_t> glb;
    glb.reserve(static_cast<std::size_t>(total_size));
    append_u32(glb, kGlbMagic);
    append_u32(glb, kGlbVersion);
    append_u32(glb, static_cast<std::uint32_t>(total_size));
    append_u32(glb, static_cast<std::uint32_t>(json_text.size()));
    append_u32(glb, kJsonChunk);
    glb.insert(glb.end(), json_text.begin(), json_text.end());
    append_u32(glb, static_cast<std::uint32_t>(binary.bytes.size()));
    append_u32(glb, kBinaryChunk);
    glb.insert(glb.end(), binary.bytes.begin(), binary.bytes.end());

    if (!output_path.parent_path().empty()) {
        std::filesystem::create_directories(output_path.parent_path());
    }
    std::ofstream output(output_path, std::ios::binary | std::ios::trunc);
    if (!output) throw std::runtime_error("cannot write VRMA file: " + output_path.string());
    output.write(reinterpret_cast<const char*>(glb.data()), static_cast<std::streamsize>(glb.size()));
    if (!output) throw std::runtime_error("failed while writing VRMA file: " + output_path.string());
}

}  // namespace animocap
