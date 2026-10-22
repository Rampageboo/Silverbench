#pragma once

#include "animocap/package.hpp"

#include <cstdint>
#include <filesystem>
#include <string>

namespace animocap {

struct FixtureResult {
    std::filesystem::path package_directory;
    std::filesystem::path ground_truth_path;
    std::string sha256;
};

MotionPackage make_synthetic_motion(std::uint64_t seed = 20260806, std::size_t frame_count = 31);
FixtureResult generate_synthetic_fixture(
    const std::filesystem::path& output_directory,
    std::uint64_t seed = 20260806,
    std::size_t frame_count = 31
);

}  // namespace animocap
