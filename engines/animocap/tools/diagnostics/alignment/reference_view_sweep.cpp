#include "animocap/multiview.hpp"
#include "animocap/pose_sequence.hpp"

#include <nlohmann/json.hpp>

#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using json = nlohmann::json;

struct Variant {
    std::string name;
    animocap::MultiviewSolveOptions options;
};

json options_json(const animocap::MultiviewSolveOptions& options) {
    return {
        {"reference_view", options.reference_view},
        {"minimum_confidence", options.minimum_confidence},
        {"conflict_threshold_m", options.conflict_threshold_m},
        {"enable_reference_image_plane_anchor",
         options.enable_reference_image_plane_anchor},
        {"reference_anchor_confidence", options.reference_anchor_confidence},
        {"require_reference_consensus_for_anchor",
         options.require_reference_consensus_for_anchor},
        {"reference_anchor_maximum_rms_m",
         options.reference_anchor_maximum_rms_m},
        {"temporal_weight", options.temporal_weight},
        {"bone_length_weight", options.bone_length_weight},
        {"maximum_warp_fraction", options.maximum_warp_fraction},
        {"enable_view_visibility_weighting",
         options.enable_view_visibility_weighting},
        {"maximum_near_side_visibility_bonus",
         options.maximum_near_side_visibility_bonus},
        {"maximum_far_side_visibility_penalty",
         options.maximum_far_side_visibility_penalty},
        {"mirrored_joint_overlap_threshold_m",
         options.mirrored_joint_overlap_threshold_m},
        {"enable_temporal_view_reliability",
         options.enable_temporal_view_reliability},
        {"temporal_outlier_acceleration_m",
         options.temporal_outlier_acceleration_m},
        {"temporal_outlier_ratio", options.temporal_outlier_ratio},
        {"enable_animation_curve_stabilization",
         options.enable_animation_curve_stabilization},
        {"animation_curve", {
            {"maximum_anchor_gap_frames",
             options.animation_curve.maximum_anchor_gap_frames},
            {"minimum_contact_frames",
             options.animation_curve.minimum_contact_frames},
            {"anchor_confidence", options.animation_curve.anchor_confidence},
            {"low_confidence_threshold",
             options.animation_curve.low_confidence_threshold},
            {"motion_turn_minimum_m",
             options.animation_curve.motion_turn_minimum_m},
            {"correction_noise_floor_m",
             options.animation_curve.correction_noise_floor_m},
            {"high_confidence_jitter_minimum_m",
             options.animation_curve.high_confidence_jitter_minimum_m},
            {"high_confidence_jitter_maximum_step_m",
             options.animation_curve.high_confidence_jitter_maximum_step_m},
            {"maximum_correction_m",
             options.animation_curve.maximum_correction_m},
            {"maximum_image_correction_px",
             options.animation_curve.maximum_image_correction_px},
            {"maximum_high_confidence_jitter_correction_m",
             options.animation_curve.maximum_high_confidence_jitter_correction_m},
            {"maximum_high_confidence_jitter_image_correction_px",
             options.animation_curve.maximum_high_confidence_jitter_image_correction_px},
            {"contact_speed_threshold_m",
             options.animation_curve.contact_speed_threshold_m},
            {"contact_height_threshold_m",
             options.animation_curve.contact_height_threshold_m},
            {"curve_strength", options.animation_curve.curve_strength},
        }},
    };
}

json diagnostics_json(const animocap::MultiviewDiagnostics& diagnostics) {
    json alignments = json::array();
    for (const auto& alignment : diagnostics.alignments) {
        alignments.push_back({
            {"view_id", alignment.view_id},
            {"mean_offset_s", alignment.mean_offset_s},
            {"mean_rate", alignment.mean_rate},
            {"normalized_cost", alignment.normalized_cost},
            {"method", alignment.method},
            {"overlap_reference_frames", alignment.overlap_reference_frames},
            {"out_of_range_reference_frames",
             alignment.out_of_range_reference_frames},
        });
    }
    return {
        {"recovered_observations", diagnostics.recovered_observations},
        {"left_right_corrections", diagnostics.left_right_corrections},
        {"rejected_view_observations",
         diagnostics.rejected_view_observations},
        {"left_right_state_changes", diagnostics.left_right_state_changes},
        {"reference_anchored_observations",
         diagnostics.reference_anchored_observations},
        {"reference_anchor_suppressed_conflicts",
         diagnostics.reference_anchor_suppressed_conflicts},
        {"reference_anchor_suppressed_low_confidence",
         diagnostics.reference_anchor_suppressed_low_confidence},
        {"visibility_evaluated_observations",
         diagnostics.visibility_evaluated_observations},
        {"visibility_downweighted_observations",
         diagnostics.visibility_downweighted_observations},
        {"visibility_boosted_observations",
         diagnostics.visibility_boosted_observations},
        {"overlap_downweighted_observations",
         diagnostics.overlap_downweighted_observations},
        {"temporal_outlier_downweighted_observations",
         diagnostics.temporal_outlier_downweighted_observations},
        {"curve_anchor_samples", diagnostics.curve_anchor_samples},
        {"curve_corrected_samples", diagnostics.curve_corrected_samples},
        {"curve_high_confidence_jitter_corrected_samples",
         diagnostics.curve_high_confidence_jitter_corrected_samples},
        {"curve_contact_locked_samples",
         diagnostics.curve_contact_locked_samples},
        {"curve_mean_correction_m", diagnostics.curve_mean_correction_m},
        {"curve_maximum_correction_m",
         diagnostics.curve_maximum_correction_m},
        {"jitter_before_curve", diagnostics.jitter_before_curve},
        {"jitter_after_curve", diagnostics.jitter_after_curve},
        {"mean_reprojection_error_m",
         diagnostics.mean_reprojection_error_m},
        {"conflict_count", diagnostics.conflicts.size()},
        {"alignments", std::move(alignments)},
    };
}

void write_json(const std::filesystem::path& path, const json& value) {
    std::ofstream output(path, std::ios::binary);
    if (!output) {
        throw std::runtime_error("cannot write diagnostic manifest: " +
                                 path.string());
    }
    output << value.dump(2) << '\n';
}

}  // namespace

int main(int argc, char** argv) {
    try {
        if (argc != 3) {
            std::cerr << "usage: multiview_ablation_harness "
                         "<poses-directory> <output-directory>\n";
            return 2;
        }

        const std::filesystem::path poses_directory(argv[1]);
        const std::filesystem::path output_directory(argv[2]);
        std::vector<animocap::MultiviewPoseInput> views;
        views.push_back({
            "front_left", -45.0,
            animocap::load_pose_sequence_json(
                poses_directory / "front_left" / "pose_sequence.json"),
            0.0,
        });
        views.push_back({
            "front", 0.0,
            animocap::load_pose_sequence_json(
                poses_directory / "front" / "pose_sequence.json"),
            0.0,
        });
        views.push_back({
            "front_right", 45.0,
            animocap::load_pose_sequence_json(
                poses_directory / "front_right" / "pose_sequence.json"),
            0.0,
        });

        animocap::MultiviewSolveOptions enhanced;
        enhanced.reference_view = 1;
        enhanced.enable_reference_image_plane_anchor = true;

        auto ref0 = enhanced; ref0.reference_view = 0;
        auto ref2 = enhanced; ref2.reference_view = 2;
        auto combined_ablated = enhanced;
        combined_ablated.enable_view_visibility_weighting = false;
        combined_ablated.enable_temporal_view_reliability = false;
        combined_ablated.enable_animation_curve_stabilization = false;
        combined_ablated.temporal_weight = 0.0;
        combined_ablated.require_reference_consensus_for_anchor = false;

        auto no_visibility = enhanced;
        no_visibility.enable_view_visibility_weighting = false;
        auto no_temporal = enhanced;
        no_temporal.enable_temporal_view_reliability = false;
        auto no_curve = enhanced;
        no_curve.enable_animation_curve_stabilization = false;
        auto no_reference_consensus = enhanced;
        no_reference_consensus.require_reference_consensus_for_anchor = false;

        const std::vector<Variant> variants{
            {"ref_front", enhanced},
            {"ref_front_left", ref0}, {"ref_front_right", ref2},
        };

        json run_manifest{
            {"producer", "tools/diagnostics/multiview_ablation_harness.cpp"},
            {"poses_directory", poses_directory.generic_string()},
            {"output_directory", output_directory.generic_string()},
            {"views", json::array({
                {{"id", "front_left"}, {"yaw_degrees", -45.0}},
                {{"id", "front"}, {"yaw_degrees", 0.0}},
                {{"id", "front_right"}, {"yaw_degrees", 45.0}},
            })},
            {"variants", json::array()},
        };

        for (const auto& variant : variants) {
            const auto variant_directory = output_directory / variant.name;
            std::filesystem::create_directories(variant_directory);
            const auto result = animocap::solve_directional_multiview(
                views, variant.options);
            const auto pose_path = variant_directory / "pose_sequence.json";
            const auto diagnostics_path =
                variant_directory / "multiview-diagnostics.json";
            animocap::save_pose_sequence_json(result.fused_pose, pose_path);
            animocap::save_multiview_diagnostics(
                result.diagnostics, diagnostics_path);
            json summary{
                {"variant", variant.name},
                {"options", options_json(variant.options)},
                {"pose_path", pose_path.generic_string()},
                {"diagnostics_path", diagnostics_path.generic_string()},
                {"frame_count", result.fused_pose.frames.size()},
                {"joint_count",
                 result.fused_pose.frames.empty()
                     ? 0
                     : result.fused_pose.frames.front().joints.size()},
                {"backend", result.fused_pose.backend},
                {"diagnostics", diagnostics_json(result.diagnostics)},
            };
            write_json(variant_directory / "variant-result.json", summary);
            run_manifest["variants"].push_back(std::move(summary));
            std::cout << variant.name << ": frames="
                      << result.fused_pose.frames.size() << " joints="
                      << result.fused_pose.frames.front().joints.size()
                      << " conflicts=" << result.diagnostics.conflicts.size()
                      << '\n';
        }
        write_json(output_directory / "harness-run.json", run_manifest);
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "multiview diagnostic harness failed: " << error.what()
                  << '\n';
        return 1;
    }
}
