#include "animocap/contracts.hpp"
#include "animocap/fixture.hpp"
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
