#include "animocap/blender_exchange.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

animocap::MotionPackage make_motion() {
    animocap::MotionPackage package;
    package.skeleton = animocap::make_default_skeleton();
    auto& motion = package.motion;
    motion.skeleton_id = package.skeleton.skeleton_id;
    motion.fps = 30.0;
    motion.frame_count = 60;
    motion.joint_count = package.skeleton.bones.size();
    motion.time_s.reserve(motion.frame_count);
    motion.scene_root_translation_m.reserve(motion.frame_count);
    motion.scene_root_rotation.assign(motion.frame_count, {});
    motion.local_rotations.assign(motion.frame_count * motion.joint_count, {});
    motion.hips_translation_m.reserve(motion.frame_count);
    motion.confidence.assign(motion.frame_count * motion.joint_count, 1.0f);
    motion.valid_mask.assign(motion.frame_count * motion.joint_count, 1);
    motion.foot_contacts.assign(motion.frame_count * 2, 0);
    for (std::size_t frame = 0; frame < motion.frame_count; ++frame) {
        motion.time_s.push_back(static_cast<double>(frame) / motion.fps);
        motion.scene_root_translation_m.push_back({0.01 * frame, 0.0, 0.005 * frame});
        motion.hips_translation_m.push_back({0.0, 0.001 * frame, 0.0});
    }
    motion.provenance.code_version = "blender-exchange-test";
    motion.provenance.config_sha256 = std::string(64, '0');
    return package;
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 2) throw std::runtime_error("expected output path argument");
        animocap::BlenderFrameSelection selection;
        selection.select(12, 60, false, false);
        selection.select(24, 60, true, false);
        selection.select(48, 60, true, false);
        require(selection.frames() == std::vector<std::size_t>({12, 24, 48}),
                "Ctrl selection mismatch");
        selection.select(24, 60, false, false);
        selection.select(30, 60, false, true);
        require(selection.size() == 7 && selection.frames().front() == 24 &&
                    selection.frames().back() == 30,
                "Shift range mismatch");
        selection.select_only({48, 12, 24, 24}, 60);

        const std::filesystem::path output = argv[1];
        animocap::export_blender_selected_frames(make_motion(), selection.frames(), output, {true});
        std::ifstream stream(output, std::ios::binary);
        nlohmann::json document;
        stream >> document;
        require(document.at("schema") == 1, "schema mismatch");
        require(document.at("selected_frames").size() == 3, "selected frame count mismatch");
        require(document.at("selected_frames").at(0).at("source_frame") == 12,
                "first frame mismatch");
        require(document.at("selected_frames").at(1).at("source_frame") == 24,
                "second frame mismatch");
        require(document.at("selected_frames").at(2).at("source_frame") == 48,
                "third frame mismatch");
        require(document.at("selected_frames").at(1).at("local_rotations").size() == 23,
                "complete pose rotation count mismatch");
        require(document.at("source_motion_sha256").get<std::string>().size() == 64,
                "motion hash mismatch");
        std::cout << "ANIMOCAP_BLENDER_EXCHANGE_OK\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
}
