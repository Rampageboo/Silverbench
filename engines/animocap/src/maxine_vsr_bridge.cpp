#include <windows.h>

#include <cstdint>
#include <cstdlib>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <format>
#include <memory>
#include <stdexcept>
#include <string>

namespace {

constexpr const char* kVideoSuperResolution = "VideoSuperRes";
constexpr const char* kQualityLevel = "QualityLevel";
constexpr const char* kInputImage = "SrcImage0";
constexpr const char* kOutputImage = "DstImage0";
constexpr const char* kCudaStream = "CudaStream";
constexpr int kNvSuccess = 0;
constexpr int kNvBgra = 7;
constexpr int kNvU8 = 1;
constexpr unsigned kNvChunky = 0;
constexpr unsigned kNvCpu = 0;
constexpr unsigned kNvGpu = 1;

void Trace(const char* message) {
    if (!GetEnvironmentVariableW(L"ANIMOCAP_MAXINE_TRACE", nullptr, 0)) return;
    std::fprintf(stderr, "animocap-maxine: %s\n", message);
    std::fflush(stderr);
}

// Stable C ABI used by NVIDIA Maxine VFX SDK 1.2. Defining only the ABI keeps
// this bridge runtime-loaded and avoids redistributing SDK headers or import
// libraries. Layout matches NvCVImage from the SDK Core package.
struct NvImage {
    unsigned int width;
    unsigned int height;
    signed int pitch;
    int pixelFormat;
    int componentType;
    unsigned char pixelBytes;
    unsigned char componentBytes;
    unsigned char numComponents;
    unsigned char planar;
    unsigned char gpuMem;
    unsigned char colorspace;
    unsigned char reserved[2];
    void* pixels;
    void* deletePtr;
    void (*deleteProc)(void*);
    unsigned long long bufferBytes;
};

using NvStatus = int;
using NvEffect = void*;
using ImageAllocFn = NvStatus(__cdecl*)(NvImage*, unsigned, unsigned, int, int,
                                        unsigned, unsigned, unsigned);
using ImageDeallocFn = void(__cdecl*)(NvImage*);
using ImageInitFn = NvStatus(__cdecl*)(NvImage*, unsigned, unsigned, int, void*,
                                       int, int, unsigned, unsigned);
using ImageTransferFn = NvStatus(__cdecl*)(const NvImage*, NvImage*, float,
                                           void*, NvImage*);
using ErrorStringFn = const char*(__cdecl*)(NvStatus);
using CreateEffectFn = NvStatus(__cdecl*)(const char*, NvEffect*);
using DestroyEffectFn = void(__cdecl*)(NvEffect);
using SetImageFn = NvStatus(__cdecl*)(NvEffect, const char*, NvImage*);
using SetCudaStreamFn = NvStatus(__cdecl*)(NvEffect, const char*, void*);
using SetU32Fn = NvStatus(__cdecl*)(NvEffect, const char*, unsigned);
using LoadEffectFn = NvStatus(__cdecl*)(NvEffect);
using RunEffectFn = NvStatus(__cdecl*)(NvEffect, int);
using CudaContextSynchronizeFn = int(__stdcall*)();

void CopyError(char* destination, std::size_t capacity, const std::string& message) {
    if (!destination || capacity == 0) return;
    const auto count = (std::min)(capacity - 1, message.size());
    std::memcpy(destination, message.data(), count);
    destination[count] = '\0';
}

void CheckNv(NvStatus status, const char* operation, ErrorStringFn errorString) {
    if (status == kNvSuccess) return;
    const char* detail = errorString ? errorString(status) : nullptr;
    throw std::runtime_error(std::format(
        "{} failed with NvCV status {} ({})", operation,
        static_cast<int>(status), detail ? detail : "unknown"));
}

template <typename Function>
Function Resolve(HMODULE module, const char* name) {
    const auto function = reinterpret_cast<Function>(GetProcAddress(module, name));
    if (!function) {
        throw std::runtime_error(std::format(
            "Maxine runtime does not export {} (Win32 error {})", name,
            GetLastError()));
    }
    return function;
}

std::wstring Utf8ToWide(const char* value) {
    if (!value || !*value) return {};
    const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1,
                                          nullptr, 0);
    if (count <= 1) throw std::runtime_error("Maxine runtime path is not valid UTF-8");
    std::wstring result(static_cast<std::size_t>(count), L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value, -1,
                        result.data(), count);
    result.resize(static_cast<std::size_t>(count - 1));
    return result;
}

struct MaxineVsr {
    std::string runtimeUtf8;
    std::filesystem::path runtime;
    HMODULE imageModule{};
    HMODULE effectsModule{};
    HMODULE featureModule{};
    HMODULE cudaDriverModule{};
    ImageAllocFn imageAlloc{};
    ImageDeallocFn imageDealloc{};
    ImageInitFn imageInit{};
    ImageTransferFn imageTransfer{};
    ErrorStringFn errorString{};
    CreateEffectFn createEffect{};
    DestroyEffectFn destroyEffect{};
    SetImageFn setImage{};
    SetCudaStreamFn setCudaStream{};
    SetU32Fn setU32{};
    LoadEffectFn loadEffect{};
    RunEffectFn runEffect{};
    CudaContextSynchronizeFn cudaSynchronize{};
    NvEffect effect{};
    NvImage* gpuInput{};
    NvImage* gpuOutput{};
    NvImage* transferScratch{};
    unsigned inputWidth{};
    unsigned inputHeight{};
    unsigned outputWidth{};
    unsigned outputHeight{};

    ~MaxineVsr() {
        if (cudaSynchronize) (void)cudaSynchronize();
        Trace("destroying VSR effect");
        if (effect && destroyEffect) destroyEffect(effect);
        Trace("deallocating VSR images");
        if (imageDealloc) {
            if (transferScratch) imageDealloc(transferScratch);
            if (gpuOutput) imageDealloc(gpuOutput);
            if (gpuInput) imageDealloc(gpuInput);
        }
        std::free(transferScratch);
        std::free(gpuOutput);
        std::free(gpuInput);
        Trace("unloading VSR libraries");
        if (featureModule) FreeLibrary(featureModule);
        if (effectsModule) FreeLibrary(effectsModule);
        if (imageModule) FreeLibrary(imageModule);
        if (cudaDriverModule) FreeLibrary(cudaDriverModule);
        Trace("VSR shutdown complete");
    }
};

std::unique_ptr<MaxineVsr> Create(
    const char* runtimePath, unsigned inputWidth, unsigned inputHeight,
    unsigned outputWidth, unsigned outputHeight, unsigned qualityMode) {
    if (inputWidth < 2 || inputHeight < 2 || outputWidth <= inputWidth ||
        outputHeight <= inputHeight) {
        throw std::runtime_error("Maxine VSR requires a valid enlarged output size");
    }
    auto instance = std::make_unique<MaxineVsr>();
    instance->runtimeUtf8 = runtimePath ? runtimePath : "";
    instance->runtime = Utf8ToWide(runtimePath);
    if (instance->runtime.empty()) {
        throw std::runtime_error("Maxine VSR runtime directory was not provided");
    }
    for (const auto* name : {L"NVCVImage.dll", L"NVVideoEffects.dll",
                              L"nvngxruntime.dll", L"nvVFXVideoSuperRes.dll",
                              L"nvngx_vsr.dll"}) {
        if (!std::filesystem::is_regular_file(instance->runtime / name)) {
            throw std::runtime_error(std::format(
                "Maxine VSR runtime is incomplete: missing {}",
                std::filesystem::path(name).string()));
        }
    }

    if (!SetDllDirectoryW(instance->runtime.c_str())) {
        throw std::runtime_error(std::format(
            "Unable to select Maxine runtime directory (Win32 error {})",
            GetLastError()));
    }
    // The feature must be loaded before the core effects module. This is the
    // ordering used by NVIDIA's working sample/backend and lets the feature
    // register its implementation before NvVFX_CreateEffect is resolved.
    instance->featureModule = LoadLibraryExW(
        (instance->runtime / L"nvVFXVideoSuperRes.dll").c_str(), nullptr,
        LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!instance->featureModule) {
        throw std::runtime_error(std::format(
            "Unable to load nvVFXVideoSuperRes.dll (Win32 error {})",
            GetLastError()));
    }
    instance->imageModule = LoadLibraryExW(
        (instance->runtime / L"NVCVImage.dll").c_str(), nullptr,
        LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!instance->imageModule) {
        throw std::runtime_error(std::format(
            "Unable to load NVCVImage.dll (Win32 error {})", GetLastError()));
    }
    instance->effectsModule = LoadLibraryExW(
        (instance->runtime / L"NVVideoEffects.dll").c_str(), nullptr,
        LOAD_WITH_ALTERED_SEARCH_PATH);
    if (!instance->effectsModule) {
        throw std::runtime_error(std::format(
            "Unable to load NVVideoEffects.dll (Win32 error {})", GetLastError()));
    }
    instance->cudaDriverModule = LoadLibraryW(L"nvcuda.dll");
    if (!instance->cudaDriverModule) {
        throw std::runtime_error(std::format(
            "Unable to load nvcuda.dll (Win32 error {})", GetLastError()));
    }

    instance->imageAlloc = Resolve<decltype(instance->imageAlloc)>(
        instance->imageModule, "NvCVImage_Alloc");
    instance->imageDealloc = Resolve<decltype(instance->imageDealloc)>(
        instance->imageModule, "NvCVImage_Dealloc");
    instance->imageInit = Resolve<decltype(instance->imageInit)>(
        instance->imageModule, "NvCVImage_Init");
    instance->imageTransfer = Resolve<decltype(instance->imageTransfer)>(
        instance->imageModule, "NvCVImage_Transfer");
    instance->errorString = Resolve<ErrorStringFn>(
        instance->imageModule, "NvCV_GetErrorStringFromCode");
    instance->createEffect = Resolve<decltype(instance->createEffect)>(
        instance->effectsModule, "NvVFX_CreateEffect");
    instance->destroyEffect = Resolve<decltype(instance->destroyEffect)>(
        instance->effectsModule, "NvVFX_DestroyEffect");
    instance->setImage = Resolve<decltype(instance->setImage)>(
        instance->effectsModule, "NvVFX_SetImage");
    instance->setCudaStream = Resolve<decltype(instance->setCudaStream)>(
        instance->effectsModule, "NvVFX_SetCudaStream");
    instance->setU32 = Resolve<decltype(instance->setU32)>(
        instance->effectsModule, "NvVFX_SetU32");
    instance->loadEffect = Resolve<decltype(instance->loadEffect)>(
        instance->effectsModule, "NvVFX_Load");
    instance->runEffect = Resolve<decltype(instance->runEffect)>(
        instance->effectsModule, "NvVFX_Run");
    instance->cudaSynchronize = Resolve<CudaContextSynchronizeFn>(
        instance->cudaDriverModule, "cuCtxSynchronize");

    instance->inputWidth = inputWidth;
    instance->inputHeight = inputHeight;
    instance->outputWidth = outputWidth;
    instance->outputHeight = outputHeight;
    instance->gpuInput = static_cast<NvImage*>(std::calloc(1, sizeof(NvImage)));
    instance->gpuOutput = static_cast<NvImage*>(std::calloc(1, sizeof(NvImage)));
    instance->transferScratch = static_cast<NvImage*>(std::calloc(1, sizeof(NvImage)));
    if (!instance->gpuInput || !instance->gpuOutput || !instance->transferScratch) {
        throw std::bad_alloc();
    }
    Trace("allocating CUDA images");
    CheckNv(instance->imageAlloc(instance->gpuInput, inputWidth, inputHeight,
                                 kNvBgra, kNvU8, kNvChunky, kNvGpu, 1),
            "Allocate Maxine VSR input", instance->errorString);
    CheckNv(instance->imageAlloc(instance->gpuOutput, outputWidth, outputHeight,
                                 kNvBgra, kNvU8, kNvChunky, kNvGpu, 1),
            "Allocate Maxine VSR output", instance->errorString);
    Trace("creating VSR effect");
    CheckNv(instance->createEffect(kVideoSuperResolution, &instance->effect),
            "Create Maxine Video Super Resolution effect", instance->errorString);
    CheckNv(instance->setImage(instance->effect, kInputImage,
                               instance->gpuInput),
            "Set Maxine VSR input image", instance->errorString);
    CheckNv(instance->setImage(instance->effect, kOutputImage,
                               instance->gpuOutput),
            "Set Maxine VSR output image", instance->errorString);
    CheckNv(instance->setCudaStream(instance->effect, kCudaStream, nullptr),
            "Set Maxine VSR CUDA stream", instance->errorString);
    CheckNv(instance->setU32(instance->effect, kQualityLevel, qualityMode),
            "Set Maxine VSR quality mode", instance->errorString);
    Trace("loading VSR model");
    CheckNv(instance->loadEffect(instance->effect), "Load Maxine VSR model",
            instance->errorString);
    Trace("VSR model ready");
    return instance;
}

void Process(MaxineVsr& instance, const std::uint8_t* input, int inputPitch,
             std::uint8_t* output, int outputPitch) {
    if (!input || !output || inputPitch < static_cast<int>(instance.inputWidth * 4) ||
        outputPitch < static_cast<int>(instance.outputWidth * 4)) {
        throw std::runtime_error("Maxine VSR received an invalid BGRA buffer");
    }
    auto freeImage = [](NvImage* image) { std::free(image); };
    std::unique_ptr<NvImage, decltype(freeImage)> cpuInput(
        static_cast<NvImage*>(std::calloc(1, sizeof(NvImage))), freeImage);
    std::unique_ptr<NvImage, decltype(freeImage)> cpuOutput(
        static_cast<NvImage*>(std::calloc(1, sizeof(NvImage))), freeImage);
    if (!cpuInput || !cpuOutput) throw std::bad_alloc();
    CheckNv(instance.imageInit(cpuInput.get(), instance.inputWidth,
                               instance.inputHeight,
                               inputPitch, const_cast<std::uint8_t*>(input),
                               kNvBgra, kNvU8, kNvChunky, kNvCpu),
            "Wrap Maxine VSR CPU input", instance.errorString);
    CheckNv(instance.imageInit(cpuOutput.get(), instance.outputWidth,
                               instance.outputHeight, outputPitch, output,
                               kNvBgra, kNvU8, kNvChunky, kNvCpu),
            "Wrap Maxine VSR CPU output", instance.errorString);
    Trace("uploading ROI");
    CheckNv(instance.imageTransfer(cpuInput.get(), instance.gpuInput, 1.0f,
                                   nullptr, instance.transferScratch),
            "Upload Maxine VSR input", instance.errorString);
    Trace("running VSR");
    CheckNv(instance.runEffect(instance.effect, 0), "Run Maxine VSR",
            instance.errorString);
    Trace("downloading ROI");
    CheckNv(instance.imageTransfer(instance.gpuOutput, cpuOutput.get(), 1.0f,
                                   nullptr, instance.transferScratch),
            "Download Maxine VSR output", instance.errorString);
    const int synchronizeStatus = instance.cudaSynchronize();
    if (synchronizeStatus != 0) {
        throw std::runtime_error(std::format(
            "Synchronize Maxine VSR CUDA context failed with status {}",
            synchronizeStatus));
    }
    Trace("ROI complete");
}

} // namespace

extern "C" {

__declspec(dllexport) void* animocap_maxine_vsr_create(
    const char* runtimePath, unsigned inputWidth, unsigned inputHeight,
    unsigned outputWidth, unsigned outputHeight, unsigned qualityMode,
    char* error, std::size_t errorCapacity) noexcept {
    try {
        return Create(runtimePath, inputWidth, inputHeight, outputWidth,
                      outputHeight, qualityMode).release();
    } catch (const std::exception& exception) {
        CopyError(error, errorCapacity, exception.what());
        return nullptr;
    }
}

__declspec(dllexport) int animocap_maxine_vsr_process(
    void* handle, const std::uint8_t* input, int inputPitch,
    std::uint8_t* output, int outputPitch, char* error,
    std::size_t errorCapacity) noexcept {
    try {
        if (!handle) throw std::runtime_error("Maxine VSR handle is null");
        Process(*static_cast<MaxineVsr*>(handle), input, inputPitch, output,
                outputPitch);
        return 0;
    } catch (const std::exception& exception) {
        CopyError(error, errorCapacity, exception.what());
        return -1;
    }
}

__declspec(dllexport) void animocap_maxine_vsr_destroy(void* handle) noexcept {
    // NvVFX_DestroyEffect in the 1.2 CPU-buffer path can block indefinitely
    // after a successful run. AniMocap deliberately owns this bridge at the
    // short-lived MMPose worker-process boundary, so the OS reclaims the CUDA
    // context and allocations when that worker exits. Do not call the blocking
    // SDK destructor here.
    (void)handle;
}

}
