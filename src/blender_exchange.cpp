#include "animocap/blender_exchange.hpp"

#include "animocap/contracts.hpp"

#include <algorithm>

namespace animocap {

void BlenderFrameSelection::select(
    std::size_t frame,
    std::size_t frame_count,
    bool control,
    bool shift
) {
    if (frame >= frame_count) throw ContractError("Blender selection frame is outside motion");
    if (shift && range_anchor_) {
        std::vector<std::size_t> range;
        const auto first = std::min(*range_anchor_, frame);
        const auto last = std::max(*range_anchor_, frame);
        range.reserve(last - first + 1);
        for (auto candidate = first; candidate <= last; ++candidate)
            range.push_back(candidate);
        if (control) {
            frames_.insert(frames_.end(), range.begin(), range.end());
        } else {
            frames_ = std::move(range);
        }
    } else if (control) {
        const auto found = std::find(frames_.begin(), frames_.end(), frame);
        if (found == frames_.end()) frames_.push_back(frame);
        else frames_.erase(found);
        range_anchor_ = frame;
    } else {
        frames_ = {frame};
        range_anchor_ = frame;
    }
    std::sort(frames_.begin(), frames_.end());
    frames_.erase(std::unique(frames_.begin(), frames_.end()), frames_.end());
}

void BlenderFrameSelection::select_only(
    const std::vector<std::size_t>& frames,
    std::size_t frame_count
) {
    frames_ = frames;
    std::sort(frames_.begin(), frames_.end());
    frames_.erase(std::unique(frames_.begin(), frames_.end()), frames_.end());
    if (!frames_.empty() && frames_.back() >= frame_count)
        throw ContractError("Blender selection contains a frame outside motion");
    range_anchor_ = frames_.empty()
        ? std::optional<std::size_t>{}
        : std::optional<std::size_t>{frames_.back()};
}

void BlenderFrameSelection::clear() {
    frames_.clear();
    range_anchor_.reset();
}

void BlenderFrameSelection::prune(std::size_t frame_count) {
    frames_.erase(std::remove_if(frames_.begin(), frames_.end(),
        [frame_count](const auto frame) { return frame >= frame_count; }), frames_.end());
    if (range_anchor_ && *range_anchor_ >= frame_count) range_anchor_.reset();
}

const std::vector<std::size_t>& BlenderFrameSelection::frames() const noexcept {
    return frames_;
}

bool BlenderFrameSelection::empty() const noexcept { return frames_.empty(); }
std::size_t BlenderFrameSelection::size() const noexcept { return frames_.size(); }

}  // namespace animocap
