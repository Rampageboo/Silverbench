#pragma once

#include "animocap/package.hpp"

#include <cstddef>
#include <filesystem>
#include <optional>
#include <vector>

namespace animocap {

// UI-independent selection state for sparse Blender exchange. It deliberately
// has no relationship to authored/smoothing keyframe selection.
class BlenderFrameSelection {
public:
    void select(std::size_t frame, std::size_t frame_count, bool control, bool shift);
    void select_only(const std::vector<std::size_t>& frames, std::size_t frame_count);
    void clear();
    void prune(std::size_t frame_count);

    [[nodiscard]] const std::vector<std::size_t>& frames() const noexcept;
    [[nodiscard]] bool empty() const noexcept;
    [[nodiscard]] std::size_t size() const noexcept;

private:
    std::vector<std::size_t> frames_;
    std::optional<std::size_t> range_anchor_;
};

struct BlenderSelectedFrameExportOptions {
    bool overwrite{};
};

// Writes sparse, complete Canonical Motion poses for Blender. The selected
// indices identify source frames; no interpolation or unselected samples are
// serialized by this exchange format.
void export_blender_selected_frames(
    const MotionPackage& package,
    const std::vector<std::size_t>& selected_frames,
    const std::filesystem::path& output,
    const BlenderSelectedFrameExportOptions& options = {}
);

}  // namespace animocap
