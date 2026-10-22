#include "animocap/pose_sequence.hpp"

#include "animocap/hash.hpp"
#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <limits>
#include <set>
#include <span>
#include <stdexcept>

namespace animocap {
namespace {

using json = nlohmann::json;
constexpr double kEpsilon = 1e-10;

void require_exact_keys(
    const json& value,
    std::initializer_list<std::string_view> keys,
    std::string_view label
) {
    if (!value.is_object()) throw ContractError(std::string(label) + " must be an object");
    std::set<std::string> expected;
    for (const auto key : keys) expected.emplace(key);
    std::set<std::string> actual;
    for (const auto& [key, unused] : value.items()) {
        (void)unused;
        actual.insert(key);
    }
    if (actual != expected) {
        throw ContractError(std::string(label) + " has missing or unknown fields");
    }
}

Vec2 read_vec2(const json& value, std::string_view label) {
    if (!value.is_array() || value.size() != 2) {
        throw ContractError(std::string(label) + " must have shape [2]");
    }
    Vec2 result{value.at(0).get<double>(), value.at(1).get<double>()};
    if (!std::isfinite(result.x) || !std::isfinite(result.y)) {
        throw ContractError(std::string(label) + " must be finite");
    }
    return result;
}

Vec3 read_vec3(const json& value, std::string_view label) {
    if (!value.is_array() || value.size() != 3) {
        throw ContractError(std::string(label) + " must have shape [3]");
    }
    Vec3 result{
        value.at(0).get<double>(),
        value.at(1).get<double>(),
        value.at(2).get<double>(),
    };
    if (!std::isfinite(result.x) || !std::isfinite(result.y) || !std::isfinite(result.z)) {
        throw ContractError(std::string(label) + " must be finite");
    }
    return result;
}

Vec3 subtract(const Vec3& a, const Vec3& b) {
    return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 add(const Vec3& a, const Vec3& b) {
    return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 scale(const Vec3& value, double amount) {
    return {value.x * amount, value.y * amount, value.z * amount};
}

double length(const Vec3& value) {
    return std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
}

Vec3 normalized(const Vec3& value) {
    const double size = length(value);
    if (!std::isfinite(size) || size < kEpsilon) {
        throw ContractError("cannot normalize a zero-length vector");
    }
    return {value.x / size, value.y / size, value.z / size};
}

double dot(const Vec3& a, const Vec3& b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 cross(const Vec3& a, const Vec3& b) {
    return {
        a.y * b.z - a.z * b.y,
        a.z * b.x - a.x * b.z,
        a.x * b.y - a.y * b.x,
    };
}

Quat rotation_between(const Vec3& source, const Vec3& target) {
    const auto a = normalized(source);
    const auto b = normalized(target);
    const double cosine = std::clamp(dot(a, b), -1.0, 1.0);
    if (cosine > 1.0 - 1e-9) return {};
    if (cosine < -1.0 + 1e-9) {
        Vec3 axis = cross(a, {1.0, 0.0, 0.0});
        if (length(axis) < kEpsilon) axis = cross(a, {0.0, 1.0, 0.0});
        return from_axis_angle(axis, 3.14159265358979323846);
    }
    const auto axis = cross(a, b);
    return normalize({1.0 + cosine, axis.x, axis.y, axis.z});
}

std::vector<int> primary_children(const Skeleton& skeleton) {
    std::vector<int> result(skeleton.bones.size(), -1);
    for (std::size_t child = 1; child < skeleton.bones.size(); ++child) {
        const auto parent = skeleton.bones[child].parent;
        if (parent >= 0 && result[static_cast<std::size_t>(parent)] < 0) {
            result[static_cast<std::size_t>(parent)] = static_cast<int>(child);
        }
    }
    return result;
}

std::vector<unsigned char> text_bytes(std::string_view text) {
    return {text.begin(), text.end()};
}

Vec3 clamp_length(const Vec3& value, double maximum) {
    const double size = length(value);
    if (size <= maximum || size < kEpsilon) return value;
    return scale(value, maximum / size);
}

struct FootObservation {
    Vec3 center_m{};
    double lowest_y_m{};
    bool valid{};
};

std::vector<std::uint8_t> infer_foot_contacts(
    const PoseSequence& sequence,
    const Skeleton& skeleton
) {
    const std::array<std::array<std::size_t, 2>, 2> feet{{
        {bone_index(skeleton, BoneSemantic::LeftFoot),
         bone_index(skeleton, BoneSemantic::LeftToes)},
        {bone_index(skeleton, BoneSemantic::RightFoot),
         bone_index(skeleton, BoneSemantic::RightToes)},
    }};
    const std::size_t frame_count = sequence.frames.size();
    std::array<std::vector<FootObservation>, 2> observations;
    std::vector<double> ground_samples;
    ground_samples.reserve(frame_count * 2);

    for (std::size_t side = 0; side < feet.size(); ++side) {
        observations[side].reserve(frame_count);
        for (const auto& frame : sequence.frames) {
            FootObservation sample;
            std::size_t valid_points = 0;
            sample.lowest_y_m = std::numeric_limits<double>::infinity();
            for (const auto joint_index : feet[side]) {
                const auto& joint = frame.joints[joint_index];
                if (!joint.valid) continue;
                sample.center_m.x += joint.position_m.x;
                sample.center_m.y += joint.position_m.y;
                sample.center_m.z += joint.position_m.z;
                sample.lowest_y_m = std::min(sample.lowest_y_m, joint.position_m.y);
                ++valid_points;
            }
            sample.valid = valid_points > 0;
            if (sample.valid) {
                const auto denominator = static_cast<double>(valid_points);
                sample.center_m.x /= denominator;
                sample.center_m.y /= denominator;
                sample.center_m.z /= denominator;
                ground_samples.push_back(sample.lowest_y_m);
            }
            observations[side].push_back(sample);
        }
    }

    std::vector<std::uint8_t> contacts(frame_count * 2, 0U);
    if (ground_samples.empty()) return contacts;
    std::sort(ground_samples.begin(), ground_samples.end());
    const auto ground_index = static_cast<std::size_t>(
        std::floor(0.10 * static_cast<double>(ground_samples.size() - 1)));
    const double ground_y_m = ground_samples[ground_index];

    constexpr double kEnterHeightM = 0.065;
    constexpr double kHoldHeightM = 0.095;
    constexpr double kEnterSpeedMps = 0.32;
    constexpr double kHoldSpeedMps = 0.48;
    for (std::size_t side = 0; side < observations.size(); ++side) {
        bool in_contact = false;
        for (std::size_t frame = 0; frame < frame_count; ++frame) {
            const auto& sample = observations[side][frame];
            double speed_mps = std::numeric_limits<double>::infinity();
            if (sample.valid && frame_count == 1) {
                speed_mps = 0.0;
            } else if (sample.valid) {
                const auto before = frame == 0 ? frame : frame - 1;
                const auto after = frame + 1 < frame_count ? frame + 1 : frame;
                const auto& first = observations[side][before];
                const auto& last = observations[side][after];
                const double elapsed = sequence.frames[after].time_s -
                    sequence.frames[before].time_s;
                if (first.valid && last.valid && elapsed > kEpsilon) {
                    speed_mps = length(subtract(last.center_m, first.center_m)) / elapsed;
                }
            }

            const double height_m = sample.lowest_y_m - ground_y_m;
            if (!sample.valid) {
                in_contact = false;
            } else if (in_contact) {
                in_contact = height_m <= kHoldHeightM && speed_mps <= kHoldSpeedMps;
            } else {
                in_contact = height_m <= kEnterHeightM && speed_mps <= kEnterSpeedMps;
            }
            contacts[frame * 2 + side] = in_contact ? 1U : 0U;
        }

        if (frame_count >= 3) {
            auto filtered = contacts;
            for (std::size_t frame = 1; frame + 1 < frame_count; ++frame) {
                const auto previous = contacts[(frame - 1) * 2 + side];
                const auto current = contacts[frame * 2 + side];
                const auto next = contacts[(frame + 1) * 2 + side];
                if (previous == next && current != previous && observations[side][frame].valid) {
                    filtered[frame * 2 + side] = previous;
                }
            }
            for (std::size_t frame = 0; frame < frame_count; ++frame) {
                contacts[frame * 2 + side] = filtered[frame * 2 + side];
            }
        }
    }
    return contacts;
}


void stabilize_contact_feet(CanonicalMotion& motion, const Skeleton& skeleton) {
    if (motion.frame_count < 2 || motion.foot_contacts.size() != motion.frame_count * 2) {
        return;
    }
    const std::array<std::array<std::size_t, 2>, 2> feet{{
        {bone_index(skeleton, BoneSemantic::LeftFoot),
         bone_index(skeleton, BoneSemantic::LeftToes)},
        {bone_index(skeleton, BoneSemantic::RightFoot),
         bone_index(skeleton, BoneSemantic::RightToes)},
    }};
    std::array<Vec3, 2> anchors{};
    std::array<bool, 2> anchored{};
    Vec3 previous_correction{};
    for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
        const auto begin = motion.local_rotations.begin() +
            static_cast<std::ptrdiff_t>(frame * motion.joint_count);
        const std::vector<Quat> rotations(
            begin, begin + static_cast<std::ptrdiff_t>(motion.joint_count));
        const auto fk = forward_kinematics(
            skeleton, rotations, motion.scene_root_translation_m[frame],
            motion.scene_root_rotation[frame], motion.hips_translation_m[frame]);
        Vec3 correction{};
        std::size_t contributors = 0;
        for (std::size_t side = 0; side < feet.size(); ++side) {
            const bool contact = motion.foot_contacts[frame * 2 + side] != 0;
            if (!contact) {
                anchored[side] = false;
                continue;
            }
            const auto center = scale(add(
                fk.positions_m[feet[side][0]], fk.positions_m[feet[side][1]]), 0.5);
            if (!anchored[side]) {
                anchors[side] = center;
                anchored[side] = true;
                continue;
            }
            auto delta = subtract(anchors[side], center);
            delta.y = 0.0;
            if (length(delta) <= 0.18) {
                correction = add(correction, delta);
                ++contributors;
            } else {
                anchors[side] = center;
            }
        }
        if (contributors == 0) {
            previous_correction = {};
            continue;
        }
        correction = scale(correction, 1.0 / static_cast<double>(contributors));
        correction = add(scale(previous_correction, 0.35), scale(correction, 0.65));
        correction = clamp_length(correction, 0.08);
        motion.scene_root_translation_m[frame] = add(
            motion.scene_root_translation_m[frame], correction);
        previous_correction = correction;
    }
}

}  // namespace

PoseSequence load_pose_sequence_json(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("cannot open pose sequence: " + path.string());
    json document;
    input >> document;
    require_exact_keys(document, {
        "schema_version", "source_video", "backend", "image_width", "image_height", "fps", "frames"
    }, "pose sequence");

    PoseSequence sequence;
    sequence.schema_version = document.at("schema_version").get<std::string>();
    sequence.source_video = std::filesystem::path(document.at("source_video").get<std::string>());
    sequence.backend = document.at("backend").get<std::string>();
    sequence.image_width = document.at("image_width").get<std::size_t>();
    sequence.image_height = document.at("image_height").get<std::size_t>();
    sequence.fps = document.at("fps").get<double>();

    const auto skeleton = make_default_skeleton();
    const auto& frames = document.at("frames");
    if (!frames.is_array()) throw ContractError("pose sequence frames must be an array");
    sequence.frames.reserve(frames.size());
    for (const auto& frame_value : frames) {
        require_exact_keys(frame_value, {"time_s", "joints"}, "pose frame");
        ObservedPoseFrame frame;
        frame.time_s = frame_value.at("time_s").get<double>();
        frame.joints.resize(skeleton.bones.size());
        std::vector<bool> seen(skeleton.bones.size(), false);
        const auto& joints = frame_value.at("joints");
        if (!joints.is_array()) throw ContractError("pose frame joints must be an array");
        for (const auto& joint_value : joints) {
            require_exact_keys(joint_value, {
                "semantic", "image_xy", "position_m", "confidence", "valid"
            }, "observed joint");
            const auto semantic = bone_semantic_from_string(
                joint_value.at("semantic").get<std::string>());
            const auto index = bone_index(skeleton, semantic);
            if (seen[index]) throw ContractError("duplicate observed joint semantic");
            seen[index] = true;
            frame.joints[index] = {
                read_vec2(joint_value.at("image_xy"), "image_xy"),
                read_vec3(joint_value.at("position_m"), "position_m"),
                joint_value.at("confidence").get<float>(),
                joint_value.at("valid").get<bool>(),
            };
        }
        if (std::find(seen.begin(), seen.end(), false) != seen.end()) {
            throw ContractError("pose frame is missing canonical joint semantics");
        }
        sequence.frames.push_back(std::move(frame));
    }
    validate_pose_sequence(sequence);
    return sequence;
}

void save_pose_sequence_json(
    const PoseSequence& sequence,
    const std::filesystem::path& path
) {
    validate_pose_sequence(sequence);
    const auto skeleton = make_default_skeleton();
    json document{
        {"schema_version", sequence.schema_version},
        {"source_video", sequence.source_video.generic_string()},
        {"backend", sequence.backend},
        {"image_width", sequence.image_width},
        {"image_height", sequence.image_height},
        {"fps", sequence.fps},
        {"frames", json::array()},
    };
    for (const auto& frame : sequence.frames) {
        json joints = json::array();
        for (std::size_t index = 0; index < frame.joints.size(); ++index) {
            const auto& joint = frame.joints[index];
            joints.push_back({
                {"semantic", to_string(skeleton.bones[index].semantic)},
                {"image_xy", {joint.image_xy.x, joint.image_xy.y}},
                {"position_m", {
                    joint.position_m.x, joint.position_m.y, joint.position_m.z}},
                {"confidence", joint.confidence},
                {"valid", joint.valid},
            });
        }
        document["frames"].push_back({
            {"time_s", frame.time_s},
            {"joints", std::move(joints)},
        });
    }
    std::filesystem::create_directories(path.parent_path());
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write pose sequence: " + path.string());
    output << document.dump(2) << '\n';
}
void validate_pose_sequence(const PoseSequence& sequence) {
    if (sequence.schema_version != kSchemaVersion) {
        throw ContractError("unsupported pose sequence schema_version");
    }
    if (sequence.source_video.empty() || sequence.backend.empty()) {
        throw ContractError("pose sequence source and backend must be recorded");
    }
    if (sequence.image_width == 0 || sequence.image_height == 0 ||
        !std::isfinite(sequence.fps) || sequence.fps <= 0.0 || sequence.frames.empty()) {
        throw ContractError("pose sequence dimensions, fps, and frames must be valid");
    }
    const auto joint_count = make_default_skeleton().bones.size();
    for (std::size_t frame_index = 0; frame_index < sequence.frames.size(); ++frame_index) {
        const auto& frame = sequence.frames[frame_index];
        if (!std::isfinite(frame.time_s) ||
            (frame_index > 0 && !(frame.time_s > sequence.frames[frame_index - 1].time_s))) {
            throw ContractError("pose sequence time must be finite and strictly increasing");
        }
        if (frame.joints.size() != joint_count) {
            throw ContractError("pose sequence joint count does not match canonical skeleton");
        }
        for (const auto& joint : frame.joints) {
            if (!std::isfinite(joint.image_xy.x) || !std::isfinite(joint.image_xy.y) ||
                !std::isfinite(joint.position_m.x) || !std::isfinite(joint.position_m.y) ||
                !std::isfinite(joint.position_m.z) || !std::isfinite(joint.confidence) ||
                joint.confidence < 0.0f || joint.confidence > 1.0f) {
                throw ContractError("pose sequence joint values must be finite and confidence in [0,1]");
            }
            if (!joint.valid && joint.confidence != 0.0f) {
                throw ContractError("invalid pose observations must have zero confidence");
            }
        }
    }
}

PoseSequence smooth_pose_sequence(const PoseSequence& sequence) {
    validate_pose_sequence(sequence);
    if (sequence.frames.size()<3 ||
        sequence.backend.find("temporal-smooth5")!=std::string::npos) {
        return sequence;
    }

    PoseSequence median=sequence;
    const std::size_t frame_count=sequence.frames.size();
    const std::size_t joint_count=sequence.frames.front().joints.size();
    auto median3=[](double a,double b,double c) {
        return a+b+c-std::min({a,b,c})-std::max({a,b,c});
    };

    for (std::size_t frame=0;frame<frame_count;++frame) {
        const std::size_t before=frame==0 ? 0 : frame-1;
        const std::size_t after=std::min(frame+1,frame_count-1);
        for (std::size_t joint=0;joint<joint_count;++joint) {
            const auto& center=sequence.frames[frame].joints[joint];
            if (!center.valid) continue;
            const auto& left_candidate=sequence.frames[before].joints[joint];
            const auto& right_candidate=sequence.frames[after].joints[joint];
            const auto& left=left_candidate.valid ? left_candidate : center;
            const auto& right=right_candidate.valid ? right_candidate : center;
            auto& target=median.frames[frame].joints[joint];
            target.image_xy={
                median3(left.image_xy.x,center.image_xy.x,right.image_xy.x),
                median3(left.image_xy.y,center.image_xy.y,right.image_xy.y),
            };
            target.position_m={
                median3(left.position_m.x,center.position_m.x,right.position_m.x),
                median3(left.position_m.y,center.position_m.y,right.position_m.y),
                median3(left.position_m.z,center.position_m.z,right.position_m.z),
            };
        }
    }

    PoseSequence result=median;
    constexpr int weights[]{1,4,6,4,1};
    for (std::size_t frame=0;frame<frame_count;++frame) {
        for (std::size_t joint=0;joint<joint_count;++joint) {
            if (!median.frames[frame].joints[joint].valid) continue;
            double image_x=0.0,image_y=0.0;
            double position_x=0.0,position_y=0.0,position_z=0.0;
            double total_weight=0.0;
            for (int offset=-2;offset<=2;++offset) {
                const auto index=static_cast<std::size_t>(std::clamp<std::ptrdiff_t>(
                    static_cast<std::ptrdiff_t>(frame)+offset,0,
                    static_cast<std::ptrdiff_t>(frame_count-1)));
                const auto& sample=median.frames[index].joints[joint];
                if (!sample.valid) continue;
                const double weight=weights[offset+2]*
                    std::max(0.1,static_cast<double>(sample.confidence));
                image_x+=sample.image_xy.x*weight;
                image_y+=sample.image_xy.y*weight;
                position_x+=sample.position_m.x*weight;
                position_y+=sample.position_m.y*weight;
                position_z+=sample.position_m.z*weight;
                total_weight+=weight;
            }
            if (total_weight<=0.0) continue;
            auto& target=result.frames[frame].joints[joint];
            target.image_xy={image_x/total_weight,image_y/total_weight};
            target.position_m={
                position_x/total_weight,
                position_y/total_weight,
                position_z/total_weight,
            };
        }
    }
    result.backend+="+temporal-smooth5";
    validate_pose_sequence(result);
    return result;
}

PoseSequence optimize_pose_sequence(
    const PoseSequence& sequence,
    const PoseOptimizationOptions& options,
    const Skeleton* character_skeleton,
    ProportionPolicy proportion_policy
) {
    return optimize_pose_sequence_detailed(
        sequence, options, character_skeleton, proportion_policy).sequence;
}

PoseOptimizationResult optimize_pose_sequence_detailed(
    const PoseSequence& sequence,
    const PoseOptimizationOptions& options,
    const Skeleton* character_skeleton,
    ProportionPolicy proportion_policy
) {
    validate_pose_sequence(sequence);
    if (character_skeleton) validate_skeleton(*character_skeleton);
    PoseOptimizationResult output;
    output.diagnostics.profile_id = character_skeleton
        ? character_skeleton->skeleton_id : std::string{};
    output.diagnostics.proportion_policy = proportion_policy;
    const std::string policy_tag = proportion_policy == ProportionPolicy::SimilarReference
        ? "similar" : "exact";
    const std::string optimization_tag = character_skeleton
        ? "character-kinematic-opt-v2[" + character_skeleton->skeleton_id +
            ":" + policy_tag + "]"
        : "kinematic-opt-v2";
    if (sequence.backend.find(optimization_tag) != std::string::npos ||
        sequence.frames.size() < 2 || options.iterations == 0) {
        output.sequence = sequence;
        return output;
    }
    if (!std::isfinite(options.temporal_weight) || options.temporal_weight < 0.0 ||
        !std::isfinite(options.bone_length_weight) || options.bone_length_weight < 0.0 ||
        !std::isfinite(options.observation_weight) || options.observation_weight < 0.0 ||
        !std::isfinite(options.maximum_frame_correction_m) ||
        options.maximum_frame_correction_m <= 0.0 ||
        !std::isfinite(options.low_confidence_threshold) ||
        options.low_confidence_threshold <= 0.0 ||
        options.low_confidence_threshold > 1.0) {
        throw ContractError(
            "pose optimization options must be finite; weights non-negative; "
            "correction positive; confidence threshold in (0, 1]");
    }

    const auto skeleton = character_skeleton
        ? *character_skeleton : make_default_skeleton();
    const std::size_t frame_count = sequence.frames.size();
    const std::size_t joint_count = skeleton.bones.size();
    const std::size_t minimum_supported_samples = std::max<std::size_t>(
        10, static_cast<std::size_t>(std::ceil(frame_count * 0.05)));
    std::vector<double> target_lengths(joint_count, 0.0);
    for (std::size_t child = 2; child < joint_count; ++child) {
        const auto parent = static_cast<std::size_t>(skeleton.bones[child].parent);
        const double rest = length(skeleton.bones[child].rest_offset_m);
        if (character_skeleton && proportion_policy == ProportionPolicy::ExactReference) {
            target_lengths[child] = rest;
            ++output.diagnostics.profile_supported_bones;
            continue;
        }
        std::vector<double> samples;
        samples.reserve(frame_count);
        for (const auto& frame : sequence.frames) {
            if (!frame.joints[parent].valid || !frame.joints[child].valid) continue;
            if (character_skeleton &&
                (frame.joints[parent].confidence < options.low_confidence_threshold ||
                 frame.joints[child].confidence < options.low_confidence_threshold)) {
                continue;
            }
            const double sample = length(subtract(
                frame.joints[child].position_m, frame.joints[parent].position_m));
            if (std::isfinite(sample) && sample > kEpsilon) samples.push_back(sample);
        }
        if (samples.empty()) {
            target_lengths[child] = rest;
            if (character_skeleton) ++output.diagnostics.profile_supported_bones;
            continue;
        }
        const auto middle = samples.begin() + static_cast<std::ptrdiff_t>(samples.size() / 2);
        std::nth_element(samples.begin(), middle, samples.end());
        const double observed = std::clamp(*middle, rest * 0.50, rest * 1.80);
        if (!character_skeleton || samples.size() >= minimum_supported_samples) {
            target_lengths[child] = observed;
            if (character_skeleton) ++output.diagnostics.well_supported_bones;
        } else {
            const double support = std::clamp(
                static_cast<double>(samples.size()) /
                    static_cast<double>(minimum_supported_samples),
                0.0, 1.0);
            target_lengths[child] = observed * support + rest * (1.0 - support);
            ++output.diagnostics.profile_supported_bones;
        }
    }

    PoseSequence result = sequence;
    const auto original = sequence;
    for (std::size_t iteration = 0; iteration < options.iterations; ++iteration) {
        const auto previous = result;
        if (frame_count >= 3 && options.temporal_weight > 0.0) {
            for (std::size_t frame = 1; frame + 1 < frame_count; ++frame) {
                for (std::size_t joint = 0; joint < joint_count; ++joint) {
                    const auto& before = previous.frames[frame - 1].joints[joint];
                    const auto& center = previous.frames[frame].joints[joint];
                    const auto& after = previous.frames[frame + 1].joints[joint];
                    if (!before.valid || !center.valid || !after.valid) continue;
                    if (character_skeleton &&
                        center.confidence >= options.low_confidence_threshold) {
                        continue;
                    }
                    const auto predicted = scale(add(before.position_m, after.position_m), 0.5);
                    const double freedom = 1.0 - 0.72 * static_cast<double>(center.confidence);
                    const auto delta = clamp_length(scale(
                        subtract(predicted, center.position_m),
                        options.temporal_weight * freedom),
                        options.maximum_frame_correction_m);
                    result.frames[frame].joints[joint].position_m = add(
                        result.frames[frame].joints[joint].position_m, delta);
                }
            }
        }

        if (options.bone_length_weight > 0.0) {
            for (std::size_t frame = 0; frame < frame_count; ++frame) {
                for (std::size_t child = 2; child < joint_count; ++child) {
                    const auto parent = static_cast<std::size_t>(skeleton.bones[child].parent);
                    auto& parent_joint = result.frames[frame].joints[parent];
                    auto& child_joint = result.frames[frame].joints[child];
                    if (!parent_joint.valid || !child_joint.valid || target_lengths[child] <= 0.0) {
                        continue;
                    }
                    double profile_gate = 1.0;
                    double parent_freedom = 0.15 +
                        0.85 * (1.0 - static_cast<double>(parent_joint.confidence));
                    double child_freedom = 0.15 +
                        0.85 * (1.0 - static_cast<double>(child_joint.confidence));
                    if (character_skeleton) {
                        parent_freedom = std::clamp(
                            (options.low_confidence_threshold - parent_joint.confidence) /
                                options.low_confidence_threshold,
                            0.0, 1.0);
                        child_freedom = std::clamp(
                            (options.low_confidence_threshold - child_joint.confidence) /
                                options.low_confidence_threshold,
                            0.0, 1.0);
                        profile_gate = std::clamp(
                            std::max(parent_freedom, child_freedom),
                            0.0, 1.0);
                        if (profile_gate <= 0.0) continue;
                    }
                    const auto direction = subtract(child_joint.position_m, parent_joint.position_m);
                    const double current_length = length(direction);
                    if (current_length < kEpsilon) continue;
                    const auto error = scale(
                        direction,
                        (current_length - target_lengths[child]) / current_length);
                    const double total = parent_freedom + child_freedom;
                    if (total <= kEpsilon) continue;
                    const auto parent_delta = clamp_length(scale(
                        error, options.bone_length_weight * profile_gate *
                            parent_freedom / total),
                        options.maximum_frame_correction_m);
                    const auto child_delta = clamp_length(scale(
                        error, -options.bone_length_weight * profile_gate *
                            child_freedom / total),
                        options.maximum_frame_correction_m);
                    parent_joint.position_m = add(parent_joint.position_m, parent_delta);
                    child_joint.position_m = add(child_joint.position_m, child_delta);
                }
            }
        }

        if (options.observation_weight > 0.0) {
            for (std::size_t frame = 0; frame < frame_count; ++frame) {
                for (std::size_t joint = 0; joint < joint_count; ++joint) {
                    auto& current = result.frames[frame].joints[joint];
                    if (!current.valid) continue;
                    const auto& observed = original.frames[frame].joints[joint];
                    const double anchor = options.observation_weight *
                        (0.25 + 0.75 * static_cast<double>(observed.confidence));
                    current.position_m = add(current.position_m, clamp_length(scale(
                        subtract(observed.position_m, current.position_m), anchor),
                        options.maximum_frame_correction_m));
                }
            }
        }
    }
    if (character_skeleton) {
        for (std::size_t frame = 0; frame < frame_count; ++frame) {
            for (std::size_t joint = 0; joint < joint_count; ++joint) {
                auto& refined = result.frames[frame].joints[joint];
                const auto& observed = original.frames[frame].joints[joint];
                if (!refined.valid || !observed.valid ||
                    observed.confidence >= options.low_confidence_threshold) {
                    continue;
                }
                refined.position_m = add(observed.position_m, clamp_length(
                    subtract(refined.position_m, observed.position_m),
                    options.maximum_frame_correction_m));
            }
        }
    }
    result.backend += "+" + optimization_tag;
    validate_pose_sequence(result);
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        for (std::size_t joint = 0; joint < joint_count; ++joint) {
            const auto& observed = original.frames[frame].joints[joint];
            const auto& refined = result.frames[frame].joints[joint];
            if (!observed.valid || !refined.valid) continue;
            const double correction = length(subtract(
                refined.position_m, observed.position_m));
            if (correction <= kEpsilon) continue;
            if (character_skeleton &&
                observed.confidence >= options.low_confidence_threshold) {
                ++output.diagnostics.high_confidence_move_attempts;
                continue;
            }
            ++output.diagnostics.corrected_joint_samples;
            output.diagnostics.mean_correction_m += correction;
            output.diagnostics.maximum_correction_m = std::max(
                output.diagnostics.maximum_correction_m, correction);
        }
    }
    if (output.diagnostics.corrected_joint_samples > 0) {
        output.diagnostics.mean_correction_m /=
            static_cast<double>(output.diagnostics.corrected_joint_samples);
    }
    output.sequence = std::move(result);
    return output;
}

PoseSequence apply_manual_pose_corrections(
    const PoseSequence& refined_sequence,
    const ManualPoseCorrections& corrections
) {
    validate_pose_sequence(refined_sequence);
    auto result = refined_sequence;
    for (const auto& correction : corrections) {
        if (correction.position_deltas_m.size() != result.frames.size()) {
            throw ContractError(
                "manual correction frame count does not match pose sequence");
        }
        if (!correction.frame_weights.empty() &&
            correction.frame_weights.size() != result.frames.size()) {
            throw ContractError(
                "manual correction curve frame count does not match pose sequence");
        }
        if (!correction.frame_weights.empty() &&
            correction.keyframe_frame_index >= result.frames.size()) {
            throw ContractError("manual correction keyframe is outside the pose sequence");
        }
        for (std::size_t frame = 0; frame < result.frames.size(); ++frame) {
            if (correction.joint_index >= result.frames[frame].joints.size()) {
                throw ContractError(
                    "manual correction joint index is outside the pose schema");
            }
            auto& joint = result.frames[frame].joints[correction.joint_index];
            const double weight = correction.frame_weights.empty()
                ? 1.0 : correction.frame_weights[frame];
            if (!std::isfinite(weight) || weight < 0.0 || weight > 1.0) {
                throw ContractError("manual correction curve weight is outside [0, 1]");
            }
            if (!joint.valid) continue;
            const auto& delta = correction.position_deltas_m[frame];
            joint.image_xy.x += correction.image_delta.x * weight;
            joint.image_xy.y += correction.image_delta.y * weight;
            joint.position_m += weight * delta;
        }
    }
    validate_pose_sequence(result);
    return result;
}

std::vector<double> make_bounded_keyframe_curve_weights(
    std::size_t frame_count,
    std::size_t keyframe_frame_index,
    std::size_t influence_radius_frames
) {
    if (frame_count == 0 || keyframe_frame_index >= frame_count) {
        throw ContractError("manual keyframe is outside the pose sequence");
    }
    if (influence_radius_frames == 0) {
        throw ContractError("manual keyframe influence radius must be positive");
    }
    std::vector<double> weights(frame_count, 0.0);
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const std::size_t distance = frame > keyframe_frame_index
            ? frame - keyframe_frame_index : keyframe_frame_index - frame;
        if (distance > influence_radius_frames) continue;
        const double value = static_cast<double>(distance) /
            static_cast<double>(influence_radius_frames);
        // Cubic Hermite smoothstep from 1 at the authored key to 0 at the
        // bounded edge. The derivative is zero at both ends, avoiding a new
        // velocity discontinuity where the correction joins the baseline.
        weights[frame] = 1.0 - value * value * (3.0 - 2.0 * value);
    }
    return weights;
}

MotionPackage reconstruct_canonical_motion(
    const PoseSequence& sequence,
    const Skeleton* character_skeleton
) {
    validate_pose_sequence(sequence);
    if (character_skeleton) validate_skeleton(*character_skeleton);
    MotionPackage package;
    package.skeleton = character_skeleton
        ? *character_skeleton : make_default_skeleton();
    package.cameras = {{
        "source_view",
        0.0,
        0.0,
        static_cast<double>(sequence.image_height) / 1.7,
        {static_cast<double>(sequence.image_width) * 0.5,
         static_cast<double>(sequence.image_height) * 0.5},
    }};

    auto& motion = package.motion;
    motion.skeleton_id = package.skeleton.skeleton_id;
    const std::size_t frames = sequence.frames.size();
    const std::size_t joints = package.skeleton.bones.size();
    motion.fps = sequence.fps;
    motion.frame_count = frames;
    motion.joint_count = joints;
    motion.time_s.reserve(frames);
    motion.scene_root_translation_m.reserve(frames);
    motion.scene_root_rotation.assign(frames, {});
    motion.local_rotations.assign(frames * joints, {});
    motion.hips_translation_m.assign(frames, {});
    motion.confidence.resize(frames * joints);
    motion.valid_mask.resize(frames * joints);
    motion.foot_contacts.assign(frames * 2, 0);

    const auto children = primary_children(package.skeleton);
    const auto hips = bone_index(package.skeleton, BoneSemantic::Hips);
    std::vector<std::vector<Quat>> per_joint(joints);
    for (auto& rotations : per_joint) rotations.reserve(frames);

    for (std::size_t frame_index = 0; frame_index < frames; ++frame_index) {
        const auto& observed = sequence.frames[frame_index];
        motion.time_s.push_back(observed.time_s);
        const auto hip_position = observed.joints[hips].position_m;
        motion.scene_root_translation_m.push_back({
            hip_position.x,
            hip_position.y - package.skeleton.bones[hips].rest_offset_m.y,
            hip_position.z,
        });

        std::vector<Quat> global(joints);
        for (std::size_t joint = 0; joint < joints; ++joint) {
            const int child = children[joint];
            Quat desired_global{};
            if (child >= 0 &&
                observed.joints[joint].valid &&
                observed.joints[static_cast<std::size_t>(child)].valid) {
                const auto source = package.skeleton.bones[static_cast<std::size_t>(child)].rest_offset_m;
                const auto target = subtract(
                    observed.joints[static_cast<std::size_t>(child)].position_m,
                    observed.joints[joint].position_m);
                if (length(source) >= kEpsilon && length(target) >= kEpsilon) {
                    desired_global = rotation_between(source, target);
                }
            } else if (package.skeleton.bones[joint].parent >= 0) {
                desired_global = global[static_cast<std::size_t>(
                    package.skeleton.bones[joint].parent)];
            }

            Quat local = desired_global;
            const int parent = package.skeleton.bones[joint].parent;
            if (parent >= 0) {
                local = normalize(multiply(
                    conjugate(global[static_cast<std::size_t>(parent)]),
                    desired_global));
            }
            global[joint] = desired_global;
            per_joint[joint].push_back(local);
            const auto flat_index = frame_index * joints + joint;
            motion.confidence[flat_index] = observed.joints[joint].confidence;
            motion.valid_mask[flat_index] = observed.joints[joint].valid ? 1U : 0U;
        }
    }

    for (auto& rotations : per_joint) enforce_quaternion_continuity(rotations);
    for (std::size_t frame = 0; frame < frames; ++frame) {
        for (std::size_t joint = 0; joint < joints; ++joint) {
            motion.local_rotations[frame * joints + joint] = per_joint[joint][frame];
        }
    }
    motion.foot_contacts = infer_foot_contacts(sequence, package.skeleton);
    stabilize_contact_feet(motion, package.skeleton);

    const auto config_text = sequence.backend + ":pose-sequence-v1";
    std::vector<std::string> sources;
    if (std::filesystem::is_regular_file(sequence.source_video)) {
        sources.push_back(sha256_file(sequence.source_video));
    } else {
        sources.push_back(sha256_bytes(text_bytes(sequence.source_video.string())));
    }
    motion.provenance = {
        ANIMOCAP_VERSION,
        sha256_bytes(text_bytes(config_text)),
        std::move(sources),
        sequence.backend,
        "",
    };
    validate_motion(motion, package.skeleton);
    return package;
}

}  // namespace animocap

