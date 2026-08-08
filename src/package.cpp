#include "animocap/package.hpp"

#include "animocap/hash.hpp"
#include "animocap/npy.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <fstream>
#include <set>
#include <type_traits>

namespace animocap {
namespace {

using json = nlohmann::json;

void require_exact_keys(const json& value, std::initializer_list<std::string_view> keys, std::string_view label) {
    if (!value.is_object()) throw ContractError(std::string(label) + " must be an object");
    std::set<std::string> expected;
    for (const auto key : keys) expected.emplace(key);
    std::set<std::string> actual;
    for (const auto& [key, unused] : value.items()) {
        (void)unused;
        actual.insert(key);
    }
    if (actual != expected) throw ContractError(std::string(label) + " has missing or unknown fields");
}

template <typename T>
void require_array(const NpyArray& array, NpyDType dtype, std::initializer_list<std::size_t> shape, std::string_view name) {
    if (array.dtype != dtype || array.shape != std::vector<std::size_t>(shape)) {
        throw ContractError(std::string(name) + " has wrong dtype or shape");
    }
    if (array.bytes.size() % sizeof(T) != 0) throw ContractError(std::string(name) + " byte size is invalid");
}

std::vector<double> flatten_vec3(const std::vector<Vec3>& values) {
    std::vector<double> result;
    result.reserve(values.size() * 3);
    for (const auto& value : values) {
        result.insert(result.end(), {value.x, value.y, value.z});
    }
    return result;
}

std::vector<double> flatten_quat(const std::vector<Quat>& values) {
    std::vector<double> result;
    result.reserve(values.size() * 4);
    for (const auto& value : values) {
        result.insert(result.end(), {value.w, value.x, value.y, value.z});
    }
    return result;
}

std::vector<Vec3> unflatten_vec3(const std::vector<double>& values) {
    if (values.size() % 3 != 0) throw ContractError("Vec3 array size is invalid");
    std::vector<Vec3> result;
    result.reserve(values.size() / 3);
    for (std::size_t index = 0; index < values.size(); index += 3) {
        result.push_back({values[index], values[index + 1], values[index + 2]});
    }
    return result;
}

std::vector<Quat> unflatten_quat(const std::vector<double>& values) {
    if (values.size() % 4 != 0) throw ContractError("quaternion array size is invalid");
    std::vector<Quat> result;
    result.reserve(values.size() / 4);
    for (std::size_t index = 0; index < values.size(); index += 4) {
        result.push_back({values[index], values[index + 1], values[index + 2], values[index + 3]});
    }
    return result;
}

json provenance_json(const Provenance& provenance) {
    return {
        {"code_version", provenance.code_version},
        {"config_sha256", provenance.config_sha256},
        {"source_sha256", provenance.source_sha256},
        {"model_id", provenance.model_id},
        {"model_weights_sha256", provenance.model_weights_sha256},
    };
}

Provenance parse_provenance(const json& value) {
    require_exact_keys(value, {"code_version", "config_sha256", "source_sha256", "model_id", "model_weights_sha256"}, "provenance");
    return {
        value.at("code_version").get<std::string>(),
        value.at("config_sha256").get<std::string>(),
        value.at("source_sha256").get<std::vector<std::string>>(),
        value.at("model_id").get<std::string>(),
        value.at("model_weights_sha256").get<std::string>(),
    };
}

json camera_json(const Camera& camera) {
    validate_camera(camera);
    return {
        {"id", camera.id},
        {"yaw_degrees", camera.yaw_degrees},
        {"pitch_degrees", camera.pitch_degrees},
        {"scale_pixels_per_meter", camera.scale_pixels_per_meter},
        {"principal_point", {camera.principal_point.x, camera.principal_point.y}},
    };
}

Camera parse_camera(const json& value) {
    require_exact_keys(value, {
        "id", "yaw_degrees", "pitch_degrees", "scale_pixels_per_meter", "principal_point"
    }, "camera");
    const auto& point = value.at("principal_point");
    if (!point.is_array() || point.size() != 2) {
        throw ContractError("camera principal_point must have shape [2]");
    }
    Camera camera{
        value.at("id").get<std::string>(),
        value.at("yaw_degrees").get<double>(),
        value.at("pitch_degrees").get<double>(),
        value.at("scale_pixels_per_meter").get<double>(),
        {point.at(0).get<double>(), point.at(1).get<double>()},
    };
    validate_camera(camera);
    return camera;
}

void write_json(const std::filesystem::path& path, const json& value) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write JSON file: " + path.string());
    output << value.dump(2) << '\n';
}

json read_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read JSON file: " + path.string());
    json value;
    input >> value;
    return value;
}

}  // namespace

void save_motion_package(const MotionPackage& package, const std::filesystem::path& directory) {
    validate_motion(package.motion, package.skeleton);
    std::set<std::string> validated_camera_ids;
    for (const auto& camera : package.cameras) {
        validate_camera(camera);
        if (!validated_camera_ids.insert(camera.id).second) {
            throw ContractError("duplicate camera id: " + camera.id);
        }
    }
    if (std::filesystem::exists(directory)) {
        throw std::runtime_error("refusing to overwrite existing motion package: " + directory.string());
    }
    std::filesystem::create_directories(directory);

    const auto frames = package.motion.frame_count;
    const auto joints = package.motion.joint_count;
    save_skeleton_json(package.skeleton, directory / "skeleton.json");
    write_json(directory / "provenance.json", provenance_json(package.motion.provenance));

    const json arrays{
        {"time_s", "time_s.npy"},
        {"scene_root_translation_m", "scene_root_translation_m.npy"},
        {"scene_root_rotation_wxyz", "scene_root_rotation_wxyz.npy"},
        {"local_rotations_wxyz", "local_rotations_wxyz.npy"},
        {"hips_translation_m", "hips_translation_m.npy"},
        {"confidence", "confidence.npy"},
        {"valid_mask", "valid_mask.npy"},
        {"foot_contacts", "foot_contacts.npy"},
    };
    const json manifest{
        {"schema_version", package.motion.schema_version},
        {"package_type", "animocap.canonical_motion"},
        {"motion_variant", "raw"},
        {"skeleton_id", package.motion.skeleton_id},
        {"fps", package.motion.fps},
        {"frame_count", frames},
        {"joint_count", joints},
        {"coordinate_system", {
            {"handedness", "right"}, {"up_axis", "Y"}, {"forward_axis", "Z"}, {"unit", "meter"}
        }},
        {"rotation", {{"representation", "quaternion"}, {"space", "parent_local"}, {"order", "wxyz"}}},
        {"arrays", arrays},
        {"provenance_file", "provenance.json"},
    };
    write_json(directory / "manifest.json", manifest);

    write_npy(directory / "time_s.npy", make_npy<double>(NpyDType::Float64, {frames}, package.motion.time_s));
    write_npy(directory / "scene_root_translation_m.npy",
              make_npy<double>(NpyDType::Float64, {frames, 3}, flatten_vec3(package.motion.scene_root_translation_m)));
    write_npy(directory / "scene_root_rotation_wxyz.npy",
              make_npy<double>(NpyDType::Float64, {frames, 4}, flatten_quat(package.motion.scene_root_rotation)));
    write_npy(directory / "local_rotations_wxyz.npy",
              make_npy<double>(NpyDType::Float64, {frames, joints, 4}, flatten_quat(package.motion.local_rotations)));
    write_npy(directory / "hips_translation_m.npy",
              make_npy<double>(NpyDType::Float64, {frames, 3}, flatten_vec3(package.motion.hips_translation_m)));
    write_npy(directory / "confidence.npy",
              make_npy<float>(NpyDType::Float32, {frames, joints}, package.motion.confidence));
    write_npy(directory / "valid_mask.npy",
              make_npy<std::uint8_t>(NpyDType::UInt8, {frames, joints}, package.motion.valid_mask));
    write_npy(directory / "foot_contacts.npy",
              make_npy<std::uint8_t>(NpyDType::UInt8, {frames, 2}, package.motion.foot_contacts));

    json cameras = json::array();
    std::set<std::string> camera_ids;
    for (const auto& camera : package.cameras) {
        if (!camera_ids.insert(camera.id).second) {
            throw ContractError("duplicate camera id: " + camera.id);
        }
        cameras.push_back(camera_json(camera));
    }
    write_json(directory / "cameras.json", {{"schema_version", kSchemaVersion}, {"cameras", cameras}});
    write_json(directory / "alignment.json", {
        {"schema_version", kSchemaVersion},
        {"mode", "external_or_not_required"},
        {"camera_count", package.cameras.size()},
    });
    float minimum_confidence=1.0f,maximum_confidence=0.0f;
    std::size_t invalid_observations=0;
    std::array<std::size_t,2> foot_contact_frames{};
    for(std::size_t index=0;index<package.motion.confidence.size();++index) {
        minimum_confidence=std::min(minimum_confidence,package.motion.confidence[index]);
        maximum_confidence=std::max(maximum_confidence,package.motion.confidence[index]);
        if(package.motion.valid_mask[index]==0)++invalid_observations;
    }
    for(std::size_t frame=0;frame<frames;++frame) {
        for(std::size_t side=0;side<foot_contact_frames.size();++side) {
            foot_contact_frames[side]+=package.motion.foot_contacts[frame*2+side]!=0 ? 1U : 0U;
        }
    }
    write_json(directory / "diagnostics.json", {
        {"schema_version", kSchemaVersion},
        {"status", "canonical_motion_validated"},
        {"confidence", {
            {"minimum", minimum_confidence},
            {"maximum", maximum_confidence},
        }},
        {"invalid_observations", invalid_observations},
        {"foot_contacts", {
            {"left_frames", foot_contact_frames[0]},
            {"right_frames", foot_contact_frames[1]},
            {"left_ratio", static_cast<double>(foot_contact_frames[0])/static_cast<double>(frames)},
            {"right_ratio", static_cast<double>(foot_contact_frames[1])/static_cast<double>(frames)},
        }},
        {"unsupported_export_fields", {"confidence", "valid_mask", "provenance", "source_support"}},
    });
}

MotionPackage load_motion_package(const std::filesystem::path& directory) {
    const auto manifest = read_json(directory / "manifest.json");
    require_exact_keys(manifest, {
        "schema_version", "package_type", "motion_variant", "skeleton_id", "fps",
        "frame_count", "joint_count", "coordinate_system", "rotation", "arrays", "provenance_file"
    }, "motion manifest");
    require_exact_keys(manifest.at("coordinate_system"), {"handedness", "up_axis", "forward_axis", "unit"}, "coordinate_system");
    require_exact_keys(manifest.at("rotation"), {"representation", "space", "order"}, "rotation");
    require_exact_keys(manifest.at("arrays"), {
        "time_s", "scene_root_translation_m", "scene_root_rotation_wxyz", "local_rotations_wxyz",
        "hips_translation_m", "confidence", "valid_mask", "foot_contacts"
    }, "arrays");

    if (manifest.at("schema_version") != kSchemaVersion ||
        manifest.at("package_type") != "animocap.canonical_motion" ||
        manifest.at("motion_variant") != "raw") {
        throw ContractError("unsupported motion package contract");
    }
    const auto& coordinates = manifest.at("coordinate_system");
    if (coordinates.at("handedness") != "right" || coordinates.at("up_axis") != "Y" ||
        coordinates.at("forward_axis") != "Z" || coordinates.at("unit") != "meter") {
        throw ContractError("unsupported motion coordinate system");
    }
    const auto& rotation = manifest.at("rotation");
    if (rotation.at("representation") != "quaternion" || rotation.at("space") != "parent_local" ||
        rotation.at("order") != "wxyz") {
        throw ContractError("unsupported motion rotation contract");
    }

    MotionPackage result;
    result.skeleton = load_skeleton_json(directory / "skeleton.json");
    auto& motion = result.motion;
    motion.schema_version = manifest.at("schema_version").get<std::string>();
    motion.skeleton_id = manifest.at("skeleton_id").get<std::string>();
    motion.fps = manifest.at("fps").get<double>();
    motion.frame_count = manifest.at("frame_count").get<std::size_t>();
    motion.joint_count = manifest.at("joint_count").get<std::size_t>();
    const auto frames = motion.frame_count;
    const auto joints = motion.joint_count;
    const auto& arrays = manifest.at("arrays");

    const auto load = [&](std::string_view key) {
        const auto filename = arrays.at(std::string(key)).get<std::string>();
        if (std::filesystem::path(filename).filename() != filename) throw ContractError("array filename must be local");
        return read_npy(directory / filename);
    };

    const auto time = load("time_s");
    const auto root_translation = load("scene_root_translation_m");
    const auto root_rotation = load("scene_root_rotation_wxyz");
    const auto local_rotation = load("local_rotations_wxyz");
    const auto hips_translation = load("hips_translation_m");
    const auto confidence = load("confidence");
    const auto valid_mask = load("valid_mask");
    const auto contacts = load("foot_contacts");
    require_array<double>(time, NpyDType::Float64, {frames}, "time_s");
    require_array<double>(root_translation, NpyDType::Float64, {frames, 3}, "scene_root_translation_m");
    require_array<double>(root_rotation, NpyDType::Float64, {frames, 4}, "scene_root_rotation_wxyz");
    require_array<double>(local_rotation, NpyDType::Float64, {frames, joints, 4}, "local_rotations_wxyz");
    require_array<double>(hips_translation, NpyDType::Float64, {frames, 3}, "hips_translation_m");
    require_array<float>(confidence, NpyDType::Float32, {frames, joints}, "confidence");
    require_array<std::uint8_t>(valid_mask, NpyDType::UInt8, {frames, joints}, "valid_mask");
    require_array<std::uint8_t>(contacts, NpyDType::UInt8, {frames, 2}, "foot_contacts");

    motion.time_s = npy_values<double>(time, NpyDType::Float64);
    motion.scene_root_translation_m = unflatten_vec3(npy_values<double>(root_translation, NpyDType::Float64));
    motion.scene_root_rotation = unflatten_quat(npy_values<double>(root_rotation, NpyDType::Float64));
    motion.local_rotations = unflatten_quat(npy_values<double>(local_rotation, NpyDType::Float64));
    motion.hips_translation_m = unflatten_vec3(npy_values<double>(hips_translation, NpyDType::Float64));
    motion.confidence = npy_values<float>(confidence, NpyDType::Float32);
    motion.valid_mask = npy_values<std::uint8_t>(valid_mask, NpyDType::UInt8);
    motion.foot_contacts = npy_values<std::uint8_t>(contacts, NpyDType::UInt8);

    const auto provenance_name = manifest.at("provenance_file").get<std::string>();
    if (std::filesystem::path(provenance_name).filename() != provenance_name) {
        throw ContractError("provenance filename must be local");
    }
    motion.provenance = parse_provenance(read_json(directory / provenance_name));

    const auto camera_document = read_json(directory / "cameras.json");
    require_exact_keys(camera_document, {"schema_version", "cameras"}, "camera document");
    if (camera_document.at("schema_version") != kSchemaVersion || !camera_document.at("cameras").is_array()) {
        throw ContractError("unsupported camera document contract");
    }
    std::set<std::string> camera_ids;
    for (const auto& value : camera_document.at("cameras")) {
        auto camera = parse_camera(value);
        if (!camera_ids.insert(camera.id).second) throw ContractError("duplicate camera id: " + camera.id);
        result.cameras.push_back(std::move(camera));
    }

    validate_motion(motion, result.skeleton);
    return result;
}

MotionPackage clip_motion_package(
    const MotionPackage& package,
    std::size_t first_frame,
    std::size_t last_frame
) {
    validate_motion(package.motion,package.skeleton);
    if(first_frame>last_frame||last_frame>=package.motion.frame_count) {
        throw ContractError("motion clip frame range is invalid");
    }
    MotionPackage result=package;
    auto& target=result.motion;
    const auto& source=package.motion;
    const std::size_t frame_count=last_frame-first_frame+1;
    const std::size_t joints=source.joint_count;
    auto slice_frames=[first_frame,last_frame](const auto& values) {
        using Vector=std::decay_t<decltype(values)>;
        return Vector(values.begin()+static_cast<std::ptrdiff_t>(first_frame),
                      values.begin()+static_cast<std::ptrdiff_t>(last_frame+1));
    };
    auto slice_rows=[first_frame,last_frame](const auto& values,std::size_t width) {
        using Vector=std::decay_t<decltype(values)>;
        return Vector(values.begin()+static_cast<std::ptrdiff_t>(first_frame*width),
                      values.begin()+static_cast<std::ptrdiff_t>((last_frame+1)*width));
    };
    target.frame_count=frame_count;
    target.time_s=slice_frames(source.time_s);
    const double origin_time=target.time_s.front();
    for(auto& time:target.time_s)time-=origin_time;
    target.scene_root_translation_m=slice_frames(source.scene_root_translation_m);
    target.scene_root_rotation=slice_frames(source.scene_root_rotation);
    target.local_rotations=slice_rows(source.local_rotations,joints);
    target.hips_translation_m=slice_frames(source.hips_translation_m);
    target.confidence=slice_rows(source.confidence,joints);
    target.valid_mask=slice_rows(source.valid_mask,joints);
    target.foot_contacts=slice_rows(source.foot_contacts,2);
    const auto clip_identity=source.provenance.config_sha256+":clip:"+
        std::to_string(first_frame)+":"+std::to_string(last_frame);
    target.provenance.config_sha256=sha256_bytes(
        std::span<const unsigned char>(
            reinterpret_cast<const unsigned char*>(clip_identity.data()),clip_identity.size()));
    validate_motion(target,result.skeleton);
    return result;
}

}  // namespace animocap
