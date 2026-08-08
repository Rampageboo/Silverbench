#pragma once

#include "animocap/package.hpp"

#include <filesystem>

namespace animocap {

enum class BvhUnit { Meters, Centimeters };

struct BvhExportOptions {
    BvhUnit unit{BvhUnit::Centimeters};
    bool overwrite{};
};

struct VrmaExportOptions {
    bool overwrite{};
};

void export_bvh(
    const MotionPackage& package,
    const std::filesystem::path& output,
    const BvhExportOptions& options = {}
);

void export_vrma(
    const MotionPackage& package,
    const std::filesystem::path& output,
    const VrmaExportOptions& options = {}
);

}  // namespace animocap
