#pragma once

#include "animocap/package.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace animocap {

struct ObservedJoint {
    Vec2 image_xy{};
    Vec3 position_m{};
    float confidence{};
    bool valid{};
};

struct ObservedPoseFrame {
    double time_s{};
    std::vector<ObservedJoint> joints;
};

struct PoseSequence {
    std::string schema_version{kSchemaVersion};
    std::filesystem::path source_video;
    std::string backend;
    std::size_t image_width{};
    std::size_t image_height{};
    double fps{};
    std::vector<ObservedPoseFrame> frames;
};

struct PoseOptimizationOptions {
    std::size_t iterations{8};
    double temporal_weight{0.28};
    double bone_length_weight{0.42};
    double observation_weight{0.18};
    double maximum_frame_correction_m{0.035};
    double low_confidence_threshold{0.55};
};

enum class ProportionPolicy {
    SimilarReference,
    ExactReference,
};

struct PoseOptimizationDiagnostics {
    std::string profile_id;
    ProportionPolicy proportion_policy{ProportionPolicy::ExactReference};
    std::size_t well_supported_bones{};
    std::size_t profile_supported_bones{};
    std::size_t corrected_joint_samples{};
    std::size_t high_confidence_move_attempts{};
    double mean_correction_m{};
    double maximum_correction_m{};
};

struct PoseOptimizationResult {
    PoseSequence sequence;
    PoseOptimizationDiagnostics diagnostics;
};

struct ManualPoseCorrection {
    std::size_t joint_index{};
    Vec2 image_delta{};
    std::vector<Vec3> position_deltas_m;
};
using ManualPoseCorrections = std::vector<ManualPoseCorrection>;

PoseSequence load_pose_sequence_json(const std::filesystem::path& path);
void save_pose_sequence_json(const PoseSequence& sequence, const std::filesystem::path& path);
void validate_pose_sequence(const PoseSequence& sequence);
PoseSequence smooth_pose_sequence(const PoseSequence& sequence);
PoseSequence optimize_pose_sequence(
    const PoseSequence& sequence,
    const PoseOptimizationOptions& options = {},
    const Skeleton* character_skeleton = nullptr,
    ProportionPolicy proportion_policy = ProportionPolicy::ExactReference
);
PoseOptimizationResult optimize_pose_sequence_detailed(
    const PoseSequence& sequence,
    const PoseOptimizationOptions& options = {},
    const Skeleton* character_skeleton = nullptr,
    ProportionPolicy proportion_policy = ProportionPolicy::ExactReference
);
PoseSequence apply_manual_pose_corrections(
    const PoseSequence& refined_sequence,
    const ManualPoseCorrections& corrections
);
MotionPackage reconstruct_canonical_motion(
    const PoseSequence& sequence,
    const Skeleton* character_skeleton = nullptr
);

}  // namespace animocap

