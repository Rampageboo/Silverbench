#include "animocap/contracts.hpp"
#include "animocap/character_profile.hpp"
#include "animocap/export.hpp"
#include "animocap/fixture.hpp"
#include "animocap/hash.hpp"
#include "animocap/math.hpp"
#include "animocap/multiview.hpp"
#include "animocap/package.hpp"
#include "animocap/pose_sequence.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <set>
#include <sstream>
#include <string>
#include <vector>

namespace {

int failures = 0;

void fail(std::string_view message, int line) {
    std::cerr << "FAIL line " << line << ": " << message << '\n';
    ++failures;
}

#define CHECK(condition) do { if (!(condition)) fail(#condition, __LINE__); } while (false)
#define CHECK_NEAR(actual, expected, tolerance) do { \
    if (std::abs((actual) - (expected)) > (tolerance)) fail(#actual " ~= " #expected, __LINE__); \
} while (false)
#define CHECK_THROWS(expression) do { \
    bool threw = false; \
    try { (void)(expression); } catch (const std::exception&) { threw = true; } \
    if (!threw) fail("expected exception: " #expression, __LINE__); \
} while (false)

std::filesystem::path source_path(std::string_view relative) {
    return std::filesystem::path(ANIMOCAP_SOURCE_DIR) / std::filesystem::path(relative);
}

std::filesystem::path test_root() {
    return std::filesystem::current_path() / "animocap-m0-test-output";
}

std::string read_text(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    std::ostringstream output;
    output << input.rdbuf();
    return output.str();
}

void write_text(const std::filesystem::path& path, std::string_view text) {
    std::ofstream output(path, std::ios::binary);
    output << text;
}

void test_sha256() {
    const std::string value = "abc";
    const std::vector<unsigned char> bytes(value.begin(), value.end());
    CHECK(animocap::sha256_bytes(bytes) ==
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

void test_skeleton_contract() {
    const auto skeleton = animocap::make_default_skeleton();
    animocap::validate_skeleton(skeleton);
    CHECK(skeleton.bones.size() == 23);
    CHECK(animocap::bone_index(skeleton, animocap::BoneSemantic::Head) == 6);

    auto duplicate = skeleton;
    duplicate.bones[1].semantic = animocap::BoneSemantic::SceneRoot;
    CHECK_THROWS(animocap::validate_skeleton(duplicate));

    const auto loaded = animocap::load_skeleton_json(
        source_path("configs/skeletons/animocap_canonical_v1.json"));
    CHECK(loaded.bones.size() == skeleton.bones.size());

    const auto temp = test_root() / "skeleton-unknown.json";
    auto json = nlohmann::json::parse(read_text(source_path("configs/skeletons/animocap_canonical_v1.json")));
    json["bones"][6]["semantic"] = "jaw";
    write_text(temp, json.dump(2));
    CHECK_THROWS(animocap::load_skeleton_json(temp));
}

void test_manifest_contract() {
    const auto path = source_path("tests/fixtures/capture.single.json");
    const auto manifest = animocap::load_capture_manifest(path);
    CHECK(manifest.views.size() == 1);
    CHECK(manifest.mode == animocap::CaptureMode::SingleView);

    auto duplicate = manifest;
    duplicate.mode = animocap::CaptureMode::SynchronizedMultiview;
    duplicate.views.push_back(duplicate.views.front());
    CHECK_THROWS(animocap::validate_capture_manifest(duplicate));

    auto synchronized = manifest;
    synchronized.mode = animocap::CaptureMode::SynchronizedMultiview;
    synchronized.calibration_file = "calibration.json";
    auto second_view = synchronized.views.front();
    second_view.id = "camera_b";
    second_view.video = "camera_b.mp4";
    second_view.time_offset_s = 0.004;
    synchronized.views.push_back(second_view);
    animocap::validate_capture_manifest(synchronized);
    const auto synchronized_path = test_root() / "capture-synchronized.json";
    animocap::save_capture_manifest(synchronized, synchronized_path);
    const auto synchronized_loaded = animocap::load_capture_manifest(
        synchronized_path);
    CHECK(synchronized_loaded.calibration_file == synchronized.calibration_file);
    CHECK(synchronized_loaded.views[1].time_offset_s == 0.004);

    auto json = nlohmann::json::parse(read_text(path));
    json["unexpected"] = true;
    const auto unknown_path = test_root() / "capture-unknown.json";
    write_text(unknown_path, json.dump(2));
    CHECK_THROWS(animocap::load_capture_manifest(unknown_path));

    json.erase("unexpected");
    json.erase("fps");
    const auto missing_path = test_root() / "capture-missing.json";
    write_text(missing_path, json.dump(2));
    CHECK_THROWS(animocap::load_capture_manifest(missing_path));
}

void test_keypoint_contract() {
    animocap::KeypointFrame frame;
    frame.bbox_xyxy = {0.0, 0.0, 100.0, 200.0};
    frame.keypoints_xy = {{1.0, 2.0}, {3.0, 4.0}};
    frame.confidence = {1.0, 0.0};
    frame.visibility = {animocap::Visibility::Visible, animocap::Visibility::Missing};
    frame.manual_override = {0, 1};
    frame.track_id = "subject-1";
    frame.model_id = "synthetic";
    animocap::validate_keypoint_frame(frame);
    frame.confidence.pop_back();
    CHECK_THROWS(animocap::validate_keypoint_frame(frame));
}

void test_coordinate_roundtrip() {
    const animocap::Vec3 original{1.25, -2.5, 3.75};
    const auto restored = animocap::blender_to_canonical(animocap::canonical_to_blender(original));
    CHECK_NEAR(restored.x, original.x, 1e-12);
    CHECK_NEAR(restored.y, original.y, 1e-12);
    CHECK_NEAR(restored.z, original.z, 1e-12);

    const auto rotation = animocap::from_axis_angle({1.0, 2.0, 3.0}, 0.7);
    const auto restored_rotation =
        animocap::blender_to_canonical(animocap::canonical_to_blender(rotation));
    CHECK_NEAR(restored_rotation.w, rotation.w, 1e-12);
    CHECK_NEAR(restored_rotation.x, rotation.x, 1e-12);
    CHECK_NEAR(restored_rotation.y, rotation.y, 1e-12);
    CHECK_NEAR(restored_rotation.z, rotation.z, 1e-12);

    std::vector<animocap::Quat> sequence{rotation, {-rotation.w, -rotation.x, -rotation.y, -rotation.z}};
    animocap::enforce_quaternion_continuity(sequence);
    CHECK_NEAR(sequence[0].w, sequence[1].w, 1e-12);
}

void test_fk() {
    const auto skeleton = animocap::make_default_skeleton();
    const std::vector<animocap::Quat> rotations(skeleton.bones.size());
    const auto result = animocap::forward_kinematics(skeleton, rotations, {});
    const auto head = result.positions_m[animocap::bone_index(skeleton, animocap::BoneSemantic::Head)];
    CHECK_NEAR(head.x, 0.0, 1e-12);
    CHECK_NEAR(head.y, 1.57, 1e-12);
    CHECK_NEAR(head.z, 0.0, 1e-12);
    const auto left_hand = result.positions_m[
        animocap::bone_index(skeleton, animocap::BoneSemantic::LeftHand)];
    CHECK_NEAR(left_hand.x, 0.74, 1e-12);
    CHECK_NEAR(left_hand.y, 1.37, 1e-12);
}

void test_character_profile_import() {
    const auto directory=test_root()/"character-profile";
    std::filesystem::create_directories(directory);
    auto skeleton=animocap::make_default_skeleton();
    skeleton.skeleton_id="profile_import_test_v1";
    const auto skeleton_path=directory/"skeleton.json";
    animocap::save_skeleton_json(skeleton,skeleton_path);

    const auto direct=animocap::load_character_profile(skeleton_path);
    CHECK(direct.skeleton.skeleton_id==skeleton.skeleton_id);
    CHECK(direct.skeleton_path==std::filesystem::absolute(skeleton_path).lexically_normal());
    CHECK_NEAR(direct.optimization_options.low_confidence_threshold,0.55,1e-12);

    const auto profile_path=directory/"profile.json";
    const nlohmann::json profile{
        {"schema_version",animocap::kSchemaVersion},
        {"profile_id",skeleton.skeleton_id},
        {"canonical_skeleton","skeleton.json"},
        {"constraint_policy",{
            {"mode","low_confidence_bone_length"},
            {"low_confidence_threshold",0.42},
            {"preserve_high_confidence_observations",true},
        }},
    };
    write_text(profile_path,profile.dump(2));
    const auto imported=animocap::load_character_profile(profile_path);
    CHECK(imported.skeleton.skeleton_id==skeleton.skeleton_id);
    CHECK(imported.skeleton_path==std::filesystem::absolute(skeleton_path).lexically_normal());
    CHECK_NEAR(imported.optimization_options.low_confidence_threshold,0.42,1e-12);

    auto invalid=profile;
    invalid["constraint_policy"]["low_confidence_threshold"]=1.5;
    const auto invalid_path=directory/"profile-invalid.json";
    write_text(invalid_path,invalid.dump(2));
    CHECK_THROWS(animocap::load_character_profile(invalid_path));
}

std::vector<std::uint8_t> read_bytes(const std::filesystem::path& path) {
    std::ifstream input(path,std::ios::binary);
    return {std::istreambuf_iterator<char>(input),std::istreambuf_iterator<char>()};
}

std::uint32_t read_u32(const std::vector<std::uint8_t>& bytes,std::size_t offset) {
    if(offset+4>bytes.size())throw std::runtime_error("truncated uint32");
    return static_cast<std::uint32_t>(bytes[offset])|
        (static_cast<std::uint32_t>(bytes[offset+1])<<8U)|
        (static_cast<std::uint32_t>(bytes[offset+2])<<16U)|
        (static_cast<std::uint32_t>(bytes[offset+3])<<24U);
}

void test_fk_scene_root_rotation() {
    const auto skeleton = animocap::make_default_skeleton();
    const std::vector<animocap::Quat> rotations(skeleton.bones.size());
    const auto quarter_turn = animocap::from_axis_angle(
        {0.0, 1.0, 0.0}, 3.14159265358979323846 * 0.5);
    const auto result = animocap::forward_kinematics(
        skeleton, rotations, {}, quarter_turn);
    const auto left_hand = result.positions_m[
        animocap::bone_index(skeleton, animocap::BoneSemantic::LeftHand)];
    CHECK_NEAR(left_hand.x, 0.0, 1e-12);
    CHECK_NEAR(left_hand.y, 1.37, 1e-12);
    CHECK_NEAR(left_hand.z, -0.74, 1e-12);
}

void test_motion_validation() {
    const auto package = animocap::make_synthetic_motion(7, 5);
    animocap::validate_motion(package.motion, package.skeleton);

    auto invalid_quaternion = package.motion;
    invalid_quaternion.local_rotations[0] = {2.0, 0.0, 0.0, 0.0};
    CHECK_THROWS(animocap::validate_motion(invalid_quaternion, package.skeleton));

    auto non_monotonic = package.motion;
    non_monotonic.time_s[2] = non_monotonic.time_s[1];
    CHECK_THROWS(animocap::validate_motion(non_monotonic, package.skeleton));

    auto invalid_mask = package.motion;
    invalid_mask.valid_mask[0] = 0;
    CHECK_THROWS(animocap::validate_motion(invalid_mask, package.skeleton));
}

void test_pose_reconstruction() {
    const auto source = animocap::make_synthetic_motion(91, 12);
    animocap::PoseSequence sequence;
    sequence.source_video = "procedural-test-video.mp4";
    sequence.backend = "synthetic-observation-test";
    sequence.image_width = 640;
    sequence.image_height = 720;
    sequence.fps = source.motion.fps;
    const animocap::Camera camera{"test", 0.0, 0.0, 300.0, {320.0, 360.0}};

    for (std::size_t frame_index = 0; frame_index < source.motion.frame_count; ++frame_index) {
        const auto begin = source.motion.local_rotations.begin() +
            static_cast<std::ptrdiff_t>(frame_index * source.motion.joint_count);
        const std::vector<animocap::Quat> rotations(
            begin, begin + static_cast<std::ptrdiff_t>(source.motion.joint_count));
        const auto fk = animocap::forward_kinematics(
            source.skeleton,
            rotations,
            source.motion.scene_root_translation_m[frame_index],
            source.motion.scene_root_rotation[frame_index],
            source.motion.hips_translation_m[frame_index]);
        animocap::ObservedPoseFrame frame;
        frame.time_s = source.motion.time_s[frame_index];
        for (const auto& position : fk.positions_m) {
            frame.joints.push_back({
                animocap::project_weak_perspective(camera, position),
                position,
                1.0f,
                true,
            });
        }
        sequence.frames.push_back(std::move(frame));
    }

    animocap::validate_pose_sequence(sequence);
    auto jittered=sequence;
    const auto head=animocap::bone_index(
        animocap::make_default_skeleton(),animocap::BoneSemantic::Head);
    jittered.frames[5].joints[head].image_xy.x+=120.0;
    jittered.frames[5].joints[head].position_m.x+=0.4;
    const double neighbor_center=(
        jittered.frames[4].joints[head].image_xy.x+
        jittered.frames[6].joints[head].image_xy.x)*0.5;
    const double jitter_before=std::abs(
        jittered.frames[5].joints[head].image_xy.x-neighbor_center);
    const auto smoothed=animocap::smooth_pose_sequence(jittered);
    const double jitter_after=std::abs(
        smoothed.frames[5].joints[head].image_xy.x-neighbor_center);
    CHECK(jitter_after<jitter_before*0.25);
    CHECK(smoothed.backend.find("temporal-smooth5")!=std::string::npos);
    const auto smoothed_twice=animocap::smooth_pose_sequence(smoothed);
    CHECK(smoothed_twice.frames[5].joints[head].image_xy.x==
          smoothed.frames[5].joints[head].image_xy.x);

    auto optimization_input=sequence;
    const auto neck=animocap::bone_index(
        animocap::make_default_skeleton(),animocap::BoneSemantic::Neck);
    optimization_input.frames[5].joints[head].position_m.x+=0.32;
    optimization_input.frames[5].joints[head].confidence=0.15f;
    const auto before_vector=optimization_input.frames[5].joints[head].position_m-
        optimization_input.frames[5].joints[neck].position_m;
    const auto reference_vector=sequence.frames[5].joints[head].position_m-
        sequence.frames[5].joints[neck].position_m;
    const auto vector_length=[](const animocap::Vec3& value) {
        return std::sqrt(value.x*value.x+value.y*value.y+value.z*value.z);
    };
    const double bone_error_before=std::abs(
        vector_length(before_vector)-vector_length(reference_vector));
    const auto optimized=animocap::optimize_pose_sequence(optimization_input);
    const auto after_vector=optimized.frames[5].joints[head].position_m-
        optimized.frames[5].joints[neck].position_m;
    const double bone_error_after=std::abs(
        vector_length(after_vector)-vector_length(reference_vector));
    CHECK(bone_error_after<bone_error_before*0.50);
    CHECK(optimized.frames[5].joints[head].image_xy==
          optimization_input.frames[5].joints[head].image_xy);
    CHECK(optimized.backend.find("kinematic-opt-v1")!=std::string::npos);
    const auto optimized_twice=animocap::optimize_pose_sequence(optimized);
    CHECK(optimized_twice.frames[5].joints[head].position_m==
          optimized.frames[5].joints[head].position_m);

    auto character_skeleton=animocap::make_default_skeleton();
    character_skeleton.skeleton_id="test_character_profile_v1";
    auto& character_head_offset=character_skeleton.bones[head].rest_offset_m;
    character_head_offset.x*=1.60;
    character_head_offset.y*=1.60;
    character_head_offset.z*=1.60;
    animocap::PoseOptimizationOptions profile_options;
    profile_options.iterations=16;
    profile_options.temporal_weight=0.0;
    profile_options.observation_weight=0.0;
    profile_options.maximum_frame_correction_m=0.05;

    auto high_confidence_profile_input=sequence;
    for(auto& frame:high_confidence_profile_input.frames)
        for(auto& joint:frame.joints)joint.confidence=1.0f;
    const auto high_confidence_profile_result=animocap::optimize_pose_sequence(
        high_confidence_profile_input,profile_options,&character_skeleton);
    CHECK(high_confidence_profile_result.frames[5].joints[head].position_m==
          high_confidence_profile_input.frames[5].joints[head].position_m);

    auto low_confidence_profile_input=high_confidence_profile_input;
    for(auto& frame:low_confidence_profile_input.frames)
        frame.joints[head].confidence=0.10f;
    const double character_head_length=vector_length(character_head_offset);
    const auto low_profile_before_vector=
        low_confidence_profile_input.frames[5].joints[head].position_m-
        low_confidence_profile_input.frames[5].joints[neck].position_m;
    const double low_profile_error_before=std::abs(
        vector_length(low_profile_before_vector)-character_head_length);
    const auto low_confidence_profile_result=animocap::optimize_pose_sequence(
        low_confidence_profile_input,profile_options,&character_skeleton);
    const auto low_profile_after_vector=
        low_confidence_profile_result.frames[5].joints[head].position_m-
        low_confidence_profile_result.frames[5].joints[neck].position_m;
    const double low_profile_error_after=std::abs(
        vector_length(low_profile_after_vector)-character_head_length);
    CHECK(low_profile_error_after<low_profile_error_before*0.10);
    CHECK(low_confidence_profile_result.backend.find(
        "character-kinematic-opt-v1[test_character_profile_v1]")!=std::string::npos);
    const auto profiled_motion=animocap::reconstruct_canonical_motion(
        low_confidence_profile_result,&character_skeleton);
    CHECK(profiled_motion.skeleton.skeleton_id==character_skeleton.skeleton_id);
    CHECK(profiled_motion.motion.skeleton_id==character_skeleton.skeleton_id);
    CHECK(profiled_motion.skeleton.bones[head].rest_offset_m==character_head_offset);

    const auto reconstructed = animocap::reconstruct_canonical_motion(sequence);
    animocap::validate_motion(reconstructed.motion, reconstructed.skeleton);
    CHECK(reconstructed.motion.frame_count == source.motion.frame_count);
    CHECK(reconstructed.motion.joint_count == source.motion.joint_count);
    CHECK(reconstructed.motion.time_s == source.motion.time_s);
    CHECK(reconstructed.motion.provenance.model_id == "synthetic-observation-test");
    CHECK(reconstructed.cameras.size() == 1);
    const auto contact_count = std::count(
        reconstructed.motion.foot_contacts.begin(),
        reconstructed.motion.foot_contacts.end(),
        static_cast<std::uint8_t>(1));
    CHECK(contact_count > reconstructed.motion.frame_count);
    CHECK(std::all_of(
        reconstructed.motion.foot_contacts.begin(),
        reconstructed.motion.foot_contacts.end(),
        [](std::uint8_t value) { return value == 0U || value == 1U; }));
}


animocap::PoseSequence make_directional_test_pose(
    double yaw_degrees, std::size_t frame_count, double phase_offset,
    double phase_rate, bool swap_sides, bool hide_reference_hand
) {
    const auto skeleton = animocap::make_default_skeleton();
    const auto base = animocap::forward_kinematics(
        skeleton, std::vector<animocap::Quat>(skeleton.bones.size()), {});
    const auto left_hand = animocap::bone_index(skeleton, animocap::BoneSemantic::LeftHand);
    const auto right_hand = animocap::bone_index(skeleton, animocap::BoneSemantic::RightHand);
    const std::vector<std::pair<animocap::BoneSemantic, animocap::BoneSemantic>> semantics{
        {animocap::BoneSemantic::LeftShoulder, animocap::BoneSemantic::RightShoulder},
        {animocap::BoneSemantic::LeftUpperArm, animocap::BoneSemantic::RightUpperArm},
        {animocap::BoneSemantic::LeftLowerArm, animocap::BoneSemantic::RightLowerArm},
        {animocap::BoneSemantic::LeftHand, animocap::BoneSemantic::RightHand},
        {animocap::BoneSemantic::LeftUpperLeg, animocap::BoneSemantic::RightUpperLeg},
        {animocap::BoneSemantic::LeftLowerLeg, animocap::BoneSemantic::RightLowerLeg},
        {animocap::BoneSemantic::LeftFoot, animocap::BoneSemantic::RightFoot},
        {animocap::BoneSemantic::LeftToes, animocap::BoneSemantic::RightToes},
    };
    const double angle = -yaw_degrees * 3.14159265358979323846 / 180.0;
    const double cosine = std::cos(angle), sine = std::sin(angle);
    auto camera_space = [=](const animocap::Vec3& value) {
        return animocap::Vec3{
            cosine * value.x + sine * value.z, value.y,
            -sine * value.x + cosine * value.z,
        };
    };

    animocap::PoseSequence sequence;
    sequence.source_video = "synthetic-directional-view.mp4";
    sequence.backend = "synthetic-directional";
    sequence.image_width = 640;
    sequence.image_height = 720;
    sequence.fps = 30.0;
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const double phase_frame = std::clamp(
            (static_cast<double>(frame) - phase_offset) / phase_rate, 0.0, 59.0);
        const double phase = phase_frame / 59.0 * 6.283185307179586;
        const double gesture = std::exp(-std::pow((phase_frame - 37.0) / 3.5, 2.0));
        std::vector<animocap::Vec3> positions = base.positions_m;
        const animocap::Vec3 root_motion{0.12 * std::sin(phase * 0.5), 0.0, 0.0};
        positions[left_hand].x += 0.28 * std::sin(phase);
        positions[left_hand].y += 0.18 * std::cos(phase * 1.7) + 0.38 * gesture;
        positions[left_hand].z += 0.22 * std::sin(phase * 0.7);
        positions[right_hand].x += 0.16 * std::cos(phase * 1.3);
        positions[right_hand].y += 0.25 * std::sin(phase * 0.8);
        positions[right_hand].z -= 0.19 * std::cos(phase);
        for (auto& position : positions) position += root_motion;
        const bool swap_frame = swap_sides && phase_frame >= 15.0 && phase_frame <= 40.0;
        if (swap_frame) {
            for (const auto [left_semantic, right_semantic] : semantics) {
                std::swap(
                    positions[animocap::bone_index(skeleton, left_semantic)],
                    positions[animocap::bone_index(skeleton, right_semantic)]);
            }
        }
        animocap::ObservedPoseFrame observed;
        observed.time_s = static_cast<double>(frame) / sequence.fps;
        for (std::size_t joint = 0; joint < positions.size(); ++joint) {
            const auto camera_position = camera_space(positions[joint]);
            bool valid = true;
            float confidence = 0.92f;
            if (hide_reference_hand && joint == left_hand &&
                phase_frame >= 20.0 && phase_frame <= 30.0) {
                valid = false;
                confidence = 0.0f;
            }
            observed.joints.push_back({
                {320.0 + 300.0 * camera_position.x,
                 360.0 - 300.0 * camera_position.y},
                camera_position, confidence, valid,
            });
        }
        sequence.frames.push_back(std::move(observed));
    }
    animocap::validate_pose_sequence(sequence);
    return sequence;
}

void test_directional_multiview() {
    std::vector<animocap::MultiviewPoseInput> views;
    views.push_back({"front", 0.0,
        make_directional_test_pose(0.0, 60, 0.0, 1.0, false, true)});
    views.push_back({"right", 90.0,
        make_directional_test_pose(90.0, 68, 4.0, 1.05, false, false)});
    views.push_back({"back", 180.0,
        make_directional_test_pose(180.0, 66, 7.0, 0.95, true, false)});
    views.push_back({"left", -90.0,
        make_directional_test_pose(-90.0, 65, 2.0, 1.02, false, false)});

    const auto result = animocap::solve_directional_multiview(views);
    CHECK(result.fused_pose.frames.size() == 60);
    CHECK(result.motion.cameras.size() == 4);
    CHECK(result.diagnostics.alignments.size() == 4);
    CHECK(result.diagnostics.recovered_observations >= 8);
    CHECK(result.diagnostics.left_right_corrections > 0);
    CHECK(result.diagnostics.mean_reprojection_error_m < 0.20);
    const auto mapped = result.diagnostics.alignments[1].source_frame_at_reference[30];
    CHECK(std::abs(mapped - (4.0 + 1.05 * 30.0)) < 2.0);
    const auto hand = animocap::bone_index(
        result.motion.skeleton, animocap::BoneSemantic::LeftHand);
    CHECK(result.fused_pose.frames[25].joints[hand].valid);
    CHECK(result.fused_pose.frames[25].joints[hand].confidence > 0.80f);

    const auto diagnostics_path = test_root() / "multiview-diagnostics.json";
    animocap::save_multiview_diagnostics(result.diagnostics, diagnostics_path);
    const auto fused_pose_path = test_root() / "fused-pose.json";
    animocap::save_pose_sequence_json(result.fused_pose, fused_pose_path);
    const auto fused_roundtrip = animocap::load_pose_sequence_json(fused_pose_path);
    CHECK(fused_roundtrip.frames.size() == result.fused_pose.frames.size());
    CHECK(fused_roundtrip.backend == result.fused_pose.backend);
    const auto diagnostics_roundtrip =
        animocap::load_multiview_diagnostics(diagnostics_path);
    CHECK(diagnostics_roundtrip.alignments.size() == 4);
    CHECK(diagnostics_roundtrip.recovered_observations >= 8);
    const auto diagnostics = nlohmann::json::parse(read_text(diagnostics_path));
    CHECK(diagnostics.at("alignments").size() == 4);
    CHECK(diagnostics.at("recovered_observations").get<std::size_t>() >= 8);
}
void test_package_roundtrip() {
    const auto directory = test_root() / "roundtrip.amotion";
    const auto original = animocap::make_synthetic_motion(42, 8);
    animocap::save_motion_package(original, directory);
    const auto loaded = animocap::load_motion_package(directory);
    CHECK(loaded.motion.frame_count == original.motion.frame_count);
    CHECK(loaded.motion.joint_count == original.motion.joint_count);
    CHECK(loaded.motion.time_s == original.motion.time_s);
    CHECK(loaded.motion.scene_root_translation_m == original.motion.scene_root_translation_m);
    CHECK(loaded.motion.scene_root_rotation == original.motion.scene_root_rotation);
    CHECK(loaded.motion.local_rotations == original.motion.local_rotations);
    CHECK(loaded.motion.hips_translation_m == original.motion.hips_translation_m);
    CHECK(loaded.motion.confidence == original.motion.confidence);
    CHECK(loaded.motion.valid_mask == original.motion.valid_mask);
    CHECK(loaded.motion.foot_contacts == original.motion.foot_contacts);
    CHECK(loaded.motion.provenance.config_sha256 == original.motion.provenance.config_sha256);
    CHECK(loaded.cameras == original.cameras);
    const auto diagnostics=nlohmann::json::parse(read_text(directory/"diagnostics.json"));
    CHECK(diagnostics.at("status")=="canonical_motion_validated");
    CHECK(diagnostics.at("invalid_observations")==0);
    CHECK(diagnostics.at("foot_contacts").at("left_frames")==original.motion.frame_count);
    CHECK(diagnostics.at("foot_contacts").at("right_frames")==original.motion.frame_count);
    CHECK(diagnostics.at("foot_contacts").at("left_ratio")==1.0);
    CHECK(diagnostics.at("foot_contacts").at("right_ratio")==1.0);
    const auto alignment=nlohmann::json::parse(read_text(directory/"alignment.json"));
    CHECK(alignment.at("mode")=="external_or_not_required");
}

void test_motion_clip() {
    const auto source=animocap::make_synthetic_motion(20260808,20);
    const auto clip=animocap::clip_motion_package(source,4,12);
    CHECK(clip.motion.frame_count==9);
    CHECK(clip.motion.time_s.front()==0.0);
    CHECK(std::abs(clip.motion.time_s.back()-8.0/source.motion.fps)<1e-12);
    CHECK(clip.motion.scene_root_translation_m.front()==
          source.motion.scene_root_translation_m[4]);
    CHECK(clip.motion.local_rotations.front()==
          source.motion.local_rotations[4*source.motion.joint_count]);
    CHECK(clip.motion.confidence.size()==9*source.motion.joint_count);
    CHECK(clip.motion.valid_mask.size()==9*source.motion.joint_count);
    CHECK(clip.motion.foot_contacts.size()==18);
    CHECK(clip.motion.provenance.config_sha256!=source.motion.provenance.config_sha256);
    CHECK(clip.cameras==source.cameras);
    animocap::validate_motion(clip.motion,clip.skeleton);
    CHECK_THROWS(animocap::clip_motion_package(source,12,4));
    CHECK_THROWS(animocap::clip_motion_package(source,0,20));
}

void test_bvh_export() {
    const auto package = animocap::make_synthetic_motion(20260808, 7);
    const auto output = test_root() / "synthetic.bvh";
    animocap::export_bvh(package, output);
    const auto text = read_text(output);
    CHECK(text.starts_with("HIERARCHY\nROOT Hips\n"));
    CHECK(text.find("CHANNELS 6 Xposition Yposition Zposition Zrotation Xrotation Yrotation") !=
          std::string::npos);
    CHECK(text.find("JOINT LeftUpperArm") != std::string::npos);
    CHECK(text.find("MOTION\nFrames: 7\nFrame Time: 0.033333") != std::string::npos);
    CHECK(text.find("nan") == std::string::npos);
    CHECK_THROWS(animocap::export_bvh(package, output));
    animocap::export_bvh(package, output, {animocap::BvhUnit::Meters, true});
    CHECK(read_text(output).find("Frames: 7") != std::string::npos);
}

void test_vrma_export() {
    const auto package=animocap::make_synthetic_motion(20260808,9);
    const auto output=test_root()/"synthetic.vrma";
    animocap::export_vrma(package,output);
    const auto bytes=read_bytes(output);
    CHECK(read_u32(bytes,0)==0x46546c67U);
    CHECK(read_u32(bytes,4)==2U);
    CHECK(read_u32(bytes,8)==bytes.size());
    const auto json_length=read_u32(bytes,12);
    CHECK(read_u32(bytes,16)==0x4e4f534aU);
    CHECK(20U+json_length+8U<=bytes.size());
    const std::string document_text(
        bytes.begin()+20,bytes.begin()+20+static_cast<std::ptrdiff_t>(json_length));
    const auto document=nlohmann::json::parse(document_text);
    CHECK(document.at("asset").at("version")=="2.0");
    CHECK(document.at("extensionsRequired").at(0)=="VRMC_vrm_animation");
    const auto& extension=document.at("extensions").at("VRMC_vrm_animation");
    CHECK(extension.at("specVersion")=="1.0");
    const auto& human_bones=extension.at("humanoid").at("humanBones");
    CHECK(human_bones.size()==22);
    CHECK(human_bones.contains("hips"));
    CHECK(human_bones.contains("leftHand"));
    const auto& animation=document.at("animations").at(0);
    CHECK(animation.at("channels").size()==23);
    CHECK(animation.at("samplers").size()==23);
    std::size_t translation_channels=0;
    for(const auto& channel:animation.at("channels")) {
        if(channel.at("target").at("path")=="translation")++translation_channels;
    }
    CHECK(translation_channels==1);
    const auto binary_header=20U+json_length;
    CHECK(read_u32(bytes,binary_header)==document.at("buffers").at(0).at("byteLength"));
    CHECK(read_u32(bytes,binary_header+4)==0x004e4942U);
    CHECK_THROWS(animocap::export_vrma(package,output));
    animocap::export_vrma(package,output,{true});
}

void test_fixture_determinism() {
    const auto a = animocap::generate_synthetic_fixture(test_root() / "fixture-a", 123, 9);
    const auto b = animocap::generate_synthetic_fixture(test_root() / "fixture-b", 123, 9);
    const auto c = animocap::generate_synthetic_fixture(test_root() / "fixture-c", 124, 9);
    CHECK(a.sha256 == b.sha256);
    CHECK(a.sha256 != c.sha256);
    CHECK(read_text(test_root() / "fixture-a" / "fixture.sha256").substr(0, 64) == a.sha256);
}

void test_license_and_asset_gate() {
    const auto licenses = read_text(source_path("LICENSES.md"));
    CHECK(licenses.find("nlohmann/json") != std::string::npos);
    CHECK(licenses.find("MMPose") != std::string::npos);
    CHECK(licenses.find("weights") != std::string::npos);

    const std::set<std::string> forbidden{
        ".blend", ".blend1", ".fbx", ".glb", ".gltf", ".vrm", ".vrma",
        ".mp4", ".mov", ".avi", ".mkv", ".png", ".jpg", ".jpeg", ".webp"
    };
    const auto root = source_path("");
    for (const auto& entry : std::filesystem::recursive_directory_iterator(root)) {
        const auto relative = std::filesystem::relative(entry.path(), root).generic_string();
        if (relative.starts_with(".git/") || relative.starts_with("build/") ||
            relative.starts_with(".venv-mmpose/") || relative.starts_with("outputs/") ||
            relative.starts_with("private/") || relative.starts_with("reports/fixture/") ||
            relative.starts_with("animocap-m0-test-output/")) {
            continue;
        }
        if (entry.is_regular_file()) {
            auto extension = entry.path().extension().string();
            std::transform(extension.begin(), extension.end(), extension.begin(), ::tolower);
            CHECK(!forbidden.contains(extension));
        }
    }
}

}  // namespace

int main() {
    const auto root = test_root();
    std::error_code cleanup_error;
    std::filesystem::remove_all(root, cleanup_error);
    std::filesystem::create_directories(root);

    const std::vector<std::pair<std::string, std::function<void()>>> tests{
        {"sha256", test_sha256},
        {"skeleton_contract", test_skeleton_contract},
        {"character_profile_import",test_character_profile_import},
        {"manifest_contract", test_manifest_contract},
        {"keypoint_contract", test_keypoint_contract},
        {"coordinate_roundtrip", test_coordinate_roundtrip},
        {"fk", test_fk},
        {"fk_scene_root_rotation", test_fk_scene_root_rotation},
        {"motion_validation", test_motion_validation},
        {"pose_reconstruction", test_pose_reconstruction},
        {"directional_multiview", test_directional_multiview},
        {"package_roundtrip", test_package_roundtrip},
        {"motion_clip", test_motion_clip},
        {"bvh_export", test_bvh_export},
        {"vrma_export", test_vrma_export},
        {"fixture_determinism", test_fixture_determinism},
        {"license_and_asset_gate", test_license_and_asset_gate},
    };

    for (const auto& [name, test] : tests) {
        try {
            test();
            if (failures == 0) std::cout << "PASS " << name << '\n';
        } catch (const std::exception& error) {
            fail(name + ": unexpected exception: " + error.what(), __LINE__);
        }
    }
    std::filesystem::remove_all(root, cleanup_error);
    if (failures != 0) {
        std::cerr << failures << " check(s) failed\n";
        return 1;
    }
    std::cout << "All AniMocap checks passed\n";
    return 0;
}
