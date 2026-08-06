#include "animocap/video.hpp"

#ifdef _WIN32

#define NOMINMAX
#include <mfapi.h>
#include <mferror.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <propvarutil.h>
#include <windows.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <utility>

namespace animocap {
namespace {
constexpr DWORD kVideoStream = static_cast<DWORD>(MF_SOURCE_READER_FIRST_VIDEO_STREAM);

void check_hr(HRESULT value, const char* operation) {
    if (FAILED(value)) {
        throw std::runtime_error(std::string(operation) + " failed (HRESULT " +
                                 std::to_string(static_cast<unsigned long>(value)) + ")");
    }
}

template <typename T>
void release(T*& value) {
    if (value != nullptr) {
        value->Release();
        value = nullptr;
    }
}

}  // namespace

struct VideoDecoder::Impl {
    IMFSourceReader* reader{};
    VideoInfo info{};
    bool media_foundation_started{};

    Impl() {
        check_hr(MFStartup(MF_VERSION, MFSTARTUP_LITE), "MFStartup");
        media_foundation_started = true;
    }

    ~Impl() {
        release(reader);
        if (media_foundation_started) MFShutdown();
    }

    void close() {
        release(reader);
        info = {};
    }
};

VideoDecoder::VideoDecoder() : impl_(std::make_unique<Impl>()) {}
VideoDecoder::~VideoDecoder() = default;
VideoDecoder::VideoDecoder(VideoDecoder&&) noexcept = default;
VideoDecoder& VideoDecoder::operator=(VideoDecoder&&) noexcept = default;

void VideoDecoder::open(const std::filesystem::path& path) {
    impl_->close();

    IMFAttributes* attributes = nullptr;
    IMFMediaType* output_type = nullptr;
    IMFMediaType* current_type = nullptr;
    PROPVARIANT duration;
    PropVariantInit(&duration);

    try {
        check_hr(MFCreateAttributes(&attributes, 2), "MFCreateAttributes");
        check_hr(attributes->SetUINT32(MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, TRUE),
                 "enable video processing");
        check_hr(attributes->SetUINT32(MF_READWRITE_DISABLE_CONVERTERS, FALSE),
                 "enable media converters");
        check_hr(MFCreateSourceReaderFromURL(path.c_str(), attributes, &impl_->reader),
                 "open video");

        check_hr(MFCreateMediaType(&output_type), "create output media type");
        check_hr(output_type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video), "set video type");
        check_hr(output_type->SetGUID(MF_MT_SUBTYPE, MFVideoFormat_RGB32), "set RGB32");
        check_hr(impl_->reader->SetCurrentMediaType(
                     kVideoStream, nullptr, output_type),
                 "configure video decoder");
        check_hr(impl_->reader->SetStreamSelection(
                     kVideoStream, TRUE),
                 "select video stream");
        check_hr(impl_->reader->GetCurrentMediaType(
                     kVideoStream, &current_type),
                 "read video media type");

        UINT32 width = 0;
        UINT32 height = 0;
        check_hr(MFGetAttributeSize(current_type, MF_MT_FRAME_SIZE, &width, &height),
                 "read frame size");
        UINT32 fps_numerator = 0;
        UINT32 fps_denominator = 0;
        if (FAILED(MFGetAttributeRatio(
                current_type, MF_MT_FRAME_RATE, &fps_numerator, &fps_denominator)) ||
            fps_denominator == 0) {
            fps_numerator = 30;
            fps_denominator = 1;
        }

        double duration_s = 0.0;
        if (SUCCEEDED(impl_->reader->GetPresentationAttribute(
                static_cast<DWORD>(MF_SOURCE_READER_MEDIASOURCE), MF_PD_DURATION, &duration)) &&
            duration.vt == VT_UI8) {
            duration_s = static_cast<double>(duration.uhVal.QuadPart) / 10'000'000.0;
        }

        impl_->info.width = width;
        impl_->info.height = height;
        impl_->info.fps = static_cast<double>(fps_numerator) /
                          static_cast<double>(fps_denominator);
        impl_->info.duration_s = duration_s;
        impl_->info.estimated_frame_count = static_cast<std::uint64_t>(
            std::llround(duration_s * impl_->info.fps));
    } catch (...) {
        release(current_type);
        release(output_type);
        release(attributes);
        PropVariantClear(&duration);
        impl_->close();
        throw;
    }

    release(current_type);
    release(output_type);
    release(attributes);
    PropVariantClear(&duration);
}

void VideoDecoder::seek(double time_s) {
    if (!impl_->reader) throw std::runtime_error("no video is open");
    PROPVARIANT position;
    PropVariantInit(&position);
    position.vt = VT_I8;
    position.hVal.QuadPart = static_cast<LONGLONG>(
        std::max(0.0, time_s) * 10'000'000.0);
    const HRESULT result = impl_->reader->SetCurrentPosition(GUID_NULL, position);
    PropVariantClear(&position);
    check_hr(result, "seek video");
}

bool VideoDecoder::read_frame(VideoFrame& frame) {
    if (!impl_->reader) throw std::runtime_error("no video is open");

    while (true) {
        DWORD stream_index = 0;
        DWORD flags = 0;
        LONGLONG timestamp = 0;
        IMFSample* sample = nullptr;
        const HRESULT result = impl_->reader->ReadSample(
            kVideoStream,
            0,
            &stream_index,
            &flags,
            &timestamp,
            &sample);
        check_hr(result, "decode video frame");

        if ((flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0) {
            release(sample);
            return false;
        }
        if (sample == nullptr) continue;

        IMFMediaBuffer* buffer = nullptr;
        BYTE* bytes = nullptr;
        DWORD maximum_length = 0;
        DWORD current_length = 0;
        try {
            check_hr(sample->ConvertToContiguousBuffer(&buffer), "read video sample buffer");
            check_hr(buffer->Lock(&bytes, &maximum_length, &current_length),
                     "lock video frame");

            const std::size_t row_bytes =
                static_cast<std::size_t>(impl_->info.width) * 4U;
            const std::size_t expected =
                row_bytes * static_cast<std::size_t>(impl_->info.height);
            if (current_length < expected) {
                throw std::runtime_error("decoded video frame is smaller than its declared size");
            }
            frame.width = impl_->info.width;
            frame.height = impl_->info.height;
            frame.time_s = static_cast<double>(timestamp) / 10'000'000.0;
            frame.bgra.resize(expected);
            for (std::size_t row = 0; row < impl_->info.height; ++row) {
                std::copy_n(bytes + row * row_bytes, row_bytes,
                            frame.bgra.data() + row * row_bytes);
            }
            buffer->Unlock();
            bytes = nullptr;
        } catch (...) {
            if (bytes != nullptr) buffer->Unlock();
            release(buffer);
            release(sample);
            throw;
        }
        release(buffer);
        release(sample);
        return true;
    }
}

const VideoInfo& VideoDecoder::info() const {
    return impl_->info;
}

bool VideoDecoder::is_open() const {
    return impl_->reader != nullptr;
}

}  // namespace animocap

#else

#include <stdexcept>

namespace animocap {

struct VideoDecoder::Impl {
    VideoInfo info{};
};

VideoDecoder::VideoDecoder() : impl_(std::make_unique<Impl>()) {}
VideoDecoder::~VideoDecoder() = default;
VideoDecoder::VideoDecoder(VideoDecoder&&) noexcept = default;
VideoDecoder& VideoDecoder::operator=(VideoDecoder&&) noexcept = default;
void VideoDecoder::open(const std::filesystem::path&) {
    throw std::runtime_error("video decoding is currently available on Windows only");
}
void VideoDecoder::seek(double) { throw std::runtime_error("video is not open"); }
bool VideoDecoder::read_frame(VideoFrame&) { return false; }
const VideoInfo& VideoDecoder::info() const { return impl_->info; }
bool VideoDecoder::is_open() const { return false; }

}  // namespace animocap

#endif

