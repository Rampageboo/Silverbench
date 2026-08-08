#pragma once

#include "animocap/pose_sequence.hpp"

#include <filesystem>

namespace animocap {

struct CharacterProfile {
    std::filesystem::path source_path;
    std::filesystem::path skeleton_path;
    Skeleton skeleton;
    PoseOptimizationOptions optimization_options;
};

// Accepts either an exported profile.json or a strict canonical skeleton.json.
CharacterProfile load_character_profile(const std::filesystem::path& path);

}  // namespace animocap
