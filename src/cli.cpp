#include "animocap/contracts.hpp"
#include "animocap/fixture.hpp"
#include "animocap/multiview.hpp"
#include "animocap/package.hpp"
#include "animocap/pose_sequence.hpp"
#include "animocap/video.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <charconv>
#include <filesystem>
#include <iostream>
#include <limits>
#include <string>
#include <string_view>

namespace {

using json = nlohmann::json;

[[noreturn]] void usage_error(std::string_view message) {
    throw animocap::ContractError(std::string(message) +
        "\nusage:\n"
        "  animocap validate-manifest <capture.json>\n"
        "  animocap inspect-motion <motion.amotion>\n"
        "  animocap inspect-video <video-file>\n"
        "  animocap reconstruct-pose <pose_sequence.json> --output <motion.amotion>\n"
        "  animocap fuse-multiview <capture.json> --poses <directory> --output <motion.amotion>\n"
        "  animocap generate-fixture --output <directory> [--seed <uint64>] [--frames <count>]\n");
}

std::uint64_t parse_uint64(std::string_view value, std::string_view label) {
    std::uint64_t result{};
    const auto [end, error] = std::from_chars(value.data(), value.data() + value.size(), result);
    if (error != std::errc{} || end != value.data() + value.size()) usage_error(std::string(label) + " must be an integer");
    return result;
}

int validate_manifest(int argc, char** argv) {
    if (argc != 3) usage_error("validate-manifest requires exactly one path");
    const auto manifest = animocap::load_capture_manifest(argv[2]);
    const json result{
        {"status", "valid"},
        {"version", manifest.version},
        {"mode", animocap::to_string(manifest.mode)},
        {"fps", manifest.fps},
        {"view_count", manifest.views.size()},
    };
    std::cout << result.dump(2) << '\n';
    return 0;
}

int inspect_motion(int argc, char** argv) {
    if (argc != 3) usage_error("inspect-motion requires exactly one package directory");
    const auto package = animocap::load_motion_package(argv[2]);
    const auto& motion = package.motion;
    float minimum_confidence = 1.0f;
    float maximum_confidence = 0.0f;
    std::size_t invalid_count = 0;
    for (std::size_t index = 0; index < motion.confidence.size(); ++index) {
        minimum_confidence = std::min(minimum_confidence, motion.confidence[index]);
        maximum_confidence = std::max(maximum_confidence, motion.confidence[index]);
        if (motion.valid_mask[index] == 0) ++invalid_count;
    }
    const json result{
        {"status", "valid"},
        {"schema_version", motion.schema_version},
        {"skeleton_id", motion.skeleton_id},
        {"frame_count", motion.frame_count},
        {"joint_count", motion.joint_count},
        {"fps", motion.fps},
        {"duration_s", motion.time_s.back() - motion.time_s.front()},
        {"confidence", {{"minimum", minimum_confidence}, {"maximum", maximum_confidence}}},
        {"invalid_observations", invalid_count},
        {"motion_variant", "raw"},
        {"unsupported_export_fields", {"confidence", "valid_mask", "provenance", "source_support"}},
    };
    std::cout << result.dump(2) << '\n';
    return 0;
}

int inspect_video(int argc, char** argv) {
    if (argc != 3) usage_error("inspect-video requires exactly one video file");
    animocap::VideoDecoder decoder;
    decoder.open(std::filesystem::path(argv[2]));
    animocap::VideoFrame frame;
    if (!decoder.read_frame(frame)) {
        throw std::runtime_error("video contains no decodable frames");
    }
    const auto& info = decoder.info();
    const json result{
        {"status", "valid"},
        {"width", info.width},
        {"height", info.height},
        {"fps", info.fps},
        {"duration_s", info.duration_s},
        {"estimated_frame_count", info.estimated_frame_count},
        {"first_frame_time_s", frame.time_s},
        {"decoded_bytes", frame.bgra.size()},
    };
    std::cout << result.dump(2) << '\n';
    return 0;
}

int reconstruct_pose(int argc, char** argv) {
    if (argc != 5 || std::string_view(argv[3]) != "--output") {
        usage_error("reconstruct-pose requires an input and --output directory");
    }
    const auto sequence = animocap::smooth_pose_sequence(
        animocap::load_pose_sequence_json(argv[2]));
    const auto package = animocap::reconstruct_canonical_motion(sequence);
    const std::filesystem::path output(argv[4]);
    animocap::save_motion_package(package, output);
    const json result{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"frame_count", package.motion.frame_count},
        {"joint_count", package.motion.joint_count},
        {"fps", package.motion.fps},
        {"backend", sequence.backend},
    };
    std::cout << result.dump(2) << '\n';
    return 0;
}

int fuse_multiview(int argc, char** argv) {
    if (argc < 7) usage_error(
        "fuse-multiview requires a manifest, --poses directory, and --output directory");
    const std::filesystem::path manifest_path(argv[2]);
    std::filesystem::path pose_directory;
    std::filesystem::path output;
    std::filesystem::path diagnostics;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--poses" && index + 1 < argc) {
            pose_directory = argv[++index];
        } else if (option == "--output" && index + 1 < argc) {
            output = argv[++index];
        } else if (option == "--diagnostics" && index + 1 < argc) {
            diagnostics = argv[++index];
        } else {
            usage_error("unknown fuse-multiview option: " + std::string(option));
        }
    }
    if (pose_directory.empty() || output.empty()) {
        usage_error("fuse-multiview requires --poses and --output");
    }
    const auto manifest = animocap::load_capture_manifest(manifest_path);
    if (manifest.mode != animocap::CaptureMode::DirectionalRepeat) {
        usage_error("fuse-multiview currently requires directional_repeat mode");
    }
    std::vector<animocap::MultiviewPoseInput> views;
    views.reserve(manifest.views.size());
    for (const auto& view : manifest.views) {
        if (!view.yaw_degrees) {
            throw animocap::ContractError(
                "directional view " + view.id + " requires yaw_degrees");
        }
        views.push_back({
            view.id,
            *view.yaw_degrees,
            animocap::smooth_pose_sequence(animocap::load_pose_sequence_json(
                pose_directory / view.id / "pose_sequence.json")),
        });
    }
    const auto result = animocap::solve_directional_multiview(views);
    animocap::save_motion_package(result.motion, output);
    const auto artifact_directory = output.parent_path().empty()
        ? std::filesystem::current_path() : output.parent_path();
    const auto fused_pose_path = artifact_directory / "fused_pose_sequence.json";
    animocap::save_pose_sequence_json(result.fused_pose, fused_pose_path);
    if (diagnostics.empty()) diagnostics = artifact_directory / "multiview-diagnostics.json";
    animocap::save_multiview_diagnostics(result.diagnostics, diagnostics);

    json alignments = json::array();
    for (const auto& alignment : result.diagnostics.alignments) {
        alignments.push_back({
            {"view_id", alignment.view_id},
            {"mean_offset_s", alignment.mean_offset_s},
            {"mean_rate", alignment.mean_rate},
            {"normalized_cost", alignment.normalized_cost},
        });
    }
    std::cout << json{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"fused_pose", fused_pose_path.generic_string()},
        {"diagnostics", diagnostics.generic_string()},
        {"view_count", views.size()},
        {"frame_count", result.motion.motion.frame_count},
        {"recovered_observations", result.diagnostics.recovered_observations},
        {"left_right_corrections", result.diagnostics.left_right_corrections},
        {"conflict_count", result.diagnostics.conflicts.size()},
        {"alignments", std::move(alignments)},
    }.dump(2) << '\n';
    return 0;
}
int generate_fixture(int argc, char** argv) {
    std::filesystem::path output;
    std::uint64_t seed = 20260806;
    std::size_t frames = 31;
    for (int index = 2; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--output") {
            if (++index >= argc) usage_error("--output requires a directory");
            output = argv[index];
        } else if (option == "--seed") {
            if (++index >= argc) usage_error("--seed requires an integer");
            seed = parse_uint64(argv[index], "--seed");
        } else if (option == "--frames") {
            if (++index >= argc) usage_error("--frames requires an integer");
            const auto parsed = parse_uint64(argv[index], "--frames");
            if (parsed > std::numeric_limits<std::size_t>::max()) usage_error("--frames is too large");
            frames = static_cast<std::size_t>(parsed);
        } else {
            usage_error("unknown generate-fixture option: " + std::string(option));
        }
    }
    if (output.empty()) usage_error("generate-fixture requires --output");
    const auto result = animocap::generate_synthetic_fixture(output, seed, frames);
    const json response{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"motion_package", result.package_directory.generic_string()},
        {"ground_truth", result.ground_truth_path.generic_string()},
        {"sha256", result.sha256},
        {"seed", seed},
        {"frame_count", frames},
    };
    std::cout << response.dump(2) << '\n';
    return 0;
}

void print_help() {
    std::cout <<
        "AniMocap Fusion tools\n"
        "  validate-manifest <capture.json>\n"
        "  inspect-motion <motion.amotion>\n"
        "  inspect-video <video-file>\n"
        "  reconstruct-pose <pose_sequence.json> --output <motion.amotion>\n"
        "  fuse-multiview <capture.json> --poses <directory> --output <motion.amotion>\n"
        "  generate-fixture --output <directory> [--seed <uint64>] [--frames <count>]\n";
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc < 2) usage_error("a command is required");
        const std::string_view command(argv[1]);
        if (command == "--help" || command == "-h") {
            print_help();
            return 0;
        }
        if (command == "--version") {
            std::cout << ANIMOCAP_VERSION << '\n';
            return 0;
        }
        if (command == "validate-manifest") return validate_manifest(argc, argv);
        if (command == "inspect-motion") return inspect_motion(argc, argv);
        if (command == "inspect-video") return inspect_video(argc, argv);
        if (command == "reconstruct-pose") return reconstruct_pose(argc, argv);
        if (command == "fuse-multiview") return fuse_multiview(argc, argv);
        if (command == "generate-fixture") return generate_fixture(argc, argv);
        usage_error("unknown command: " + std::string(command));
    } catch (const animocap::ContractError& error) {
        std::cerr << "contract error: " << error.what() << '\n';
        return 2;
    } catch (const std::exception& error) {
        std::cerr << "error: " << error.what() << '\n';
        return 1;
    }
}
