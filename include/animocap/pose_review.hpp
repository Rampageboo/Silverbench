#pragma once
#include "animocap/pose_sequence.hpp"
#include <utility>

namespace animocap {
enum class ReviewTrust { Weighted, Locked, Excluded };
struct JointReview {
    std::size_t frame{}, joint{};
    ReviewTrust trust{ReviewTrust::Locked};
    ObservedJoint target{};
    double weight{8.0};
};
struct ReviewRange { std::size_t first{}, last{}, joint{}; };
struct PoseReview {
    std::vector<JointReview> marks;
    std::vector<ReviewRange> ranges;
};
struct PoseReviewResult {
    PoseSequence sequence;
    // Frame-major: inferred samples have no accepted observation.
    std::vector<bool> inferred;
};
// Local observation-space repair. Does not claim new triangulation or ground truth.
// Both endpoints must be explicit locked samples; unrelated joints stay bit-exact.
PoseReviewResult rebuild_reviewed_pose(const PoseSequence&, const PoseReview&);
void save_pose_review(const PoseSequence&, const PoseReview&, const std::filesystem::path&);
std::pair<PoseSequence, PoseReview> load_pose_review(const std::filesystem::path&);
} // namespace animocap
