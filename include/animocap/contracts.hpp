#pragma once

#include "animocap/skeleton.hpp"
#include "animocap/types.hpp"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace animocap {

enum class CaptureMode { SingleView, SynchronizedMultiview, DirectionalRepeat };
enum class Visibility { Visible, Occluded, Truncated, Missing };

struct CaptureView {
    std::string id;
    std::string video;
    std::optional<double> yaw_degrees;
};

struct CaptureManifest {
    int version{1};
    CaptureMode mode{CaptureMode::SingleView};
    double fps{30.0};
    bool looping{};
    std::vector<CaptureView> views;
    std::string subject_type{"anime_humanoid"};
    std::optional<double> approximate_height_m;
    std::string output_directory;
};

struct KeypointFrame {
    std::string schema_version{kSchemaVersion};
    std::size_t frame_index{};
    double source_time_s{};
    std::array<double, 4> bbox_xyxy{};
    std::vector<Vec2> keypoints_xy;
    std::vector<double> confidence;
    std::vector<Visibility> visibility;
    std::vector<std::uint8_t> manual_override;
    std::string track_id;
    std::string model_id;
};

struct Provenance {
    std::string code_version;
    std::string config_sha256;
    std::vector<std::string> source_sha256;
    std::string model_id{"none-m0"};
    std::string model_weights_sha256;
};

struct CanonicalMotion {
    std::string schema_version{kSchemaVersion};
    std::string skeleton_id{"animocap_canonical_v1"};
    double fps{30.0};
    std::size_t frame_count{};
    std::size_t joint_count{};
    std::vector<double> time_s;
    std::vector<Vec3> scene_root_translation_m;
    std::vector<Quat> scene_root_rotation;
    std::vector<Quat> local_rotations;
    std::vector<Vec3> hips_translation_m;
    std::vector<float> confidence;
    std::vector<std::uint8_t> valid_mask;
    std::vector<std::uint8_t> foot_contacts;
    Provenance provenance;
};

std::string_view to_string(CaptureMode mode);
CaptureMode capture_mode_from_string(std::string_view value);
std::string_view to_string(Visibility visibility);
Visibility visibility_from_string(std::string_view value);

CaptureManifest load_capture_manifest(const std::filesystem::path& path);
void save_capture_manifest(const CaptureManifest& manifest, const std::filesystem::path& path);
void validate_capture_manifest(const CaptureManifest& manifest);
void validate_keypoint_frame(const KeypointFrame& frame);
void validate_camera(const Camera& camera);
void validate_motion(const CanonicalMotion& motion, const Skeleton& skeleton);

}  // namespace animocap
