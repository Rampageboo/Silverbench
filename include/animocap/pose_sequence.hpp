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

PoseSequence load_pose_sequence_json(const std::filesystem::path& path);
void validate_pose_sequence(const PoseSequence& sequence);
PoseSequence smooth_pose_sequence(const PoseSequence& sequence);
MotionPackage reconstruct_canonical_motion(const PoseSequence& sequence);

}  // namespace animocap

