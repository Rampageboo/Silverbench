#pragma once

#include "animocap/contracts.hpp"
#include "animocap/skeleton.hpp"

#include <filesystem>
#include <vector>

namespace animocap {

struct MotionPackage {
    Skeleton skeleton;
    CanonicalMotion motion;
    std::vector<Camera> cameras;
};

void save_motion_package(const MotionPackage& package, const std::filesystem::path& directory);
MotionPackage load_motion_package(const std::filesystem::path& directory);
MotionPackage clip_motion_package(
    const MotionPackage& package,
    std::size_t first_frame,
    std::size_t last_frame
);

}  // namespace animocap
