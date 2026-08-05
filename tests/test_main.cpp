#include "animocap/contracts.hpp"
#include "animocap/fixture.hpp"
#include "animocap/hash.hpp"
#include "animocap/math.hpp"
#include "animocap/package.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <cmath>
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
            relative.starts_with("private/") || relative.starts_with("reports/fixture/")) {
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
        {"manifest_contract", test_manifest_contract},
        {"keypoint_contract", test_keypoint_contract},
        {"coordinate_roundtrip", test_coordinate_roundtrip},
        {"fk", test_fk},
        {"motion_validation", test_motion_validation},
        {"package_roundtrip", test_package_roundtrip},
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
    std::cout << "All M0 checks passed\n";
    return 0;
}
