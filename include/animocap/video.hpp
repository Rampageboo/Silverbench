#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <vector>

namespace animocap {

struct VideoInfo {
    std::uint32_t width{};
    std::uint32_t height{};
    double duration_s{};
    double fps{};
    std::uint64_t estimated_frame_count{};
};

struct VideoFrame {
    std::uint32_t width{};
    std::uint32_t height{};
    double time_s{};
    std::vector<std::uint8_t> bgra;
};

class VideoDecoder {
public:
    VideoDecoder();
    ~VideoDecoder();
    VideoDecoder(const VideoDecoder&) = delete;
    VideoDecoder& operator=(const VideoDecoder&) = delete;
    VideoDecoder(VideoDecoder&&) noexcept;
    VideoDecoder& operator=(VideoDecoder&&) noexcept;

    void open(const std::filesystem::path& path);
    void seek(double time_s);
    bool read_frame(VideoFrame& frame);
    const VideoInfo& info() const;
    bool is_open() const;

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

}  // namespace animocap

