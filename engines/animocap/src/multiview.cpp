#include "animocap/multiview.hpp"

#include "animocap/math.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <limits>
#include <numeric>
#include <stdexcept>
#include <utility>

namespace animocap {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kEpsilon = 1e-9;
constexpr std::size_t kMaximumAlignmentSamples = 600;
constexpr std::size_t kMotionDescriptorDimensions = 11;
using MotionDescriptor = std::array<double, kMotionDescriptorDimensions>;

double length(const Vec3& value) {
    return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

Vec3 rotate_y(const Vec3& value, double degrees) {
    const double angle = degrees * kPi / 180.0;
    const double cosine = std::cos(angle);
    const double sine = std::sin(angle);
    return {
        cosine * value.x + sine * value.z,
        value.y,
        -sine * value.x + cosine * value.z,
    };
}

Vec3 divide(const Vec3& value, double divisor) {
    return {value.x / divisor, value.y / divisor, value.z / divisor};
}

Vec3 interpolate(const Vec3& a, const Vec3& b, double alpha) {
    return (1.0 - alpha) * a + alpha * b;
}

Vec2 interpolate(const Vec2& a, const Vec2& b, double alpha) {
    return {
        a.x + (b.x - a.x) * alpha,
        a.y + (b.y - a.y) * alpha,
    };
}

ObservedJoint sample_joint(
    const PoseSequence& sequence,
    double frame_position,
    std::size_t joint_index
) {
    frame_position = std::clamp(
        frame_position, 0.0, static_cast<double>(sequence.frames.size() - 1));
    const auto before = static_cast<std::size_t>(std::floor(frame_position));
    const auto after = std::min(before + 1, sequence.frames.size() - 1);
    const double alpha = frame_position - static_cast<double>(before);
    const auto& a = sequence.frames[before].joints[joint_index];
    const auto& b = sequence.frames[after].joints[joint_index];
    if (!a.valid && !b.valid) return {};
    if (!a.valid) return b;
    if (!b.valid) return a;
    return {
        interpolate(a.image_xy, b.image_xy, alpha),
        interpolate(a.position_m, b.position_m, alpha),
        static_cast<float>(a.confidence + (b.confidence - a.confidence) * alpha),
        true,
    };
}

double joint_angle_cosine(
    const ObservedPoseFrame& frame,
    std::size_t before,
    std::size_t vertex,
    std::size_t after,
    double fallback
) {
    if (!frame.joints[before].valid || !frame.joints[vertex].valid ||
        !frame.joints[after].valid) return fallback;
    const auto first = frame.joints[before].position_m - frame.joints[vertex].position_m;
    const auto second = frame.joints[after].position_m - frame.joints[vertex].position_m;
    const double denominator = length(first) * length(second);
    if (denominator <= kEpsilon) return fallback;
    return std::clamp(
        (first.x * second.x + first.y * second.y + first.z * second.z) /
            denominator,
        -1.0, 1.0);
}

double descriptor_distance(
    const MotionDescriptor& first,
    const MotionDescriptor& second
) {
    constexpr std::array<double, kMotionDescriptorDimensions> weights{
        1.35, 1.0, 0.8, 0.8, 0.55, 0.75, 0.75, 0.8, 0.8, 0.55, 0.55};
    double cost = 0.0;
    double weight_sum = 0.0;
    for (std::size_t dimension = 0; dimension < first.size(); ++dimension) {
        // A single noisy depth channel must not dominate the complete phase cue.
        cost += weights[dimension] * std::min(
            3.0, std::abs(first[dimension] - second[dimension]));
        weight_sum += weights[dimension];
    }
    return cost / weight_sum;
}

std::vector<MotionDescriptor> motion_descriptor(const PoseSequence& sequence) {
    const auto skeleton = make_default_skeleton();
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    const auto head = bone_index(skeleton, BoneSemantic::Head);
    const auto left_upper_arm = bone_index(skeleton, BoneSemantic::LeftUpperArm);
    const auto left_lower_arm = bone_index(skeleton, BoneSemantic::LeftLowerArm);
    const auto left_hand = bone_index(skeleton, BoneSemantic::LeftHand);
    const auto right_upper_arm = bone_index(skeleton, BoneSemantic::RightUpperArm);
    const auto right_lower_arm = bone_index(skeleton, BoneSemantic::RightLowerArm);
    const auto right_hand = bone_index(skeleton, BoneSemantic::RightHand);
    const auto left_upper_leg = bone_index(skeleton, BoneSemantic::LeftUpperLeg);
    const auto left_lower_leg = bone_index(skeleton, BoneSemantic::LeftLowerLeg);
    const auto left_foot = bone_index(skeleton, BoneSemantic::LeftFoot);
    const auto right_upper_leg = bone_index(skeleton, BoneSemantic::RightUpperLeg);
    const auto right_lower_leg = bone_index(skeleton, BoneSemantic::RightLowerLeg);
    const auto right_foot = bone_index(skeleton, BoneSemantic::RightFoot);
    std::vector<double> speed(sequence.frames.size(), 0.0);
    std::vector<MotionDescriptor> result(sequence.frames.size());
    for (std::size_t frame = 0; frame < sequence.frames.size(); ++frame) {
        const auto& current = sequence.frames[frame];
        if (frame > 0) result[frame] = result[frame - 1];
        const double body_scale = current.joints[hips].valid && current.joints[head].valid
            ? std::max(0.20, length(
                current.joints[head].position_m - current.joints[hips].position_m))
            : 1.0;
        auto normalized_distance = [&](std::size_t a, std::size_t b, double fallback) {
            if (!current.joints[a].valid || !current.joints[b].valid) return fallback;
            return length(current.joints[a].position_m - current.joints[b].position_m) /
                body_scale;
        };
        const double left_hand_head = normalized_distance(
            left_hand, head, result[frame][2]);
        const double right_hand_head = normalized_distance(
            right_hand, head, result[frame][3]);
        const double left_hand_height = current.joints[left_hand].valid &&
                current.joints[hips].valid
            ? (current.joints[left_hand].position_m.y -
               current.joints[hips].position_m.y) / body_scale
            : result[frame][5];
        const double right_hand_height = current.joints[right_hand].valid &&
                current.joints[hips].valid
            ? (current.joints[right_hand].position_m.y -
               current.joints[hips].position_m.y) / body_scale
            : result[frame][6];
        const double left_elbow = joint_angle_cosine(
            current, left_upper_arm, left_lower_arm, left_hand, result[frame][7]);
        const double right_elbow = joint_angle_cosine(
            current, right_upper_arm, right_lower_arm, right_hand, result[frame][8]);
        const double left_knee = joint_angle_cosine(
            current, left_upper_leg, left_lower_leg, left_foot, result[frame][9]);
        const double right_knee = joint_angle_cosine(
            current, right_upper_leg, right_lower_leg, right_foot, result[frame][10]);
        result[frame][1] = normalized_distance(left_hand, right_hand, result[frame][1]);
        result[frame][2] = std::min(left_hand_head, right_hand_head);
        result[frame][3] = std::max(left_hand_head, right_hand_head);
        result[frame][4] = normalized_distance(left_foot, right_foot, result[frame][4]);
        result[frame][5] = std::min(left_hand_height, right_hand_height);
        result[frame][6] = std::max(left_hand_height, right_hand_height);
        result[frame][7] = std::min(left_elbow, right_elbow);
        result[frame][8] = std::max(left_elbow, right_elbow);
        result[frame][9] = std::min(left_knee, right_knee);
        result[frame][10] = std::max(left_knee, right_knee);
        if (frame == 0) continue;
        const auto& before = sequence.frames[frame - 1];
        if (!before.joints[hips].valid || !current.joints[hips].valid) continue;
        const Vec3 before_hips = before.joints[hips].position_m;
        const Vec3 current_hips = current.joints[hips].position_m;
        double weighted_speed = 0.0;
        double total_weight = 0.0;
        for (std::size_t joint = 1; joint < current.joints.size(); ++joint) {
            const auto& a = before.joints[joint];
            const auto& b = current.joints[joint];
            if (!a.valid || !b.valid) continue;
            const Vec3 local_a = a.position_m - before_hips;
            const Vec3 local_b = b.position_m - current_hips;
            const double weight = std::sqrt(
                static_cast<double>(a.confidence) * static_cast<double>(b.confidence));
            weighted_speed += weight * length(local_b - local_a) / body_scale;
            total_weight += weight;
        }
        const double delta_time = std::max(1e-4, current.time_s - before.time_s);
        if (total_weight > 0.0) speed[frame] = weighted_speed / total_weight / delta_time;
    }
    if (speed.size() > 1) speed[0] = speed[1];
    for (std::size_t frame = 0; frame < result.size(); ++frame)
        result[frame][0] = speed[frame];
    for (std::size_t dimension = 0; dimension < kMotionDescriptorDimensions; ++dimension) {
        double mean = 0.0;
        for (const auto& value : result) mean += value[dimension];
        mean /= static_cast<double>(result.size());
        double variance = 0.0;
        for (const auto& value : result)
            variance += (value[dimension] - mean) * (value[dimension] - mean);
        const double scale = std::sqrt(
            variance / static_cast<double>(result.size()) + 1e-8);
        for (auto& value : result) value[dimension] =
            (value[dimension] - mean) / scale;
    }
    return result;
}

std::vector<double> view_invariant_motion_energy(const PoseSequence& sequence) {
    const auto skeleton = make_default_skeleton();
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    const auto head = bone_index(skeleton, BoneSemantic::Head);
    std::vector<double> raw(sequence.frames.size(), 0.0);
    for (std::size_t frame = 1; frame < sequence.frames.size(); ++frame) {
        const auto& current = sequence.frames[frame];
        const auto& before = sequence.frames[frame - 1];
        if (!current.joints[hips].valid || !current.joints[head].valid ||
            !before.joints[hips].valid || !before.joints[head].valid) continue;
        const double current_scale = std::max(50.0, std::hypot(
            current.joints[head].image_xy.x - current.joints[hips].image_xy.x,
            current.joints[head].image_xy.y - current.joints[hips].image_xy.y));
        const double before_scale = std::max(50.0, std::hypot(
            before.joints[head].image_xy.x - before.joints[hips].image_xy.x,
            before.joints[head].image_xy.y - before.joints[hips].image_xy.y));
        std::vector<double> speeds;
        speeds.reserve(current.joints.size());
        for (std::size_t joint = 1; joint < current.joints.size(); ++joint) {
            if (!current.joints[joint].valid || !before.joints[joint].valid) continue;
            const Vec2 current_local{
                (current.joints[joint].image_xy.x - current.joints[hips].image_xy.x) /
                    current_scale,
                (current.joints[joint].image_xy.y - current.joints[hips].image_xy.y) /
                    current_scale,
            };
            const Vec2 before_local{
                (before.joints[joint].image_xy.x - before.joints[hips].image_xy.x) /
                    before_scale,
                (before.joints[joint].image_xy.y - before.joints[hips].image_xy.y) /
                    before_scale,
            };
            speeds.push_back(std::hypot(
                current_local.x - before_local.x,
                current_local.y - before_local.y));
        }
        if (speeds.empty()) continue;
        std::sort(speeds.begin(), speeds.end());
        // Ignore the fastest fifth: a single mistracked extremity is not an
        // authored animation event and must not decide phase alignment.
        const std::size_t retained = std::max<std::size_t>(
            1, speeds.size() * 4 / 5);
        raw[frame] = std::accumulate(
            speeds.begin(), speeds.begin() + static_cast<std::ptrdiff_t>(retained),
            0.0) / static_cast<double>(retained);
    }
    if (raw.size() > 1) raw[0] = raw[1];
    std::vector<double> smoothed(raw.size(), 0.0);
    constexpr std::size_t kRadius = 3;
    for (std::size_t frame = 0; frame < raw.size(); ++frame) {
        const std::size_t begin = frame > kRadius ? frame - kRadius : 0;
        const std::size_t end = std::min(raw.size(), frame + kRadius + 1);
        smoothed[frame] = std::accumulate(
            raw.begin() + static_cast<std::ptrdiff_t>(begin),
            raw.begin() + static_cast<std::ptrdiff_t>(end), 0.0) /
            static_cast<double>(end - begin);
    }
    return smoothed;
}

double sample_scalar(const std::vector<double>& values, double position) {
    position = std::clamp(position, 0.0, static_cast<double>(values.size() - 1));
    const auto before = static_cast<std::size_t>(std::floor(position));
    const auto after = std::min(before + 1, values.size() - 1);
    const double alpha = position - static_cast<double>(before);
    return values[before] + (values[after] - values[before]) * alpha;
}
struct ReducedSignal {
    std::vector<MotionDescriptor> values;
    std::vector<double> original_frame;
};

ReducedSignal reduce_signal(const std::vector<MotionDescriptor>& source) {
    const std::size_t count = std::min(source.size(), kMaximumAlignmentSamples);
    ReducedSignal result;
    result.values.reserve(count);
    result.original_frame.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        const double begin = static_cast<double>(index) * source.size() / count;
        const double end = static_cast<double>(index + 1) * source.size() / count;
        const std::size_t first = static_cast<std::size_t>(std::floor(begin));
        const std::size_t last = std::max(first + 1, static_cast<std::size_t>(std::ceil(end)));
        MotionDescriptor sum{};
        std::size_t samples = 0;
        for (std::size_t item = first; item < std::min(last, source.size()); ++item) {
            for (std::size_t dimension = 0; dimension < sum.size(); ++dimension)
                sum[dimension] += source[item][dimension];
            ++samples;
        }
        if (samples)
            for (double& value : sum) value /= static_cast<double>(samples);
        result.values.push_back(samples ? sum : source[first]);
        result.original_frame.push_back((begin + end - 1.0) * 0.5);
    }
    return result;
}

ViewAlignment align_view(
    const PoseSequence& reference,
    const PoseSequence& source,
    std::string view_id,
    double maximum_warp_fraction,
    double time_offset_s
) {
    ViewAlignment result;
    result.view_id = std::move(view_id);
    if (&reference == &source) {
        result.source_frame_at_reference.resize(reference.frames.size());
        std::iota(
            result.source_frame_at_reference.begin(),
            result.source_frame_at_reference.end(), 0.0);
        result.method = "reference";
        result.overlap_reference_frames = reference.frames.size();
        return result;
    }

    const auto reference_energy = view_invariant_motion_energy(reference);
    const auto source_energy = view_invariant_motion_energy(source);
    const auto reference_descriptors = motion_descriptor(reference);
    const auto source_descriptors = motion_descriptor(source);
    const double infinity = std::numeric_limits<double>::infinity();
    double best_offset = 0.0;
    double best_rate = source.fps / reference.fps;
    double best_quality = -infinity;
    double best_correlation = -1.0;
    double best_descriptor_cost = 3.0;
    const double maximum_offset = std::max(
        2.0, source.frames.size() * std::clamp(maximum_warp_fraction, 0.05, 0.80));
    const bool has_explicit_offset = std::abs(time_offset_s) > kEpsilon;
    const double expected_rate = source.fps / reference.fps;
    const double fixed_offset = time_offset_s * source.fps;
    const std::size_t minimum_overlap = std::max<std::size_t>(
        12, std::min(reference.frames.size(), source.frames.size()) * 55 / 100);
    const int minimum_rate_step = has_explicit_offset ? 0 : -30;
    const int maximum_rate_step = has_explicit_offset ? 0 : 30;
    for (int rate_step = minimum_rate_step;
         rate_step <= maximum_rate_step; ++rate_step) {
        const double rate = expected_rate * (1.0 + rate_step * 0.005);
        const double offset_begin = has_explicit_offset ? fixed_offset : -maximum_offset;
        const double offset_end = has_explicit_offset ? fixed_offset : maximum_offset;
        for (double offset = offset_begin; offset <= offset_end + 0.25; offset += 1.0) {
            std::vector<double> reference_samples;
            std::vector<double> source_samples;
            double descriptor_cost = 0.0;
            std::size_t descriptor_samples = 0;
            for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
                const double source_frame = offset + rate * static_cast<double>(frame);
                if (source_frame < 0.0 ||
                    source_frame > static_cast<double>(source.frames.size() - 1)) continue;
                reference_samples.push_back(reference_energy[frame]);
                source_samples.push_back(sample_scalar(source_energy, source_frame));
                if (frame % std::max<std::size_t>(
                        1, reference.frames.size() / kMaximumAlignmentSamples) == 0) {
                    const auto before = static_cast<std::size_t>(std::floor(source_frame));
                    const auto after = std::min(before + 1, source_descriptors.size() - 1);
                    const double alpha = source_frame - static_cast<double>(before);
                    MotionDescriptor sampled{};
                    for (std::size_t dimension = 0; dimension < sampled.size(); ++dimension)
                        sampled[dimension] = source_descriptors[before][dimension] +
                            (source_descriptors[after][dimension] -
                             source_descriptors[before][dimension]) * alpha;
                    descriptor_cost += descriptor_distance(
                        reference_descriptors[frame], sampled);
                    ++descriptor_samples;
                }
            }
            if (reference_samples.size() < minimum_overlap) continue;
            const double reference_mean = std::accumulate(
                reference_samples.begin(), reference_samples.end(), 0.0) /
                static_cast<double>(reference_samples.size());
            const double source_mean = std::accumulate(
                source_samples.begin(), source_samples.end(), 0.0) /
                static_cast<double>(source_samples.size());
            double covariance = 0.0;
            double reference_variance = 0.0;
            double source_variance = 0.0;
            for (std::size_t sample = 0; sample < reference_samples.size(); ++sample) {
                const double a = reference_samples[sample] - reference_mean;
                const double b = source_samples[sample] - source_mean;
                covariance += a * b;
                reference_variance += a * a;
                source_variance += b * b;
            }
            const double denominator = std::sqrt(
                reference_variance * source_variance);
            const double correlation = denominator > 1e-12
                ? covariance / denominator : -1.0;
            const double normalized_descriptor_cost = descriptor_samples
                ? descriptor_cost / static_cast<double>(descriptor_samples) : 3.0;
            const double overlap_ratio = static_cast<double>(reference_samples.size()) /
                static_cast<double>(reference.frames.size());
            const double quality = 0.85 * correlation -
                0.15 * normalized_descriptor_cost -
                0.20 * std::abs(rate / expected_rate - 1.0) +
                0.03 * overlap_ratio;
            if (quality > best_quality) {
                best_quality = quality;
                best_correlation = correlation;
                best_descriptor_cost = normalized_descriptor_cost;
                best_offset = offset;
                best_rate = rate;
            }
        }
    }
    if (!std::isfinite(best_quality)) {
        throw ContractError("directional view alignment found no sufficient common action interval");
    }
    result.source_frame_at_reference.resize(reference.frames.size());
    for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
        result.source_frame_at_reference[frame] =
            best_offset + best_rate * static_cast<double>(frame);
    }
    double offset_sum = 0.0;
    std::size_t offset_samples = 0;
    for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
        const double source_frame = result.source_frame_at_reference[frame];
        if (source_frame < 0.0 ||
            source_frame > static_cast<double>(source.frames.size() - 1)) {
            ++result.out_of_range_reference_frames;
            continue;
        }
        ++result.overlap_reference_frames;
        const auto source_index = static_cast<std::size_t>(std::clamp(
            std::llround(source_frame), 0LL,
            static_cast<long long>(source.frames.size() - 1)));
        offset_sum += source.frames[source_index].time_s - reference.frames[frame].time_s;
        ++offset_samples;
    }
    result.mean_offset_s = offset_samples
        ? offset_sum / static_cast<double>(offset_samples) : 0.0;
    const double reference_duration =
        reference.frames.back().time_s - reference.frames.front().time_s;
    const double source_duration =
        (result.source_frame_at_reference.back() - result.source_frame_at_reference.front()) /
        source.fps;
    result.mean_rate = reference_duration > kEpsilon
        ? source_duration / reference_duration : 1.0;
    // Correlation is a phase-quality signal, not a pose-confidence score. Keep
    // it bounded so a valid oblique view still contributes after alignment.
    result.normalized_cost = best_correlation > -0.99
        ? std::clamp(0.35 * (1.0 - best_correlation), 0.0, 0.70)
        : std::clamp(0.35 * best_descriptor_cost, 0.0, 0.70);
    return result;
}

std::vector<std::pair<std::size_t, std::size_t>> mirrored_pairs(const Skeleton& skeleton) {
    return {
        {bone_index(skeleton, BoneSemantic::LeftShoulder), bone_index(skeleton, BoneSemantic::RightShoulder)},
        {bone_index(skeleton, BoneSemantic::LeftUpperArm), bone_index(skeleton, BoneSemantic::RightUpperArm)},
        {bone_index(skeleton, BoneSemantic::LeftLowerArm), bone_index(skeleton, BoneSemantic::RightLowerArm)},
        {bone_index(skeleton, BoneSemantic::LeftHand), bone_index(skeleton, BoneSemantic::RightHand)},
        {bone_index(skeleton, BoneSemantic::LeftUpperLeg), bone_index(skeleton, BoneSemantic::RightUpperLeg)},
        {bone_index(skeleton, BoneSemantic::LeftLowerLeg), bone_index(skeleton, BoneSemantic::RightLowerLeg)},
        {bone_index(skeleton, BoneSemantic::LeftFoot), bone_index(skeleton, BoneSemantic::RightFoot)},
        {bone_index(skeleton, BoneSemantic::LeftToes), bone_index(skeleton, BoneSemantic::RightToes)},
    };
}

std::vector<ObservedJoint> aligned_world_joints(
    const MultiviewPoseInput& view,
    double source_frame,
    std::size_t hips
) {
    std::vector<ObservedJoint> result(view.pose.frames.front().joints.size());
    if (source_frame < 0.0 ||
        source_frame > static_cast<double>(view.pose.frames.size() - 1)) {
        return result;
    }
    const auto hip = sample_joint(view.pose, source_frame, hips);
    for (std::size_t joint = 0; joint < result.size(); ++joint) {
        result[joint] = sample_joint(view.pose, source_frame, joint);
        if (result[joint].valid && hip.valid) {
            result[joint].position_m = rotate_y(
                result[joint].position_m - hip.position_m, view.yaw_degrees);
        } else {
            result[joint].valid = false;
            result[joint].confidence = 0.0f;
        }
    }
    return result;
}

double assignment_cost(
    const std::vector<ObservedJoint>& reference,
    const std::vector<ObservedJoint>& candidate,
    const std::vector<std::pair<std::size_t, std::size_t>>& pairs,
    bool swapped
) {
    double cost = 0.0;
    double weight_sum = 0.0;
    for (const auto [left, right] : pairs) {
        for (const auto target : {left, right}) {
            const auto source = swapped ? (target == left ? right : left) : target;
            if (!reference[target].valid || !candidate[source].valid) continue;
            const double weight = static_cast<double>(reference[target].confidence) *
                static_cast<double>(candidate[source].confidence);
            const double distance = length(
                reference[target].position_m - candidate[source].position_m);
            cost += weight * distance * distance;
            weight_sum += weight;
        }
    }
    return weight_sum > 0.0 ? cost / weight_sum : std::numeric_limits<double>::infinity();
}

double semantic_side(BoneSemantic semantic) {
    switch (semantic) {
    case BoneSemantic::LeftShoulder:
    case BoneSemantic::LeftUpperArm:
    case BoneSemantic::LeftLowerArm:
    case BoneSemantic::LeftHand:
    case BoneSemantic::LeftUpperLeg:
    case BoneSemantic::LeftLowerLeg:
    case BoneSemantic::LeftFoot:
    case BoneSemantic::LeftToes:
        return 1.0;
    case BoneSemantic::RightShoulder:
    case BoneSemantic::RightUpperArm:
    case BoneSemantic::RightLowerArm:
    case BoneSemantic::RightHand:
    case BoneSemantic::RightUpperLeg:
    case BoneSemantic::RightLowerLeg:
    case BoneSemantic::RightFoot:
    case BoneSemantic::RightToes:
        return -1.0;
    default:
        return 0.0;
    }
}

std::size_t mirrored_joint_index(const Skeleton& skeleton, std::size_t joint) {
    for (const auto [left, right] : mirrored_pairs(skeleton)) {
        if (joint == left) return right;
        if (joint == right) return left;
    }
    return skeleton.bones.size();
}

Vec3 body_left_axis(
    const std::vector<ObservedJoint>& joints,
    const Skeleton& skeleton
) {
    const std::array<std::pair<BoneSemantic, BoneSemantic>, 2> spans{{
        {BoneSemantic::LeftShoulder, BoneSemantic::RightShoulder},
        {BoneSemantic::LeftUpperLeg, BoneSemantic::RightUpperLeg},
    }};
    Vec3 axis{};
    double total_weight = 0.0;
    for (const auto [left_semantic, right_semantic] : spans) {
        const auto left = bone_index(skeleton, left_semantic);
        const auto right = bone_index(skeleton, right_semantic);
        if (!joints[left].valid || !joints[right].valid) continue;
        Vec3 candidate = joints[left].position_m - joints[right].position_m;
        candidate.y = 0.0;
        const double magnitude = length(candidate);
        if (magnitude <= kEpsilon) continue;
        const double weight = std::sqrt(
            static_cast<double>(joints[left].confidence) *
            static_cast<double>(joints[right].confidence));
        axis += weight * divide(candidate, magnitude);
        total_weight += weight;
    }
    const double magnitude = length(axis);
    return total_weight > 0.0 && magnitude > kEpsilon
        ? divide(axis, magnitude) : Vec3{1.0, 0.0, 0.0};
}

struct VisibilityWeight {
    double factor{1.0};
    bool overlap_downweighted{};
};

VisibilityWeight joint_view_visibility_weight(
    const std::vector<std::vector<ObservedJoint>>& samples,
    const std::vector<MultiviewPoseInput>& views,
    const std::vector<double>& pixels_per_meter,
    const Skeleton& skeleton,
    const MultiviewSolveOptions& options,
    const Vec3& reference_body_left_axis,
    std::size_t view,
    std::size_t joint
) {
    VisibilityWeight result;
    const auto& observation = samples[view][joint];
    const double side = semantic_side(skeleton.bones[joint].semantic);
    double side_alignment = 0.0;
    if (side != 0.0) {
        const Vec3 outward = side > 0.0
            ? reference_body_left_axis : -1.0 * reference_body_left_axis;
        const double yaw = views[view].yaw_degrees * kPi / 180.0;
        // Camera position relative to the subject under the directional yaw
        // convention. A +90 degree "right" view faces the body's right side.
        const Vec3 subject_to_camera{-std::sin(yaw), 0.0, std::cos(yaw)};
        side_alignment = std::clamp(
            outward.x * subject_to_camera.x + outward.z * subject_to_camera.z,
            -1.0, 1.0);
        result.factor *= 1.0 +
            options.maximum_near_side_visibility_bonus *
                std::max(0.0, side_alignment) -
            options.maximum_far_side_visibility_penalty *
                std::max(0.0, -side_alignment);
    }

    const auto mirrored = mirrored_joint_index(skeleton, joint);
    if (mirrored < skeleton.bones.size() && samples[view][mirrored].valid) {
        const auto& other = samples[view][mirrored];
        const double separation_m = std::hypot(
            observation.image_xy.x - other.image_xy.x,
            observation.image_xy.y - other.image_xy.y) /
            std::max(1.0, pixels_per_meter[view]);
        if (separation_m < options.mirrored_joint_overlap_threshold_m) {
            const double overlap = 1.0 - separation_m /
                std::max(options.mirrored_joint_overlap_threshold_m, kEpsilon);
            const double penalty = side_alignment < -0.05 ? 0.60 : 0.22;
            result.factor *= 1.0 - penalty * overlap;
            result.overlap_downweighted = true;
        }
    }

    const int parent = skeleton.bones[joint].parent;
    if (parent > 0 && samples[view][static_cast<std::size_t>(parent)].valid) {
        std::vector<double> segment_lengths;
        for (const auto& view_samples : samples) {
            if (!view_samples[joint].valid ||
                !view_samples[static_cast<std::size_t>(parent)].valid) continue;
            segment_lengths.push_back(length(
                view_samples[joint].position_m -
                view_samples[static_cast<std::size_t>(parent)].position_m));
        }
        if (segment_lengths.size() >= 2) {
            std::sort(segment_lengths.begin(), segment_lengths.end());
            const double median = segment_lengths[segment_lengths.size() / 2];
            const double observed = length(
                observation.position_m -
                samples[view][static_cast<std::size_t>(parent)].position_m);
            if (median > kEpsilon) {
                const double relative_error = std::abs(observed - median) / median;
                // Small cross-view length differences are ordinary monocular
                // depth noise. Only a material segment anomaly becomes
                // visibility evidence; the dead band prevents frame-to-frame
                // weight shimmer on otherwise stable animation.
                if (relative_error > 0.20) {
                    result.factor *= std::clamp(
                        1.0 - 0.65 * (relative_error - 0.20), 0.65, 1.0);
                }
            }
        }
    }

    const double width = static_cast<double>(views[view].pose.image_width);
    const double height = static_cast<double>(views[view].pose.image_height);
    if (observation.image_xy.x < width * 0.02 ||
        observation.image_xy.x > width * 0.98 ||
        observation.image_xy.y < height * 0.02 ||
        observation.image_xy.y > height * 0.98) {
        result.factor *= 0.70;
    }
    result.factor = std::clamp(result.factor, 0.30, 1.20);
    return result;
}

struct JointTriangulation {
    bool valid{};
    Vec3 relative_position{};
    float confidence{};
    std::size_t contributors{};
    std::size_t rejected_view_observations{};
    std::size_t visibility_evaluated_observations{};
    std::size_t visibility_downweighted_observations{};
    std::size_t visibility_boosted_observations{};
    std::size_t overlap_downweighted_observations{};
    std::size_t temporal_outlier_downweighted_observations{};
    bool reference_rejected{};
    bool temporal_disagreement{};
    double maximum_residual{};
    double reference_residual{};
    double rms_residual{};
};

struct TemporalViewState {
    Vec2 position{};
    Vec2 velocity{};
    std::size_t last_frame{std::numeric_limits<std::size_t>::max()};
    bool has_velocity{};
};

double estimate_pixels_per_meter(
    const std::vector<ObservedJoint>& joints,
    std::size_t head,
    std::size_t left_foot,
    std::size_t right_foot,
    std::size_t image_height
) {
    double weighted_scale = 0.0;
    double total_weight = 0.0;
    for (const auto foot : {left_foot, right_foot}) {
        if (!joints[head].valid || !joints[foot].valid) continue;
        const double vertical_m = std::abs(
            joints[head].position_m.y - joints[foot].position_m.y);
        const double vertical_px = std::abs(
            joints[head].image_xy.y - joints[foot].image_xy.y);
        if (vertical_m < 0.25 || vertical_px < 8.0) continue;
        const double weight = std::sqrt(
            static_cast<double>(joints[head].confidence) *
            static_cast<double>(joints[foot].confidence));
        weighted_scale += weight * vertical_px / vertical_m;
        total_weight += weight;
    }
    const double fallback = static_cast<double>(image_height) / 1.7;
    return std::clamp(
        total_weight > 0.0 ? weighted_scale / total_weight : fallback,
        fallback * 0.35, fallback * 3.0);
}

JointTriangulation triangulate_joint(
    const std::vector<std::vector<ObservedJoint>>& samples,
    const std::vector<MultiviewPoseInput>& views,
    const std::vector<ViewAlignment>& alignments,
    const std::vector<double>& pixels_per_meter,
    const Skeleton& skeleton,
    const MultiviewSolveOptions& options,
    std::vector<std::vector<double>>& visibility_state,
    std::vector<std::vector<std::size_t>>& visibility_last_frame,
    std::vector<std::vector<TemporalViewState>>& temporal_view_state,
    std::size_t frame_index,
    std::size_t joint,
    std::size_t hips
) {
    JointTriangulation result;
    std::vector<std::size_t> usable_views;
    usable_views.reserve(samples.size());
    for (std::size_t view = 0; view < samples.size(); ++view) {
        const auto& observation = samples[view][joint];
        const auto& hip = samples[view][hips];
        if (observation.valid && hip.valid &&
            observation.confidence >= options.minimum_confidence) {
            usable_views.push_back(view);
        }
    }
    std::vector<double> visibility_factor(samples.size(), 1.0);
    if (options.enable_view_visibility_weighting) {
        const Vec3 reference_left_axis = body_left_axis(
            samples[options.reference_view], skeleton);
        for (const auto view : usable_views) {
            const auto visibility = joint_view_visibility_weight(
                samples, views, pixels_per_meter, skeleton, options,
                reference_left_axis, view, joint);
            double factor=visibility.factor;
            if(visibility_last_frame[view][joint]!=
                   std::numeric_limits<std::size_t>::max()&&
               visibility_last_frame[view][joint]+1==frame_index) {
                // Visibility is expected to evolve over several animation
                // frames. A short causal filter prevents tiny pose/depth noise
                // from modulating fusion weights at video frequency.
                factor=0.65*visibility_state[view][joint]+0.35*factor;
            }
            visibility_state[view][joint]=factor;
            visibility_last_frame[view][joint]=frame_index;
            visibility_factor[view] = factor;
            ++result.visibility_evaluated_observations;
            if (factor < 1.0 - 1e-6)
                ++result.visibility_downweighted_observations;
            else if (factor > 1.0 + 1e-6)
                ++result.visibility_boosted_observations;
            if (visibility.overlap_downweighted)
                ++result.overlap_downweighted_observations;
        }
    }
    std::vector<double> temporal_factor(samples.size(), 1.0);
    if (options.enable_temporal_view_reliability) {
        std::vector<double> acceleration(samples.size(), 0.0);
        std::vector<double> comparable_acceleration;
        std::vector<bool> has_acceleration(samples.size(), false);
        for (const auto view : usable_views) {
            const auto& observation = samples[view][joint];
            const auto& hip = samples[view][hips];
            const double scale = std::max(1.0, pixels_per_meter[view]);
            const Vec2 current{
                (observation.image_xy.x - hip.image_xy.x) / scale,
                -(observation.image_xy.y - hip.image_xy.y) / scale};
            auto& state = temporal_view_state[view][joint];
            if (state.last_frame != std::numeric_limits<std::size_t>::max() &&
                state.last_frame + 1 == frame_index) {
                const Vec2 velocity{
                    current.x - state.position.x,
                    current.y - state.position.y};
                if (state.has_velocity) {
                    acceleration[view] = std::hypot(
                        velocity.x - state.velocity.x,
                        velocity.y - state.velocity.y);
                    comparable_acceleration.push_back(acceleration[view]);
                    has_acceleration[view] = true;
                }
                state.velocity = velocity;
                state.has_velocity = true;
            } else {
                state.velocity = {};
                state.has_velocity = false;
            }
            state.position = current;
            state.last_frame = frame_index;
        }
        if (comparable_acceleration.size() >= 3) {
            std::sort(comparable_acceleration.begin(), comparable_acceleration.end());
            const double median = comparable_acceleration[
                comparable_acceleration.size() / 2];
            const double threshold = std::max(
                options.temporal_outlier_acceleration_m,
                median * options.temporal_outlier_ratio + 0.005);
            for (const auto view : usable_views) {
                if (!has_acceleration[view] || acceleration[view] <= threshold)
                    continue;
                temporal_factor[view] = std::clamp(
                    threshold / std::max(acceleration[view], kEpsilon),
                    0.05, 1.0);
                ++result.temporal_outlier_downweighted_observations;
                result.temporal_disagreement = true;
            }
        }
    }
    std::vector<bool> rejected(samples.size(), false);
    if (usable_views.size() >= 3) {
        // Build deterministic pair hypotheses directly from the 2D
        // hip-relative observations. This keeps consensus in the same
        // ROI/body-scale coordinate system as the final orthographic solve;
        // view-dependent MotionBERT depth is deliberately not a gate here.
        struct ReprojectionHypothesis {
            Vec3 position{};
            std::vector<std::size_t> inliers;
            double weighted_residual{std::numeric_limits<double>::infinity()};
        } best_hypothesis;
        bool have_hypothesis = false;
        auto observation_values = [&](std::size_t view) {
            const auto& observation = samples[view][joint];
            const auto& hip = samples[view][hips];
            const double angle = views[view].yaw_degrees * kPi / 180.0;
            const double scale = std::max(1.0, pixels_per_meter[view]);
            return std::array<double, 4>{
                std::cos(angle),
                -std::sin(angle),
                (observation.image_xy.x - hip.image_xy.x) / scale,
                -(observation.image_xy.y - hip.image_xy.y) / scale};
        };
        auto observation_weight = [&](std::size_t view) {
            const double quality = 1.0 /
                (1.0 + 2.0 * alignments[view].normalized_cost);
            const double confidence = samples[view][joint].confidence;
            return quality * confidence * confidence * visibility_factor[view] *
                temporal_factor[view];
        };
        for (std::size_t first = 0; first < usable_views.size(); ++first) {
            for (std::size_t second = first + 1;
                 second < usable_views.size(); ++second) {
                const auto first_view = usable_views[first];
                const auto second_view = usable_views[second];
                const auto first_values = observation_values(first_view);
                const auto second_values = observation_values(second_view);
                const double determinant = first_values[0] * second_values[1] -
                    second_values[0] * first_values[1];
                if (std::abs(determinant) <= 1e-7) continue;
                const double x = (first_values[2] * second_values[1] -
                                  second_values[2] * first_values[1]) /
                    determinant;
                const double z = (first_values[0] * second_values[2] -
                                  second_values[0] * first_values[2]) /
                    determinant;
                const double first_weight = observation_weight(first_view);
                const double second_weight = observation_weight(second_view);
                const double y = (first_weight * first_values[3] +
                                  second_weight * second_values[3]) /
                    std::max(kEpsilon, first_weight + second_weight);
                ReprojectionHypothesis candidate;
                candidate.position = {x, y, z};
                double weighted_squared_residual = 0.0;
                double residual_weight = 0.0;
                for (const auto view : usable_views) {
                    const auto values = observation_values(view);
                    const double residual = std::hypot(
                        values[0] * x + values[1] * z - values[2],
                        y - values[3]);
                    const double weight = observation_weight(view);
                    if (residual <= options.conflict_threshold_m) {
                        candidate.inliers.push_back(view);
                        weighted_squared_residual += weight * residual * residual;
                        residual_weight += weight;
                    }
                }
                candidate.weighted_residual = residual_weight > 0.0
                    ? weighted_squared_residual / residual_weight
                    : std::numeric_limits<double>::infinity();
                if (!have_hypothesis ||
                    candidate.inliers.size() > best_hypothesis.inliers.size() ||
                    (candidate.inliers.size() == best_hypothesis.inliers.size() &&
                     candidate.weighted_residual <
                         best_hypothesis.weighted_residual)) {
                    best_hypothesis = std::move(candidate);
                    have_hypothesis = true;
                }
            }
        }
        const std::size_t required_consensus = usable_views.size() / 2 + 1;
        if (have_hypothesis && best_hypothesis.inliers.size() >= required_consensus &&
            best_hypothesis.inliers.size() < usable_views.size()) {
            for (const auto view : usable_views) {
                if (std::find(best_hypothesis.inliers.begin(),
                              best_hypothesis.inliers.end(), view) ==
                    best_hypothesis.inliers.end()) {
                    rejected[view] = true;
                    ++result.rejected_view_observations;
                }
            }
        }
    }
    result.reference_rejected = rejected[options.reference_view];
    std::vector<double> robust_factor(samples.size(), 1.0);
    Vec3 estimate{};
    for (int iteration = 0; iteration < 3; ++iteration) {
        double m00 = 0.0, m01 = 0.0, m11 = 0.0;
        double bx = 0.0, bz = 0.0, by = 0.0, vertical_weight = 0.0;
        Vec3 fallback{};
        double fallback_weight = 0.0;
        for (std::size_t view = 0; view < samples.size(); ++view) {
            const auto& observation = samples[view][joint];
            const auto& hip = samples[view][hips];
            if (rejected[view] || !observation.valid || !hip.valid ||
                observation.confidence < options.minimum_confidence) continue;
            const double quality = 1.0 /
                (1.0 + 2.0 * alignments[view].normalized_cost);
            const double weight = quality * observation.confidence *
                observation.confidence * robust_factor[view] *
                visibility_factor[view] * temporal_factor[view];
            const double angle = views[view].yaw_degrees * kPi / 180.0;
            const double row_x = std::cos(angle);
            const double row_z = -std::sin(angle);
            const double scale = std::max(1.0, pixels_per_meter[view]);
            const double horizontal =
                (observation.image_xy.x - hip.image_xy.x) / scale;
            const double vertical =
                -(observation.image_xy.y - hip.image_xy.y) / scale;
            m00 += weight * row_x * row_x;
            m01 += weight * row_x * row_z;
            m11 += weight * row_z * row_z;
            bx += weight * row_x * horizontal;
            bz += weight * row_z * horizontal;
            by += weight * vertical;
            vertical_weight += weight;
            fallback += weight * observation.position_m;
            fallback_weight += weight;
        }
        if (vertical_weight <= 0.0) return result;
        const double determinant = m00 * m11 - m01 * m01;
        if (std::abs(determinant) > 1e-7) {
            estimate.x = (bx * m11 - bz * m01) / determinant;
            estimate.z = (bz * m00 - bx * m01) / determinant;
        } else if (fallback_weight > 0.0) {
            const auto fallback_estimate = divide(fallback, fallback_weight);
            estimate.x = fallback_estimate.x;
            estimate.z = fallback_estimate.z;
        }
        estimate.y = by / vertical_weight;
        if (iteration < 2) {
            for (std::size_t view = 0; view < samples.size(); ++view) {
                const auto& observation = samples[view][joint];
                const auto& hip = samples[view][hips];
                if (rejected[view] || !observation.valid || !hip.valid ||
                    observation.confidence < options.minimum_confidence) continue;
                const double angle = views[view].yaw_degrees * kPi / 180.0;
                const double predicted_horizontal =
                    std::cos(angle) * estimate.x - std::sin(angle) * estimate.z;
                const double scale = std::max(1.0, pixels_per_meter[view]);
                const double horizontal =
                    (observation.image_xy.x - hip.image_xy.x) / scale;
                const double vertical =
                    -(observation.image_xy.y - hip.image_xy.y) / scale;
                const double residual = std::hypot(
                    predicted_horizontal - horizontal, estimate.y - vertical);
                robust_factor[view] = residual <= options.conflict_threshold_m
                    ? 1.0 : options.conflict_threshold_m /
                        std::max(residual, kEpsilon);
            }
        }
    }

    double weighted_squared_error = 0.0;
    double total_weight = 0.0;
    double confidence_complement = 1.0;
    for (std::size_t view = 0; view < samples.size(); ++view) {
        const auto& observation = samples[view][joint];
        const auto& hip = samples[view][hips];
        if (!observation.valid || !hip.valid ||
            observation.confidence < options.minimum_confidence) continue;
        const double angle = views[view].yaw_degrees * kPi / 180.0;
        const double predicted_horizontal =
            std::cos(angle) * estimate.x - std::sin(angle) * estimate.z;
        const double scale = std::max(1.0, pixels_per_meter[view]);
        const double horizontal =
            (observation.image_xy.x - hip.image_xy.x) / scale;
        const double vertical =
            -(observation.image_xy.y - hip.image_xy.y) / scale;
        const double residual = std::hypot(
            predicted_horizontal - horizontal, estimate.y - vertical);
        result.maximum_residual = std::max(result.maximum_residual, residual);
        if (view == options.reference_view) result.reference_residual = residual;
        if (rejected[view]) continue;
        const double quality = 1.0 /
            (1.0 + 2.0 * alignments[view].normalized_cost);
        const double weight = quality * observation.confidence *
            observation.confidence * robust_factor[view] *
            visibility_factor[view] * temporal_factor[view];
        weighted_squared_error += weight * residual * residual;
        total_weight += weight;
        confidence_complement *= 1.0 - quality * observation.confidence *
            std::min(1.0, visibility_factor[view]);
        ++result.contributors;
    }
    result.valid = result.contributors > 0 && total_weight > 0.0;
    result.relative_position = estimate;
    result.confidence = static_cast<float>(std::clamp(
        1.0 - confidence_complement, 0.0, 1.0));
    result.rms_residual = result.valid
        ? std::sqrt(weighted_squared_error / total_weight) : 0.0;
    return result;
}
void enforce_bone_lengths(
    std::vector<ObservedJoint>& joints,
    const Skeleton& skeleton,
    double weight
) {
    weight = std::clamp(weight, 0.0, 1.0);
    for (int iteration = 0; iteration < 3; ++iteration) {
        for (std::size_t joint = 1; joint < joints.size(); ++joint) {
            const int parent_value = skeleton.bones[joint].parent;
            if (parent_value < 0 || !joints[joint].valid) continue;
            const auto parent = static_cast<std::size_t>(parent_value);
            if (!joints[parent].valid) continue;
            const double target_length = length(skeleton.bones[joint].rest_offset_m);
            const Vec3 delta = joints[joint].position_m - joints[parent].position_m;
            const double current_length = length(delta);
            if (target_length < kEpsilon || current_length < kEpsilon) continue;
            const Vec3 target = joints[parent].position_m +
                (target_length / current_length) * delta;
            joints[joint].position_m = interpolate(
                joints[joint].position_m, target, weight / 3.0);
        }
    }
}

struct ReferenceAnchorResult {
    std::size_t anchored{};
    std::size_t suppressed_conflicts{};
    std::size_t suppressed_low_confidence{};
};

ReferenceAnchorResult pin_reference_image_plane(
    PoseSequence& fused,
    const PoseSequence& reference,
    const std::vector<std::vector<bool>>& anchor_allowed,
    double yaw_degrees,
    std::size_t hips,
    std::size_t head,
    std::size_t left_foot,
    std::size_t right_foot,
    double minimum_confidence
) {
    ReferenceAnchorResult result;
    const double angle = yaw_degrees * kPi / 180.0;
    const double row_x = std::cos(angle);
    const double row_z = -std::sin(angle);
    for (std::size_t frame = 0; frame < fused.frames.size(); ++frame) {
        const auto& reference_frame = reference.frames[frame];
        const auto& reference_hip = reference_frame.joints[hips];
        if (!reference_hip.valid) continue;
        const double pixels_per_meter = estimate_pixels_per_meter(
            reference_frame.joints, head, left_foot, right_foot,
            reference.image_height);
        for (std::size_t joint = 0;
             joint < fused.frames[frame].joints.size(); ++joint) {
            const auto& observation = reference_frame.joints[joint];
            auto& output = fused.frames[frame].joints[joint];
            if (!output.valid || !observation.valid) continue;
            if (observation.confidence < minimum_confidence) {
                ++result.suppressed_low_confidence;
                continue;
            }
            if (!anchor_allowed.empty() && !anchor_allowed[frame][joint]) {
                ++result.suppressed_conflicts;
                continue;
            }

            Vec3 relative = output.position_m - reference_hip.position_m;
            const double observed_horizontal =
                (observation.image_xy.x - reference_hip.image_xy.x) /
                std::max(1.0, pixels_per_meter);
            const double predicted_horizontal =
                row_x * relative.x + row_z * relative.z;
            const double correction = observed_horizontal - predicted_horizontal;
            // Apply the minimum-norm correction in the reference camera plane;
            // the orthogonal component remains the depth solved by other views.
            relative.x += row_x * correction;
            relative.z += row_z * correction;
            relative.y = -(observation.image_xy.y - reference_hip.image_xy.y) /
                std::max(1.0, pixels_per_meter);
            output.position_m = reference_hip.position_m + relative;
            output.image_xy = observation.image_xy;
            ++result.anchored;
        }
    }
    return result;
}

bool has_useful_yaw_diversity(const std::vector<MultiviewPoseInput>& views) {
    constexpr double kMinimumSine = 0.25;
    double maximum_sine = 0.0;
    for (std::size_t first = 0; first < views.size(); ++first) {
        for (std::size_t second = first + 1; second < views.size(); ++second) {
            const double difference =
                (views[first].yaw_degrees - views[second].yaw_degrees) * kPi / 180.0;
            maximum_sine = std::max(maximum_sine, std::abs(std::sin(difference)));
        }
    }
    return maximum_sine >= kMinimumSine;
}

}  // namespace

MultiviewSolveResult solve_directional_multiview(
    const std::vector<MultiviewPoseInput>& views,
    const MultiviewSolveOptions& options
) {
    if (views.size() < 2 || views.size() > 8) {
        throw ContractError("directional multiview requires two to eight pose sequences");
    }
    if (options.reference_view >= views.size()) {
        throw ContractError("multiview reference view is out of range");
    }
    if (!std::isfinite(options.maximum_near_side_visibility_bonus) ||
        options.maximum_near_side_visibility_bonus < 0.0 ||
        options.maximum_near_side_visibility_bonus > 1.0 ||
        !std::isfinite(options.maximum_far_side_visibility_penalty) ||
        options.maximum_far_side_visibility_penalty < 0.0 ||
        options.maximum_far_side_visibility_penalty >= 1.0 ||
        !std::isfinite(options.mirrored_joint_overlap_threshold_m) ||
        options.mirrored_joint_overlap_threshold_m <= 0.0) {
        throw ContractError("invalid multiview visibility weighting options");
    }
    if (!std::isfinite(options.reference_anchor_maximum_rms_m) ||
        options.reference_anchor_maximum_rms_m <= 0.0) {
        throw ContractError(
            "reference anchor maximum RMS must be finite and positive");
    }
    if (!std::isfinite(options.temporal_outlier_acceleration_m) ||
        options.temporal_outlier_acceleration_m <= 0.0 ||
        !std::isfinite(options.temporal_outlier_ratio) ||
        options.temporal_outlier_ratio <= 1.0) {
        throw ContractError("invalid temporal view reliability options");
    }
    for (const auto& view : views) {
        if (view.view_id.empty() || !std::isfinite(view.yaw_degrees) ||
            !std::isfinite(view.time_offset_s)) {
            throw ContractError("multiview view id, yaw, and time offset must be valid");
        }
        validate_pose_sequence(view.pose);
    }
    if (!has_useful_yaw_diversity(views)) {
        throw ContractError(
            "directional multiview yaw set is geometrically degenerate; "
            "use distinct non-collinear view yaws");
    }
    const auto& source_reference = views[options.reference_view].pose;
    const auto skeleton = make_default_skeleton();
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    const auto head = bone_index(skeleton, BoneSemantic::Head);
    const auto left_foot = bone_index(skeleton, BoneSemantic::LeftFoot);
    const auto right_foot = bone_index(skeleton, BoneSemantic::RightFoot);
    const auto pairs = mirrored_pairs(skeleton);

    MultiviewSolveResult result;
    result.diagnostics.alignments.reserve(views.size());
    for (const auto& view : views) {
        result.diagnostics.alignments.push_back(align_view(
            source_reference, view.pose, view.view_id, options.maximum_warp_fraction,
            view.time_offset_s));
    }

    // A directional repeat is one authored action captured several times. Only
    // the shared phase interval is genuinely multiview; clamping a shorter view
    // at either endpoint creates frozen observations and false consensus.
    std::size_t common_begin = 0;
    std::size_t common_end = source_reference.frames.size();
    for (const auto& alignment : result.diagnostics.alignments) {
        std::size_t begin = 0;
        while (begin < alignment.source_frame_at_reference.size() &&
               alignment.source_frame_at_reference[begin] < 0.0) ++begin;
        std::size_t end = alignment.source_frame_at_reference.size();
        const auto view_index = static_cast<std::size_t>(
            &alignment - result.diagnostics.alignments.data());
        const double maximum_source_frame = static_cast<double>(
            views[view_index].pose.frames.size() - 1);
        while (end > begin &&
               alignment.source_frame_at_reference[end - 1] >
                   maximum_source_frame) --end;
        common_begin = std::max(common_begin, begin);
        common_end = std::min(common_end, end);
    }
    if (common_end <= common_begin || common_end - common_begin < 3) {
        throw ContractError(
            "directional views have no sufficient common aligned action interval");
    }
    PoseSequence reference = source_reference;
    reference.frames = std::vector<ObservedPoseFrame>(
        source_reference.frames.begin() + static_cast<std::ptrdiff_t>(common_begin),
        source_reference.frames.begin() + static_cast<std::ptrdiff_t>(common_end));
    const double first_time = reference.frames.front().time_s;
    for (auto& frame : reference.frames) frame.time_s -= first_time;
    for (auto& alignment : result.diagnostics.alignments) {
        alignment.source_frame_at_reference = std::vector<double>(
            alignment.source_frame_at_reference.begin() +
                static_cast<std::ptrdiff_t>(common_begin),
            alignment.source_frame_at_reference.begin() +
                static_cast<std::ptrdiff_t>(common_end));
    }

    result.fused_pose = reference;
    result.fused_pose.backend =
        "directional-multiview-motion-energy-affine+confidence-orthographic";
    if (options.enable_view_visibility_weighting)
        result.fused_pose.backend += "+joint-view-visibility";
    if (options.enable_temporal_view_reliability)
        result.fused_pose.backend += "+temporal-view-reliability";
    if (options.require_reference_consensus_for_anchor)
        result.fused_pose.backend += "+evidence-gated-reference-anchor";
    result.fused_pose.source_video = reference.source_video;
    double reprojection_error_sum = 0.0;
    std::size_t reprojection_error_samples = 0;
    std::vector<bool> left_right_swapped(views.size(), false);
    std::vector<int> pending_left_right_state(views.size(), -1);
    std::vector<std::size_t> pending_left_right_frames(views.size(), 0);
    const auto joint_count=reference.frames.front().joints.size();
    std::vector<std::vector<double>> visibility_state(
        views.size(),std::vector<double>(joint_count,1.0));
    std::vector<std::vector<std::size_t>> visibility_last_frame(
        views.size(),std::vector<std::size_t>(joint_count,
            std::numeric_limits<std::size_t>::max()));
    std::vector<std::vector<TemporalViewState>> temporal_view_state(
        views.size(), std::vector<TemporalViewState>(joint_count));
    std::vector<std::vector<bool>> reference_anchor_allowed(
        reference.frames.size(), std::vector<bool>(joint_count, true));
    std::vector<std::vector<bool>> temporal_curve_relaxation(
        reference.frames.size(), std::vector<bool>(joint_count, false));
    constexpr std::size_t kLeftRightConfirmationFrames = 3;
    constexpr double kLeftRightRatio = 0.72;
    constexpr double kLeftRightMargin = 0.01;

    for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
        std::vector<std::vector<ObservedJoint>> samples;
        samples.reserve(views.size());
        for (std::size_t view_index = 0; view_index < views.size(); ++view_index) {
            auto joints = aligned_world_joints(
                views[view_index],
                result.diagnostics.alignments[view_index]
                    .source_frame_at_reference[frame],
                hips);
            if (view_index != options.reference_view) {
                const auto reference_joints = aligned_world_joints(
                    views[options.reference_view], static_cast<double>(frame), hips);
                const double normal = assignment_cost(reference_joints, joints, pairs, false);
                const double swapped = assignment_cost(reference_joints, joints, pairs, true);
                bool clear_evidence = false;
                bool desired_swapped = left_right_swapped[view_index];
                if (std::isfinite(swapped) &&
                    swapped + kLeftRightMargin < normal * kLeftRightRatio) {
                    clear_evidence = true;
                    desired_swapped = true;
                } else if (std::isfinite(normal) &&
                           normal + kLeftRightMargin < swapped * kLeftRightRatio) {
                    clear_evidence = true;
                    desired_swapped = false;
                }
                if (clear_evidence &&
                    desired_swapped != left_right_swapped[view_index]) {
                    const int desired_state = desired_swapped ? 1 : 0;
                    if (pending_left_right_state[view_index] != desired_state) {
                        pending_left_right_state[view_index] = desired_state;
                        pending_left_right_frames[view_index] = 1;
                    } else {
                        ++pending_left_right_frames[view_index];
                    }
                    if (pending_left_right_frames[view_index] >=
                        kLeftRightConfirmationFrames) {
                        left_right_swapped[view_index] = desired_swapped;
                        pending_left_right_state[view_index] = -1;
                        pending_left_right_frames[view_index] = 0;
                        ++result.diagnostics.left_right_state_changes;
                    }
                } else {
                    pending_left_right_state[view_index] = -1;
                    pending_left_right_frames[view_index] = 0;
                }
                if (left_right_swapped[view_index]) {
                    for (const auto [left, right] : pairs) std::swap(joints[left], joints[right]);
                    ++result.diagnostics.left_right_corrections;
                }
            }
            samples.push_back(std::move(joints));
        }

        auto& output_frame = result.fused_pose.frames[frame];
        const Vec3 reference_hip = reference.frames[frame].joints[hips].position_m;
        std::vector<double> pixels_per_meter;
        pixels_per_meter.reserve(samples.size());
        for (std::size_t view_index = 0; view_index < samples.size(); ++view_index) {
            pixels_per_meter.push_back(estimate_pixels_per_meter(
                samples[view_index], head, left_foot, right_foot,
                views[view_index].pose.image_height));
        }
        for (std::size_t joint = 0; joint < output_frame.joints.size(); ++joint) {
            const auto solved = triangulate_joint(
                samples, views, result.diagnostics.alignments, pixels_per_meter,
                skeleton, options,visibility_state,visibility_last_frame,
                temporal_view_state,
                frame,joint,hips);
            result.diagnostics.rejected_view_observations +=
                solved.rejected_view_observations;
            result.diagnostics.visibility_evaluated_observations +=
                solved.visibility_evaluated_observations;
            result.diagnostics.visibility_downweighted_observations +=
                solved.visibility_downweighted_observations;
            result.diagnostics.visibility_boosted_observations +=
                solved.visibility_boosted_observations;
            result.diagnostics.overlap_downweighted_observations +=
                solved.overlap_downweighted_observations;
            result.diagnostics.temporal_outlier_downweighted_observations +=
                solved.temporal_outlier_downweighted_observations;
            temporal_curve_relaxation[frame][joint] =
                solved.temporal_disagreement;
            if (!solved.valid) {
                output_frame.joints[joint].valid = false;
                output_frame.joints[joint].confidence = 0.0f;
                continue;
            }
            if (options.require_reference_consensus_for_anchor) {
                reference_anchor_allowed[frame][joint] =
                    solved.contributors >= 2 &&
                    !solved.reference_rejected;
            }
            auto& fused = output_frame.joints[joint];
            fused.position_m = reference_hip + solved.relative_position;
            fused.confidence = solved.confidence;
            fused.valid = true;
            const auto& reference_observation = reference.frames[frame].joints[joint];
            if (!reference_observation.valid) {
                ++result.diagnostics.recovered_observations;
                const double angle = views[options.reference_view].yaw_degrees *
                    kPi / 180.0;
                const auto& reference_hip_observation = reference.frames[frame].joints[hips];
                fused.image_xy = {
                    reference_hip_observation.image_xy.x +
                        pixels_per_meter[options.reference_view] *
                        (std::cos(angle) * solved.relative_position.x -
                         std::sin(angle) * solved.relative_position.z),
                    reference_hip_observation.image_xy.y -
                        pixels_per_meter[options.reference_view] *
                        solved.relative_position.y,
                };
            }
            if (solved.maximum_residual > options.conflict_threshold_m) {
                result.diagnostics.conflicts.push_back({
                    frame, joint, solved.maximum_residual, solved.contributors});
            }
            reprojection_error_sum += solved.rms_residual;
            ++reprojection_error_samples;
        }
        enforce_bone_lengths(output_frame.joints, skeleton, options.bone_length_weight);
    }

    result.diagnostics.mean_reprojection_error_m = reprojection_error_samples
        ? reprojection_error_sum / static_cast<double>(reprojection_error_samples)
        : 0.0;
    validate_pose_sequence(result.fused_pose);
    if (options.enable_animation_curve_stabilization &&
        options.temporal_weight > 0.0) {
        auto curve_input = result.fused_pose;
        for (std::size_t frame = 0; frame < curve_input.frames.size(); ++frame)
            for (std::size_t joint = 0;
                 joint < curve_input.frames[frame].joints.size(); ++joint)
                if (temporal_curve_relaxation[frame][joint])
                    curve_input.frames[frame].joints[joint].confidence = std::min(
                        curve_input.frames[frame].joints[joint].confidence, 0.05f);
        auto stabilized = stabilize_pose_with_animation_curves(
            curve_input, options.animation_curve, &skeleton);
        for (std::size_t frame = 0; frame < stabilized.sequence.frames.size(); ++frame)
            for (std::size_t joint = 0;
                 joint < stabilized.sequence.frames[frame].joints.size(); ++joint)
                stabilized.sequence.frames[frame].joints[joint].confidence =
                    result.fused_pose.frames[frame].joints[joint].confidence;
        result.diagnostics.curve_anchor_samples =
            stabilized.diagnostics.anchor_samples;
        result.diagnostics.curve_corrected_samples =
            stabilized.diagnostics.corrected_samples;
        result.diagnostics.curve_high_confidence_jitter_corrected_samples =
            stabilized.diagnostics.high_confidence_jitter_corrected_samples;
        result.diagnostics.curve_contact_locked_samples =
            stabilized.diagnostics.contact_locked_samples;
        result.diagnostics.curve_mean_correction_m =
            stabilized.diagnostics.mean_correction_m;
        result.diagnostics.curve_maximum_correction_m =
            stabilized.diagnostics.maximum_correction_m;
        result.diagnostics.jitter_before_curve =
            stabilized.diagnostics.jitter_before;
        result.diagnostics.jitter_after_curve =
            stabilized.diagnostics.jitter_after;
        result.fused_pose = std::move(stabilized.sequence);
    }
    result.fused_pose = optimize_pose_sequence(result.fused_pose);
    const auto anchor_result = pin_reference_image_plane(
        result.fused_pose, reference, reference_anchor_allowed,
        views[options.reference_view].yaw_degrees,
        hips, head, left_foot, right_foot,
        options.reference_anchor_confidence);
    result.diagnostics.reference_anchored_observations = anchor_result.anchored;
    result.diagnostics.reference_anchor_suppressed_conflicts =
        anchor_result.suppressed_conflicts;
    result.diagnostics.reference_anchor_suppressed_low_confidence =
        anchor_result.suppressed_low_confidence;
    validate_pose_sequence(result.fused_pose);
    result.motion = reconstruct_canonical_motion(result.fused_pose);
    result.motion.cameras.clear();
    for (const auto& view : views) {
        result.motion.cameras.push_back({
            view.view_id,
            view.yaw_degrees,
            0.0,
            static_cast<double>(view.pose.image_height) / 1.7,
            {static_cast<double>(view.pose.image_width) * 0.5,
             static_cast<double>(view.pose.image_height) * 0.5},
        });
    }
    result.motion.motion.provenance.model_id = result.fused_pose.backend;
    validate_motion(result.motion.motion, result.motion.skeleton);
    return result;
}

MultiviewDiagnostics load_multiview_diagnostics(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error(
        "cannot read multiview diagnostics: " + path.string());
    nlohmann::json value;
    input >> value;
    if (value.at("schema_version") != kSchemaVersion) {
        throw ContractError("unsupported multiview diagnostics schema_version");
    }
    MultiviewDiagnostics result;
    result.recovered_observations = value.at("recovered_observations").get<std::size_t>();
    result.left_right_corrections = value.at("left_right_corrections").get<std::size_t>();
    result.rejected_view_observations = value.contains("rejected_view_observations")
        ? value.at("rejected_view_observations").get<std::size_t>() : 0;
    result.left_right_state_changes = value.contains("left_right_state_changes")
        ? value.at("left_right_state_changes").get<std::size_t>() : 0;
    result.reference_anchored_observations =
        value.contains("reference_anchored_observations")
        ? value.at("reference_anchored_observations").get<std::size_t>() : 0;
    result.reference_anchor_suppressed_conflicts =
        value.contains("reference_anchor_suppressed_conflicts")
        ? value.at("reference_anchor_suppressed_conflicts").get<std::size_t>() : 0;
    result.reference_anchor_suppressed_low_confidence =
        value.contains("reference_anchor_suppressed_low_confidence")
        ? value.at("reference_anchor_suppressed_low_confidence").get<std::size_t>() : 0;
    result.visibility_evaluated_observations =
        value.contains("visibility_evaluated_observations")
        ? value.at("visibility_evaluated_observations").get<std::size_t>() : 0;
    result.visibility_downweighted_observations =
        value.contains("visibility_downweighted_observations")
        ? value.at("visibility_downweighted_observations").get<std::size_t>() : 0;
    result.visibility_boosted_observations =
        value.contains("visibility_boosted_observations")
        ? value.at("visibility_boosted_observations").get<std::size_t>() : 0;
    result.overlap_downweighted_observations =
        value.contains("overlap_downweighted_observations")
        ? value.at("overlap_downweighted_observations").get<std::size_t>() : 0;
    result.temporal_outlier_downweighted_observations =
        value.contains("temporal_outlier_downweighted_observations")
        ? value.at("temporal_outlier_downweighted_observations")
              .get<std::size_t>() : 0;
    result.curve_anchor_samples = value.contains("curve_anchor_samples")
        ? value.at("curve_anchor_samples").get<std::size_t>() : 0;
    result.curve_corrected_samples = value.contains("curve_corrected_samples")
        ? value.at("curve_corrected_samples").get<std::size_t>() : 0;
    result.curve_high_confidence_jitter_corrected_samples =
        value.contains("curve_high_confidence_jitter_corrected_samples")
        ? value.at("curve_high_confidence_jitter_corrected_samples").get<std::size_t>() : 0;
    result.curve_contact_locked_samples = value.contains("curve_contact_locked_samples")
        ? value.at("curve_contact_locked_samples").get<std::size_t>() : 0;
    result.mean_reprojection_error_m = value.at("mean_reprojection_error_m").get<double>();
    result.curve_mean_correction_m = value.contains("curve_mean_correction_m")
        ? value.at("curve_mean_correction_m").get<double>() : 0.0;
    result.curve_maximum_correction_m = value.contains("curve_maximum_correction_m")
        ? value.at("curve_maximum_correction_m").get<double>() : 0.0;
    result.jitter_before_curve = value.contains("jitter_before_curve")
        ? value.at("jitter_before_curve").get<double>() : 0.0;
    result.jitter_after_curve = value.contains("jitter_after_curve")
        ? value.at("jitter_after_curve").get<double>() : 0.0;
    for (const auto& item : value.at("alignments")) {
        ViewAlignment alignment;
        alignment.view_id = item.at("view_id").get<std::string>();
        alignment.mean_offset_s = item.at("mean_offset_s").get<double>();
        alignment.mean_rate = item.at("mean_rate").get<double>();
        alignment.normalized_cost = item.at("normalized_cost").get<double>();
        alignment.method = item.value("method", std::string{"legacy"});
        alignment.overlap_reference_frames = item.value(
            "overlap_reference_frames", std::size_t{});
        alignment.out_of_range_reference_frames = item.value(
            "out_of_range_reference_frames", std::size_t{});
        alignment.source_frame_at_reference =
            item.at("source_frame_at_reference").get<std::vector<double>>();
        result.alignments.push_back(std::move(alignment));
    }
    for (const auto& item : value.at("conflicts")) {
        result.conflicts.push_back({
            item.at("frame_index").get<std::size_t>(),
            item.at("joint_index").get<std::size_t>(),
            item.at("disagreement_m").get<double>(),
            item.at("contributing_views").get<std::size_t>(),
        });
    }
    if (result.alignments.size() < 2 || result.alignments.size() > 8 ||
        !std::isfinite(result.mean_reprojection_error_m) ||
        !std::isfinite(result.curve_mean_correction_m) ||
        !std::isfinite(result.curve_maximum_correction_m) ||
        !std::isfinite(result.jitter_before_curve) ||
        !std::isfinite(result.jitter_after_curve)) {
        throw ContractError("invalid multiview diagnostics");
    }
    return result;
}
void save_multiview_diagnostics(
    const MultiviewDiagnostics& diagnostics,
    const std::filesystem::path& path
) {
    nlohmann::json value{
        {"schema_version", kSchemaVersion},
        {"alignments", nlohmann::json::array()},
        {"conflicts", nlohmann::json::array()},
        {"recovered_observations", diagnostics.recovered_observations},
        {"left_right_corrections", diagnostics.left_right_corrections},
        {"rejected_view_observations", diagnostics.rejected_view_observations},
        {"left_right_state_changes", diagnostics.left_right_state_changes},
        {"reference_anchored_observations",
         diagnostics.reference_anchored_observations},
        {"reference_anchor_suppressed_conflicts",
         diagnostics.reference_anchor_suppressed_conflicts},
        {"reference_anchor_suppressed_low_confidence",
         diagnostics.reference_anchor_suppressed_low_confidence},
        {"visibility_evaluated_observations",
         diagnostics.visibility_evaluated_observations},
        {"visibility_downweighted_observations",
         diagnostics.visibility_downweighted_observations},
        {"visibility_boosted_observations",
         diagnostics.visibility_boosted_observations},
        {"overlap_downweighted_observations",
         diagnostics.overlap_downweighted_observations},
        {"temporal_outlier_downweighted_observations",
         diagnostics.temporal_outlier_downweighted_observations},
        {"curve_anchor_samples", diagnostics.curve_anchor_samples},
        {"curve_corrected_samples", diagnostics.curve_corrected_samples},
        {"curve_high_confidence_jitter_corrected_samples",
         diagnostics.curve_high_confidence_jitter_corrected_samples},
        {"curve_contact_locked_samples", diagnostics.curve_contact_locked_samples},
        {"mean_reprojection_error_m", diagnostics.mean_reprojection_error_m},
        {"curve_mean_correction_m", diagnostics.curve_mean_correction_m},
        {"curve_maximum_correction_m", diagnostics.curve_maximum_correction_m},
        {"jitter_before_curve", diagnostics.jitter_before_curve},
        {"jitter_after_curve", diagnostics.jitter_after_curve},
    };
    for (const auto& alignment : diagnostics.alignments) {
        value["alignments"].push_back({
            {"view_id", alignment.view_id},
            {"mean_offset_s", alignment.mean_offset_s},
            {"mean_rate", alignment.mean_rate},
            {"normalized_cost", alignment.normalized_cost},
            {"method", alignment.method},
            {"overlap_reference_frames", alignment.overlap_reference_frames},
            {"out_of_range_reference_frames",
             alignment.out_of_range_reference_frames},
            {"source_frame_at_reference", alignment.source_frame_at_reference},
        });
    }
    const auto skeleton = make_default_skeleton();
    for (const auto& conflict : diagnostics.conflicts) {
        value["conflicts"].push_back({
            {"frame_index", conflict.frame_index},
            {"joint_index", conflict.joint_index},
            {"semantic", to_string(skeleton.bones.at(conflict.joint_index).semantic)},
            {"disagreement_m", conflict.disagreement_m},
            {"contributing_views", conflict.contributing_views},
        });
    }
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write multiview diagnostics: " + path.string());
    output << value.dump(2) << '\n';
}

}  // namespace animocap
