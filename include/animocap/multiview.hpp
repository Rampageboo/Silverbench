#pragma once

#include "animocap/animation_curve.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace animocap {

struct MultiviewPoseInput {
    std::string view_id;
    double yaw_degrees{};
    PoseSequence pose;
    // Positive values sample this view later than reference time. This mirrors
    // capture.json time_offset_s and acts as an explicit phase anchor.
    double time_offset_s{};
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
    std::size_t rejected_view_observations{};
    std::size_t left_right_state_changes{};
    std::size_t reference_anchored_observations{};
    std::size_t visibility_evaluated_observations{};
    std::size_t visibility_downweighted_observations{};
    std::size_t visibility_boosted_observations{};
    std::size_t overlap_downweighted_observations{};
    std::size_t curve_anchor_samples{};
    std::size_t curve_corrected_samples{};
    std::size_t curve_high_confidence_jitter_corrected_samples{};
    std::size_t curve_contact_locked_samples{};
    double mean_reprojection_error_m{};
    double curve_mean_correction_m{};
    double curve_maximum_correction_m{};
    double jitter_before_curve{};
    double jitter_after_curve{};
};

struct MultiviewSolveOptions {
    std::size_t reference_view{};
    double minimum_confidence{0.12};
    double conflict_threshold_m{0.18};
    // A trustworthy reference view owns the two image-plane coordinates. Other
    // views may still solve the orthogonal depth component and recover missing
    // or weak reference observations.
    double reference_anchor_confidence{0.85};
    // Backward-compatible temporal gate: zero disables the post-fusion curve
    // stage; positive values retain the configured animation_curve strength.
    double temporal_weight{0.18};
    double bone_length_weight{0.35};
    double maximum_warp_fraction{0.30};
    // Visibility changes only the weight of already-compatible observations.
    // It cannot manufacture a joint or override strict-majority rejection.
    bool enable_view_visibility_weighting{true};
    double maximum_near_side_visibility_bonus{0.15};
    double maximum_far_side_visibility_penalty{0.30};
    double mirrored_joint_overlap_threshold_m{0.06};
    bool enable_animation_curve_stabilization{true};
    AnimationCurveStabilizationOptions animation_curve{};
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
