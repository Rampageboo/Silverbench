#include "animocap/fixture.hpp"

#include "animocap/hash.hpp"
#include "animocap/math.hpp"

#include <nlohmann/json.hpp>

#include <cmath>
#include <fstream>
#include <sstream>

namespace animocap {
namespace {

using json = nlohmann::json;
constexpr double kPi = 3.141592653589793238462643383279502884;

class DeterministicRng {
public:
    explicit DeterministicRng(std::uint64_t seed) : state_(seed == 0 ? 0x9e3779b97f4a7c15ULL : seed) {}
    double unit() {
        state_ ^= state_ >> 12U;
        state_ ^= state_ << 25U;
        state_ ^= state_ >> 27U;
        const auto value = state_ * 2685821657736338717ULL;
        return static_cast<double>(value >> 11U) / static_cast<double>(1ULL << 53U);
    }
private:
    std::uint64_t state_;
};

std::vector<unsigned char> bytes_of(std::string_view text) {
    return {text.begin(), text.end()};
}

void write_json(const std::filesystem::path& path, const json& value) {
    std::ofstream output(path, std::ios::binary);
    if (!output) throw std::runtime_error("cannot write fixture JSON: " + path.string());
    output << value.dump(2) << '\n';
}

}  // namespace

MotionPackage make_synthetic_motion(std::uint64_t seed, std::size_t frame_count) {
    if (frame_count < 2) throw ContractError("synthetic fixture requires at least two frames");
    MotionPackage package;
    package.skeleton = make_default_skeleton();
    package.cameras = {
        {"front", 0.0, 0.0, 300.0, {320.0, 360.0}},
        {"held_out_45", 45.0, 0.0, 300.0, {320.0, 360.0}},
    };
    auto& motion = package.motion;
    motion.frame_count = frame_count;
    motion.joint_count = package.skeleton.bones.size();
    motion.fps = 30.0;

    DeterministicRng rng(seed);
    const double arm_amplitude = 0.10 + 0.03 * rng.unit();
    const double body_amplitude = 0.010 + 0.005 * rng.unit();
    const double phase_offset = 0.2 * rng.unit();
    const auto left_arm = bone_index(package.skeleton, BoneSemantic::LeftUpperArm);
    const auto right_arm = bone_index(package.skeleton, BoneSemantic::RightUpperArm);
    const auto head = bone_index(package.skeleton, BoneSemantic::Head);

    motion.time_s.reserve(frame_count);
    motion.scene_root_translation_m.reserve(frame_count);
    motion.scene_root_rotation.reserve(frame_count);
    motion.local_rotations.assign(frame_count * motion.joint_count, {});
    motion.hips_translation_m.reserve(frame_count);
    motion.confidence.assign(frame_count * motion.joint_count, 1.0f);
    motion.valid_mask.assign(frame_count * motion.joint_count, 1U);
    motion.foot_contacts.assign(frame_count * 2, 1U);

    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const double alpha = static_cast<double>(frame) / static_cast<double>(frame_count - 1);
        const double phase = 2.0 * kPi * alpha + phase_offset;
        motion.time_s.push_back(static_cast<double>(frame) / motion.fps);
        motion.scene_root_translation_m.push_back({0.015 * std::sin(phase), 0.0, 0.010 * std::cos(phase)});
        motion.scene_root_rotation.push_back(from_axis_angle({0.0, 1.0, 0.0}, 0.04 * std::sin(phase)));
        motion.hips_translation_m.push_back({0.0, body_amplitude * std::sin(phase), 0.0});
        motion.local_rotations[frame * motion.joint_count + left_arm] =
            from_axis_angle({0.0, 0.0, 1.0}, arm_amplitude * std::sin(phase));
        motion.local_rotations[frame * motion.joint_count + right_arm] =
            from_axis_angle({0.0, 0.0, 1.0}, -arm_amplitude * std::sin(phase));
        motion.local_rotations[frame * motion.joint_count + head] =
            from_axis_angle({0.0, 1.0, 0.0}, 0.03 * std::sin(phase));
    }

    const auto config_text = std::to_string(seed) + ":" + std::to_string(frame_count) + ":m0-fixture-v1";
    const auto source_text = std::string("procedural-stick-figure-v1");
    motion.provenance = {
        ANIMOCAP_VERSION,
        sha256_bytes(bytes_of(config_text)),
        {sha256_bytes(bytes_of(source_text))},
        "none-m0",
        "",
    };
    validate_motion(motion, package.skeleton);
    return package;
}

FixtureResult generate_synthetic_fixture(
    const std::filesystem::path& output_directory,
    std::uint64_t seed,
    std::size_t frame_count
) {
    if (std::filesystem::exists(output_directory)) {
        throw std::runtime_error("refusing to overwrite fixture directory: " + output_directory.string());
    }
    std::filesystem::create_directories(output_directory);
    const auto package = make_synthetic_motion(seed, frame_count);
    const auto package_directory = output_directory / "motion.amotion";
    save_motion_package(package, package_directory);

    const auto& front = package.cameras.at(0);
    const auto& held_out = package.cameras.at(1);
    json ground_truth{
        {"schema_version", kSchemaVersion},
        {"fixture_type", "procedural_stick_figure"},
        {"seed", seed},
        {"coordinate_system", "right_handed_y_up_z_forward_meters"},
        {"cameras", {
            {{"id", front.id}, {"yaw_degrees", front.yaw_degrees}, {"pitch_degrees", front.pitch_degrees},
             {"scale_pixels_per_meter", front.scale_pixels_per_meter},
             {"principal_point", {front.principal_point.x, front.principal_point.y}}},
            {{"id", held_out.id}, {"yaw_degrees", held_out.yaw_degrees}, {"pitch_degrees", held_out.pitch_degrees},
             {"scale_pixels_per_meter", held_out.scale_pixels_per_meter},
             {"principal_point", {held_out.principal_point.x, held_out.principal_point.y}}},
        }},
        {"frames", json::array()},
    };

    for (std::size_t frame = 0; frame < package.motion.frame_count; ++frame) {
        const auto begin = package.motion.local_rotations.begin() +
                           static_cast<std::ptrdiff_t>(frame * package.motion.joint_count);
        const std::vector<Quat> rotations(begin, begin + static_cast<std::ptrdiff_t>(package.motion.joint_count));
        const auto fk = forward_kinematics(
            package.skeleton,
            rotations,
            package.motion.scene_root_translation_m[frame],
            package.motion.scene_root_rotation[frame],
            package.motion.hips_translation_m[frame]
        );
        json positions = json::array();
        json front_points = json::array();
        json held_out_points = json::array();
        for (const auto& position : fk.positions_m) {
            positions.push_back({position.x, position.y, position.z});
            const auto a = project_weak_perspective(front, position);
            const auto b = project_weak_perspective(held_out, position);
            front_points.push_back({a.x, a.y});
            held_out_points.push_back({b.x, b.y});
        }
        ground_truth["frames"].push_back({
            {"frame_index", frame},
            {"time_s", package.motion.time_s[frame]},
            {"joint_positions_m", positions},
            {"front_keypoints_px", front_points},
            {"held_out_keypoints_px", held_out_points},
        });
    }

    const auto ground_truth_path = output_directory / "ground_truth.json";
    write_json(ground_truth_path, ground_truth);
    const auto hash = sha256_directory(output_directory);
    std::ofstream hash_file(output_directory / "fixture.sha256", std::ios::binary);
    if (!hash_file) throw std::runtime_error("cannot write fixture hash");
    hash_file << hash << '\n';
    return {package_directory, ground_truth_path, hash};
}

}  // namespace animocap
