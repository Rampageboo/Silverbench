#pragma once

#include "animocap/package.hpp"
#include "animocap/pose_review.hpp"
#include "animocap/pose_sequence.hpp"

#include <filesystem>
#include <string>
#include <vector>

namespace animocap {

// The editing state of one take, replayable from the refined pose
// (optimize(smooth(capture))). Studio keeps the same edits in memory and bakes
// manual drags into the .areview baseline on save; an edit session keeps them
// as data so another front end (RampageWorkbench) can undo, redo and persist
// them without reimplementing the solvers.

enum class CurvePreset { Linear, EaseIn, EaseOut, Smooth, Hold };

struct DragCorrection {
    std::size_t joint{};
    std::size_t keyframe{};
    // Image-space drag of the joint at the keyframe, in source pixels.
    Vec2 drag_px{};
    // 0 picks the Studio default: a quarter second, at least 4 frames.
    std::size_t radius{};
    CurvePreset curve{CurvePreset::Smooth};
};

struct EditSession {
    std::vector<DragCorrection> corrections;
    std::vector<std::size_t> smoothed_keyframes;
    PoseReview review;
    // Parallel to review.marks: true takes the mark's target from the
    // corrected pose (after drags and smoothing) instead of the stored one,
    // which is how a drag on a locked joint moves its lock.
    std::vector<bool> target_from_pose;
};

struct EditResult {
    // Review baseline: refined pose with drags and keyframe smoothing.
    PoseSequence corrected;
    // Final observation-space pose after the joint review rebuild.
    PoseSequence pose;
    // Frame-major, as PoseReviewResult::inferred.
    std::vector<bool> inferred;
    // The review actually solved, with derived targets filled in; saving it
    // beside `corrected` gives a Studio-compatible .areview folder.
    PoseReview review;
    MotionPackage motion;
};

std::vector<double> curve_preset_weights(
    std::size_t frame_count, std::size_t keyframe, std::size_t radius, CurvePreset preset);
std::size_t default_drag_radius(double fps);
ManualPoseCorrection make_drag_correction(const PoseSequence& reference, const DragCorrection& drag);

EditResult apply_edit_session(
    const PoseSequence& refined, const EditSession& session, const Skeleton* character_skeleton = nullptr);

EditSession load_edit_session(const std::filesystem::path& path);
// Same format as the file, given as JSON text (animocap serve receives it inline).
EditSession parse_edit_session(const std::string& json_text);
void save_edit_session(const EditSession& session, const std::filesystem::path& path);

}  // namespace animocap
