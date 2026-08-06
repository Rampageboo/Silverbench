#pragma once

#include "animocap/pose_sequence.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace animocap {

struct MultiviewPoseInput {
    std::string view_id;
    double yaw_degrees{};
    PoseSequence pose;
};

struct ViewAlignment {
    std::string view_id;
    double mean_offset_s{};
    double mean_rate{1.0};
    double normalized_cost{};
    std::vector<double> source_frame_at_reference;
};

struct JointConflict {
    std::size_t frame_index{};
    std::size_t joint_index{};
    double disagreement_m{};
    std::size_t contributing_views{};
};

struct MultiviewDiagnostics {
    std::vector<ViewAlignment> alignments;
    std::vector<JointConflict> conflicts;
    std::size_t recovered_observations{};
    std::size_t left_right_corrections{};
    double mean_reprojection_error_m{};
};

struct MultiviewSolveOptions {
    std::size_t reference_view{};
    double minimum_confidence{0.12};
    double conflict_threshold_m{0.18};
    double temporal_weight{0.18};
    double bone_length_weight{0.35};
    double maximum_warp_fraction{0.30};
};

struct MultiviewSolveResult {
    PoseSequence fused_pose;
    MotionPackage motion;
    MultiviewDiagnostics diagnostics;
};

MultiviewSolveResult solve_directional_multiview(
    const std::vector<MultiviewPoseInput>& views,
    const MultiviewSolveOptions& options = {});

MultiviewDiagnostics load_multiview_diagnostics(const std::filesystem::path& path);

void save_multiview_diagnostics(
    const MultiviewDiagnostics& diagnostics,
    const std::filesystem::path& path);

}  // namespace animocap
