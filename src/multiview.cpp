#include "animocap/multiview.hpp"

#include "animocap/math.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
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

std::vector<double> motion_descriptor(const PoseSequence& sequence) {
    const auto skeleton = make_default_skeleton();
    const auto hips = bone_index(skeleton, BoneSemantic::Hips);
    const auto head = bone_index(skeleton, BoneSemantic::Head);
    const auto left_hand = bone_index(skeleton, BoneSemantic::LeftHand);
    const auto right_hand = bone_index(skeleton, BoneSemantic::RightHand);
    const auto left_foot = bone_index(skeleton, BoneSemantic::LeftFoot);
    const auto right_foot = bone_index(skeleton, BoneSemantic::RightFoot);
    std::vector<double> speed(sequence.frames.size(), 0.0);
    std::vector<double> shape(sequence.frames.size(), 0.0);
    for (std::size_t frame = 0; frame < sequence.frames.size(); ++frame) {
        const auto& current = sequence.frames[frame];
        double signature = 0.0;
        double signature_weight = 0.0;
        auto add_distance = [&](std::size_t a, std::size_t b, double weight) {
            if (!current.joints[a].valid || !current.joints[b].valid) return;
            signature += weight * length(
                current.joints[a].position_m - current.joints[b].position_m);
            signature_weight += weight;
        };
        add_distance(left_hand, right_hand, 1.0);
        add_distance(left_hand, head, 0.65);
        add_distance(right_hand, head, 0.65);
        add_distance(left_foot, right_foot, 0.35);
        shape[frame] = signature_weight > 0.0
            ? signature / signature_weight
            : (frame > 0 ? shape[frame - 1] : 0.0);
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
            weighted_speed += weight * length(local_b - local_a);
            total_weight += weight;
        }
        const double delta_time = std::max(1e-4, current.time_s - before.time_s);
        if (total_weight > 0.0) speed[frame] = weighted_speed / total_weight / delta_time;
    }
    if (speed.size() > 1) speed[0] = speed[1];
    auto standardize = [](std::vector<double>& values) {
        const double mean = std::accumulate(values.begin(), values.end(), 0.0) /
            static_cast<double>(values.size());
        double variance = 0.0;
        for (const double value : values) variance += (value - mean) * (value - mean);
        const double scale = std::sqrt(
            variance / static_cast<double>(values.size()) + 1e-8);
        for (double& value : values) value = (value - mean) / scale;
    };
    standardize(speed);
    standardize(shape);
    std::vector<double> result(speed.size());
    for (std::size_t frame = 0; frame < result.size(); ++frame) {
        result[frame] = 0.55 * speed[frame] + 0.45 * shape[frame];
    }
    return result;
}
struct ReducedSignal {
    std::vector<double> values;
    std::vector<double> original_frame;
};

ReducedSignal reduce_signal(const std::vector<double>& source) {
    const std::size_t count = std::min(source.size(), kMaximumAlignmentSamples);
    ReducedSignal result;
    result.values.reserve(count);
    result.original_frame.reserve(count);
    for (std::size_t index = 0; index < count; ++index) {
        const double begin = static_cast<double>(index) * source.size() / count;
        const double end = static_cast<double>(index + 1) * source.size() / count;
        const std::size_t first = static_cast<std::size_t>(std::floor(begin));
        const std::size_t last = std::max(first + 1, static_cast<std::size_t>(std::ceil(end)));
        double sum = 0.0;
        std::size_t samples = 0;
        for (std::size_t item = first; item < std::min(last, source.size()); ++item) {
            sum += source[item];
            ++samples;
        }
        result.values.push_back(samples ? sum / samples : source[first]);
        result.original_frame.push_back((begin + end - 1.0) * 0.5);
    }
    return result;
}

ViewAlignment align_view(
    const PoseSequence& reference,
    const PoseSequence& source,
    std::string view_id,
    double maximum_warp_fraction
) {
    ViewAlignment result;
    result.view_id = std::move(view_id);
    if (&reference == &source) {
        result.source_frame_at_reference.resize(reference.frames.size());
        std::iota(
            result.source_frame_at_reference.begin(),
            result.source_frame_at_reference.end(), 0.0);
        return result;
    }

    const auto reference_signal = reduce_signal(motion_descriptor(reference));
    const auto source_signal = reduce_signal(motion_descriptor(source));
    const std::size_t rows = reference_signal.values.size();
    const std::size_t columns = source_signal.values.size();
    const double infinity = std::numeric_limits<double>::infinity();

    // Seed DTW with a global affine time fit. This prevents periodic motion
    // from matching the correct shape at the wrong repetition.
    double seed_offset = 0.0;
    double seed_rate = static_cast<double>(source.frames.size() - 1) /
        std::max<std::size_t>(1, reference.frames.size() - 1);
    double seed_cost = infinity;
    const double maximum_offset = std::max(
        2.0, source.frames.size() * std::clamp(maximum_warp_fraction, 0.05, 0.80));
    const double offset_step = std::max(1.0, source.frames.size() / 300.0);
    auto sample_source_signal = [&](double source_frame) {
        const double position = source.frames.size() > 1
            ? source_frame * (columns - 1) / (source.frames.size() - 1)
            : 0.0;
        const auto before = static_cast<std::size_t>(std::clamp(
            std::floor(position), 0.0, static_cast<double>(columns - 1)));
        const auto after = std::min(before + 1, columns - 1);
        const double alpha = std::clamp(position - before, 0.0, 1.0);
        return source_signal.values[before] +
            (source_signal.values[after] - source_signal.values[before]) * alpha;
    };
    for (int rate_step = 70; rate_step <= 130; ++rate_step) {
        const double rate = rate_step / 100.0;
        for (double offset = -maximum_offset; offset <= maximum_offset;
             offset += offset_step) {
            double candidate_cost = 0.0;
            std::size_t samples = 0;
            for (std::size_t row = 0; row < rows; ++row) {
                const double source_frame = offset +
                    rate * reference_signal.original_frame[row];
                if (source_frame < 0.0 ||
                    source_frame > static_cast<double>(source.frames.size() - 1)) {
                    candidate_cost += 2.5;
                    continue;
                }
                candidate_cost += std::abs(
                    reference_signal.values[row] - sample_source_signal(source_frame));
                ++samples;
            }
            if (samples < rows * 7 / 10) continue;
            candidate_cost /= static_cast<double>(rows);
            candidate_cost += 0.45 * std::abs(rate - 1.0);
            if (candidate_cost < seed_cost) {
                seed_cost = candidate_cost;
                seed_offset = offset;
                seed_rate = rate;
            }
        }
    }
    std::vector<double> cost(rows * columns, infinity);
    std::vector<unsigned char> predecessor(rows * columns, 0);
    const auto cell = [columns](std::size_t row, std::size_t column) {
        return row * columns + column;
    };
    const std::size_t window = std::max<std::size_t>(
        3, static_cast<std::size_t>(std::ceil(
            std::max(rows, columns) *
            std::clamp(maximum_warp_fraction * 0.25, 0.03, 0.20))));

    for (std::size_t row = 0; row < rows; ++row) {
        const double expected_source_frame = seed_offset +
            seed_rate * reference_signal.original_frame[row];
        const double expected = std::clamp(
            source.frames.size() > 1
                ? expected_source_frame * (columns - 1) /
                    (source.frames.size() - 1)
                : 0.0,
            0.0, static_cast<double>(columns - 1));
        const std::size_t begin = static_cast<std::size_t>(std::max(
            0.0, std::floor(expected - static_cast<double>(window))));
        const std::size_t end = std::min(
            columns, static_cast<std::size_t>(std::ceil(expected + window + 1.0)));
        for (std::size_t column = begin; column < end; ++column) {
            const double local = std::abs(
                reference_signal.values[row] - source_signal.values[column]);
            if (row == 0) {
                cost[cell(row, column)] = local + 0.12 * static_cast<double>(column);
                predecessor[cell(row, column)] = 4;
                continue;
            }
            double best = infinity;
            unsigned char direction = 0;
            if (row > 0 && column > 0 && cost[cell(row - 1, column - 1)] < best) {
                best = cost[cell(row - 1, column - 1)]; direction = 1;
            }
            if (row > 0 && cost[cell(row - 1, column)] + 0.08 < best) {
                best = cost[cell(row - 1, column)] + 0.08; direction = 2;
            }
            if (column > 0 && cost[cell(row, column - 1)] + 0.08 < best) {
                best = cost[cell(row, column - 1)] + 0.08; direction = 3;
            }
            if (std::isfinite(best)) {
                cost[cell(row, column)] = local + best;
                predecessor[cell(row, column)] = direction;
            }
        }
    }
    std::size_t endpoint = columns - 1;
    double endpoint_cost = infinity;
    for (std::size_t candidate = 0; candidate < columns; ++candidate) {
        const double value = cost[cell(rows - 1, candidate)] +
            0.12 * static_cast<double>(columns - 1 - candidate);
        if (value < endpoint_cost) {
            endpoint_cost = value;
            endpoint = candidate;
        }
    }
    if (!std::isfinite(endpoint_cost)) {
        throw ContractError("directional view alignment exceeded the configured warp window");
    }

    std::vector<std::pair<std::size_t, std::size_t>> path;
    std::size_t row = rows - 1;
    std::size_t column = endpoint;
    for (;;) {
        path.emplace_back(row, column);
        if (row == 0) break;
        switch (predecessor[cell(row, column)]) {
            case 1: --row; --column; break;
            case 2: --row; break;
            case 3: --column; break;
            default: throw ContractError("directional view alignment path is incomplete");
        }
    }
    std::reverse(path.begin(), path.end());
    std::vector<double> reduced_mapping(rows, 0.0);
    std::vector<std::size_t> mapping_samples(rows, 0);
    for (const auto [reference_index, source_index] : path) {
        reduced_mapping[reference_index] += source_signal.original_frame[source_index];
        ++mapping_samples[reference_index];
    }
    for (std::size_t index = 0; index < rows; ++index) {
        if (mapping_samples[index]) {
            reduced_mapping[index] /= static_cast<double>(mapping_samples[index]);
        } else if (index > 0) {
            reduced_mapping[index] = reduced_mapping[index - 1];
        }
    }

    result.source_frame_at_reference.resize(reference.frames.size());
    for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
        const double reduced_position = reference.frames.size() > 1
            ? static_cast<double>(frame) * (rows - 1) / (reference.frames.size() - 1)
            : 0.0;
        const auto before = static_cast<std::size_t>(std::floor(reduced_position));
        const auto after = std::min(before + 1, rows - 1);
        const double alpha = reduced_position - static_cast<double>(before);
        result.source_frame_at_reference[frame] =
            reduced_mapping[before] +
            (reduced_mapping[after] - reduced_mapping[before]) * alpha;
    }
    double offset_sum = 0.0;
    for (std::size_t frame = 0; frame < reference.frames.size(); ++frame) {
        const double source_frame = result.source_frame_at_reference[frame];
        const auto source_index = static_cast<std::size_t>(std::clamp(
            std::llround(source_frame), 0LL,
            static_cast<long long>(source.frames.size() - 1)));
        offset_sum += source.frames[source_index].time_s - reference.frames[frame].time_s;
    }
    result.mean_offset_s = offset_sum / static_cast<double>(reference.frames.size());
    const double reference_duration =
        reference.frames.back().time_s - reference.frames.front().time_s;
    const double source_duration =
        (result.source_frame_at_reference.back() - result.source_frame_at_reference.front()) /
        source.fps;
    result.mean_rate = reference_duration > kEpsilon
        ? source_duration / reference_duration : 1.0;
    result.normalized_cost = endpoint_cost /
        static_cast<double>(path.size());
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

struct JointTriangulation {
    bool valid{};
    Vec3 relative_position{};
    float confidence{};
    std::size_t contributors{};
    double maximum_residual{};
    double rms_residual{};
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
    std::size_t joint,
    std::size_t hips,
    double minimum_confidence,
    double conflict_threshold
) {
    JointTriangulation result;
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
            if (!observation.valid || !hip.valid ||
                observation.confidence < minimum_confidence) continue;
            const double quality = 1.0 /
                (1.0 + 2.0 * alignments[view].normalized_cost);
            const double weight = quality * observation.confidence *
                observation.confidence * robust_factor[view];
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
                if (!observation.valid || !hip.valid ||
                    observation.confidence < minimum_confidence) continue;
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
                robust_factor[view] = residual <= conflict_threshold
                    ? 1.0 : conflict_threshold / std::max(residual, kEpsilon);
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
            observation.confidence < minimum_confidence) continue;
        const double quality = 1.0 /
            (1.0 + 2.0 * alignments[view].normalized_cost);
        const double weight = quality * observation.confidence *
            observation.confidence * robust_factor[view];
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
        weighted_squared_error += weight * residual * residual;
        total_weight += weight;
        confidence_complement *= 1.0 - quality * observation.confidence;
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

}  // namespace

MultiviewSolveResult solve_directional_multiview(
    const std::vector<MultiviewPoseInput>& views,
    const MultiviewSolveOptions& options
) {
    if (views.size() < 2 || views.size() > 4) {
        throw ContractError("directional multiview requires two to four pose sequences");
    }
    if (options.reference_view >= views.size()) {
        throw ContractError("multiview reference view is out of range");
    }
    for (const auto& view : views) {
        if (view.view_id.empty() || !std::isfinite(view.yaw_degrees)) {
            throw ContractError("multiview view id and yaw must be valid");
        }
        validate_pose_sequence(view.pose);
    }
    const auto& reference = views[options.reference_view].pose;
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
            reference, view.pose, view.view_id, options.maximum_warp_fraction));
    }

    result.fused_pose = reference;
    result.fused_pose.backend = "directional-multiview-dtw+confidence-orthographic+joint-opt";
    result.fused_pose.source_video = reference.source_video;
    double reprojection_error_sum = 0.0;
    std::size_t reprojection_error_samples = 0;

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
                if (std::isfinite(swapped) && swapped + 0.01 < normal * 0.72) {
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
                joint, hips, options.minimum_confidence,
                options.conflict_threshold_m);
            if (!solved.valid) {
                output_frame.joints[joint].valid = false;
                output_frame.joints[joint].confidence = 0.0f;
                continue;
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
        if (frame > 0 && options.temporal_weight > 0.0) {
            for (std::size_t joint = 0; joint < output_frame.joints.size(); ++joint) {
                auto& current = output_frame.joints[joint];
                const auto& previous = result.fused_pose.frames[frame - 1].joints[joint];
                if (current.valid && previous.valid) {
                    current.position_m = interpolate(
                        current.position_m, previous.position_m,
                        std::clamp(options.temporal_weight, 0.0, 0.45));
                }
            }
        }
        enforce_bone_lengths(output_frame.joints, skeleton, options.bone_length_weight);
    }

    result.diagnostics.mean_reprojection_error_m = reprojection_error_samples
        ? reprojection_error_sum / static_cast<double>(reprojection_error_samples)
        : 0.0;
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
    result.mean_reprojection_error_m = value.at("mean_reprojection_error_m").get<double>();
    for (const auto& item : value.at("alignments")) {
        result.alignments.push_back({
            item.at("view_id").get<std::string>(),
            item.at("mean_offset_s").get<double>(),
            item.at("mean_rate").get<double>(),
            item.at("normalized_cost").get<double>(),
            item.at("source_frame_at_reference").get<std::vector<double>>(),
        });
    }
    for (const auto& item : value.at("conflicts")) {
        result.conflicts.push_back({
            item.at("frame_index").get<std::size_t>(),
            item.at("joint_index").get<std::size_t>(),
            item.at("disagreement_m").get<double>(),
            item.at("contributing_views").get<std::size_t>(),
        });
    }
    if (result.alignments.size() < 2 || result.alignments.size() > 4 ||
        !std::isfinite(result.mean_reprojection_error_m)) {
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
        {"mean_reprojection_error_m", diagnostics.mean_reprojection_error_m},
    };
    for (const auto& alignment : diagnostics.alignments) {
        value["alignments"].push_back({
            {"view_id", alignment.view_id},
            {"mean_offset_s", alignment.mean_offset_s},
            {"mean_rate", alignment.mean_rate},
            {"normalized_cost", alignment.normalized_cost},
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
