#include "animocap/export.hpp"

#include "animocap/hash.hpp"
#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <fstream>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace animocap {
namespace {

using json = nlohmann::json;
constexpr std::uint32_t kGlbMagic = 0x46546c67U;
constexpr std::uint32_t kGlbVersion = 2U;
constexpr std::uint32_t kJsonChunk = 0x4e4f534aU;
constexpr std::uint32_t kBinaryChunk = 0x004e4942U;
constexpr std::uint32_t kFloatComponent = 5126U;
constexpr std::size_t kBoneCount = 23;

std::vector<std::uint8_t> read_file(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read VRMA file: " + path.string());
    input.seekg(0, std::ios::end);
    const auto size = input.tellg();
    if (size < 0) throw std::runtime_error("cannot determine VRMA file size");
    input.seekg(0, std::ios::beg);
    std::vector<std::uint8_t> bytes(static_cast<std::size_t>(size));
    input.read(reinterpret_cast<char*>(bytes.data()), static_cast<std::streamsize>(size));
    if (!input && !bytes.empty()) throw std::runtime_error("cannot read VRMA file bytes");
    return bytes;
}

std::uint32_t read_u32(const std::vector<std::uint8_t>& bytes, std::size_t offset) {
    if (offset + 4U > bytes.size()) throw ContractError("truncated VRMA GLB header");
    return static_cast<std::uint32_t>(bytes[offset]) |
        (static_cast<std::uint32_t>(bytes[offset + 1U]) << 8U) |
        (static_cast<std::uint32_t>(bytes[offset + 2U]) << 16U) |
        (static_cast<std::uint32_t>(bytes[offset + 3U]) << 24U);
}

struct GlbDocument {
    json document;
    std::vector<std::uint8_t> binary;
};

GlbDocument parse_glb(const std::vector<std::uint8_t>& bytes) {
    if (bytes.size() < 20U || read_u32(bytes, 0U) != kGlbMagic ||
        read_u32(bytes, 4U) != kGlbVersion) {
        throw ContractError("VRMA must be a glTF 2.0 binary file");
    }
    const auto declared_size = static_cast<std::size_t>(read_u32(bytes, 8U));
    if (declared_size != bytes.size()) throw ContractError("VRMA GLB size mismatch");
    const auto json_size = static_cast<std::size_t>(read_u32(bytes, 12U));
    if (read_u32(bytes, 16U) != kJsonChunk || 20U + json_size + 8U > bytes.size()) {
        throw ContractError("VRMA JSON chunk is missing or truncated");
    }
    const std::string json_text(
        bytes.begin() + 20,
        bytes.begin() + 20 + static_cast<std::ptrdiff_t>(json_size));
    GlbDocument result;
    try {
        result.document = json::parse(json_text);
    } catch (const json::exception& error) {
        throw ContractError(std::string("invalid VRMA JSON: ") + error.what());
    }
    const auto binary_header = 20U + json_size;
    const auto binary_size = static_cast<std::size_t>(read_u32(bytes, binary_header));
    if (read_u32(bytes, binary_header + 4U) != kBinaryChunk ||
        binary_header + 8U + binary_size > bytes.size()) {
        throw ContractError("VRMA binary chunk is missing or truncated");
    }
    result.binary.assign(
        bytes.begin() + static_cast<std::ptrdiff_t>(binary_header + 8U),
        bytes.begin() + static_cast<std::ptrdiff_t>(binary_header + 8U + binary_size));
    return result;
}

std::size_t component_count(std::string_view type) {
    if (type == "SCALAR") return 1U;
    if (type == "VEC3") return 3U;
    if (type == "VEC4") return 4U;
    throw ContractError("unsupported VRMA accessor type: " + std::string(type));
}

struct AccessorData {
    std::size_t count{};
    std::size_t components{};
    std::vector<float> values;
};

AccessorData read_accessor(
    const json& document,
    const std::vector<std::uint8_t>& binary,
    std::size_t accessor_index,
    std::string_view expected_type
) {
    const auto& accessors = document.at("accessors");
    if (accessor_index >= accessors.size()) throw ContractError("VRMA accessor index is invalid");
    const auto& accessor = accessors.at(accessor_index);
    if (accessor.at("componentType").get<std::uint32_t>() != kFloatComponent ||
        accessor.at("type").get<std::string>() != expected_type) {
        throw ContractError("VRMA animation accessors must use FLOAT " + std::string(expected_type));
    }
    const auto view_index = accessor.at("bufferView").get<std::size_t>();
    const auto& views = document.at("bufferViews");
    if (view_index >= views.size()) throw ContractError("VRMA bufferView index is invalid");
    const auto& view = views.at(view_index);
    if (view.value("buffer", 0U) != 0U) throw ContractError("external VRMA buffers are unsupported");
    const auto count = accessor.at("count").get<std::size_t>();
    const auto components = component_count(expected_type);
    const auto element_size = components * sizeof(float);
    const auto stride = view.value("byteStride", element_size);
    if (stride < element_size) throw ContractError("VRMA accessor stride is too small");
    const auto start = view.value("byteOffset", 0U) + accessor.value("byteOffset", 0U);
    if (count > 0U && (start > binary.size() ||
        (count - 1U) * stride + element_size > binary.size() - start)) {
        throw ContractError("VRMA accessor exceeds its binary buffer");
    }
    AccessorData result{count, components, {}};
    result.values.resize(count * components);
    for (std::size_t item = 0; item < count; ++item) {
        for (std::size_t component = 0; component < components; ++component) {
            std::memcpy(
                &result.values[item * components + component],
                binary.data() + start + item * stride + component * sizeof(float),
                sizeof(float));
        }
    }
    return result;
}

Vec3 read_node_translation(const json& node) {
    if (!node.contains("translation")) return {};
    const auto& value = node.at("translation");
    if (!value.is_array() || value.size() != 3U) {
        throw ContractError("VRMA node translation must contain three values");
    }
    return {value.at(0).get<double>(), value.at(1).get<double>(), value.at(2).get<double>()};
}

std::vector<double> accessor_times(const AccessorData& accessor) {
    std::vector<double> times;
    times.reserve(accessor.count);
    for (const auto value : accessor.values) {
        if (!std::isfinite(value)) throw ContractError("VRMA animation time must be finite");
        times.push_back(value);
    }
    for (std::size_t index = 1; index < times.size(); ++index) {
        if (!(times[index] > times[index - 1U])) {
            throw ContractError("VRMA animation times must be strictly increasing");
        }
    }
    return times;
}

void require_matching_times(
    std::vector<double>& shared,
    const std::vector<double>& candidate
) {
    if (shared.empty()) {
        shared = candidate;
        return;
    }
    if (shared.size() != candidate.size()) {
        throw ContractError("VRMA channels must share one frame timeline");
    }
    for (std::size_t index = 0; index < shared.size(); ++index) {
        if (std::abs(shared[index] - candidate[index]) > 1e-5) {
            throw ContractError("VRMA channels with different key times are unsupported");
        }
    }
}

}  // namespace

MotionPackage import_vrma(const std::filesystem::path& input_path) {
    const auto bytes = read_file(input_path);
    auto glb = parse_glb(bytes);
    const auto& document = glb.document;
    if (document.at("asset").at("version") != "2.0") {
        throw ContractError("VRMA requires glTF asset version 2.0");
    }
    const auto& extension = document.at("extensions").at("VRMC_vrm_animation");
    if (extension.at("specVersion") != "1.0") {
        throw ContractError("unsupported VRM Animation specVersion");
    }
    const auto& nodes = document.at("nodes");
    const auto& human_bones = extension.at("humanoid").at("humanBones");

    std::array<std::optional<std::size_t>, kBoneCount> semantic_nodes;
    std::vector<std::optional<BoneSemantic>> node_semantics(nodes.size());
    for (const auto semantic : required_bone_semantics()) {
        if (semantic == BoneSemantic::SceneRoot) continue;
        const auto name = std::string(to_string(semantic));
        if (!human_bones.contains(name)) {
            throw ContractError("VRMA is missing canonical human bone: " + name);
        }
        const auto node = human_bones.at(name).at("node").get<std::size_t>();
        if (node >= nodes.size() || node_semantics[node]) {
            throw ContractError("VRMA human bone node mapping is invalid");
        }
        semantic_nodes[static_cast<std::size_t>(semantic)] = node;
        node_semantics[node] = semantic;
    }

    std::vector<std::optional<std::size_t>> node_parents(nodes.size());
    for (std::size_t parent = 0; parent < nodes.size(); ++parent) {
        if (!nodes[parent].contains("children")) continue;
        for (const auto& child_value : nodes[parent].at("children")) {
            const auto child = child_value.get<std::size_t>();
            if (child >= nodes.size() || node_parents[child]) {
                throw ContractError("VRMA node hierarchy is invalid");
            }
            node_parents[child] = parent;
        }
    }

    auto skeleton = make_default_skeleton();
    skeleton.skeleton_id = "animocap_vrma_import_v1";
    const auto expected = make_default_skeleton();
    for (const auto semantic : required_bone_semantics()) {
        if (semantic == BoneSemantic::SceneRoot) continue;
        const auto index = bone_index(skeleton, semantic);
        const auto node = *semantic_nodes[static_cast<std::size_t>(semantic)];
        skeleton.bones[index].rest_offset_m = read_node_translation(nodes.at(node));
        if (semantic == BoneSemantic::Hips) {
            if (!node_parents[node] || node_semantics[*node_parents[node]]) {
                throw ContractError("VRMA Hips must be parented by a non-humanoid root node");
            }
        } else {
            const auto expected_parent = expected.bones[static_cast<std::size_t>(
                expected.bones[index].parent)].semantic;
            const auto parent_node = semantic_nodes[static_cast<std::size_t>(expected_parent)];
            if (!node_parents[node] || !parent_node || *node_parents[node] != *parent_node) {
                throw ContractError(
                    "unsupported VRMA parent topology for " + std::string(to_string(semantic)));
            }
        }
    }
    validate_skeleton(skeleton);

    const auto& animation = document.at("animations").at(0);
    const auto& samplers = animation.at("samplers");
    std::vector<double> shared_times;
    std::array<std::vector<Quat>, kBoneCount> rotations;
    std::vector<Vec3> hips_positions;
    for (const auto& channel : animation.at("channels")) {
        const auto sampler_index = channel.at("sampler").get<std::size_t>();
        if (sampler_index >= samplers.size()) throw ContractError("VRMA sampler index is invalid");
        const auto& sampler = samplers.at(sampler_index);
        if (sampler.value("interpolation", std::string("LINEAR")) != "LINEAR") {
            throw ContractError("only LINEAR VRMA animation interpolation is supported");
        }
        const auto node = channel.at("target").at("node").get<std::size_t>();
        if (node >= node_semantics.size() || !node_semantics[node]) continue;
        const auto semantic = *node_semantics[node];
        const auto path = channel.at("target").at("path").get<std::string>();
        const auto input_accessor = read_accessor(
            document, glb.binary, sampler.at("input").get<std::size_t>(), "SCALAR");
        const auto times = accessor_times(input_accessor);
        require_matching_times(shared_times, times);
        if (path == "rotation") {
            const auto values = read_accessor(
                document, glb.binary, sampler.at("output").get<std::size_t>(), "VEC4");
            if (values.count != times.size()) throw ContractError("VRMA rotation sample count mismatch");
            auto& target = rotations[static_cast<std::size_t>(semantic)];
            if (!target.empty()) throw ContractError("duplicate VRMA rotation channel");
            target.reserve(values.count);
            for (std::size_t frame = 0; frame < values.count; ++frame) {
                target.push_back(normalize({
                    values.values[frame * 4U + 3U],
                    values.values[frame * 4U],
                    values.values[frame * 4U + 1U],
                    values.values[frame * 4U + 2U],
                }));
            }
        } else if (path == "translation" && semantic == BoneSemantic::Hips) {
            const auto values = read_accessor(
                document, glb.binary, sampler.at("output").get<std::size_t>(), "VEC3");
            if (values.count != times.size()) throw ContractError("VRMA translation sample count mismatch");
            if (!hips_positions.empty()) throw ContractError("duplicate VRMA Hips translation channel");
            hips_positions.reserve(values.count);
            for (std::size_t frame = 0; frame < values.count; ++frame) {
                hips_positions.push_back({
                    values.values[frame * 3U],
                    values.values[frame * 3U + 1U],
                    values.values[frame * 3U + 2U],
                });
            }
        }
    }
    if (shared_times.empty() || hips_positions.size() != shared_times.size()) {
        throw ContractError("VRMA is missing its Hips translation timeline");
    }
    for (const auto semantic : required_bone_semantics()) {
        if (semantic == BoneSemantic::SceneRoot) continue;
        if (rotations[static_cast<std::size_t>(semantic)].size() != shared_times.size()) {
            throw ContractError(
                "VRMA is missing rotation animation for " + std::string(to_string(semantic)));
        }
    }

    MotionPackage result;
    result.skeleton = skeleton;
    auto& motion = result.motion;
    motion.skeleton_id = skeleton.skeleton_id;
    motion.frame_count = shared_times.size();
    motion.joint_count = skeleton.bones.size();
    motion.fps = shared_times.size() > 1U
        ? static_cast<double>(shared_times.size() - 1U) /
            (shared_times.back() - shared_times.front())
        : 30.0;
    motion.time_s.reserve(motion.frame_count);
    motion.scene_root_translation_m.reserve(motion.frame_count);
    motion.scene_root_rotation.assign(motion.frame_count, {});
    motion.local_rotations.assign(motion.frame_count * motion.joint_count, {});
    motion.hips_translation_m.assign(motion.frame_count, {});
    motion.confidence.assign(motion.frame_count * motion.joint_count, 1.0f);
    motion.valid_mask.assign(motion.frame_count * motion.joint_count, 1U);
    motion.foot_contacts.assign(motion.frame_count * 2U, 0U);
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
        motion.time_s.push_back(shared_times[frame] - shared_times.front());
        const auto hips_rotation = rotations[static_cast<std::size_t>(BoneSemantic::Hips)][frame];
        motion.scene_root_translation_m.push_back(
            hips_positions[frame] - rotate(hips_rotation, skeleton.bones[hips].rest_offset_m));
        for (const auto semantic : required_bone_semantics()) {
            if (semantic == BoneSemantic::SceneRoot) continue;
            const auto joint = bone_index(skeleton, semantic);
            motion.local_rotations[frame * motion.joint_count + joint] =
                rotations[static_cast<std::size_t>(semantic)][frame];
        }
    }
    const auto source_hash = sha256_file(input_path);
    motion.provenance.code_version = ANIMOCAP_VERSION;
    motion.provenance.config_sha256 = source_hash;
    motion.provenance.source_sha256 = {source_hash};
    motion.provenance.model_id = "vrma-import";
    validate_motion(motion, result.skeleton);
    return result;
}

}  // namespace animocap
