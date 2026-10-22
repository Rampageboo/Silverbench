#include "animocap/edit_session.hpp"

#include "animocap/animation_curve.hpp"
#include "animocap/skeleton.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <array>
#include <cmath>
#include <fstream>
#include <string>

namespace animocap {
namespace {

using nlohmann::json;
using Channels = std::array<double, 5>;

double curve_weight(double normalized_distance, CurvePreset preset) {
    const double value = std::clamp(normalized_distance, 0.0, 1.0);
    switch (preset) {
    case CurvePreset::Linear: return 1.0 - value;
    case CurvePreset::EaseIn: return 1.0 - value * value;
    case CurvePreset::EaseOut: return (1.0 - value) * (1.0 - value);
    case CurvePreset::Smooth: return 1.0 - value * value * (3.0 - 2.0 * value);
    case CurvePreset::Hold: return 1.0;
    }
    return 1.0 - value * value * (3.0 - 2.0 * value);
}

const char* preset_name(CurvePreset preset) {
    switch (preset) {
    case CurvePreset::Linear: return "linear";
    case CurvePreset::EaseIn: return "ease-in";
    case CurvePreset::EaseOut: return "ease-out";
    case CurvePreset::Smooth: return "smooth";
    case CurvePreset::Hold: return "hold";
    }
    return "smooth";
}

CurvePreset preset_from(const std::string& name) {
    if (name == "linear") return CurvePreset::Linear;
    if (name == "ease-in") return CurvePreset::EaseIn;
    if (name == "ease-out") return CurvePreset::EaseOut;
    if (name == "smooth") return CurvePreset::Smooth;
    if (name == "hold") return CurvePreset::Hold;
    throw ContractError("unknown curve preset: " + name);
}

const char* trust_name(ReviewTrust trust) {
    switch (trust) {
    case ReviewTrust::Weighted: return "weighted";
    case ReviewTrust::Locked: return "locked";
    case ReviewTrust::Excluded: return "excluded";
    }
    return "locked";
}

ReviewTrust trust_from(const std::string& name) {
    if (name == "weighted") return ReviewTrust::Weighted;
    if (name == "locked") return ReviewTrust::Locked;
    if (name == "excluded") return ReviewTrust::Excluded;
    throw ContractError("unknown review trust: " + name);
}

void check_frame_joint(const PoseSequence& pose, std::size_t frame, std::size_t joint, const char* what) {
    if (frame >= pose.frames.size() || joint >= pose.frames[frame].joints.size()) {
        throw ContractError(std::string(what) + " refers to a frame or joint outside the take");
    }
}

}  // namespace

std::vector<double> curve_preset_weights(
    std::size_t frame_count, std::size_t keyframe, std::size_t radius, CurvePreset preset) {
    if (frame_count == 0 || keyframe >= frame_count) return {};
    radius = std::max<std::size_t>(1, radius);
    std::vector<double> result(frame_count, 0.0);
    for (std::size_t frame = 0; frame < frame_count; ++frame) {
        const std::size_t distance = frame > keyframe ? frame - keyframe : keyframe - frame;
        if (distance > radius) continue;
        result[frame] = curve_weight(static_cast<double>(distance) / static_cast<double>(radius), preset);
    }
    return result;
}

std::size_t default_drag_radius(double fps) {
    return std::max<std::size_t>(4, static_cast<std::size_t>(std::lround(std::max(1.0, fps) * 0.25)));
}

ManualPoseCorrection make_drag_correction(const PoseSequence& reference, const DragCorrection& drag) {
    check_frame_joint(reference, drag.keyframe, drag.joint, "drag correction");
    const auto skeleton = make_default_skeleton();
    const auto head = bone_index(skeleton, BoneSemantic::Head);
    const auto left_foot = bone_index(skeleton, BoneSemantic::LeftFoot);
    const auto right_foot = bone_index(skeleton, BoneSemantic::RightFoot);

    ManualPoseCorrection correction;
    correction.joint_index = drag.joint;
    correction.image_delta = drag.drag_px;
    correction.keyframe_frame_index = drag.keyframe;
    const auto radius = drag.radius ? drag.radius : default_drag_radius(reference.fps);
    correction.frame_weights = curve_preset_weights(reference.frames.size(), drag.keyframe, radius, drag.curve);
    correction.position_deltas_m.reserve(reference.frames.size());
    // Same pixel-to-metre estimate as the Studio drag: a 1.55 m head-to-feet
    // height per frame. Depth is not edited by an image drag.
    for (const auto& frame : reference.frames) {
        const auto head_xy = frame.joints[head].image_xy;
        const auto left_xy = frame.joints[left_foot].image_xy;
        const auto right_xy = frame.joints[right_foot].image_xy;
        const double foot_x = (left_xy.x + right_xy.x) * 0.5;
        const double foot_y = (left_xy.y + right_xy.y) * 0.5;
        const double body_pixels = std::max(1.0, std::hypot(head_xy.x - foot_x, head_xy.y - foot_y));
        const double meters_per_pixel = 1.55 / body_pixels;
        correction.position_deltas_m.push_back({
            -drag.drag_px.x * meters_per_pixel,
            -drag.drag_px.y * meters_per_pixel,
            0.0,
        });
    }
    return correction;
}

EditResult apply_edit_session(
    const PoseSequence& refined, const EditSession& session, const Skeleton* character_skeleton) {
    validate_pose_sequence(refined);
    if (session.target_from_pose.size() != session.review.marks.size()) {
        throw ContractError("edit session target flags do not match its review marks");
    }
    ManualPoseCorrections corrections;
    corrections.reserve(session.corrections.size());
    std::vector<std::size_t> authored;
    for (const auto& drag : session.corrections) {
        corrections.push_back(make_drag_correction(refined, drag));
        authored.push_back(drag.keyframe);
    }
    std::sort(authored.begin(), authored.end());
    authored.erase(std::unique(authored.begin(), authored.end()), authored.end());

    auto corrected = apply_manual_pose_corrections(refined, corrections);
    if (!session.smoothed_keyframes.empty()) {
        for (const auto frame : session.smoothed_keyframes) {
            if (frame >= corrected.frames.size()) throw ContractError("smoothed keyframe is outside the take");
        }
        auto smoothed = smooth_pose_around_keyframes(corrected, session.smoothed_keyframes).sequence;
        // Every authored keyframe stays an exact anchor (Studio rule), so later
        // drags compose with an earlier local smoothing pass.
        for (const auto frame : authored) smoothed.frames[frame] = corrected.frames[frame];
        corrected = std::move(smoothed);
    }

    PoseReview review = session.review;
    for (std::size_t index = 0; index < review.marks.size(); ++index) {
        auto& mark = review.marks[index];
        check_frame_joint(corrected, mark.frame, mark.joint, "review mark");
        if (session.target_from_pose[index]) mark.target = corrected.frames[mark.frame].joints[mark.joint];
    }
    auto reviewed = rebuild_reviewed_pose(corrected, review);
    auto motion = reconstruct_canonical_motion(reviewed.sequence, character_skeleton);
    return {std::move(corrected), std::move(reviewed.sequence), std::move(reviewed.inferred), std::move(review),
            std::move(motion)};
}

EditSession load_edit_session(const std::filesystem::path& path) {
    std::ifstream input(path);
    if (!input) throw ContractError("cannot read edit session: " + path.string());
    json value;
    input >> value;
    if (value.at("version") != 1) throw ContractError("unsupported edit session version");
    EditSession session;
    for (const auto& item : value.value("corrections", json::array())) {
        DragCorrection drag;
        drag.joint = item.at("joint");
        drag.keyframe = item.at("keyframe");
        const auto px = item.at("dragPx");
        drag.drag_px = {px.at(0).get<double>(), px.at(1).get<double>()};
        drag.radius = item.value("radius", std::size_t{0});
        drag.curve = preset_from(item.value("curve", std::string("smooth")));
        if (!std::isfinite(drag.drag_px.x) || !std::isfinite(drag.drag_px.y)) {
            throw ContractError("drag correction must be finite");
        }
        session.corrections.push_back(drag);
    }
    for (const auto& frame : value.value("smoothedKeyframes", json::array())) {
        session.smoothed_keyframes.push_back(frame.get<std::size_t>());
    }
    const auto review = value.value("review", json::object());
    for (const auto& item : review.value("marks", json::array())) {
        JointReview mark;
        mark.frame = item.at("frame");
        mark.joint = item.at("joint");
        mark.trust = trust_from(item.at("trust").get<std::string>());
        mark.weight = item.value("weight", 8.0);
        const bool from_pose = !item.contains("target") || item.at("target").is_null();
        if (!from_pose) {
            const auto v = item.at("target").get<Channels>();
            mark.target.position_m = {v[0], v[1], v[2]};
            mark.target.image_xy = {v[3], v[4]};
            mark.target.valid = item.value("valid", true);
            mark.target.confidence = item.value("confidence", 1.0f);
        }
        session.review.marks.push_back(mark);
        session.target_from_pose.push_back(from_pose);
    }
    for (const auto& item : review.value("ranges", json::array())) {
        session.review.ranges.push_back({item.at(0), item.at(1), item.at(2)});
    }
    return session;
}

void save_edit_session(const EditSession& session, const std::filesystem::path& path) {
    if (session.target_from_pose.size() != session.review.marks.size()) {
        throw ContractError("edit session target flags do not match its review marks");
    }
    json corrections = json::array();
    for (const auto& drag : session.corrections) {
        corrections.push_back({
            {"joint", drag.joint},
            {"keyframe", drag.keyframe},
            {"dragPx", {drag.drag_px.x, drag.drag_px.y}},
            {"radius", drag.radius},
            {"curve", preset_name(drag.curve)},
        });
    }
    json marks = json::array();
    for (std::size_t index = 0; index < session.review.marks.size(); ++index) {
        const auto& mark = session.review.marks[index];
        json item{{"frame", mark.frame}, {"joint", mark.joint}, {"trust", trust_name(mark.trust)}, {"weight", mark.weight}};
        if (!session.target_from_pose[index]) {
            const auto& t = mark.target;
            item["target"] = Channels{t.position_m.x, t.position_m.y, t.position_m.z, t.image_xy.x, t.image_xy.y};
            item["valid"] = t.valid;
            item["confidence"] = t.confidence;
        }
        marks.push_back(std::move(item));
    }
    json ranges = json::array();
    for (const auto& range : session.review.ranges) ranges.push_back({range.first, range.last, range.joint});
    const json value{
        {"version", 1},
        {"corrections", std::move(corrections)},
        {"smoothedKeyframes", session.smoothed_keyframes},
        {"review", {{"marks", std::move(marks)}, {"ranges", std::move(ranges)}}},
    };
    std::ofstream output(path);
    output << value.dump(2);
    if (!output) throw ContractError("cannot write edit session: " + path.string());
}

}  // namespace animocap
