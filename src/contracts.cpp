#include "animocap/contracts.hpp"

#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <set>

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

bool is_sha256(std::string_view value) {
    return value.size() == 64 && std::all_of(value.begin(), value.end(), [](char character) {
        return (character >= '0' && character <= '9') ||
               (character >= 'a' && character <= 'f') ||
               (character >= 'A' && character <= 'F');
    });
}

void validate_quaternion(const Quat& value, std::string_view label) {
    const double length = quat_norm(value);
    if (!std::isfinite(length) || std::abs(length - 1.0) > 1e-6) {
        throw ContractError(std::string(label) + " must be a unit quaternion");
    }
}

}  // namespace

std::string_view to_string(CaptureMode mode) {
    switch (mode) {
        case CaptureMode::SingleView: return "single_view";
        case CaptureMode::SynchronizedMultiview: return "synchronized_multiview";
        case CaptureMode::DirectionalRepeat: return "directional_repeat";
    }
    throw ContractError("invalid capture mode");
}

CaptureMode capture_mode_from_string(std::string_view value) {
    if (value == "single_view") return CaptureMode::SingleView;
    if (value == "synchronized_multiview") return CaptureMode::SynchronizedMultiview;
    if (value == "directional_repeat") return CaptureMode::DirectionalRepeat;
    throw ContractError("unknown capture mode: " + std::string(value));
}

std::string_view to_string(Visibility visibility) {
    switch (visibility) {
        case Visibility::Visible: return "visible";
        case Visibility::Occluded: return "occluded";
        case Visibility::Truncated: return "truncated";
        case Visibility::Missing: return "missing";
    }
    throw ContractError("invalid visibility");
}

Visibility visibility_from_string(std::string_view value) {
    if (value == "visible") return Visibility::Visible;
    if (value == "occluded") return Visibility::Occluded;
    if (value == "truncated") return Visibility::Truncated;
    if (value == "missing") return Visibility::Missing;
    throw ContractError("unknown visibility: " + std::string(value));
}

void validate_capture_manifest(const CaptureManifest& manifest) {
    if (manifest.version != 1) throw ContractError("unsupported capture manifest version");
    if (!std::isfinite(manifest.fps) || manifest.fps <= 0.0) throw ContractError("fps must be finite and positive");
    if (manifest.subject_type != "anime_humanoid") throw ContractError("unsupported subject type");
    if (manifest.output_directory.empty()) throw ContractError("output directory must not be empty");
    if (manifest.approximate_height_m &&
        (!std::isfinite(*manifest.approximate_height_m) || *manifest.approximate_height_m <= 0.0)) {
        throw ContractError("approximate height must be finite and positive");
    }

    const std::size_t count = manifest.views.size();
    if (manifest.mode == CaptureMode::SingleView && count != 1) {
        throw ContractError("single_view requires exactly one view");
    }
    if (manifest.mode != CaptureMode::SingleView && (count < 2 || count > 4)) {
        throw ContractError("multiview modes require two to four views");
    }

    std::set<std::string> ids;
    std::set<std::string> videos;
    for (const auto& view : manifest.views) {
        if (view.id.empty() || view.video.empty()) throw ContractError("view id and video must not be empty");
        if (!ids.insert(view.id).second) throw ContractError("duplicate view id");
        if (!videos.insert(view.video).second) throw ContractError("duplicate view video");
        if (view.yaw_degrees && !std::isfinite(*view.yaw_degrees)) throw ContractError("view yaw must be finite");
    }
}

CaptureManifest load_capture_manifest(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot read capture manifest: " + path.string());
    json value;
    input >> value;
    require_exact_keys(value, {"version", "mode", "fps", "looping", "views", "subject", "output"}, "capture manifest");
    require_exact_keys(value.at("subject"), {"type", "approximate_height_m"}, "subject");
    require_exact_keys(value.at("output"), {"directory"}, "output");

    CaptureManifest result;
    result.version = value.at("version").get<int>();
    result.mode = capture_mode_from_string(value.at("mode").get<std::string>());
    result.fps = value.at("fps").get<double>();
    result.looping = value.at("looping").get<bool>();
    result.subject_type = value.at("subject").at("type").get<std::string>();
    if (!value.at("subject").at("approximate_height_m").is_null()) {
        result.approximate_height_m = value.at("subject").at("approximate_height_m").get<double>();
    }
    result.output_directory = value.at("output").at("directory").get<std::string>();

    if (!value.at("views").is_array()) throw ContractError("views must be an array");
    for (const auto& view_value : value.at("views")) {
        require_exact_keys(view_value, {"id", "video", "yaw_degrees"}, "view");
        CaptureView view;
        view.id = view_value.at("id").get<std::string>();
        view.video = view_value.at("video").get<std::string>();
        if (!view_value.at("yaw_degrees").is_null()) view.yaw_degrees = view_value.at("yaw_degrees").get<double>();
        result.views.push_back(std::move(view));
    }
    validate_capture_manifest(result);
    return result;
}

void save_capture_manifest(const CaptureManifest& manifest, const std::filesystem::path& path) {
    validate_capture_manifest(manifest);
    json value{
        {"version", manifest.version},
        {"mode", to_string(manifest.mode)},
        {"fps", manifest.fps},
        {"looping", manifest.looping},
        {"views", json::array()},
        {"subject", {
            {"type", manifest.subject_type},
            {"approximate_height_m", manifest.approximate_height_m ? json(*manifest.approximate_height_m) : json(nullptr)}
        }},
        {"output", {{"directory", manifest.output_directory}}},
    };
    for (const auto& view : manifest.views) {
        value["views"].push_back({
            {"id", view.id},
            {"video", view.video},
            {"yaw_degrees", view.yaw_degrees ? json(*view.yaw_degrees) : json(nullptr)},
        });
    }
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write capture manifest: " + path.string());
    output << value.dump(2) << '\n';
}

void validate_camera(const Camera& camera) {
    if (camera.id.empty()) throw ContractError("camera id must not be empty");
    if (!std::isfinite(camera.yaw_degrees) || !std::isfinite(camera.pitch_degrees) ||
        !std::isfinite(camera.scale_pixels_per_meter) || camera.scale_pixels_per_meter <= 0.0 ||
        !std::isfinite(camera.principal_point.x) || !std::isfinite(camera.principal_point.y)) {
        throw ContractError("camera values must be finite and scale must be positive");
    }
}

void validate_keypoint_frame(const KeypointFrame& frame) {
    if (frame.schema_version != kSchemaVersion) throw ContractError("unsupported keypoint schema_version");
    if (!std::isfinite(frame.source_time_s) || frame.source_time_s < 0.0) {
        throw ContractError("source_time_s must be finite and non-negative");
    }
    if (!(frame.bbox_xyxy[2] > frame.bbox_xyxy[0] && frame.bbox_xyxy[3] > frame.bbox_xyxy[1])) {
        throw ContractError("bbox_xyxy must have positive area");
    }
    const auto count = frame.keypoints_xy.size();
    if (count == 0 || frame.confidence.size() != count || frame.visibility.size() != count ||
        frame.manual_override.size() != count) {
        throw ContractError("keypoint arrays must be non-empty and share shape [J]");
    }
    for (std::size_t index = 0; index < count; ++index) {
        const auto& point = frame.keypoints_xy[index];
        if (!std::isfinite(point.x) || !std::isfinite(point.y)) throw ContractError("keypoint coordinates must be finite");
        if (!std::isfinite(frame.confidence[index]) || frame.confidence[index] < 0.0 ||
            frame.confidence[index] > 1.0) {
            throw ContractError("keypoint confidence must be in [0, 1]");
        }
        if (frame.manual_override[index] > 1) throw ContractError("manual_override must be a boolean mask");
    }
    if (frame.track_id.empty() || frame.model_id.empty()) throw ContractError("track_id and model_id must not be empty");
}

void validate_motion(const CanonicalMotion& motion, const Skeleton& skeleton) {
    validate_skeleton(skeleton);
    if (motion.schema_version != kSchemaVersion) throw ContractError("unsupported motion schema_version");
    if (motion.skeleton_id != skeleton.skeleton_id) throw ContractError("motion skeleton_id mismatch");
    if (!std::isfinite(motion.fps) || motion.fps <= 0.0) throw ContractError("motion fps must be positive");
    if (motion.frame_count == 0 || motion.joint_count != skeleton.bones.size()) {
        throw ContractError("motion frame_count and joint_count must be valid");
    }
    const auto frames = motion.frame_count;
    const auto joints = motion.joint_count;
    if (motion.time_s.size() != frames ||
        motion.scene_root_translation_m.size() != frames ||
        motion.scene_root_rotation.size() != frames ||
        motion.local_rotations.size() != frames * joints ||
        motion.hips_translation_m.size() != frames ||
        motion.confidence.size() != frames * joints ||
        motion.valid_mask.size() != frames * joints ||
        motion.foot_contacts.size() != frames * 2) {
        throw ContractError("motion arrays do not match declared shapes");
    }

    for (std::size_t frame = 0; frame < frames; ++frame) {
        if (!std::isfinite(motion.time_s[frame])) throw ContractError("time values must be finite");
        if (frame > 0 && !(motion.time_s[frame] > motion.time_s[frame - 1])) {
            throw ContractError("time must be strictly increasing");
        }
        validate_quaternion(motion.scene_root_rotation[frame], "scene_root_rotation");
    }
    for (const auto& rotation : motion.local_rotations) validate_quaternion(rotation, "local_rotations");
    for (std::size_t index = 0; index < frames * joints; ++index) {
        if (!std::isfinite(motion.confidence[index]) || motion.confidence[index] < 0.0f ||
            motion.confidence[index] > 1.0f) {
            throw ContractError("confidence must be in [0, 1]");
        }
        if (motion.valid_mask[index] > 1) throw ContractError("valid_mask must be boolean");
        if (motion.valid_mask[index] == 0 && motion.confidence[index] != 0.0f) {
            throw ContractError("invalid observations must have zero confidence");
        }
    }
    for (const auto contact : motion.foot_contacts) {
        if (contact > 1) throw ContractError("foot_contacts must be boolean");
    }
    if (motion.provenance.code_version.empty() || !is_sha256(motion.provenance.config_sha256)) {
        throw ContractError("provenance must include code version and config SHA-256");
    }
    for (const auto& hash : motion.provenance.source_sha256) {
        if (!is_sha256(hash)) throw ContractError("source provenance hash must be SHA-256");
    }
    if (!motion.provenance.model_weights_sha256.empty() &&
        !is_sha256(motion.provenance.model_weights_sha256)) {
        throw ContractError("model weight provenance hash must be SHA-256");
    }
}

}  // namespace animocap
