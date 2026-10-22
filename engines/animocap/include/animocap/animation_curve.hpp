#pragma once

#include "animocap/pose_sequence.hpp"

#include <cstddef>
#include <vector>

namespace animocap {

struct AnimationCurveStabilizationOptions {
    std::size_t maximum_anchor_gap_frames{8};
    std::size_t minimum_contact_frames{3};
    double anchor_confidence{0.78};
    double low_confidence_threshold{0.62};
    double motion_turn_minimum_m{0.012};
    double correction_noise_floor_m{0.0025};
    double high_confidence_jitter_minimum_m{0.0012};
    double high_confidence_jitter_maximum_step_m{0.010};
    double maximum_correction_m{0.035};
    double maximum_image_correction_px{14.0};
    double maximum_high_confidence_jitter_correction_m{0.006};
    double maximum_high_confidence_jitter_image_correction_px{3.0};
    double contact_speed_threshold_m{0.009};
    double contact_height_threshold_m{0.065};
    double curve_strength{0.78};
};

struct AnimationCurveStabilizationDiagnostics {
    std::size_t anchor_samples{};
    std::size_t protected_motion_turns{};
    std::size_t corrected_samples{};
    std::size_t high_confidence_jitter_corrected_samples{};
    std::size_t contact_locked_samples{};
    std::size_t invalid_samples_preserved{};
    double mean_correction_m{};
    double maximum_correction_m{};
    double jitter_before{};
    double jitter_after{};
};

struct AnimationCurveStabilizationResult {
    PoseSequence sequence;
    AnimationCurveStabilizationDiagnostics diagnostics;
};

// A sparse Studio selection can be used as a local smoothing centre without
// rewriting the authored keyframe samples themselves.  The operation is
// intentionally bounded: it is for removing high-frequency shake around an
// authored pose, not for inventing a new motion or changing a deliberate turn.
struct KeyframeCenteredSmoothingOptions {
    std::size_t radius_frames{4};
    double strength{0.78};
    double correction_noise_floor_m{0.0004};
    double maximum_correction_m{0.006};
    double maximum_image_correction_px{3.0};
};

struct KeyframeCenteredSmoothingDiagnostics {
    std::size_t selected_keyframes{};
    std::size_t protected_keyframe_samples{};
    std::size_t corrected_samples{};
    std::size_t invalid_samples_preserved{};
    double mean_correction_m{};
    double maximum_correction_m{};
    double jitter_before{};
    double jitter_after{};
};

struct KeyframeCenteredSmoothingResult {
    PoseSequence sequence;
    KeyframeCenteredSmoothingDiagnostics diagnostics;
};

double pose_sequence_jitter_metric(const PoseSequence& sequence);

AnimationCurveStabilizationResult stabilize_pose_with_animation_curves(
    const PoseSequence& sequence,
    const AnimationCurveStabilizationOptions& options = {},
    const Skeleton* skeleton = nullptr);

KeyframeCenteredSmoothingResult smooth_pose_around_keyframes(
    const PoseSequence& sequence,
    const std::vector<std::size_t>& keyframe_frames,
    const KeyframeCenteredSmoothingOptions& options = {});

}  // namespace animocap
