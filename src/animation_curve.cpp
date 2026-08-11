#include "animocap/animation_curve.hpp"

#include "animocap/skeleton.hpp"

#include <algorithm>
#include <cmath>
#include <limits>
#include <vector>

namespace animocap {
namespace {

constexpr double kEpsilon = 1e-9;

double clamp01(double value) {
    return std::clamp(value, 0.0, 1.0);
}

Vec3 scale(const Vec3& value, double factor) {
    return {value.x * factor, value.y * factor, value.z * factor};
}

Vec2 scale(const Vec2& value, double factor) {
    return {value.x * factor, value.y * factor};
}

Vec2 operator+(const Vec2& left, const Vec2& right) {
    return {left.x + right.x, left.y + right.y};
}

Vec2 operator-(const Vec2& left, const Vec2& right) {
    return {left.x - right.x, left.y - right.y};
}

double norm(const Vec3& value) {
    return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

double norm(const Vec2& value) {
    return std::hypot(value.x, value.y);
}

double dot(const Vec3& left, const Vec3& right) {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

double median3(double first, double second, double third) {
    return first + second + third -
        std::min({first, second, third}) -
        std::max({first, second, third});
}

Vec3 bounded_delta(Vec3 delta, double maximum) {
    const double magnitude = norm(delta);
    if (magnitude <= maximum || magnitude <= kEpsilon) return delta;
    return scale(delta, maximum / magnitude);
}

Vec2 bounded_delta(Vec2 delta, double maximum) {
    const double magnitude = norm(delta);
    if (magnitude <= maximum || magnitude <= kEpsilon) return delta;
    return scale(delta, maximum / magnitude);
}

Vec3 hermite(
    const Vec3& start, const Vec3& end,
    const Vec3& start_tangent, const Vec3& end_tangent,
    double value
) {
    const double squared = value * value;
    const double cubed = squared * value;
    return scale(start, 2.0 * cubed - 3.0 * squared + 1.0) +
        scale(start_tangent, cubed - 2.0 * squared + value) +
        scale(end, -2.0 * cubed + 3.0 * squared) +
        scale(end_tangent, cubed - squared);
}

Vec2 hermite(
    const Vec2& start, const Vec2& end,
    const Vec2& start_tangent, const Vec2& end_tangent,
    double value
) {
    const double squared = value * value;
    const double cubed = squared * value;
    return scale(start, 2.0 * cubed - 3.0 * squared + 1.0) +
        scale(start_tangent, cubed - 2.0 * squared + value) +
        scale(end, -2.0 * cubed + 3.0 * squared) +
        scale(end_tangent, cubed - squared);
}

bool is_foot_semantic(BoneSemantic semantic) {
    return semantic == BoneSemantic::LeftFoot ||
        semantic == BoneSemantic::RightFoot ||
        semantic == BoneSemantic::LeftToes ||
        semantic == BoneSemantic::RightToes;
}

template <typename Position>
Position anchor_tangent(
    const PoseSequence& sequence,
    const std::vector<std::size_t>& anchors,
    std::size_t anchor_index,
    std::size_t joint,
    Position ObservedJoint::*member
) {
    const std::size_t current = anchors[anchor_index];
    if (anchors.size() == 1) return {};
    if (anchor_index == 0) {
        const std::size_t next = anchors[1];
        return sequence.frames[next].joints[joint].*member -
            sequence.frames[current].joints[joint].*member;
    }
    if (anchor_index + 1 == anchors.size()) {
        const std::size_t previous = anchors[anchor_index - 1];
        return sequence.frames[current].joints[joint].*member -
            sequence.frames[previous].joints[joint].*member;
    }
    const std::size_t previous = anchors[anchor_index - 1];
    const std::size_t next = anchors[anchor_index + 1];
    const double span = static_cast<double>(next - previous);
    const double local_span = 0.5 * static_cast<double>(
        anchors[anchor_index + 1] - anchors[anchor_index - 1]);
    return scale(
        sequence.frames[next].joints[joint].*member -
            sequence.frames[previous].joints[joint].*member,
        local_span / std::max(1.0, span));
}

void add_gap_anchors(
    const PoseSequence& sequence,
    std::size_t joint,
    std::size_t maximum_gap,
    std::vector<std::size_t>& anchors
) {
    if (maximum_gap < 2) maximum_gap = 2;
    for (;;) {
        std::sort(anchors.begin(), anchors.end());
        anchors.erase(std::unique(anchors.begin(), anchors.end()), anchors.end());
        bool inserted = false;
        for (std::size_t index = 1; index < anchors.size(); ++index) {
            const std::size_t left = anchors[index - 1];
            const std::size_t right = anchors[index];
            if (right - left <= maximum_gap) continue;
            const std::size_t search_start = left + maximum_gap / 2;
            const std::size_t search_end = std::min(right - 1, left + maximum_gap);
            std::size_t best = search_start;
            float best_confidence = -1.0f;
            for (std::size_t frame = search_start; frame <= search_end; ++frame) {
                const auto& sample = sequence.frames[frame].joints[joint];
                if (sample.valid && sample.confidence > best_confidence) {
                    best = frame;
                    best_confidence = sample.confidence;
                }
            }
            anchors.push_back(best);
            inserted = true;
            break;
        }
        if (!inserted) break;
    }
}

}  // namespace

double pose_sequence_jitter_metric(const PoseSequence& sequence) {
    validate_pose_sequence(sequence);
    if (sequence.frames.size() < 3) return 0.0;
    double total = 0.0;
    std::size_t samples = 0;
    for (std::size_t frame = 1; frame + 1 < sequence.frames.size(); ++frame) {
        for (std::size_t joint = 0; joint < sequence.frames[frame].joints.size(); ++joint) {
            const auto& previous = sequence.frames[frame - 1].joints[joint];
            const auto& current = sequence.frames[frame].joints[joint];
            const auto& next = sequence.frames[frame + 1].joints[joint];
            if (!previous.valid || !current.valid || !next.valid) continue;
            total += norm(previous.position_m - scale(current.position_m, 2.0) +
                next.position_m);
            ++samples;
        }
    }
    return samples ? total / static_cast<double>(samples) : 0.0;
}

AnimationCurveStabilizationResult stabilize_pose_with_animation_curves(
    const PoseSequence& sequence,
    const AnimationCurveStabilizationOptions& options,
    const Skeleton* supplied_skeleton
) {
    validate_pose_sequence(sequence);
    const auto finite_nonnegative = [](double value) {
        return std::isfinite(value) && value >= 0.0;
    };
    if (options.maximum_anchor_gap_frames < 2 ||
        options.minimum_contact_frames < 2 ||
        !finite_nonnegative(options.anchor_confidence) ||
        options.anchor_confidence > 1.0 ||
        !finite_nonnegative(options.low_confidence_threshold) ||
        options.low_confidence_threshold > 1.0 ||
        !finite_nonnegative(options.motion_turn_minimum_m) ||
        !finite_nonnegative(options.correction_noise_floor_m) ||
        !finite_nonnegative(options.high_confidence_jitter_minimum_m) ||
        !finite_nonnegative(options.high_confidence_jitter_maximum_step_m) ||
        !finite_nonnegative(options.maximum_correction_m) ||
        !finite_nonnegative(options.maximum_image_correction_px) ||
        !finite_nonnegative(options.maximum_high_confidence_jitter_correction_m) ||
        !finite_nonnegative(options.maximum_high_confidence_jitter_image_correction_px) ||
        options.high_confidence_jitter_minimum_m >
            options.high_confidence_jitter_maximum_step_m ||
        options.maximum_high_confidence_jitter_correction_m >
            options.maximum_correction_m ||
        options.maximum_high_confidence_jitter_image_correction_px >
            options.maximum_image_correction_px ||
        !finite_nonnegative(options.contact_speed_threshold_m) ||
        !finite_nonnegative(options.contact_height_threshold_m) ||
        !finite_nonnegative(options.curve_strength) || options.curve_strength > 1.0) {
        throw ContractError("invalid animation curve stabilization options");
    }

    const Skeleton fallback_skeleton = make_default_skeleton();
    const Skeleton& skeleton = supplied_skeleton ? *supplied_skeleton : fallback_skeleton;
    validate_skeleton(skeleton);
    if (skeleton.bones.size() != sequence.frames.front().joints.size()) {
        throw ContractError("animation curve skeleton does not match pose joints");
    }

    AnimationCurveStabilizationResult result{sequence, {}};
    result.diagnostics.jitter_before = pose_sequence_jitter_metric(sequence);
    if (sequence.backend.find("animation-keyframe-curve") != std::string::npos) {
        result.diagnostics.jitter_after = result.diagnostics.jitter_before;
        for (const auto& frame : sequence.frames) {
            for (const auto& joint : frame.joints) {
                if (!joint.valid) ++result.diagnostics.invalid_samples_preserved;
            }
        }
        return result;
    }
    const std::size_t frame_count = sequence.frames.size();
    const std::size_t joint_count = sequence.frames.front().joints.size();
    std::vector<bool> high_confidence_jitter_corrected(
        frame_count * joint_count, false);
    const auto is_high_confidence_micro_jitter = [&](std::size_t joint,
                                                      std::size_t frame) {
        if (frame == 0 || frame + 1 >= frame_count) return false;
        const auto& previous = sequence.frames[frame - 1].joints[joint];
        const auto& current = sequence.frames[frame].joints[joint];
        const auto& next = sequence.frames[frame + 1].joints[joint];
        if (!previous.valid || !current.valid || !next.valid ||
            current.confidence < options.low_confidence_threshold) return false;
        const Vec3 incoming = current.position_m - previous.position_m;
        const Vec3 outgoing = next.position_m - current.position_m;
        const Vec3 midpoint = scale(previous.position_m + next.position_m, 0.5);
        return dot(incoming, outgoing) < 0.0 &&
            std::max(norm(incoming), norm(outgoing)) <=
                options.high_confidence_jitter_maximum_step_m &&
            norm(midpoint - current.position_m) >=
                options.high_confidence_jitter_minimum_m;
    };
    std::vector<double> foot_heights;
    for (std::size_t joint = 0; joint < joint_count; ++joint) {
        if (!is_foot_semantic(skeleton.bones[joint].semantic)) continue;
        for (const auto& frame : sequence.frames) {
            if (frame.joints[joint].valid) {
                foot_heights.push_back(frame.joints[joint].position_m.y);
            }
        }
    }
    std::sort(foot_heights.begin(), foot_heights.end());
    const double ground_height = foot_heights.empty() ? 0.0 : foot_heights[
        std::min(foot_heights.size() - 1, foot_heights.size() / 10)];

    for (std::size_t joint = 0; joint < joint_count; ++joint) {
        std::size_t run_start = 0;
        while (run_start < frame_count) {
            while (run_start < frame_count &&
                   !sequence.frames[run_start].joints[joint].valid) {
                ++result.diagnostics.invalid_samples_preserved;
                ++run_start;
            }
            if (run_start == frame_count) break;
            std::size_t run_end = run_start;
            while (run_end + 1 < frame_count &&
                   sequence.frames[run_end + 1].joints[joint].valid) ++run_end;

            std::vector<bool> trusted_anchor(frame_count, false);
            std::vector<std::size_t> anchors{run_start};
            trusted_anchor[run_start] = true;
            if (run_end != run_start) {
                anchors.push_back(run_end);
                trusted_anchor[run_end] = true;
            }
            for (std::size_t frame = run_start + 1; frame < run_end; ++frame) {
                const auto& previous = sequence.frames[frame - 1].joints[joint];
                const auto& current = sequence.frames[frame].joints[joint];
                const auto& next = sequence.frames[frame + 1].joints[joint];
                const Vec3 incoming = current.position_m - previous.position_m;
                const Vec3 outgoing = next.position_m - current.position_m;
                const bool direction_turn = dot(incoming, outgoing) < 0.0 &&
                    std::min(norm(incoming), norm(outgoing)) >=
                        options.motion_turn_minimum_m;
                if (direction_turn && current.confidence >= options.anchor_confidence) {
                    anchors.push_back(frame);
                    trusted_anchor[frame] = true;
                    ++result.diagnostics.protected_motion_turns;
                }
            }
            add_gap_anchors(
                sequence, joint, options.maximum_anchor_gap_frames, anchors);
            std::sort(anchors.begin(), anchors.end());
            anchors.erase(std::unique(anchors.begin(), anchors.end()), anchors.end());
            result.diagnostics.anchor_samples += anchors.size();

            // Periodic control knots only bound the curve span; unlike trusted
            // run boundaries and deliberate motion turns, they may themselves
            // be low-confidence jitter. Robustly center those knots before
            // using them as curve controls.
            for (const auto anchor : anchors) {
                if (trusted_anchor[anchor] || anchor == run_start || anchor == run_end) {
                    continue;
                }
                const auto& previous = sequence.frames[anchor - 1].joints[joint];
                const auto& current = sequence.frames[anchor].joints[joint];
                const auto& next = sequence.frames[anchor + 1].joints[joint];
                const Vec3 centered_position{
                    median3(previous.position_m.x, current.position_m.x, next.position_m.x),
                    median3(previous.position_m.y, current.position_m.y, next.position_m.y),
                    median3(previous.position_m.z, current.position_m.z, next.position_m.z),
                };
                const Vec2 centered_image{
                    median3(previous.image_xy.x, current.image_xy.x, next.image_xy.x),
                    median3(previous.image_xy.y, current.image_xy.y, next.image_xy.y),
                };
                auto& target = result.sequence.frames[anchor].joints[joint];
                const bool micro_jitter=is_high_confidence_micro_jitter(joint,anchor);
                const double strength=micro_jitter
                    ?options.curve_strength*0.72
                    :options.curve_strength*(1.0-0.55*current.confidence);
                const Vec3 position_correction=bounded_delta(
                    scale(centered_position-current.position_m,strength),
                    micro_jitter?options.maximum_high_confidence_jitter_correction_m:
                        options.maximum_correction_m);
                target.position_m=current.position_m+position_correction;
                target.image_xy=current.image_xy+bounded_delta(
                    scale(centered_image-current.image_xy,strength),
                    micro_jitter?options.maximum_high_confidence_jitter_image_correction_px:
                        options.maximum_image_correction_px);
                if(micro_jitter&&norm(position_correction)>kEpsilon)
                    high_confidence_jitter_corrected[anchor*joint_count+joint]=true;
            }

            for (std::size_t segment = 1; segment < anchors.size(); ++segment) {
                const std::size_t left = anchors[segment - 1];
                const std::size_t right = anchors[segment];
                if (right <= left + 1) continue;
                const auto& left_sample = result.sequence.frames[left].joints[joint];
                const auto& right_sample = result.sequence.frames[right].joints[joint];
                const Vec3 left_tangent = anchor_tangent(
                    result.sequence, anchors, segment - 1, joint,
                    &ObservedJoint::position_m);
                const Vec3 right_tangent = anchor_tangent(
                    result.sequence, anchors, segment, joint,
                    &ObservedJoint::position_m);
                const Vec2 left_image_tangent = anchor_tangent(
                    result.sequence, anchors, segment - 1, joint,
                    &ObservedJoint::image_xy);
                const Vec2 right_image_tangent = anchor_tangent(
                    result.sequence, anchors, segment, joint,
                    &ObservedJoint::image_xy);
                for (std::size_t frame = left + 1; frame < right; ++frame) {
                    const double value = static_cast<double>(frame - left) /
                        static_cast<double>(right - left);
                    const Vec3 curve_position = hermite(
                        left_sample.position_m, right_sample.position_m,
                        left_tangent, right_tangent, value);
                    const Vec2 curve_image = hermite(
                        left_sample.image_xy, right_sample.image_xy,
                        left_image_tangent, right_image_tangent, value);
                    const auto& original = sequence.frames[frame].joints[joint];
                    const double residual = norm(curve_position - original.position_m);
                    if (residual <= options.correction_noise_floor_m) continue;
                    const double low_confidence = clamp01(
                        (options.low_confidence_threshold - original.confidence) /
                        std::max(options.low_confidence_threshold, kEpsilon));
                    const double residual_factor = clamp01(
                        (residual - options.correction_noise_floor_m) /
                        std::max(options.maximum_correction_m, kEpsilon));
                    double strength = options.curve_strength *
                        std::max(low_confidence, 0.2 * residual_factor) *
                        (1.0 - 0.55 * original.confidence);
                    const bool micro_jitter=
                        is_high_confidence_micro_jitter(joint,frame);
                    if(micro_jitter)strength=std::max(
                        strength,options.curve_strength*0.72);
                    if (strength <= kEpsilon) continue;
                    Vec3 correction = bounded_delta(
                        scale(curve_position - original.position_m, strength),
                        micro_jitter
                            ?options.maximum_high_confidence_jitter_correction_m
                            :options.maximum_correction_m);
                    Vec2 image_correction = bounded_delta(
                        scale(curve_image - original.image_xy, strength),
                        micro_jitter
                            ?options.maximum_high_confidence_jitter_image_correction_px
                            :options.maximum_image_correction_px);
                    auto& target = result.sequence.frames[frame].joints[joint];
                    target.position_m += correction;
                    target.image_xy = target.image_xy + image_correction;
                    if(micro_jitter&&norm(correction)>kEpsilon)
                        high_confidence_jitter_corrected[frame*joint_count+joint]=true;
                }
            }
            run_start = run_end + 1;
        }

        if (!is_foot_semantic(skeleton.bones[joint].semantic)) continue;
        const auto near_ground = [&](std::size_t frame) {
            const auto& sample = sequence.frames[frame].joints[joint];
            return sample.valid && sample.position_m.y <=
                ground_height + options.contact_height_threshold_m;
        };
        std::size_t contact_start = 0;
        while (contact_start + 1 < frame_count) {
            while (contact_start + 1 < frame_count &&
                   (!near_ground(contact_start) ||
                    !near_ground(contact_start + 1) ||
                    norm(sequence.frames[contact_start + 1].joints[joint].position_m -
                         sequence.frames[contact_start].joints[joint].position_m) >
                        options.contact_speed_threshold_m)) {
                ++contact_start;
            }
            if (contact_start + 1 >= frame_count) break;
            std::size_t contact_end = contact_start + 1;
            while (contact_end + 1 < frame_count &&
                   near_ground(contact_end + 1) &&
                   norm(sequence.frames[contact_end + 1].joints[joint].position_m -
                        sequence.frames[contact_end].joints[joint].position_m) <=
                       options.contact_speed_threshold_m) ++contact_end;
            if (contact_end - contact_start + 1 >= options.minimum_contact_frames) {
                Vec3 locked_position{};
                double total_weight = 0.0;
                for (std::size_t frame = contact_start; frame <= contact_end; ++frame) {
                    const auto& sample = sequence.frames[frame].joints[joint];
                    const double weight = std::max(0.1, static_cast<double>(sample.confidence));
                    locked_position += scale(sample.position_m, weight);
                    total_weight += weight;
                }
                locked_position = scale(locked_position, 1.0 / total_weight);
                for (std::size_t frame = contact_start; frame <= contact_end; ++frame) {
                    auto& target = result.sequence.frames[frame].joints[joint];
                    const auto& original = sequence.frames[frame].joints[joint];
                    const Vec3 correction = bounded_delta(
                        locked_position - original.position_m,
                        options.maximum_correction_m);
                    const double correction_m = norm(correction);
                    if (correction_m <= kEpsilon) continue;
                    target.position_m = original.position_m + correction;
                    ++result.diagnostics.contact_locked_samples;
                }
            }
            contact_start = contact_end + 1;
        }
    }

    double correction_sum = 0.0;
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        for (std::size_t joint = 0; joint < joint_count; ++joint) {
            const double correction_m = norm(
                result.sequence.frames[frame].joints[joint].position_m -
                sequence.frames[frame].joints[joint].position_m);
            if (correction_m <= kEpsilon) continue;
            if (high_confidence_jitter_corrected[frame * joint_count + joint]) {
                ++result.diagnostics.high_confidence_jitter_corrected_samples;
            }
            correction_sum += correction_m;
            result.diagnostics.maximum_correction_m = std::max(
                result.diagnostics.maximum_correction_m, correction_m);
            ++result.diagnostics.corrected_samples;
        }
    }
    result.diagnostics.mean_correction_m = result.diagnostics.corrected_samples
        ? correction_sum / static_cast<double>(result.diagnostics.corrected_samples)
        : 0.0;
    result.sequence.backend += "+animation-keyframe-curve";
    validate_pose_sequence(result.sequence);
    result.diagnostics.jitter_after = pose_sequence_jitter_metric(result.sequence);
    return result;
}

}  // namespace animocap
