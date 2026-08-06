#include "animocap/math.hpp"
#include "animocap/contracts.hpp"
#include "animocap/multiview.hpp"
#include "animocap/package.hpp"
#include "animocap/pose_sequence.hpp"
#include "animocap/video.hpp"

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <windowsx.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cwctype>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace {
constexpr wchar_t kWindowClass[] = L"AniMocapFusionWindow";
constexpr UINT kTimerPlayback = 1;
constexpr UINT kAnalysisDone = WM_APP + 1;
constexpr int kImport = 101, kAnalyze = 102, kLoad = 103, kPlay = 104;
constexpr int kTimeline = 105, kStatus = 106, kProgress = 107, kSetup = 108;
constexpr int kCalibrate = 109, kPersonFrame = 110;
constexpr int kAutoFrame = 111, kResetFrame = 112, kVlmToggle = 113, kVlmSetup = 114;
constexpr int kMultiview = 115;
constexpr int kHeader = 58, kSteps = 58, kScopeBar = 54, kTimelineHeight = 224;
constexpr int kPadding = 18;
constexpr double kPi = 3.14159265358979323846;

struct AnalysisResult {
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::MultiviewDiagnostics> diagnostics;
    std::filesystem::path motion_path;
    std::wstring error, warning;
};
struct AppState {
    HWND window{}, timeline{}, status{}, progress{}, play{};
    std::filesystem::path root, video_path, motion_path;
    std::array<std::filesystem::path,4> multiview_videos{};
    std::unique_ptr<animocap::VideoDecoder> decoder;
    animocap::VideoFrame video_frame;
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::MultiviewDiagnostics> multiview_diagnostics;
    bool playing{}, analyzing{}, rotating{}, calibrating{}, scrubbing{};
    bool has_person_frame{}, selecting_person_frame{}, drawing_person_frame{};
    bool auto_person_frame{true}, manual_person_frame{}, vlm_enabled{true};
    bool multiview_mode{};
    int dragging_anchor{-1};
    RECT person_frame{};
    POINT frame_start{}, frame_current{};
    double time_s{}, yaw{28.0}, pitch{-8.0};
    POINT last_mouse{};
    std::jthread worker;
    HFONT font{}, title_font{};
    HBRUSH panel_brush{};
} app;

std::wstring widen(const std::string& value) {
    if (value.empty()) return {};
    int size = MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), nullptr, 0);
    std::wstring result(static_cast<std::size_t>(size), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(), size);
    return result;
}
std::wstring quote(const std::filesystem::path& path) { return L"\"" + path.wstring() + L"\""; }
void set_status(const std::wstring& value) { SetWindowTextW(app.status, value.c_str()); }

std::filesystem::path find_root() {
    std::wstring value(32768, L'\0');
    value.resize(GetModuleFileNameW(nullptr, value.data(), static_cast<DWORD>(value.size())));
    auto root = std::filesystem::path(value).parent_path();
    for (int i = 0; i < 5; ++i, root = root.parent_path())
        if (std::filesystem::exists(root / "python/animocap_ml_adapters/mmpose_adapter.py")) return root;
    return std::filesystem::current_path();
}
void enable_dark_title_bar(HWND window) {
    HMODULE library=LoadLibraryW(L"dwmapi.dll");
    if (!library) return;
    using SetAttribute=HRESULT(WINAPI*)(HWND,DWORD,LPCVOID,DWORD);
    auto set_attribute=reinterpret_cast<SetAttribute>(
        GetProcAddress(library,"DwmSetWindowAttribute"));
    if (set_attribute) {
        const BOOL enabled=TRUE;
        set_attribute(window,20,&enabled,sizeof(enabled));
    }
    FreeLibrary(library);
}
std::optional<std::filesystem::path> choose(bool folder, const wchar_t* title) {
    IFileOpenDialog* dialog{};
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog)))) return std::nullopt;
    dialog->SetTitle(title);
    if (folder) {
        DWORD options{};
        dialog->GetOptions(&options);
        dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    } else {
        const COMDLG_FILTERSPEC filters[] = {
            {L"\u89c6\u9891\u6587\u4ef6", L"*.mp4;*.mov;*.avi;*.mkv;*.webm;*.m4v"}, {L"\u6240\u6709\u6587\u4ef6", L"*.*"}};
        dialog->SetFileTypes(2, filters);
    }
    std::optional<std::filesystem::path> result;
    if (SUCCEEDED(dialog->Show(app.window))) {
        IShellItem* item{};
        if (SUCCEEDED(dialog->GetResult(&item))) {
            PWSTR path{};
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path))) {
                result = std::filesystem::path(path);
                CoTaskMemFree(path);
            }
            item->Release();
        }
    }
    dialog->Release();
    return result;
}
RECT canvas_rect() {
    RECT client{}; GetClientRect(app.window, &client);
    return {kPadding, kHeader + kSteps + kScopeBar,
            client.right - kPadding, client.bottom - kTimelineHeight};
}
int workspace_split() {
    RECT canvas=canvas_rect();
    return canvas.left+static_cast<int>((canvas.right-canvas.left)*.66);
}
RECT video_area() {
    RECT canvas=canvas_rect();
    return {canvas.left,canvas.top,workspace_split()-7,canvas.bottom};
}
RECT motion_area() {
    RECT canvas=canvas_rect();
    int split=workspace_split();
    int right_height=canvas.bottom-canvas.top;
    return {split+7,canvas.top,canvas.right,
            canvas.top+static_cast<int>(right_height*.58)};
}
RECT issues_area() {
    RECT canvas=canvas_rect();
    RECT motion=motion_area();
    return {motion.left,motion.bottom+10,canvas.right,canvas.bottom};
}
RECT timeline_area() {
    RECT client{}; GetClientRect(app.window,&client);
    return {kPadding,client.bottom-kTimelineHeight+12,
            client.right-kPadding,client.bottom-46};
}
RECT video_source_rect() {
    if (app.has_person_frame) return app.person_frame;
    return {0,0,static_cast<LONG>(app.video_frame.width),
           static_cast<LONG>(app.video_frame.height)};
}
RECT video_destination(RECT area) {
    if (app.video_frame.width==0 || app.video_frame.height==0) return area;
    RECT source=video_source_rect();
    double source_aspect=static_cast<double>(source.right-source.left)/
                         std::max<LONG>(1,source.bottom-source.top);
    double target_aspect=static_cast<double>(area.right-area.left)/(area.bottom-area.top);
    RECT destination=area;
    if (source_aspect>target_aspect) {
        int height=static_cast<int>((area.right-area.left)/source_aspect);
        destination.top+=((area.bottom-area.top)-height)/2;
        destination.bottom=destination.top+height;
    } else {
        int width=static_cast<int>((area.bottom-area.top)*source_aspect);
        destination.left+=((area.right-area.left)-width)/2;
        destination.right=destination.left+width;
    }
    return destination;
}
void update_timeline() {
    if (!app.decoder || !app.decoder->is_open()) return;
    double duration = std::max(0.001, app.decoder->info().duration_s);
    SendMessageW(app.timeline, TBM_SETPOS, TRUE,
                 static_cast<int>(std::clamp(app.time_s / duration * 10000.0, 0.0, 10000.0)));
}
void stop_playback(const std::wstring& status = {}) {
    app.playing=false;
    KillTimer(app.window,kTimerPlayback);
    if (app.play) SetWindowTextW(app.play,L"播放");
    if (!status.empty()) set_status(status);
}
void decode_at(double time_s) {
    if (!app.decoder || !app.decoder->is_open()) return;
    try {
        app.decoder->seek(time_s);
        if (app.decoder->read_frame(app.video_frame)) {
            app.time_s=app.video_frame.time_s;
            update_timeline();
            InvalidateRect(app.window,nullptr,FALSE);
        }
    } catch (const std::exception& error) {
        stop_playback(L"视频定位失败 · " + widen(error.what()));
    }
}
bool seek_from_timeline(POINT point) {
    if (!app.decoder || !app.decoder->is_open()) return false;
    RECT area=timeline_area();
    RECT track{area.left+104,area.top+146,area.right-12,area.bottom-8};
    if (point.x<track.left || point.x>track.right ||
        point.y<track.top || point.y>track.bottom) return false;
    const double ratio=static_cast<double>(point.x-track.left)/
        std::max<LONG>(1,track.right-track.left);
    decode_at(app.decoder->info().duration_s*std::clamp(ratio,0.0,1.0));
    return true;
}
void open_video(const std::filesystem::path& path) {
    try {
        auto decoder = std::make_unique<animocap::VideoDecoder>();
        decoder->open(path);
        animocap::VideoFrame frame;
        if (!decoder->read_frame(frame)) throw std::runtime_error("video contains no decodable frames");
        app.video_path = path;
        app.decoder = std::move(decoder);
        app.video_frame = std::move(frame);
        app.time_s = app.video_frame.time_s;
        app.pose.reset(); app.motion.reset(); app.multiview_diagnostics.reset();
        app.multiview_mode=false; app.multiview_videos={};
        app.has_person_frame=false; app.auto_person_frame=true; app.manual_person_frame=false;
        app.selecting_person_frame=false;
        app.drawing_person_frame=false;
        EnableWindow(GetDlgItem(app.window,kPersonFrame),TRUE);
        EnableWindow(GetDlgItem(app.window,kResetFrame),TRUE);
        const auto& info = app.decoder->info();
        set_status(L"\u89c6\u9891\u5df2\u5bfc\u5165 \u00b7 " + std::to_wstring(info.width) + L"\u00d7" +
                   std::to_wstring(info.height) + L" \u00b7 " +
                   std::to_wstring(static_cast<int>(std::round(info.fps))) + L" FPS");
        update_timeline();
        InvalidateRect(app.window, nullptr, TRUE);
    } catch (const std::exception& error) {
        MessageBoxW(app.window, widen(error.what()).c_str(), L"\u89c6\u9891\u5bfc\u5165\u5931\u8d25", MB_ICONERROR);
    }
}
void import_video() {
    auto path = choose(false, L"\u5bfc\u5165\u52a8\u4f5c\u89c6\u9891");
    if (!path) return;
    open_video(*path);
}
int run_hidden(const std::wstring& command, const std::filesystem::path& directory) {
    std::vector<wchar_t> buffer(command.begin(), command.end()); buffer.push_back(L'\0');
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(nullptr, buffer.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW,
                        nullptr, directory.c_str(), &startup, &process))
        throw std::runtime_error("cannot start Python inference process");
    WaitForSingleObject(process.hProcess, INFINITE);
    DWORD code{}; GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    return static_cast<int>(code);
}
bool load_multiview_folder(const std::filesystem::path& folder) {
    const std::array<std::vector<std::wstring>,4> aliases{{
        {L"front",L"正面"},{L"right",L"右侧"},
        {L"back",L"背面"},{L"left",L"左侧"}
    }};
    const std::array<std::wstring,4> labels{L"正面 front",L"右侧 right",L"背面 back",L"左侧 left"};
    const std::array<std::wstring,6> extensions{L".mp4",L".mov",L".avi",L".mkv",L".webm",L".m4v"};
    std::array<std::vector<std::filesystem::path>,4> matches;
    for(const auto& entry:std::filesystem::directory_iterator(folder)) {
        if(!entry.is_regular_file())continue;
        std::wstring extension=entry.path().extension().wstring();
        std::transform(extension.begin(),extension.end(),extension.begin(),::towlower);
        if(std::find(extensions.begin(),extensions.end(),extension)==extensions.end())continue;
        std::wstring stem=entry.path().stem().wstring();
        std::transform(stem.begin(),stem.end(),stem.begin(),::towlower);
        for(std::size_t direction=0;direction<aliases.size();++direction)
            for(const auto& alias:aliases[direction])
                if(stem.find(alias)!=std::wstring::npos) {
                    matches[direction].push_back(entry.path()); break;
                }
    }
    for(std::size_t direction=0;direction<matches.size();++direction) {
        if(matches[direction].size()!=1) {
            MessageBoxW(app.window,
                (L"无法唯一识别“"+labels[direction]+L"”视频。\n"
                 L"请将四个文件分别命名为 front、right、back、left（扩展名不限）。").c_str(),
                L"四视角导入失败",MB_ICONWARNING);
            return false;
        }
    }
    std::array<std::filesystem::path,4> videos{
        matches[0][0],matches[1][0],matches[2][0],matches[3][0]};
    open_video(videos[0]);
    if(!app.decoder||!app.decoder->is_open())return false;
    app.multiview_videos=std::move(videos);
    app.multiview_mode=true;
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    set_status(L"四视角已导入 · 正面 / 右侧 / 背面 / 左侧 · 将自动相位对齐并联合求解");
    InvalidateRect(app.window,nullptr,TRUE);
    return true;
}
void import_multiview_folder() {
    auto folder=choose(true,L"选择包含 front、right、back、left 四段视频的文件夹");
    if(folder)load_multiview_folder(*folder);
}
std::filesystem::path unique_output() {
    auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return app.root / "outputs" / (app.video_path.stem().wstring() + L"-" + std::to_wstring(stamp));
}
void start_analysis() {
    if (app.analyzing) return;
    if (app.video_path.empty()) {
        MessageBoxW(app.window,L"请先导入一个视频。",L"AniMocap Fusion",MB_ICONINFORMATION);
        return;
    }
    if (app.selecting_person_frame || app.drawing_person_frame) {
        MessageBoxW(app.window,L"请先完成手动框选，再开始捕捉。",L"人物范围尚未完成",MB_ICONINFORMATION);
        return;
    }
    app.analyzing=true;
    EnableWindow(GetDlgItem(app.window,kAnalyze),FALSE);
    EnableWindow(GetDlgItem(app.window,kAutoFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kImport),FALSE);
    EnableWindow(GetDlgItem(app.window,kMultiview),FALSE);
    SendMessageW(app.progress,PBM_SETMARQUEE,TRUE,35);
    ShowWindow(app.progress,SW_SHOW);
    if (app.multiview_mode) {
        set_status(L"四视角捕捉 · 正在逐视角提取关节，随后自动相位对齐并联合求解…");
    } else if (app.manual_person_frame && app.has_person_frame) {
        set_status(L"正在严格使用手动框捕捉 · x="+
            std::to_wstring(app.person_frame.left)+L" y="+
            std::to_wstring(app.person_frame.top)+L" w="+
            std::to_wstring(app.person_frame.right-app.person_frame.left)+L" h="+
            std::to_wstring(app.person_frame.bottom-app.person_frame.top));
    } else {
        set_status(app.vlm_enabled
            ? L"正在执行 HRNet → 光流 → 本地视觉纠错…"
            : L"正在执行 HRNet → 光流动作捕捉…");
    }
    auto video=app.video_path,root=app.root,output=unique_output();
    const bool has_person_frame=app.manual_person_frame && app.has_person_frame;
    const RECT person_frame=app.person_frame;
    const bool use_vlm=app.vlm_enabled;
    const bool multiview_mode=app.multiview_mode;
    const auto multiview_videos=app.multiview_videos;
    const double capture_fps=app.decoder ? app.decoder->info().fps : 30.0;
    HWND window=app.window;
    app.worker=std::jthread([video,root,output,window,has_person_frame,
                             person_frame,use_vlm,multiview_mode,
                             multiview_videos,capture_fps]() {
        auto result=std::make_unique<AnalysisResult>();
        try {
            std::filesystem::create_directories(output);
            auto python=root/".venv-mmpose/Scripts/python.exe";
            if(!std::filesystem::exists(python))python=L"python.exe";
            if(multiview_mode) {
                animocap::CaptureManifest manifest;
                manifest.mode=animocap::CaptureMode::DirectionalRepeat;
                manifest.fps=capture_fps;
                manifest.output_directory=output.generic_string();
                const std::array<std::string,4> ids{"front","right","back","left"};
                const std::array<double,4> yaws{0.0,90.0,180.0,-90.0};
                for(std::size_t index=0;index<ids.size();++index)
                    manifest.views.push_back({
                        ids[index],multiview_videos[index].generic_string(),yaws[index]});
                auto manifest_path=output/"capture.multiview.json";
                animocap::save_capture_manifest(manifest,manifest_path);
                auto pipeline=root/"python/animocap_ml_adapters/multiview_pipeline.py";
                std::wstring command=quote(python)+L" "+quote(pipeline)+
                    L" --manifest "+quote(manifest_path)+L" --output "+quote(output);
                if(!use_vlm)command+=L" --no-vlm";
                if(run_hidden(command,root)!=0)
                    throw std::runtime_error(
                        "multiview pipeline failed; intermediate per-view poses were preserved");
                result->pose=animocap::load_pose_sequence_json(
                    output/"fused_pose_sequence.json");
                result->motion_path=output/"motion.amotion";
                result->motion=animocap::load_motion_package(result->motion_path);
                result->diagnostics=animocap::load_multiview_diagnostics(
                    output/"multiview-diagnostics.json");
            } else {
                auto adapter=root/"python/animocap_ml_adapters/mmpose_adapter.py";
                auto observations=output/"pose_sequence.json";
            std::wstring command=quote(python)+L" "+quote(adapter)+
                L" --input "+quote(video)+L" --output "+quote(observations);
            if(has_person_frame) {
                command+=L" --roi "+std::to_wstring(person_frame.left)+L" "+
                    std::to_wstring(person_frame.top)+L" "+
                    std::to_wstring(person_frame.right-person_frame.left)+L" "+
                    std::to_wstring(person_frame.bottom-person_frame.top);
            }
            if(run_hidden(command,root)!=0)
                throw std::runtime_error(
                    "MMPose inference failed. Run tools/setup_mmpose.ps1.");

            auto final_observations=observations;
            if(use_vlm) {
                auto vlm_adapter=
                    root/"python/animocap_ml_adapters/local_vlm_adapter.py";
                auto corrected=output/"pose_sequence-vlm.json";
                auto issues=output/"visual-recovery-issues.json";
                std::wstring vlm_command=quote(python)+L" "+quote(vlm_adapter)+
                    L" --input-video "+quote(video)+L" --input-pose "+
                    quote(observations)+L" --output-pose "+quote(corrected)+
                    L" --issues-output "+quote(issues)+
                    L" --model qwen3-vl:4b";
                if(has_person_frame) {
                    vlm_command+=L" --roi "+std::to_wstring(person_frame.left)+L" "+
                        std::to_wstring(person_frame.top)+L" "+
                        std::to_wstring(person_frame.right-person_frame.left)+L" "+
                        std::to_wstring(person_frame.bottom-person_frame.top);
                }
                if(run_hidden(vlm_command,root)==0 &&
                    std::filesystem::exists(corrected))
                    final_observations=corrected;
                else
                    result->warning=
                        L"本地视觉纠错未运行；已保留 HRNet + 光流结果。请配置 Qwen3-VL。";
            }
            result->pose=animocap::smooth_pose_sequence(
                animocap::load_pose_sequence_json(final_observations));
            result->motion=animocap::reconstruct_canonical_motion(*result->pose);
            result->motion_path=output/"motion.amotion";
            animocap::save_motion_package(*result->motion,result->motion_path);
            }
        } catch(const std::exception& error) {
            result->error=widen(error.what());
        }
        PostMessageW(window,kAnalysisDone,0,
            reinterpret_cast<LPARAM>(result.release()));
    });
}void setup_mmpose() {
    auto script = app.root / "tools/setup_mmpose.ps1";
    std::wstring args = L"-NoExit -ExecutionPolicy Bypass -File " + quote(script);
    if (reinterpret_cast<INT_PTR>(ShellExecuteW(app.window, L"open", L"powershell.exe",
        args.c_str(), app.root.c_str(), SW_SHOWNORMAL)) <= 32)
        MessageBoxW(app.window, L"\u65e0\u6cd5\u542f\u52a8\u5b89\u88c5\u811a\u672c\u3002", L"\u5b89\u88c5\u5931\u8d25", MB_ICONERROR);
}
void setup_local_vlm() {
    auto script=app.root/"tools/setup_local_vlm.ps1";
    std::wstring args=L"-NoExit -ExecutionPolicy Bypass -File "+quote(script);
    if(reinterpret_cast<INT_PTR>(ShellExecuteW(app.window,L"open",L"powershell.exe",
        args.c_str(),app.root.c_str(),SW_SHOWNORMAL))<=32)
        MessageBoxW(app.window,L"无法启动本地视觉模型安装脚本。",
                    L"安装失败",MB_ICONERROR);
}
void toggle_local_vlm() {
    app.vlm_enabled=!app.vlm_enabled;
    SetWindowTextW(GetDlgItem(app.window,kVlmToggle),
        app.vlm_enabled?L"本地视觉纠错 · 开":L"本地视觉纠错 · 关");
    set_status(app.vlm_enabled
        ? L"本地视觉纠错已启用 · 只检查低置信度、遮挡和左右肢体歧义"
        : L"本地视觉纠错已关闭 · 捕捉仅使用 HRNet、光流和时序平滑");
    InvalidateRect(app.window,nullptr,FALSE);
}
void load_motion() {
    auto path = choose(true, L"\u9009\u62e9 motion.amotion \u6587\u4ef6\u5939");
    if (!path) return;
    try {
        app.motion = animocap::load_motion_package(*path);
        app.motion_path = *path;
        app.time_s = app.motion->motion.time_s.front();
        set_status(L"\u52a8\u4f5c\u5df2\u52a0\u8f7d \u00b7 " + std::to_wstring(app.motion->motion.frame_count) + L" \u5e27");
        InvalidateRect(app.window, nullptr, TRUE);
    } catch (const std::exception& error) {
        MessageBoxW(app.window, widen(error.what()).c_str(), L"\u52a8\u4f5c\u52a0\u8f7d\u5931\u8d25", MB_ICONERROR);
    }
}

std::size_t pose_frame() {
    if (!app.pose || app.pose->frames.empty()) return 0;
    const auto& frames = app.pose->frames;
    auto found = std::lower_bound(frames.begin(), frames.end(), app.time_s,
        [](const animocap::ObservedPoseFrame& frame, double time) { return frame.time_s < time; });
    if (found == frames.end()) return frames.size() - 1;
    if (found == frames.begin()) return 0;
    std::size_t after = static_cast<std::size_t>(found - frames.begin()), before = after - 1;
    return std::abs(frames[before].time_s - app.time_s) <
           std::abs(frames[after].time_s - app.time_s) ? before : after;
}
std::size_t motion_frame() {
    if (!app.motion || app.motion->motion.time_s.empty()) return 0;
    const auto& times = app.motion->motion.time_s;
    auto found = std::lower_bound(times.begin(), times.end(), app.time_s);
    if (found == times.end()) return times.size() - 1;
    if (found == times.begin()) return 0;
    std::size_t after = static_cast<std::size_t>(found - times.begin()), before = after - 1;
    return std::abs(times[before] - app.time_s) < std::abs(times[after] - app.time_s) ? before : after;
}
void fill(HDC dc, RECT rect, COLORREF color) {
    HBRUSH brush = CreateSolidBrush(color); FillRect(dc, &rect, brush); DeleteObject(brush);
}
void text(HDC dc, const std::wstring& value, RECT rect, COLORREF color, HFONT font,
          UINT flags = DT_LEFT | DT_VCENTER | DT_SINGLELINE) {
    SetBkMode(dc, TRANSPARENT); SetTextColor(dc, color); SelectObject(dc, font);
    DrawTextW(dc, value.c_str(), -1, &rect, flags);
}
void draw_person_frame_selection(HDC dc) {
    if (!app.drawing_person_frame) return;
    RECT box{
        std::min(app.frame_start.x,app.frame_current.x),
        std::min(app.frame_start.y,app.frame_current.y),
        std::max(app.frame_start.x,app.frame_current.x),
        std::max(app.frame_start.y,app.frame_current.y)
    };
    HPEN pen=CreatePen(PS_DASH,2,RGB(255,210,82));
    auto old_pen=SelectObject(dc,pen);
    auto old_brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
    Rectangle(dc,box.left,box.top,box.right,box.bottom);
    SelectObject(dc,old_brush);
    SelectObject(dc,old_pen);
    DeleteObject(pen);
}
void draw_video(HDC dc, RECT area) {
    fill(dc, area, RGB(12, 15, 22));
    if (app.video_frame.bgra.empty()) {
        text(dc, L"\u5bfc\u5165\u89c6\u9891\u540e\u53ef\u5728\u6b64\u67e5\u770b\u539f\u59cb\u753b\u9762\u4e0e 2D \u5173\u952e\u70b9", area,
             RGB(116,126,148), app.font, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
        return;
    }
    RECT destination=video_destination(area);
    RECT source=video_source_rect();
    BITMAPINFO bitmap{}; bitmap.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
    bitmap.bmiHeader.biWidth = static_cast<LONG>(app.video_frame.width);
    bitmap.bmiHeader.biHeight = -static_cast<LONG>(app.video_frame.height);
    bitmap.bmiHeader.biPlanes = 1; bitmap.bmiHeader.biBitCount = 32;
    bitmap.bmiHeader.biCompression = BI_RGB;
    POINT old_origin{};
    int old_stretch_mode=SetStretchBltMode(dc,HALFTONE);
    SetBrushOrgEx(dc,destination.left,destination.top,&old_origin);
    StretchDIBits(dc, destination.left, destination.top, destination.right-destination.left,
        destination.bottom-destination.top, source.left, source.top,
        source.right-source.left, source.bottom-source.top, app.video_frame.bgra.data(),
        &bitmap, DIB_RGB_COLORS, SRCCOPY);
    SetBrushOrgEx(dc,old_origin.x,old_origin.y,nullptr);
    SetStretchBltMode(dc,old_stretch_mode);
    draw_person_frame_selection(dc);
    if (!app.pose) return;
    int saved_dc=SaveDC(dc);
    IntersectClipRect(dc,destination.left,destination.top,destination.right,destination.bottom);
    const auto& frame = app.pose->frames[pose_frame()];
    auto skeleton = animocap::make_default_skeleton();
    double sx = static_cast<double>(destination.right-destination.left)/(source.right-source.left);
    double sy = static_cast<double>(destination.bottom-destination.top)/(source.bottom-source.top);
    auto point = [&](std::size_t i) {
        auto value = frame.joints[i].image_xy;
        return POINT{destination.left + static_cast<LONG>(std::lround((value.x-source.left)*sx)),
                     destination.top + static_cast<LONG>(std::lround((value.y-source.top)*sy))};
    };
    HPEN pen = CreatePen(PS_SOLID, 3, RGB(90,232,192));
    auto old_pen=SelectObject(dc,pen);
    for (std::size_t i=1; i<skeleton.bones.size(); ++i) {
        auto parent = static_cast<std::size_t>(skeleton.bones[i].parent);
        if (!frame.joints[i].valid || !frame.joints[parent].valid) continue;
        auto a=point(parent), b=point(i); MoveToEx(dc,a.x,a.y,nullptr); LineTo(dc,b.x,b.y);
    }
    SelectObject(dc,old_pen); DeleteObject(pen);
    for (std::size_t i=0; i<skeleton.bones.size(); ++i) {
        if (!frame.joints[i].valid) continue;
        auto p=point(i); float confidence=frame.joints[i].confidence;
        COLORREF color = confidence>=.65f ? RGB(66,231,178) :
                         confidence>=.3f ? RGB(255,194,92) : RGB(255,102,121);
        int radius=app.calibrating ? 7 : 4;
        if (app.dragging_anchor==static_cast<int>(i)) color=RGB(255,255,255);
        HBRUSH brush=CreateSolidBrush(color); auto old=SelectObject(dc,brush);
        Ellipse(dc,p.x-radius,p.y-radius,p.x+radius+1,p.y+radius+1);
        SelectObject(dc,old); DeleteObject(brush);
    }
    RestoreDC(dc,saved_dc);
}
animocap::Vec2 project(const animocap::Vec3& value, RECT area) {
    double yaw=app.yaw*kPi/180.0, pitch=app.pitch*kPi/180.0;
    double cy=std::cos(yaw), sy=std::sin(yaw), cp=std::cos(pitch), sp=std::sin(pitch);
    double x=cy*value.x+sy*value.z, z=-sy*value.x+cy*value.z;
    double y=cp*value.y-sp*z, scale=static_cast<double>(area.bottom-area.top)/2.05;
    return {(area.left+area.right)*.5+x*scale, area.bottom-24.0-y*scale};
}
void draw_motion(HDC dc, RECT area) {
    fill(dc, area, RGB(18,22,31));
    RECT label=area; label.left+=18; label.top+=8; label.bottom=label.top+28;
    text(dc,app.pose ? L"OBSERVED 2.5D" : L"CANONICAL 3D",
         label,RGB(132,146,174),app.font);
    if (!app.motion && !app.pose) {
        text(dc,L"\u5b8c\u6210\u6355\u6349\u6216\u52a0\u8f7d\u52a8\u4f5c\u540e\u663e\u793a 3D \u9aa8\u67b6",area,RGB(116,126,148),app.font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        return;
    }
    animocap::Skeleton skeleton;
    std::vector<animocap::Vec3> positions;
    std::vector<float> confidences;
    if (app.pose) {
        skeleton=animocap::make_default_skeleton();
        const auto& observed=app.pose->frames[pose_frame()];
        positions.reserve(observed.joints.size());
        confidences.reserve(observed.joints.size());
        for (const auto& joint : observed.joints) {
            positions.push_back(joint.position_m);
            confidences.push_back(joint.confidence);
        }
    } else {
        const std::size_t frame=motion_frame();
        const auto& motion=app.motion->motion;
        skeleton=app.motion->skeleton;
        auto begin=motion.local_rotations.begin()+
            static_cast<std::ptrdiff_t>(frame*motion.joint_count);
        std::vector<animocap::Quat> rotations(
            begin,begin+static_cast<std::ptrdiff_t>(motion.joint_count));
        auto fk=animocap::forward_kinematics(
            skeleton,rotations,motion.scene_root_translation_m[frame],
            motion.hips_translation_m[frame]);
        positions=std::move(fk.positions_m);
        auto confidence_begin=motion.confidence.begin()+
            static_cast<std::ptrdiff_t>(frame*motion.joint_count);
        confidences.assign(confidence_begin,
            confidence_begin+static_cast<std::ptrdiff_t>(motion.joint_count));
    }
    HPEN grid=CreatePen(PS_SOLID,1,RGB(37,44,58));
    auto old_pen=SelectObject(dc,grid);
    int ground=static_cast<int>(project({0,0,0},area).y);
    MoveToEx(dc,area.left+28,ground,nullptr); LineTo(dc,area.right-28,ground);
    SelectObject(dc,old_pen); DeleteObject(grid);
    HPEN shadow=CreatePen(PS_SOLID,7,RGB(27,31,42)), bone=CreatePen(PS_SOLID,3,RGB(123,111,255));
    old_pen=SelectObject(dc,shadow);
    for (std::size_t i=1;i<skeleton.bones.size();++i) {
        auto parent=static_cast<std::size_t>(skeleton.bones[i].parent);
        auto a=project(positions[parent],area), b=project(positions[i],area);
        SelectObject(dc,shadow); MoveToEx(dc,static_cast<int>(a.x),static_cast<int>(a.y),nullptr);
        LineTo(dc,static_cast<int>(b.x),static_cast<int>(b.y));
        SelectObject(dc,bone); MoveToEx(dc,static_cast<int>(a.x),static_cast<int>(a.y),nullptr);
        LineTo(dc,static_cast<int>(b.x),static_cast<int>(b.y));
    }
    SelectObject(dc,old_pen); DeleteObject(shadow); DeleteObject(bone);
    for (std::size_t i=0;i<positions.size();++i) {
        auto p=project(positions[i],area);
        float confidence=confidences[i];
        COLORREF color=confidence>=.65f?RGB(100,239,195):confidence>=.3f?RGB(255,194,92):RGB(255,102,121);
        HBRUSH brush=CreateSolidBrush(color); auto old=SelectObject(dc,brush);
        Ellipse(dc,static_cast<int>(p.x)-4,static_cast<int>(p.y)-4,
                static_cast<int>(p.x)+5,static_cast<int>(p.y)+5);
        SelectObject(dc,old); DeleteObject(brush);
    }
    RECT hint=area; hint.left+=18; hint.top=hint.bottom-34;
    text(dc,L"\u62d6\u52a8\u65cb\u8f6c\u89c6\u89d2",hint,RGB(91,103,128),app.font);
}
std::wstring issue_joint_name(animocap::BoneSemantic semantic) {
    using S=animocap::BoneSemantic;
    switch(semantic) {
    case S::LeftUpperArm: return L"左上臂";
    case S::LeftLowerArm: return L"左前臂";
    case S::LeftHand: return L"左手";
    case S::RightUpperArm: return L"右上臂";
    case S::RightLowerArm: return L"右前臂";
    case S::RightHand: return L"右手";
    case S::LeftUpperLeg: return L"左大腿";
    case S::LeftLowerLeg: return L"左小腿";
    case S::LeftFoot: return L"左脚";
    case S::RightUpperLeg: return L"右大腿";
    case S::RightLowerLeg: return L"右小腿";
    case S::RightFoot: return L"右脚";
    default: return L"人体关节";
    }
}
bool is_limb(animocap::BoneSemantic semantic) {
    using S=animocap::BoneSemantic;
    return semantic==S::LeftUpperArm||semantic==S::LeftLowerArm||
        semantic==S::LeftHand||semantic==S::RightUpperArm||
        semantic==S::RightLowerArm||semantic==S::RightHand||
        semantic==S::LeftUpperLeg||semantic==S::LeftLowerLeg||
        semantic==S::LeftFoot||semantic==S::RightUpperLeg||
        semantic==S::RightLowerLeg||semantic==S::RightFoot;
}
void draw_steps(HDC dc,RECT area) {
    fill(dc,area,RGB(13,17,24));
    const wchar_t* labels[]={L"视频",L"人物",L"捕捉",L"检查",L"导出"};
    int active=0;
    if(app.decoder&&app.decoder->is_open())active=1;
    if(app.analyzing)active=2;
    else if(app.pose)active=3;
    else if(app.decoder&&app.decoder->is_open())active=2;
    if(app.motion&&app.pose)active=4;
    const int usable=area.right-area.left-120;
    HPEN line=CreatePen(PS_SOLID,1,RGB(48,57,73));
    auto old_pen=SelectObject(dc,line);
    MoveToEx(dc,area.left+60,area.top+27,nullptr);
    LineTo(dc,area.left+60+usable,area.top+27);
    SelectObject(dc,old_pen); DeleteObject(line);
    for(int index=0;index<5;++index) {
        int x=area.left+60+usable*index/4;
        COLORREF color=index<=active?RGB(65,218,226):RGB(104,116,139);
        HBRUSH brush=CreateSolidBrush(index==active?RGB(25,95,112):RGB(18,23,32));
        auto old_brush=SelectObject(dc,brush);
        HPEN pen=CreatePen(PS_SOLID,1,color); old_pen=SelectObject(dc,pen);
        Ellipse(dc,x-14,area.top+13,x+15,area.top+42);
        SelectObject(dc,old_pen); DeleteObject(pen);
        SelectObject(dc,old_brush); DeleteObject(brush);
        text(dc,std::to_wstring(index+1),{x-14,area.top+13,x+15,area.top+42},
             RGB(224,235,244),app.font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        text(dc,labels[index],{x+22,area.top+8,x+92,area.top+47},
             index==active?RGB(237,243,250):RGB(146,157,180),app.font);
    }
}
void draw_issues(HDC dc,RECT area) {
    fill(dc,area,RGB(16,21,29));
    auto skeleton=animocap::make_default_skeleton();
    struct Issue { std::wstring name; float confidence; std::wstring detail; };
    std::vector<Issue> issues;
    if(app.pose&&!app.pose->frames.empty()) {
        const auto& frame=app.pose->frames[pose_frame()];
        for(std::size_t index=0;index<frame.joints.size();++index) {
            if(!is_limb(skeleton.bones[index].semantic))continue;
            const auto& joint=frame.joints[index];
            if(!joint.valid||joint.confidence<.58f)
                issues.push_back({issue_joint_name(skeleton.bones[index].semantic),
                                  joint.valid?joint.confidence:0.0f,L""});
        }
        std::sort(issues.begin(),issues.end(),[](const Issue& a,const Issue& b){
            return a.confidence<b.confidence;
        });
    }
    if(app.multiview_diagnostics&&app.pose) {
        const auto current=pose_frame();
        for(const auto& conflict:app.multiview_diagnostics->conflicts) {
            if(conflict.frame_index!=current||conflict.joint_index>=skeleton.bones.size())continue;
            const float confidence=static_cast<float>(std::clamp(
                1.0-conflict.disagreement_m/.45,0.0,1.0));
            issues.push_back({
                issue_joint_name(skeleton.bones[conflict.joint_index].semantic),confidence,
                L"跨视角差异 "+std::to_wstring(
                    static_cast<int>(std::lround(conflict.disagreement_m*100.0)))+L" cm"
            });
        }
    }
    std::wstring heading=issues.empty()
        ? (app.multiview_diagnostics?L"当前帧四视角一致":L"当前帧没有明显问题")
        : L"需要检查 · "+std::to_wstring(issues.size())+L" 个关节";
    text(dc,heading,{area.left+16,area.top+8,area.right-16,area.top+38},
         issues.empty()?RGB(100,226,183):RGB(238,242,249),app.font);
    int issue_y=area.top+42;
    if(app.multiview_diagnostics) {
        std::wstring alignment=L"时间对齐";
        for(const auto& item:app.multiview_diagnostics->alignments) {
            alignment+=L" · "+widen(item.view_id)+L" "+
                std::to_wstring(static_cast<int>(std::lround(item.mean_offset_s*1000.0)))+L"ms";
        }
        text(dc,alignment,{area.left+16,area.top+34,area.right-16,area.top+64},
             RGB(112,137,167),app.font);
        issue_y=area.top+68;
    }
    if(issues.empty()) {
        text(dc,app.multiview_diagnostics
            ? L"遮挡观测已由其他视角恢复；拖动时间轴检查全段冲突"
            : L"本地视觉纠错只会在遮挡、跳点或左右歧义时介入",
             {area.left+16,area.top+42,area.right-16,area.bottom-12},
             RGB(112,125,149),app.font,DT_LEFT|DT_TOP|DT_WORDBREAK);
        return;
    }
    int y=issue_y;
    for(std::size_t index=0;index<std::min<std::size_t>(3,issues.size());++index) {
        RECT row{area.left+12,y,area.right-12,std::min<LONG>(area.bottom-8,y+48)};
        fill(dc,row,RGB(22,28,38));
        HBRUSH dot=CreateSolidBrush(RGB(255,184,72)); auto old=SelectObject(dc,dot);
        Ellipse(dc,row.left+12,row.top+17,row.left+22,row.top+27);
        SelectObject(dc,old);DeleteObject(dot);
        text(dc,issues[index].name+L" · "+
             (issues[index].detail.empty()
                ? L"置信度 "+std::to_wstring(
                    static_cast<int>(issues[index].confidence*100))+L"%"
                : issues[index].detail),
             {row.left+32,row.top,row.right-90,row.bottom},RGB(224,230,240),app.font);
        text(dc,L"手动修正",{row.right-86,row.top,row.right-10,row.bottom},
             RGB(89,220,229),app.font,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
        y+=56;
        if(y>=area.bottom-30)break;
    }
}
void draw_timeline_panel(HDC dc,RECT area) {
    fill(dc,area,RGB(13,17,24));
    const int label_width=104;
    const int graph_top=area.top+54,graph_bottom=area.top+100;
    text(dc,L"置信度",{area.left+14,graph_top,area.left+label_width,graph_bottom},
         RGB(149,160,181),app.font);
    HPEN baseline=CreatePen(PS_SOLID,1,RGB(42,50,64));
    auto old_pen=SelectObject(dc,baseline);
    MoveToEx(dc,area.left+label_width,graph_bottom-5,nullptr);
    LineTo(dc,area.right-12,graph_bottom-5);
    SelectObject(dc,old_pen);DeleteObject(baseline);
    if(app.pose&&app.pose->frames.size()>1) {
        HPEN curve=CreatePen(PS_SOLID,2,RGB(126,111,255));
        old_pen=SelectObject(dc,curve);
        bool first=true;
        for(std::size_t frame_index=0;frame_index<app.pose->frames.size();++frame_index) {
            const auto& frame=app.pose->frames[frame_index];
            double sum=0.0;int count=0;
            for(const auto& joint:frame.joints)if(joint.valid){sum+=joint.confidence;++count;}
            double confidence=count?sum/count:0.0;
            int x=area.left+label_width+static_cast<int>(
                (area.right-area.left-label_width-12)*
                frame_index/(app.pose->frames.size()-1.0));
            int y=graph_bottom-5-static_cast<int>(confidence*(graph_bottom-graph_top-8));
            if(first){MoveToEx(dc,x,y,nullptr);first=false;}else LineTo(dc,x,y);
        }
        SelectObject(dc,old_pen);DeleteObject(curve);
    }
    text(dc,L"歧义标记",{area.left+14,area.top+106,area.left+label_width,area.top+142},
         RGB(149,160,181),app.font);
    if(app.pose&&app.pose->frames.size()>1) {
        HBRUSH marker=CreateSolidBrush(RGB(105,91,245));
        auto old=SelectObject(dc,marker);
        for(std::size_t frame_index=0;frame_index<app.pose->frames.size();++frame_index) {
            float lowest=1.0f;
            for(const auto& joint:app.pose->frames[frame_index].joints)
                if(joint.valid)lowest=std::min(lowest,joint.confidence);
            if(lowest>=.38f)continue;
            int x=area.left+label_width+static_cast<int>(
                (area.right-area.left-label_width-12)*
                frame_index/(app.pose->frames.size()-1.0));
            POINT diamond[]={{x,area.top+116},{x+5,area.top+121},
                             {x,area.top+126},{x-5,area.top+121}};
            Polygon(dc,diamond,4);
        }
        SelectObject(dc,old);DeleteObject(marker);
    }
    text(dc,L"视频轨道",{area.left+14,area.top+146,area.left+label_width,area.bottom-8},
         RGB(149,160,181),app.font);
    fill(dc,{area.left+label_width,area.top+153,area.right-12,area.bottom-12},
         RGB(25,31,42));
    if(app.decoder&&app.decoder->is_open()) {
        int cursor=area.left+label_width+static_cast<int>(
            (area.right-area.left-label_width-12)*
            app.time_s/std::max(.001,app.decoder->info().duration_s));
        HPEN pen=CreatePen(PS_SOLID,2,RGB(65,218,226));
        old_pen=SelectObject(dc,pen);
        MoveToEx(dc,cursor,area.top+48,nullptr);LineTo(dc,cursor,area.bottom-8);
        SelectObject(dc,old_pen);DeleteObject(pen);
    }
}
void paint(HWND window) {
    PAINTSTRUCT ps{};
    HDC paint_dc=BeginPaint(window,&ps);
    RECT client{};GetClientRect(window,&client);
    HDC dc=CreateCompatibleDC(paint_dc);
    HBITMAP buffer=CreateCompatibleBitmap(paint_dc,client.right,client.bottom);
    auto old_bitmap=SelectObject(dc,buffer);
    fill(dc,client,RGB(9,12,17));
    fill(dc,{0,0,client.right,kHeader},RGB(13,17,24));
    text(dc,L"AniMocap Fusion",{22,6,238,kHeader-4},RGB(240,244,250),app.title_font);
    std::wstring pipeline=app.multiview_mode
        ? L"四视角：逐视角观测 → 相位对齐 → 置信度加权 → 联合优化"
        : app.vlm_enabled
            ? L"本地处理：HRNet → 光流 → Qwen3-VL 纠错 · 就绪"
            : L"本地处理：HRNet → 光流 · 视觉纠错已关闭";
    text(dc,pipeline,{client.right-850,6,client.right-260,kHeader-4},
         (app.multiview_mode||app.vlm_enabled)?RGB(122,215,191):RGB(151,160,179),app.font,
         DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
    draw_steps(dc,{0,kHeader,client.right,kHeader+kSteps});
    RECT scope{0,kHeader+kSteps,client.right,kHeader+kSteps+kScopeBar};
    fill(dc,scope,RGB(14,19,27));
    text(dc,app.multiview_mode?L"四视角范围：":L"人物范围：",{22,scope.top,118,scope.bottom},
         RGB(225,231,240),app.font);
    text(dc,app.multiview_mode
        ? L"正面 / 右侧 / 背面 / 左侧分别自动识别完整人体，再联合恢复遮挡关节"
        : app.auto_person_frame
            ? L"仅识别人体骨架，不包含翅膀、武器、宠物和 UI"
            : app.has_person_frame?L"使用手动人物框":L"使用完整视频画面",
        {460,scope.top,workspace_split()-12,scope.bottom},
        RGB(126,138,160),app.font);
    draw_video(dc,video_area());
    draw_motion(dc,motion_area());
    draw_issues(dc,issues_area());
    draw_timeline_panel(dc,timeline_area());
    BitBlt(paint_dc,0,0,client.right,client.bottom,dc,0,0,SRCCOPY);
    SelectObject(dc,old_bitmap);DeleteObject(buffer);DeleteDC(dc);
    EndPaint(window,&ps);
}
void draw_owner_button(const DRAWITEMSTRUCT* item) {
    RECT rect=item->rcItem;
    const int id=GetDlgCtrlID(item->hwndItem);
    const bool pressed=(item->itemState&ODS_SELECTED)!=0;
    const bool disabled=(item->itemState&ODS_DISABLED)!=0;
    const bool primary=id==kAnalyze;
    const bool selected=(id==kAutoFrame&&app.auto_person_frame)||
                        (id==kPersonFrame&&app.manual_person_frame)||
                        (id==kVlmToggle&&app.vlm_enabled);
    COLORREF background=primary?RGB(39,185,201):
        selected?RGB(30,86,112):RGB(22,28,38);
    if(pressed)background=primary?RGB(30,151,166):RGB(31,39,52);
    if(disabled)background=RGB(18,22,29);
    HBRUSH brush=CreateSolidBrush(background);auto old_brush=SelectObject(item->hDC,brush);
    HPEN pen=CreatePen(PS_SOLID,1,primary?RGB(72,224,231):
        selected?RGB(58,153,187):RGB(48,57,73));
    auto old_pen=SelectObject(item->hDC,pen);
    Rectangle(item->hDC,rect.left,rect.top,rect.right,rect.bottom);
    SelectObject(item->hDC,old_pen);DeleteObject(pen);
    SelectObject(item->hDC,old_brush);DeleteObject(brush);
    wchar_t label[128]{};
    GetWindowTextW(item->hwndItem,label,128);
    text(item->hDC,label,rect,disabled?RGB(91,100,116):primary?RGB(7,25,31):RGB(225,232,242),
         app.font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
}
HWND button(HWND parent,int id,const wchar_t* label) {
    HWND result=CreateWindowExW(0,L"BUTTON",label,
        WS_CHILD|WS_VISIBLE|BS_OWNERDRAW,0,0,0,0,parent,
        reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
        GetModuleHandleW(nullptr),nullptr);
    SendMessageW(result,WM_SETFONT,reinterpret_cast<WPARAM>(app.font),TRUE);
    return result;
}
void layout(HWND window) {
    RECT client{};GetClientRect(window,&client);
    int header_x=248;
    for(int id:{kImport,kMultiview,kLoad,kSetup,kVlmSetup}) {
        const int width=(id==kMultiview||id==kVlmSetup)?104:88;
        MoveWindow(GetDlgItem(window,id),header_x,10,width,36,TRUE);
        header_x+=width+8;
    }
    MoveWindow(GetDlgItem(window,kVlmToggle),client.right-235,10,215,36,TRUE);
    const int scope_y=kHeader+kSteps+9;
    MoveWindow(GetDlgItem(window,kAutoFrame),118,scope_y,104,36,TRUE);
    MoveWindow(GetDlgItem(window,kPersonFrame),232,scope_y,104,36,TRUE);
    MoveWindow(GetDlgItem(window,kResetFrame),346,scope_y,90,36,TRUE);
    RECT issues=issues_area();
    MoveWindow(GetDlgItem(window,kCalibrate),issues.right-116,issues.top+6,100,32,TRUE);
    RECT timeline=timeline_area();
    MoveWindow(app.play,timeline.left+8,timeline.top+8,74,34,TRUE);
    ShowWindow(app.timeline,SW_HIDE);
    MoveWindow(GetDlgItem(window,kAnalyze),client.right-178,client.bottom-42,158,34,TRUE);
    MoveWindow(app.progress,client.right-178,client.bottom-49,158,5,TRUE);
    MoveWindow(app.status,20,client.bottom-42,std::max<LONG>(180,client.right-220),34,TRUE);
    InvalidateRect(window,nullptr,FALSE);
}
void toggle_play() {
    if (!app.decoder || !app.decoder->is_open()) return;
    app.playing=!app.playing; SetWindowTextW(app.play,app.playing?L"\u6682\u505c":L"\u64ad\u653e");
    if (app.playing) {
        UINT interval=static_cast<UINT>(std::max(1.0,std::round(
            1000.0/std::max(1.0,app.decoder->info().fps))));
        SetTimer(app.window,kTimerPlayback,interval,nullptr);
    }
    else KillTimer(app.window,kTimerPlayback);
}
bool apply_pose_person_frame() {
    if (!app.pose || app.pose->frames.empty() ||
        app.video_frame.width<2 || app.video_frame.height<2) return false;
    double left=static_cast<double>(app.video_frame.width);
    double top=static_cast<double>(app.video_frame.height);
    double right=0.0,bottom=0.0;
    std::size_t samples=0;
    const std::size_t stride=std::max<std::size_t>(1,app.pose->frames.size()/48);
    for (std::size_t frame_index=0;frame_index<app.pose->frames.size();frame_index+=stride) {
        const auto& frame=app.pose->frames[frame_index];
        for (std::size_t joint_index=1;joint_index<frame.joints.size();++joint_index) {
            const auto& joint=frame.joints[joint_index];
            if (!joint.valid || joint.confidence<.25f) continue;
            left=std::min(left,joint.image_xy.x); top=std::min(top,joint.image_xy.y);
            right=std::max(right,joint.image_xy.x); bottom=std::max(bottom,joint.image_xy.y);
            ++samples;
        }
    }
    if (samples<12 || right-left<40.0 || bottom-top<80.0) return false;
    const double margin_x=std::max(36.0,(right-left)*.28);
    const double margin_y=std::max(28.0,(bottom-top)*.12);
    app.person_frame={
        static_cast<LONG>(std::clamp(std::floor(left-margin_x),0.0,
            static_cast<double>(app.video_frame.width-2))),
        static_cast<LONG>(std::clamp(std::floor(top-margin_y),0.0,
            static_cast<double>(app.video_frame.height-2))),
        static_cast<LONG>(std::clamp(std::ceil(right+margin_x),2.0,
            static_cast<double>(app.video_frame.width))),
        static_cast<LONG>(std::clamp(std::ceil(bottom+margin_y),2.0,
            static_cast<double>(app.video_frame.height)))
    };
    if (app.person_frame.right<=app.person_frame.left+2 ||
        app.person_frame.bottom<=app.person_frame.top+2) return false;
    app.has_person_frame=true;
    return true;
}
void use_auto_person_frame() {
    if (!app.decoder || !app.decoder->is_open()) {
        MessageBoxW(app.window,L"请先导入视频。",L"自动识别人物",MB_ICONINFORMATION);
        return;
    }
    stop_playback();
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.selecting_person_frame=false;
    app.drawing_person_frame=false;
    if (apply_pose_person_frame())
        set_status(L"人物范围 · 已根据整段人体关节自动收紧，翅膀与宠物不参与范围计算");
    else {
        app.has_person_frame=false;
        set_status(L"人物范围 · 捕捉首帧将自动识别人体，随后排除翅膀、宠物和 UI");
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void reset_person_frame() {
    stop_playback();
    app.auto_person_frame=false;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    app.selecting_person_frame=false;
    app.drawing_person_frame=false;
    set_status(L"人物范围已重置 · 当前使用完整视频画面");
    InvalidateRect(app.window,nullptr,FALSE);
}
void begin_person_frame_selection() {
    if (!app.decoder || !app.decoder->is_open()) {
        MessageBoxW(app.window,L"请先导入视频。",
                    L"框选人物",MB_ICONINFORMATION);
        return;
    }
    stop_playback();
    app.auto_person_frame=false;
    app.manual_person_frame=false;
    app.calibrating=false;
    app.dragging_anchor=-1;
    app.has_person_frame=false;
    app.selecting_person_frame=true;
    app.drawing_person_frame=false;
    SetWindowTextW(GetDlgItem(app.window,kCalibrate),L"校准锚点");
    SetWindowTextW(GetDlgItem(app.window,kPersonFrame),L"正在框选…");
    set_status(L"框选人物 · 在视频上拖动矩形，只保留角色和动作范围");
    InvalidateRect(app.window,nullptr,FALSE);
}
bool begin_person_frame_drag(POINT mouse) {
    if (!app.selecting_person_frame) return false;
    RECT destination=video_destination(video_area());
    if (mouse.x<destination.left || mouse.x>destination.right ||
        mouse.y<destination.top || mouse.y>destination.bottom) return false;
    app.drawing_person_frame=true;
    app.frame_start=mouse;
    app.frame_current=mouse;
    SetCapture(app.window);
    return true;
}
void move_person_frame(POINT mouse) {
    if (!app.drawing_person_frame) return;
    RECT destination=video_destination(video_area());
    app.frame_current.x=std::clamp(mouse.x,destination.left,destination.right);
    app.frame_current.y=std::clamp(mouse.y,destination.top,destination.bottom);
    InvalidateRect(app.window,nullptr,FALSE);
}
void finish_person_frame() {
    if (!app.drawing_person_frame) return;
    RECT destination=video_destination(video_area());
    RECT box{
        std::min(app.frame_start.x,app.frame_current.x),
        std::min(app.frame_start.y,app.frame_current.y),
        std::max(app.frame_start.x,app.frame_current.x),
        std::max(app.frame_start.y,app.frame_current.y)
    };
    app.drawing_person_frame=false;
    ReleaseCapture();
    if (box.right-box.left<40 || box.bottom-box.top<40) {
        set_status(L"人物框太小 · 请重新拖动框选");
        InvalidateRect(app.window,nullptr,FALSE);
        return;
    }
    double sx=static_cast<double>(app.video_frame.width)/
              std::max(1L,destination.right-destination.left);
    double sy=static_cast<double>(app.video_frame.height)/
              std::max(1L,destination.bottom-destination.top);
    app.person_frame={
        static_cast<LONG>(std::lround((box.left-destination.left)*sx)),
        static_cast<LONG>(std::lround((box.top-destination.top)*sy)),
        static_cast<LONG>(std::lround((box.right-destination.left)*sx)),
        static_cast<LONG>(std::lround((box.bottom-destination.top)*sy))
    };

    app.person_frame.left=std::clamp<LONG>(app.person_frame.left,0,
        static_cast<LONG>(app.video_frame.width)-2);
    app.person_frame.top=std::clamp<LONG>(app.person_frame.top,0,
        static_cast<LONG>(app.video_frame.height)-2);
    app.person_frame.right=std::clamp<LONG>(app.person_frame.right,
        app.person_frame.left+2,static_cast<LONG>(app.video_frame.width));
    app.person_frame.bottom=std::clamp<LONG>(app.person_frame.bottom,
        app.person_frame.top+2,static_cast<LONG>(app.video_frame.height));
    app.has_person_frame=true;
    app.auto_person_frame=false;
    app.manual_person_frame=true;
    app.selecting_person_frame=false;
    SetWindowTextW(GetDlgItem(app.window,kPersonFrame),L"手动框选");
    set_status(L"手动人物框已应用 · x="+std::to_wstring(app.person_frame.left)+
        L" y="+std::to_wstring(app.person_frame.top)+L" w="+
        std::to_wstring(app.person_frame.right-app.person_frame.left)+L" h="+
        std::to_wstring(app.person_frame.bottom-app.person_frame.top)+
        L" · 捕捉将严格使用此范围");
    InvalidateRect(app.window,nullptr,FALSE);
}
bool begin_anchor_drag(POINT mouse) {
    if (!app.calibrating || !app.pose || app.video_frame.bgra.empty()) return false;
    RECT destination=video_destination(video_area());
    RECT source=video_source_rect();
    if (mouse.x<destination.left || mouse.x>destination.right ||
        mouse.y<destination.top || mouse.y>destination.bottom) return false;
    const auto& frame=app.pose->frames[pose_frame()];
    double sx=static_cast<double>(destination.right-destination.left)/(source.right-source.left);
    double sy=static_cast<double>(destination.bottom-destination.top)/(source.bottom-source.top);
    double best=18.0*18.0;
    int selected=-1;
    for (std::size_t i=1;i<frame.joints.size();++i) {
        if (!frame.joints[i].valid) continue;
        double x=destination.left+(frame.joints[i].image_xy.x-source.left)*sx;
        double y=destination.top+(frame.joints[i].image_xy.y-source.top)*sy;
        double distance=(x-mouse.x)*(x-mouse.x)+(y-mouse.y)*(y-mouse.y);
        if (distance<best) { best=distance; selected=static_cast<int>(i); }
    }
    if (selected<0) return false;
    app.dragging_anchor=selected;
    app.last_mouse=mouse;
    SetCapture(app.window);
    return true;
}
void move_anchor(POINT mouse) {
    if (app.dragging_anchor<0 || !app.pose) return;
    RECT destination=video_destination(video_area());
    RECT source=video_source_rect();
    double sx=static_cast<double>(destination.right-destination.left)/(source.right-source.left);
    double sy=static_cast<double>(destination.bottom-destination.top)/(source.bottom-source.top);
    if (sx<=0.0 || sy<=0.0) return;
    double delta_u=(mouse.x-app.last_mouse.x)/sx;
    double delta_v=(mouse.y-app.last_mouse.y)/sy;
    auto skeleton=animocap::make_default_skeleton();
    const auto head=animocap::bone_index(skeleton,animocap::BoneSemantic::Head);
    const auto left_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::LeftFoot);
    const auto right_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::RightFoot);
    const auto selected=static_cast<std::size_t>(app.dragging_anchor);
    for (auto& frame : app.pose->frames) {
        auto& joint=frame.joints[selected];
        joint.image_xy.x+=delta_u;
        joint.image_xy.y+=delta_v;
        const auto& head_xy=frame.joints[head].image_xy;
        const auto& left_xy=frame.joints[left_foot].image_xy;
        const auto& right_xy=frame.joints[right_foot].image_xy;
        double foot_x=(left_xy.x+right_xy.x)*0.5;
        double foot_y=(left_xy.y+right_xy.y)*0.5;
        double body_pixels=std::max(1.0,std::hypot(head_xy.x-foot_x,head_xy.y-foot_y));
        double meters_per_pixel=1.55/body_pixels;
        joint.position_m.x-=delta_u*meters_per_pixel;
        joint.position_m.y-=delta_v*meters_per_pixel;
    }
    app.last_mouse=mouse;
    InvalidateRect(app.window,nullptr,FALSE);
}
void finish_anchor_drag() {
    if (app.dragging_anchor<0) return;
    app.dragging_anchor=-1;
    ReleaseCapture();
    try {
        app.motion=animocap::reconstruct_canonical_motion(*app.pose);
        set_status(L"锚点修正已传播到全部帧 · 可继续拖动其他错位关节");
    } catch (const std::exception& error) {
        set_status(L"锚点修正已应用，但规范动作重建失败");
        MessageBoxW(app.window,widen(error.what()).c_str(),L"校准失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void toggle_calibration() {
    if (!app.pose) {
        MessageBoxW(app.window,L"请先运行动作捕捉或加载观测数据。",
                    L"锚点校准",MB_ICONINFORMATION);
        return;
    }
    app.calibrating=!app.calibrating;
    app.playing=false;
    KillTimer(app.window,kTimerPlayback);
    SetWindowTextW(app.play,L"播放");
    SetWindowTextW(GetDlgItem(app.window,kCalibrate),
        app.calibrating ? L"完成修正" : L"手动修正");
    set_status(app.calibrating
        ? L"锚点校准 · 拖动错位关节，偏移自动应用到整段视频"
        : L"校准已应用 · 不需要逐帧调整");
    InvalidateRect(app.window,nullptr,FALSE);
}
LRESULT CALLBACK window_proc(HWND window,UINT message,WPARAM wparam,LPARAM lparam) {
    switch(message) {
    case WM_CREATE:
        app.window=window; app.root=find_root();
        app.font=CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.title_font=CreateFontW(-25,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.panel_brush=CreateSolidBrush(RGB(9,12,17));
        button(window,kImport,L"打开视频");
        button(window,kMultiview,L"导入四视角");
        button(window,kLoad,L"打开动作");
        button(window,kSetup,L"推理环境");
        button(window,kVlmSetup,L"配置本地 AI");
        button(window,kVlmToggle,L"本地视觉纠错 · 开");
        button(window,kAutoFrame,L"自动识别");
        button(window,kPersonFrame,L"手动框选");
        button(window,kResetFrame,L"重置");
        button(window,kCalibrate,L"手动修正");
        button(window,kAnalyze,L"开始捕捉");
        app.play=button(window,kPlay,L"\u64ad\u653e");
        app.timeline=CreateWindowExW(0,TRACKBAR_CLASSW,nullptr,WS_CHILD|WS_VISIBLE|TBS_HORZ,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kTimeline)),
            GetModuleHandleW(nullptr),nullptr);
        SendMessageW(app.timeline,TBM_SETRANGE,TRUE,MAKELPARAM(0,10000));
        app.progress=CreateWindowExW(0,PROGRESS_CLASSW,nullptr,WS_CHILD|PBS_MARQUEE|PBS_SMOOTH,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kProgress)),
            GetModuleHandleW(nullptr),nullptr); ShowWindow(app.progress,SW_HIDE);
        app.status=CreateWindowExW(0,L"STATIC",L"\u7a7a\u95f2 \u00b7 \u5bfc\u5165\u89c6\u9891\u5f00\u59cb",WS_CHILD|WS_VISIBLE|SS_LEFT,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kStatus)),
            GetModuleHandleW(nullptr),nullptr);
        SendMessageW(app.status,WM_SETFONT,reinterpret_cast<WPARAM>(app.font),TRUE);
        layout(window); return 0;
    case WM_SIZE: layout(window); InvalidateRect(window,nullptr,TRUE); return 0;
    case WM_DRAWITEM:
        draw_owner_button(reinterpret_cast<const DRAWITEMSTRUCT*>(lparam));
        return TRUE;
    case WM_COMMAND:
        switch(LOWORD(wparam)) {
        case kImport: import_video(); return 0;
        case kMultiview: import_multiview_folder(); return 0;
        case kLoad: load_motion(); return 0;
        case kSetup: setup_mmpose(); return 0;
        case kVlmSetup: setup_local_vlm(); return 0;
        case kVlmToggle: toggle_local_vlm(); return 0;
        case kAutoFrame: use_auto_person_frame(); return 0;
        case kPersonFrame: begin_person_frame_selection(); return 0;
        case kResetFrame: reset_person_frame(); return 0;
        case kAnalyze: start_analysis(); return 0;
        case kCalibrate: toggle_calibration(); return 0;
        case kPlay: toggle_play(); return 0;
        default: break;
        }
        break;    case WM_HSCROLL:
        if (reinterpret_cast<HWND>(lparam)==app.timeline && app.decoder) {
            int value=static_cast<int>(SendMessageW(app.timeline,TBM_GETPOS,0,0));
            decode_at(app.decoder->info().duration_s*value/10000.0);
        } return 0;
    case WM_TIMER:
        if (wparam==kTimerPlayback && app.playing && app.decoder) {
            try {
                if (app.decoder->read_frame(app.video_frame)) {
                    app.time_s=app.video_frame.time_s;
                    update_timeline();
                    InvalidateRect(window,nullptr,FALSE);
                } else {
                    stop_playback();
                }
            } catch (const std::exception& error) {
                stop_playback(L"视频解码已停止 · " + widen(error.what()));
            }
        } return 0;
    case kAnalysisDone: {
        std::unique_ptr<AnalysisResult> result(reinterpret_cast<AnalysisResult*>(lparam));
        app.analyzing=false; SendMessageW(app.progress,PBM_SETMARQUEE,FALSE,0);
        ShowWindow(app.progress,SW_HIDE); EnableWindow(GetDlgItem(window,kAnalyze),TRUE);
        EnableWindow(GetDlgItem(window,kAutoFrame),TRUE);
        EnableWindow(GetDlgItem(window,kPersonFrame),!app.multiview_mode);
        EnableWindow(GetDlgItem(window,kResetFrame),!app.multiview_mode);
        EnableWindow(GetDlgItem(window,kImport),TRUE);
        EnableWindow(GetDlgItem(window,kMultiview),TRUE);
        if (!result->error.empty()) {
            set_status(L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25 \u00b7 \u4e2d\u95f4\u4ea7\u7269\u5df2\u4fdd\u7559");
            MessageBoxW(window,result->error.c_str(),L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25",MB_ICONERROR);
        } else {
            app.pose=std::move(result->pose);
            app.motion=std::move(result->motion);
            app.motion_path=std::move(result->motion_path);
            app.multiview_diagnostics=std::move(result->diagnostics);
            if(app.auto_person_frame)apply_pose_person_frame();
            if(app.multiview_diagnostics) {
                set_status(L"四视角联合求解完成 · 恢复 "+
                    std::to_wstring(app.multiview_diagnostics->recovered_observations)+
                    L" 个遮挡观测 · "+
                    std::to_wstring(app.multiview_diagnostics->conflicts.size())+
                    L" 个跨视角冲突待检查");
            } else if(!result->warning.empty())
                set_status(L"捕捉完成 · "+result->warning);
            else if(app.pose&&app.pose->backend.find("qwen3-vl-local")!=std::string::npos)
                set_status(L"捕捉完成 · HRNet、光流、本地视觉纠错和时序平滑已应用");
            else
                set_status(L"捕捉完成 · HRNet、光流和时序平滑已应用");
            InvalidateRect(window,nullptr,TRUE);
        } return 0;
    }
    case WM_CTLCOLORSTATIC:
        if (reinterpret_cast<HWND>(lparam)==app.status) {
            auto dc=reinterpret_cast<HDC>(wparam);
            SetTextColor(dc,RGB(170,181,204));
            SetBkColor(dc,RGB(9,12,17));
            return reinterpret_cast<LRESULT>(app.panel_brush);
        } break;
    case WM_LBUTTONDOWN: {
        POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
        if (begin_person_frame_drag(point)) return 0;
        if (begin_anchor_drag(point)) return 0;
        if (seek_from_timeline(point)) {
            app.scrubbing=true; SetCapture(window); return 0;
        }
        RECT motion=motion_area();
        if (PtInRect(&motion,point)) {
            app.rotating=true; app.last_mouse=point; SetCapture(window);
        } return 0;
    }
    case WM_MOUSEMOVE:
        if (app.scrubbing) {
            POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
            RECT area=timeline_area();
            point.x=std::clamp<LONG>(point.x,area.left+104,area.right-12);
            point.y=area.top+160;
            seek_from_timeline(point);
            return 0;
        }
        if (app.drawing_person_frame) {
            move_person_frame({GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)});
            return 0;
        }
        if (app.dragging_anchor>=0) {
            move_anchor({GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)});
            return 0;
        }
        if (app.rotating) {
            POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
            app.yaw+=(point.x-app.last_mouse.x)*.45;
            app.pitch=std::clamp(app.pitch+(point.y-app.last_mouse.y)*.35,-75.0,75.0);
            app.last_mouse=point; InvalidateRect(window,nullptr,FALSE);
        } return 0;
    case WM_LBUTTONUP:
        if (app.scrubbing) { app.scrubbing=false; ReleaseCapture(); return 0; }
        if (app.drawing_person_frame) { finish_person_frame(); return 0; }
        if (app.dragging_anchor>=0) { finish_anchor_drag(); return 0; }
        if (app.rotating) { app.rotating=false; ReleaseCapture(); } return 0;
    case WM_PAINT: paint(window); return 0;
    case WM_ERASEBKGND: return 1;
    case WM_DESTROY:
        KillTimer(window,kTimerPlayback);
        if(app.font)DeleteObject(app.font); if(app.title_font)DeleteObject(app.title_font);
        if(app.panel_brush)DeleteObject(app.panel_brush);
        PostQuitMessage(0); return 0;
    default: break;
    }
    return DefWindowProcW(window,message,wparam,lparam);
}
}  // namespace

int WINAPI wWinMain(HINSTANCE instance,HINSTANCE,PWSTR,int show) {
    CoInitializeEx(nullptr,COINIT_APARTMENTTHREADED);
    INITCOMMONCONTROLSEX controls{sizeof(controls),ICC_BAR_CLASSES|ICC_PROGRESS_CLASS|ICC_STANDARD_CLASSES};
    InitCommonControlsEx(&controls);
    WNDCLASSEXW wc{}; wc.cbSize=sizeof(wc); wc.style=CS_HREDRAW|CS_VREDRAW;
    wc.lpfnWndProc=window_proc; wc.hInstance=instance; wc.hCursor=LoadCursorW(nullptr,reinterpret_cast<LPCWSTR>(IDC_ARROW));
    wc.hIcon=LoadIconW(nullptr,reinterpret_cast<LPCWSTR>(IDI_APPLICATION));
    wc.hbrBackground=reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
    wc.lpszClassName=kWindowClass;
    RegisterClassExW(&wc);
    HWND window=CreateWindowExW(0,kWindowClass,L"AniMocap Fusion",
        WS_OVERLAPPEDWINDOW|WS_CLIPCHILDREN,CW_USEDEFAULT,CW_USEDEFAULT,1500,1000,
        nullptr,nullptr,instance,nullptr);
    if(!window){CoUninitialize();return 1;}
    enable_dark_title_bar(window);
    ShowWindow(window,show); UpdateWindow(window);
    int argument_count = 0;
    LPWSTR* arguments = CommandLineToArgvW(GetCommandLineW(), &argument_count);
    for (int index = 1; arguments && index + 1 < argument_count; ++index) {
        if (std::wstring_view(arguments[index]) == L"--multiview-folder") {
            load_multiview_folder(std::filesystem::path(arguments[++index]));
        } else if (std::wstring_view(arguments[index]) == L"--video") {
            open_video(std::filesystem::path(arguments[++index]));
        } else if (std::wstring_view(arguments[index]) == L"--pose") {
            try {
                app.pose = animocap::smooth_pose_sequence(
                    animocap::load_pose_sequence_json(
                        std::filesystem::path(arguments[++index])));
                set_status(L"\u89c2\u6d4b\u5df2\u52a0\u8f7d \u00b7 " +
                           std::to_wstring(app.pose->frames.size()) + L" \u5e27 \u00b7 \u65f6\u5e8f\u5e73\u6ed1");
                InvalidateRect(window, nullptr, TRUE);
            } catch (const std::exception& error) {
                MessageBoxW(window, widen(error.what()).c_str(),
                    L"\u89c2\u6d4b\u52a0\u8f7d\u5931\u8d25", MB_ICONERROR);
            }
        } else if (std::wstring_view(arguments[index]) == L"--motion") {
            try {
                app.motion_path = std::filesystem::path(arguments[++index]);
                app.motion = app.pose
                    ? std::optional<animocap::MotionPackage>(
                        animocap::reconstruct_canonical_motion(*app.pose))
                    : std::optional<animocap::MotionPackage>(
                        animocap::load_motion_package(app.motion_path));
                app.time_s = app.motion->motion.time_s.front();
                set_status(L"\u52a8\u4f5c\u5df2\u52a0\u8f7d \u00b7 " + std::to_wstring(app.motion->motion.frame_count) + L" \u5e27");
                InvalidateRect(window, nullptr, TRUE);
            } catch (const std::exception& error) {
                MessageBoxW(window, widen(error.what()).c_str(), L"\u52a8\u4f5c\u52a0\u8f7d\u5931\u8d25", MB_ICONERROR);
            }
        }
    }
    if (arguments) LocalFree(arguments);
    MSG message{}; while(GetMessageW(&message,nullptr,0,0)>0){TranslateMessage(&message);DispatchMessageW(&message);}
    CoUninitialize(); return static_cast<int>(message.wParam);
}
#else
int main(){return 1;}
#endif

