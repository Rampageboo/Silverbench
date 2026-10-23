#include "animocap/blender_exchange.hpp"
#include "animocap/contracts.hpp"
#include "animocap/edit_session.hpp"
#include "animocap/character_profile.hpp"
#include "animocap/export.hpp"
#include "animocap/fixture.hpp"
#include "animocap/multiview.hpp"
#include "animocap/package.hpp"
#include "animocap/pose_sequence.hpp"
#include "animocap/video.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <charconv>
#include <filesystem>
#include <iostream>
#include <limits>
#include <optional>
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
        "  animocap reconstruct-pose <pose_sequence.json> --output <motion.amotion> [--character-profile <profile-or-skeleton.json>] [--pose-output <refined.json>] [--no-smooth]\n"
        "  animocap apply-edits <refined.json> --edits <edits.json> --output <motion.amotion> [--character-profile <profile-or-skeleton.json>] [--pose-output <pose.json>] [--review-output <motion.amotion.areview>] [--cameras-from <motion.amotion>]\n"
        "  animocap serve   (resident editor: JSON requests on stdin, see docs/animocap-engine.md)\n"
        "  animocap fuse-multiview <capture.json> --poses <directory> --output <motion.amotion> [--diagnostics <diagnostics.json>] [--comparison-pose <pose.json>] [--character-profile <profile-or-skeleton.json>] [--reference-image-plane-anchor]\n"
        "  animocap export-bvh <motion.amotion> --output <motion.bvh> [--unit centimeters|meters] [--force]\n"
        "  animocap export-blender <motion.amotion> --frames <f,f,...> --output <frames.animocap-blender.json> [--force]\n"
        "  animocap export-vrma <motion.amotion> --output <motion.vrma> [--force]\n"
        "  animocap trim-motion <motion.amotion> --output <clip.amotion> --start-frame <index> --end-frame <index>\n"
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
    std::size_t low_confidence_count = 0;
    double confidence_sum = 0.0;
    std::array<std::size_t,2> contact_frames{};
    for (std::size_t index = 0; index < motion.confidence.size(); ++index) {
        minimum_confidence = std::min(minimum_confidence, motion.confidence[index]);
        maximum_confidence = std::max(maximum_confidence, motion.confidence[index]);
        if (motion.valid_mask[index] == 0) ++invalid_count;
        else {
            confidence_sum+=motion.confidence[index];
            if(motion.confidence[index]<0.35f)++low_confidence_count;
        }
    }
    for(std::size_t frame=0;frame<motion.frame_count;++frame) {
        for(std::size_t side=0;side<2;++side)
            contact_frames[side]+=motion.foot_contacts[frame*2+side]!=0?1U:0U;
    }
    const auto valid_count=motion.confidence.size()-invalid_count;
    const json result{
        {"status", "valid"},
        {"schema_version", motion.schema_version},
        {"skeleton_id", motion.skeleton_id},
        {"frame_count", motion.frame_count},
        {"joint_count", motion.joint_count},
        {"fps", motion.fps},
        {"duration_s", motion.time_s.back() - motion.time_s.front()},
        {"confidence", {
            {"minimum", minimum_confidence}, {"maximum", maximum_confidence},
            {"valid_mean",valid_count?confidence_sum/static_cast<double>(valid_count):0.0},
            {"low_confidence_observations",low_confidence_count}
        }},
        {"invalid_observations", invalid_count},
        {"foot_contacts", {
            {"left_frames",contact_frames[0]},{"right_frames",contact_frames[1]},
            {"left_ratio",static_cast<double>(contact_frames[0])/motion.frame_count},
            {"right_ratio",static_cast<double>(contact_frames[1])/motion.frame_count}
        }},
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
    if (argc < 5) {
        usage_error("reconstruct-pose requires an input and --output directory");
    }
    std::filesystem::path output;
    std::filesystem::path character_profile_path;
    std::filesystem::path pose_output;
    bool smooth=true;
    for(int index=3;index<argc;++index) {
        const std::string_view option(argv[index]);
        if(option=="--output" && index+1<argc)output=argv[++index];
        else if(option=="--character-profile" && index+1<argc)
            character_profile_path=argv[++index];
        else if(option=="--pose-output" && index+1<argc)pose_output=argv[++index];
        // A fused multiview pose is already stabilized; Studio only optimizes it.
        else if(option=="--no-smooth")smooth=false;
        else usage_error("unknown reconstruct-pose option: "+std::string(option));
    }
    if(output.empty())usage_error("reconstruct-pose requires --output");
    std::optional<animocap::CharacterProfile> character_profile;
    if(!character_profile_path.empty())
        character_profile=animocap::load_character_profile(character_profile_path);
    const auto* profile=character_profile?&character_profile->skeleton:nullptr;
    const auto options=character_profile
        ? character_profile->optimization_options:animocap::PoseOptimizationOptions{};
    auto observed = animocap::load_pose_sequence_json(argv[2]);
    if(smooth)observed=animocap::smooth_pose_sequence(observed);
    auto optimization = animocap::optimize_pose_sequence_detailed(
        observed,options,profile,
        character_profile ? character_profile->proportion_policy
                          : animocap::ProportionPolicy::ExactReference);
    if(character_profile)
        optimization.diagnostics.profile_id=character_profile->profile_id;
    const auto& sequence = optimization.sequence;
    const auto package = animocap::reconstruct_canonical_motion(sequence,profile);
    animocap::save_motion_package(package, output);
    // The refined sequence is the base that apply-edits replays edits on.
    if(!pose_output.empty())animocap::save_pose_sequence_json(sequence,pose_output);
    const json result{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"pose_output", pose_output.empty()?json(nullptr):json(pose_output.generic_string())},
        {"frame_count", package.motion.frame_count},
        {"joint_count", package.motion.joint_count},
        {"fps", package.motion.fps},
        {"backend", sequence.backend},
        {"skeleton_id", package.skeleton.skeleton_id},
        {"profile_corrected_samples",
         optimization.diagnostics.corrected_joint_samples},
        {"profile_high_confidence_move_attempts",
         optimization.diagnostics.high_confidence_move_attempts},
        {"profile_well_supported_bones",
         optimization.diagnostics.well_supported_bones},
        {"profile_supported_bones",
         optimization.diagnostics.profile_supported_bones},
        {"profile_mean_correction_m",
         optimization.diagnostics.mean_correction_m},
        {"profile_maximum_correction_m",
         optimization.diagnostics.maximum_correction_m},
        {"profile_id", optimization.diagnostics.profile_id},
    };
    std::cout << result.dump(2) << '\n';
    return 0;
}

int apply_edits(int argc, char** argv) {
    if (argc < 7) usage_error("apply-edits requires a refined pose, --edits and --output");
    std::filesystem::path edits;
    std::filesystem::path output;
    std::filesystem::path pose_output;
    std::filesystem::path review_output;
    std::filesystem::path cameras_from;
    std::filesystem::path character_profile_path;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--edits" && index + 1 < argc) edits = argv[++index];
        else if (option == "--output" && index + 1 < argc) output = argv[++index];
        else if (option == "--pose-output" && index + 1 < argc) pose_output = argv[++index];
        else if (option == "--review-output" && index + 1 < argc) review_output = argv[++index];
        else if (option == "--cameras-from" && index + 1 < argc) cameras_from = argv[++index];
        else if (option == "--character-profile" && index + 1 < argc) character_profile_path = argv[++index];
        else usage_error("unknown apply-edits option: " + std::string(option));
    }
    if (edits.empty() || output.empty()) usage_error("apply-edits requires --edits and --output");
    std::optional<animocap::CharacterProfile> character_profile;
    if (!character_profile_path.empty())
        character_profile = animocap::load_character_profile(character_profile_path);
    const auto* profile = character_profile ? &character_profile->skeleton : nullptr;

    const auto refined = animocap::load_pose_sequence_json(argv[2]);
    const auto session = animocap::load_edit_session(edits);
    auto result = animocap::apply_edit_session(refined, session, profile);
    // Multiview takes carry solved cameras; a pose-only rebuild would drop them.
    if (!cameras_from.empty()) result.motion.cameras = animocap::load_motion_package(cameras_from).cameras;
    animocap::save_motion_package(result.motion, output);
    if (!pose_output.empty()) animocap::save_pose_sequence_json(result.pose, pose_output);
    if (!review_output.empty()) animocap::save_pose_review(result.corrected, result.review, review_output);

    const auto joints = result.pose.frames.empty() ? std::size_t{0} : result.pose.frames.front().joints.size();
    json inferred = json::array();
    for (std::size_t index = 0; index < result.inferred.size(); ++index) {
        if (result.inferred[index]) inferred.push_back({index / joints, index % joints});
    }
    std::cout << json{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"frame_count", result.motion.motion.frame_count},
        {"joint_count", result.motion.motion.joint_count},
        {"corrections", session.corrections.size()},
        {"review_marks", session.review.marks.size()},
        {"review_ranges", session.review.ranges.size()},
        {"inferred", std::move(inferred)},
    }.dump(2) << '\n';
    return 0;
}

// ---------------------------------------------------------------- serve
// A resident editing process: one JSON request per stdin line, one JSON reply
// per stdout line. It keeps the refined pose and the last result in memory, so
// an edit costs the solve, not re-reading and re-writing the whole take; replies
// carry only the frames that changed. Protocol: docs/animocap-engine.md.

json pose_delta(const animocap::PoseSequence& before, const animocap::PoseSequence& after, bool full) {
    json frames = json::array(), image = json::array(), position = json::array(),
         confidence = json::array(), valid = json::array();
    for (std::size_t f = 0; f < after.frames.size(); ++f) {
        const auto& joints = after.frames[f].joints;
        bool changed = full || f >= before.frames.size() || before.frames[f].joints.size() != joints.size();
        for (std::size_t j = 0; !changed && j < joints.size(); ++j) {
            const auto& a = before.frames[f].joints[j];
            const auto& b = joints[j];
            changed = a.image_xy != b.image_xy || a.position_m != b.position_m ||
                      a.confidence != b.confidence || a.valid != b.valid;
        }
        if (!changed) continue;
        frames.push_back(f);
        for (const auto& joint : joints) {
            image.push_back(joint.image_xy.x);
            image.push_back(joint.image_xy.y);
            position.push_back(joint.position_m.x);
            position.push_back(joint.position_m.y);
            position.push_back(joint.position_m.z);
            confidence.push_back(joint.confidence);
            valid.push_back(joint.valid ? 1 : 0);
        }
    }
    return {{"frames", std::move(frames)}, {"image", std::move(image)}, {"position", std::move(position)},
            {"confidence", std::move(confidence)}, {"valid", std::move(valid)}};
}

json inferred_pairs(const animocap::EditResult& result) {
    const auto joints = result.pose.frames.empty() ? std::size_t{0} : result.pose.frames.front().joints.size();
    json pairs = json::array();
    for (std::size_t index = 0; index < result.inferred.size(); ++index) {
        if (result.inferred[index]) pairs.push_back({index / joints, index % joints});
    }
    return pairs;
}

struct ServeState {
    std::optional<animocap::PoseSequence> refined;
    std::optional<animocap::CharacterProfile> profile;
    std::vector<animocap::Camera> cameras;
    std::optional<animocap::EditResult> last;
};

json serve_request(ServeState& state, const json& request) {
    const auto command = request.at("cmd").get<std::string>();
    if (command == "open") {
        ServeState next;
        next.refined = animocap::load_pose_sequence_json(std::filesystem::path(request.at("refined").get<std::string>()));
        if (request.contains("profile") && !request["profile"].is_null())
            next.profile = animocap::load_character_profile(request["profile"].get<std::string>());
        if (request.contains("cameras_from") && !request["cameras_from"].is_null())
            next.cameras = animocap::load_motion_package(request["cameras_from"].get<std::string>()).cameras;
        const auto edits = animocap::parse_edit_session(request.at("edits").dump());
        next.last = animocap::apply_edit_session(*next.refined, edits, next.profile ? &next.profile->skeleton : nullptr);
        state = std::move(next);
        return {{"frame_count", state.refined->frames.size()},
                {"joint_count", state.refined->frames.empty() ? 0 : state.refined->frames.front().joints.size()}};
    }
    if (!state.refined) throw animocap::ContractError("no take is open");
    if (command == "apply") {
        const auto edits = animocap::parse_edit_session(request.at("edits").dump());
        auto result = animocap::apply_edit_session(*state.refined, edits, state.profile ? &state.profile->skeleton : nullptr);
        const bool full = request.value("full", false);
        json reply{
            {"pose", pose_delta(state.last->pose, result.pose, full)},
            {"baseline", pose_delta(state.last->corrected, result.corrected, full)},
            {"inferred", inferred_pairs(result)},
            {"corrections", edits.corrections.size()},
            {"review_marks", edits.review.marks.size()},
            {"review_ranges", edits.review.ranges.size()},
        };
        state.last = std::move(result);
        return reply;
    }
    if (command == "write") {
        auto motion = state.last->motion;
        if (!state.cameras.empty()) motion.cameras = state.cameras;
        animocap::save_motion_package(motion, std::filesystem::path(request.at("output").get<std::string>()));
        if (request.contains("pose_output"))
            animocap::save_pose_sequence_json(state.last->pose, request["pose_output"].get<std::string>());
        if (request.contains("review_output"))
            animocap::save_pose_review(state.last->corrected, state.last->review, request["review_output"].get<std::string>());
        return {{"frame_count", motion.motion.frame_count}, {"joint_count", motion.motion.joint_count},
                {"inferred", inferred_pairs(*state.last)}};
    }
    throw animocap::ContractError("unknown serve command: " + command);
}

int serve(int argc, char**) {
    if (argc != 2) usage_error("serve takes no arguments");
    ServeState state;
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.find_first_not_of(" \t\r") == std::string::npos) continue;
        json reply;
        json id = nullptr;
        try {
            const auto request = json::parse(line);
            id = request.value("id", json(nullptr));
            if (request.value("cmd", std::string{}) == "close") break;
            reply = serve_request(state, request);
            reply["ok"] = true;
        } catch (const animocap::ContractError& error) {
            reply = {{"ok", false}, {"contract", true}, {"error", error.what()}};
        } catch (const std::exception& error) {
            reply = {{"ok", false}, {"contract", false}, {"error", error.what()}};
        }
        reply["id"] = id;
        std::cout << reply.dump() << std::endl;
    }
    return 0;
}

int export_blender(int argc, char** argv) {
    if (argc < 7) usage_error("export-blender requires a motion package, --frames and --output");
    std::filesystem::path output;
    std::vector<std::size_t> frames;
    animocap::BlenderSelectedFrameExportOptions options;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--output" && index + 1 < argc) {
            output = argv[++index];
        } else if (option == "--frames" && index + 1 < argc) {
            // Comma-separated source frame numbers, e.g. 12,40,41.
            std::string_view list(argv[++index]);
            while (!list.empty()) {
                const auto comma = list.find(',');
                const auto item = list.substr(0, comma);
                const auto value = parse_uint64(item, "--frames");
                if (value > std::numeric_limits<std::size_t>::max()) usage_error("--frames value is too large");
                frames.push_back(static_cast<std::size_t>(value));
                list = comma == std::string_view::npos ? std::string_view{} : list.substr(comma + 1);
            }
        } else if (option == "--force") {
            options.overwrite = true;
        } else {
            usage_error("unknown export-blender option: " + std::string(option));
        }
    }
    if (output.empty() || frames.empty()) usage_error("export-blender requires --frames and --output");
    animocap::export_blender_selected_frames(animocap::load_motion_package(argv[2]), frames, output, options);
    std::cout << json{{"status", "exported"}, {"output", output.generic_string()}, {"frame_count", frames.size()}}.dump(2) << '\n';
    return 0;
}

int fuse_multiview(int argc, char** argv) {
    if (argc < 7) usage_error(
        "fuse-multiview requires a manifest, --poses directory, and --output directory");
    const std::filesystem::path manifest_path(argv[2]);
    std::filesystem::path pose_directory;
    std::filesystem::path output;
    std::filesystem::path diagnostics;
    std::filesystem::path comparison_pose;
    std::filesystem::path character_profile_path;
    bool enable_reference_image_plane_anchor=false;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--poses" && index + 1 < argc) {
            pose_directory = argv[++index];
        } else if (option == "--output" && index + 1 < argc) {
            output = argv[++index];
        } else if (option == "--diagnostics" && index + 1 < argc) {
            diagnostics = argv[++index];
        } else if (option == "--comparison-pose" && index + 1 < argc) {
            comparison_pose = argv[++index];
        } else if(option=="--character-profile" && index+1<argc) {
            character_profile_path=argv[++index];
        } else if(option=="--reference-image-plane-anchor") {
            enable_reference_image_plane_anchor=true;
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
            animocap::load_pose_sequence_json(
                pose_directory / view.id / "pose_sequence.json"),
            view.time_offset_s,
        });
    }
    std::optional<animocap::CharacterProfile> character_profile;
    if(!character_profile_path.empty())
        character_profile=animocap::load_character_profile(character_profile_path);
    const auto* profile=character_profile?&character_profile->skeleton:nullptr;
    const auto options=character_profile
        ? character_profile->optimization_options:animocap::PoseOptimizationOptions{};
    animocap::MultiviewSolveOptions solve_options;
    solve_options.enable_reference_image_plane_anchor=
        enable_reference_image_plane_anchor;
    solve_options.reference_view=static_cast<std::size_t>(std::distance(
        views.begin(),std::min_element(views.begin(),views.end(),
            [](const auto& left,const auto& right) {
                return std::abs(left.yaw_degrees)<std::abs(right.yaw_degrees);
            })));
    if (!comparison_pose.empty()) {
        auto baseline_options=solve_options;
        baseline_options.enable_reference_image_plane_anchor=true;
        baseline_options.enable_view_visibility_weighting=false;
        baseline_options.enable_temporal_view_reliability=false;
        baseline_options.enable_animation_curve_stabilization=false;
        baseline_options.temporal_weight=0.0;
        baseline_options.require_reference_consensus_for_anchor=false;
        const auto baseline=animocap::solve_directional_multiview(
            views,baseline_options);
        animocap::save_pose_sequence_json(baseline.fused_pose,comparison_pose);
    }
    auto result = animocap::solve_directional_multiview(views,solve_options);
    if(profile) {
        result.fused_pose=animocap::optimize_pose_sequence(
            result.fused_pose,options,profile,
            character_profile->proportion_policy);
        const auto cameras=result.motion.cameras;
        result.motion=animocap::reconstruct_canonical_motion(
            result.fused_pose,profile);
        result.motion.cameras=cameras;
    }
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
            {"method", alignment.method},
            {"overlap_reference_frames", alignment.overlap_reference_frames},
            {"out_of_range_reference_frames", alignment.out_of_range_reference_frames},
        });
    }
    std::cout << json{
        {"status", "generated"},
        {"output", output.generic_string()},
        {"fused_pose", fused_pose_path.generic_string()},
        {"comparison_pose", comparison_pose.empty()
            ? std::string{} : comparison_pose.generic_string()},
        {"diagnostics", diagnostics.generic_string()},
        {"view_count", views.size()},
        {"frame_count", result.motion.motion.frame_count},
        {"skeleton_id", result.motion.skeleton.skeleton_id},
        {"recovered_observations", result.diagnostics.recovered_observations},
        {"left_right_corrections", result.diagnostics.left_right_corrections},
        {"rejected_view_observations", result.diagnostics.rejected_view_observations},
        {"left_right_state_changes", result.diagnostics.left_right_state_changes},
        {"reference_anchored_observations",
         result.diagnostics.reference_anchored_observations},
        {"reference_anchor_suppressed_conflicts",
         result.diagnostics.reference_anchor_suppressed_conflicts},
        {"reference_anchor_suppressed_low_confidence",
         result.diagnostics.reference_anchor_suppressed_low_confidence},
        {"visibility_evaluated_observations",
         result.diagnostics.visibility_evaluated_observations},
        {"visibility_downweighted_observations",
         result.diagnostics.visibility_downweighted_observations},
        {"visibility_boosted_observations",
         result.diagnostics.visibility_boosted_observations},
        {"overlap_downweighted_observations",
         result.diagnostics.overlap_downweighted_observations},
        {"temporal_outlier_downweighted_observations",
         result.diagnostics.temporal_outlier_downweighted_observations},
        {"curve_anchor_samples", result.diagnostics.curve_anchor_samples},
        {"curve_corrected_samples", result.diagnostics.curve_corrected_samples},
        {"curve_high_confidence_jitter_corrected_samples",
         result.diagnostics.curve_high_confidence_jitter_corrected_samples},
        {"curve_contact_locked_samples", result.diagnostics.curve_contact_locked_samples},
        {"curve_mean_correction_m", result.diagnostics.curve_mean_correction_m},
        {"curve_maximum_correction_m", result.diagnostics.curve_maximum_correction_m},
        {"jitter_before_curve", result.diagnostics.jitter_before_curve},
        {"jitter_after_curve", result.diagnostics.jitter_after_curve},
        {"conflict_count", result.diagnostics.conflicts.size()},
        {"alignments", std::move(alignments)},
    }.dump(2) << '\n';
    return 0;
}

int export_bvh(int argc, char** argv) {
    if (argc < 5) usage_error("export-bvh requires a motion package and --output file");
    const std::filesystem::path input(argv[2]);
    std::filesystem::path output;
    animocap::BvhExportOptions options;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--output" && index + 1 < argc) {
            output = argv[++index];
        } else if (option == "--unit" && index + 1 < argc) {
            const std::string_view unit(argv[++index]);
            if (unit == "centimeters") options.unit = animocap::BvhUnit::Centimeters;
            else if (unit == "meters") options.unit = animocap::BvhUnit::Meters;
            else usage_error("--unit must be centimeters or meters");
        } else if (option == "--force") {
            options.overwrite = true;
        } else {
            usage_error("unknown export-bvh option: " + std::string(option));
        }
    }
    if (output.empty()) usage_error("export-bvh requires --output");
    const auto package = animocap::load_motion_package(input);
    animocap::export_bvh(package, output, options);
    std::cout << json{
        {"status", "exported"},
        {"format", "bvh"},
        {"input", input.generic_string()},
        {"output", output.generic_string()},
        {"unit", options.unit == animocap::BvhUnit::Centimeters ? "centimeters" : "meters"},
        {"frame_count", package.motion.frame_count},
        {"fps", package.motion.fps},
        {"preserved_in_source_only", {"confidence", "valid_mask", "foot_contacts", "provenance"}},
    }.dump(2) << '\n';
    return 0;
}

int export_vrma(int argc, char** argv) {
    if (argc < 5) usage_error("export-vrma requires a motion package and --output file");
    const std::filesystem::path input(argv[2]);
    std::filesystem::path output;
    animocap::VrmaExportOptions options;
    for (int index = 3; index < argc; ++index) {
        const std::string_view option(argv[index]);
        if (option == "--output" && index + 1 < argc) {
            output = argv[++index];
        } else if (option == "--force") {
            options.overwrite = true;
        } else {
            usage_error("unknown export-vrma option: " + std::string(option));
        }
    }
    if (output.empty()) usage_error("export-vrma requires --output");
    const auto package = animocap::load_motion_package(input);
    animocap::export_vrma(package, output, options);
    std::cout << json{
        {"status", "exported"},
        {"format", "vrma"},
        {"spec_version", "1.0"},
        {"input", input.generic_string()},
        {"output", output.generic_string()},
        {"frame_count", package.motion.frame_count},
        {"fps", package.motion.fps},
        {"preserved_in_source_only", {"confidence", "valid_mask", "foot_contacts", "provenance"}},
    }.dump(2) << '\n';
    return 0;
}

int trim_motion(int argc,char** argv) {
    if(argc<9)usage_error(
        "trim-motion requires a motion package, --output, --start-frame, and --end-frame");
    const std::filesystem::path input(argv[2]);
    std::filesystem::path output;
    std::optional<std::size_t> first,last;
    for(int index=3;index<argc;++index) {
        const std::string_view option(argv[index]);
        if(option=="--output"&&index+1<argc)output=argv[++index];
        else if(option=="--start-frame"&&index+1<argc) {
            const auto value=parse_uint64(argv[++index],"--start-frame");
            if(value>std::numeric_limits<std::size_t>::max())usage_error("--start-frame is too large");
            first=static_cast<std::size_t>(value);
        } else if(option=="--end-frame"&&index+1<argc) {
            const auto value=parse_uint64(argv[++index],"--end-frame");
            if(value>std::numeric_limits<std::size_t>::max())usage_error("--end-frame is too large");
            last=static_cast<std::size_t>(value);
        } else usage_error("unknown trim-motion option: "+std::string(option));
    }
    if(output.empty()||!first||!last)usage_error(
        "trim-motion requires --output, --start-frame, and --end-frame");
    const auto source=animocap::load_motion_package(input);
    const auto clip=animocap::clip_motion_package(source,*first,*last);
    animocap::save_motion_package(clip,output);
    std::cout<<json{
        {"status","trimmed"},{"input",input.generic_string()},
        {"output",output.generic_string()},{"start_frame",*first},{"end_frame",*last},
        {"frame_count",clip.motion.frame_count},{"duration_s",clip.motion.time_s.back()}
    }.dump(2)<<'\n';
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
        "  reconstruct-pose <pose_sequence.json> --output <motion.amotion> [--character-profile <profile-or-skeleton.json>] [--pose-output <refined.json>] [--no-smooth]\n"
        "  apply-edits <refined.json> --edits <edits.json> --output <motion.amotion> [--character-profile <profile-or-skeleton.json>] [--pose-output <pose.json>] [--review-output <motion.amotion.areview>] [--cameras-from <motion.amotion>]\n"
        "  serve   (resident editor: JSON requests on stdin, see docs/animocap-engine.md)\n"
        "  fuse-multiview <capture.json> --poses <directory> --output <motion.amotion> [--diagnostics <diagnostics.json>] [--comparison-pose <pose.json>] [--character-profile <profile-or-skeleton.json>] [--reference-image-plane-anchor]\n"
        "  export-bvh <motion.amotion> --output <motion.bvh> [--unit centimeters|meters] [--force]\n"
        "  export-blender <motion.amotion> --frames <f,f,...> --output <frames.animocap-blender.json> [--force]\n"
        "  export-vrma <motion.amotion> --output <motion.vrma> [--force]\n"
        "  trim-motion <motion.amotion> --output <clip.amotion> --start-frame <index> --end-frame <index>\n"
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
        if (command == "apply-edits") return apply_edits(argc, argv);
        if (command == "serve") return serve(argc, argv);
        if (command == "fuse-multiview") return fuse_multiview(argc, argv);
        if (command == "export-bvh") return export_bvh(argc, argv);
        if (command == "export-vrma") return export_vrma(argc, argv);
        if (command == "export-blender") return export_blender(argc, argv);
        if (command == "trim-motion") return trim_motion(argc, argv);
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
