#include "animocap/edit_session.hpp"
#include "animocap/skeleton.hpp"

#include <cmath>
#include <filesystem>
#include <iostream>

namespace {
int failures = 0;
#define CHECK(x) do { if (!(x)) { std::cerr << "FAIL " << __LINE__ << ": " << #x << '\n'; ++failures; } } while (false)
#define THROWS(x) do { bool threw = false; try { (void)(x); } catch (const std::exception&) { threw = true; } CHECK(threw); } while (false)

bool same(const animocap::ObservedJoint& a, const animocap::ObservedJoint& b) {
    return a.position_m == b.position_m && a.image_xy == b.image_xy && a.valid == b.valid && a.confidence == b.confidence;
}

bool same(const animocap::PoseSequence& a, const animocap::PoseSequence& b) {
    if (a.frames.size() != b.frames.size()) return false;
    for (std::size_t f = 0; f < a.frames.size(); ++f) {
        for (std::size_t j = 0; j < a.frames[f].joints.size(); ++j) {
            if (!same(a.frames[f].joints[j], b.frames[f].joints[j])) return false;
        }
    }
    return true;
}

animocap::PoseSequence fixture() {
    animocap::PoseSequence s;
    s.backend = "edit-test";
    s.source_video = "fixture.mp4";
    s.fps = 30;
    s.image_width = 640;
    s.image_height = 480;
    const auto skeleton = animocap::make_default_skeleton();
    for (std::size_t f = 0; f < 40; ++f) {
        animocap::ObservedPoseFrame frame;
        frame.time_s = f / 30.0;
        for (std::size_t j = 0; j < skeleton.bones.size(); ++j) {
            const double x = f * 0.01 + (f % 2 ? 0.009 : -0.009);
            frame.joints.push_back({{200 + x * 100, 100.0 + j * 12.0}, {x, j * 0.03, 0}, 0.8f, true});
        }
        s.frames.push_back(frame);
    }
    return s;
}
}  // namespace

int main() {
    using namespace animocap;
    // Curve presets keep the Studio shapes.
    const auto smooth = curve_preset_weights(21, 10, 4, CurvePreset::Smooth);
    CHECK(smooth[10] == 1.0 && smooth[12] == 0.5 && smooth[14] == 0.0 && smooth[15] == 0.0 && smooth[5] == 0.0);
    CHECK(curve_preset_weights(21, 10, 4, CurvePreset::Linear)[11] == 0.75);
    CHECK(curve_preset_weights(21, 10, 4, CurvePreset::Hold)[14] == 1.0);
    CHECK(curve_preset_weights(5, 9, 4, CurvePreset::Smooth).empty());
    CHECK(default_drag_radius(30) == 8 && default_drag_radius(8) == 4);

    const auto refined = fixture();
    // An empty session is the refined pose itself.
    const auto plain = apply_edit_session(refined, {});
    CHECK(same(plain.corrected, refined) && same(plain.pose, refined));
    CHECK(plain.motion.motion.frame_count == refined.frames.size());

    // A drag moves the keyframe by the full drag and fades out inside the radius.
    EditSession session;
    session.corrections.push_back({10, 20, {6.0, -4.0}, 4, CurvePreset::Smooth});
    const auto dragged = apply_edit_session(refined, session);
    const auto& moved = dragged.pose.frames[20].joints[10].image_xy;
    CHECK(std::abs(moved.x - (refined.frames[20].joints[10].image_xy.x + 6.0)) < 1e-9);
    CHECK(std::abs(moved.y - (refined.frames[20].joints[10].image_xy.y - 4.0)) < 1e-9);
    CHECK(same(dragged.pose.frames[25].joints[10], refined.frames[25].joints[10]));
    CHECK(same(dragged.pose.frames[20].joints[9], refined.frames[20].joints[9]));
    // Same as composing the library calls by hand.
    const auto by_hand = apply_manual_pose_corrections(refined, {make_drag_correction(refined, session.corrections[0])});
    CHECK(same(dragged.corrected, by_hand));

    // Locks without a stored target follow the corrected pose, so a drag on a
    // locked joint moves the lock; the range between locks is rebuilt.
    session.review.marks = {
        {20, 10, ReviewTrust::Locked, {}, 8},
        {30, 10, ReviewTrust::Locked, refined.frames[30].joints[10], 8},
        {25, 10, ReviewTrust::Excluded, {}, 8},
    };
    session.target_from_pose = {true, false, false};
    session.review.ranges = {{20, 30, 10}};
    const auto reviewed = apply_edit_session(refined, session);
    CHECK(same(reviewed.pose.frames[20].joints[10], dragged.corrected.frames[20].joints[10]));
    CHECK(same(reviewed.review.marks[0].target, dragged.corrected.frames[20].joints[10]));
    CHECK(reviewed.inferred[25 * refined.frames[0].joints.size() + 10]);
    CHECK(same(reviewed.pose.frames[25].joints[9], refined.frames[25].joints[9]));

    // Keyframe smoothing keeps authored keyframes exact.
    session.smoothed_keyframes = {20};
    const auto smoothed = apply_edit_session(refined, session);
    CHECK(same(smoothed.corrected.frames[20].joints[10], dragged.corrected.frames[20].joints[10]));

    // Persistence round-trips, including derived targets.
    const auto path = std::filesystem::temp_directory_path() / "animocap-edit-session-test.json";
    save_edit_session(session, path);
    const auto loaded = load_edit_session(path);
    std::filesystem::remove(path);
    CHECK(loaded.target_from_pose == session.target_from_pose);
    CHECK(loaded.corrections.size() == 1 && loaded.corrections[0].drag_px == session.corrections[0].drag_px);
    CHECK(same(apply_edit_session(refined, loaded).pose, smoothed.pose));

    // Invalid edits are refused rather than clamped.
    auto bad = session;
    bad.review.marks[0].frame = 99;
    THROWS(apply_edit_session(refined, bad));
    bad = session;
    bad.target_from_pose.pop_back();
    THROWS(apply_edit_session(refined, bad));
    bad = session;
    bad.corrections[0].joint = 999;
    THROWS(apply_edit_session(refined, bad));
    bad = session;
    bad.smoothed_keyframes = {400};
    THROWS(apply_edit_session(refined, bad));

    if (failures) std::cerr << failures << " edit session checks failed\n";
    else std::cout << "edit session checks passed\n";
    return failures ? 1 : 0;
}
