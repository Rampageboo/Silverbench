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
    std::string method{"view-invariant-motion-energy-affine"};
    std::size_t overlap_reference_frames{};
    std::size_t out_of_range_reference_frames{};
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
    std::size_t reference_anchor_suppressed_conflicts{};
    std::size_t reference_anchor_suppressed_low_confidence{};
    std::size_t visibility_evaluated_observations{};
    std::size_t visibility_downweighted_observations{};
    std::size_t visibility_boosted_observations{};
    std::size_t overlap_downweighted_observations{};
    std::size_t temporal_outlier_downweighted_observations{};
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
    // Legacy single-view image-plane ownership is opt-in. The default preserves
    // the balanced multiview solve through stabilization and optimization.
    bool enable_reference_image_plane_anchor{false};
    // When the legacy anchor is enabled, a trustworthy reference view owns the
    // two image-plane coordinates. Other views may still solve depth.
    double reference_anchor_confidence{0.85};
    // A confident reference observation owns the image plane when at least one
    // other view contributes. It yields only when strict multiview consensus
    // rejects the reference itself; a lone conflicting side view cannot pull a
    // good front observation away from the source image.
    bool require_reference_consensus_for_anchor{true};
    double reference_anchor_maximum_rms_m{0.06};
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
    // Reject view-specific high-frequency defects before they can be inherited
    // by fusion. Deliberate motion shared by multiple views remains eligible.
    bool enable_temporal_view_reliability{true};
    double temporal_outlier_acceleration_m{0.045};
    double temporal_outlier_ratio{3.0};
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
