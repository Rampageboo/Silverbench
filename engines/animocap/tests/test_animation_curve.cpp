#include "animocap/animation_curve.hpp"
#include "animocap/skeleton.hpp"

#include <algorithm>
#include <cmath>
#include <iostream>

namespace {

int failures = 0;

void check(bool condition, const char* expression, int line) {
    if (condition) return;
    std::cerr << "FAIL line " << line << ": " << expression << '\n';
    ++failures;
}

#define CHECK(expression) check((expression), #expression, __LINE__)

animocap::PoseSequence make_curve_fixture() {
    const auto skeleton = animocap::make_default_skeleton();
    const auto hand = animocap::bone_index(
        skeleton, animocap::BoneSemantic::LeftHand);
    const auto foot = animocap::bone_index(
        skeleton, animocap::BoneSemantic::LeftFoot);
    const auto airborne_foot = animocap::bone_index(
        skeleton, animocap::BoneSemantic::RightFoot);
    const auto neck = animocap::bone_index(
        skeleton, animocap::BoneSemantic::Neck);
    animocap::PoseSequence sequence;
    sequence.source_video = "curve-fixture.mp4";
    sequence.backend = "curve-fixture";
    sequence.image_width = 640;
    sequence.image_height = 720;
    sequence.fps = 30.0;
    for (std::size_t frame = 0; frame < 25; ++frame) {
        animocap::ObservedPoseFrame pose;
        pose.time_s = static_cast<double>(frame) / sequence.fps;
        pose.joints.resize(skeleton.bones.size());
        for (std::size_t joint = 0; joint < pose.joints.size(); ++joint) {
            const double time = static_cast<double>(frame);
            const double base = 0.012 * time;
            const double jitter = frame > 0 && frame + 1 < 25
                ? (frame % 2 ? 0.018 : -0.018) : 0.0;
            pose.joints[joint] = {
                {320.0 + 90.0 * (base + jitter), 360.0},
                {base + jitter, static_cast<double>(joint) * 0.01, 0.0},
                frame == 0 || frame == 24 ? 0.95f : 0.35f,
                true,
            };
        }
        const double peak = frame <= 12
            ? 0.05 * static_cast<double>(frame)
            : 0.05 * static_cast<double>(24 - frame);
        pose.joints[hand].position_m.x = peak;
        pose.joints[hand].image_xy.x = 320.0 + 90.0 * peak;
        pose.joints[hand].confidence = frame == 12 ? 0.98f : 0.38f;
        const double planted_jitter = frame % 2 ? 0.002 : -0.002;
        pose.joints[foot].position_m = {0.1 + planted_jitter, 0.0, 0.0};
        pose.joints[foot].image_xy = {329.0 + 90.0 * planted_jitter, 360.0};
        pose.joints[foot].confidence = 0.45f;
        pose.joints[airborne_foot].position_m = {
            0.2 + 0.004 * static_cast<double>(frame), 0.4, 0.0};
        pose.joints[airborne_foot].image_xy = {
            338.0 + 0.36 * static_cast<double>(frame), 324.0};
        pose.joints[airborne_foot].confidence = 0.95f;
        const double micro_jitter = frame > 0 && frame + 1 < 25
            ? (frame % 2 ? 0.004 : -0.004) : 0.0;
        pose.joints[neck].position_m = {micro_jitter, 1.45, 0.0};
        pose.joints[neck].image_xy = {320.0 + 90.0 * micro_jitter, 230.0};
        pose.joints[neck].confidence = 0.95f;
        if (frame == 7) {
            pose.joints[hand].valid = false;
            pose.joints[hand].confidence = 0.0f;
        }
        sequence.frames.push_back(std::move(pose));
    }
    animocap::validate_pose_sequence(sequence);
    return sequence;
}

}  // namespace

int main() {
    const auto input = make_curve_fixture();
    const auto skeleton = animocap::make_default_skeleton();
    const auto hand = animocap::bone_index(
        skeleton, animocap::BoneSemantic::LeftHand);
    const auto foot = animocap::bone_index(
        skeleton, animocap::BoneSemantic::LeftFoot);
    const auto airborne_foot = animocap::bone_index(
        skeleton, animocap::BoneSemantic::RightFoot);
    const auto neck = animocap::bone_index(
        skeleton, animocap::BoneSemantic::Neck);
    const auto result = animocap::stabilize_pose_with_animation_curves(
        input, {}, &skeleton);

    CHECK(result.diagnostics.corrected_samples > 0);
    CHECK(result.diagnostics.high_confidence_jitter_corrected_samples > 0);
    CHECK(result.diagnostics.protected_motion_turns > 0);
    CHECK(result.diagnostics.contact_locked_samples > 0);
    CHECK(result.diagnostics.jitter_after < result.diagnostics.jitter_before * 0.82);
    CHECK(std::abs(
        result.sequence.frames[12].joints[hand].position_m.x -
        input.frames[12].joints[hand].position_m.x) < 1e-12);
    CHECK(!result.sequence.frames[7].joints[hand].valid);
    CHECK(result.sequence.frames[7].joints[hand].confidence == 0.0f);
    CHECK(result.diagnostics.invalid_samples_preserved > 0);
    CHECK(result.diagnostics.maximum_correction_m <= 0.0350001);
    CHECK(std::abs(result.sequence.frames[9].joints[neck].position_m.x) <
          std::abs(input.frames[9].joints[neck].position_m.x));
    for(std::size_t frame=0;frame<input.frames.size();++frame) {
        const double correction=std::abs(
            result.sequence.frames[frame].joints[neck].position_m.x-
            input.frames[frame].joints[neck].position_m.x);
        CHECK(correction<=0.0060001);
    }
    double foot_minimum = 1.0;
    double foot_maximum = -1.0;
    for (const auto& frame : result.sequence.frames) {
        foot_minimum = std::min(foot_minimum, frame.joints[foot].position_m.x);
        foot_maximum = std::max(foot_maximum, frame.joints[foot].position_m.x);
    }
    CHECK(foot_maximum - foot_minimum < 0.0001);
    const double airborne_travel =
        result.sequence.frames.back().joints[airborne_foot].position_m.x -
        result.sequence.frames.front().joints[airborne_foot].position_m.x;
    CHECK(airborne_travel > 0.09);
    const auto repeated = animocap::stabilize_pose_with_animation_curves(
        result.sequence, {}, &skeleton);
    CHECK(repeated.sequence.backend == result.sequence.backend);
    CHECK(repeated.sequence.frames[6].joints[hand].position_m ==
        result.sequence.frames[6].joints[hand].position_m);
    CHECK(repeated.diagnostics.corrected_samples == 0);

    animocap::AnimationCurveStabilizationOptions invalid;
    invalid.maximum_anchor_gap_frames = 1;
    bool threw = false;
    try {
        (void)animocap::stabilize_pose_with_animation_curves(input, invalid);
    } catch (const std::exception&) {
        threw = true;
    }
    CHECK(threw);

    if (failures) return 1;
    const double peak_error = std::abs(
        result.sequence.frames[12].joints[hand].position_m.x -
        input.frames[12].joints[hand].position_m.x);
    std::cout << "animation curve checks passed: jitter "
              << result.diagnostics.jitter_before << " -> "
              << result.diagnostics.jitter_after << ", peak_error="
              << peak_error << ", corrected="
              << result.diagnostics.corrected_samples << '\n';
    return 0;
}
