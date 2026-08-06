#include "animocap/pose_sequence.hpp"

#include "animocap/hash.hpp"
#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <fstream>
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

MotionPackage reconstruct_canonical_motion(const PoseSequence& sequence) {
    validate_pose_sequence(sequence);
    MotionPackage package;
    package.skeleton = make_default_skeleton();
    package.cameras = {{
        "source_view",
        0.0,
        0.0,
        static_cast<double>(sequence.image_height) / 1.7,
        {static_cast<double>(sequence.image_width) * 0.5,
         static_cast<double>(sequence.image_height) * 0.5},
    }};

    auto& motion = package.motion;
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

