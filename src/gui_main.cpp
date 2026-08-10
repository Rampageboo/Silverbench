#include "animocap/math.hpp"
#include "animocap/character_profile.hpp"
#include "animocap/contracts.hpp"
#include "animocap/export.hpp"
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
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <vector>

namespace {
constexpr wchar_t kWindowClass[] = L"AniMocapFusionWindow";
constexpr UINT kTimerPlayback = 1;
constexpr UINT kTimerAnalysisProgress = 2;
constexpr UINT kAnalysisDone = WM_APP + 1;
constexpr int kImport = 101, kAnalyze = 102, kLoad = 103, kPlay = 104;
constexpr int kTimeline = 105, kStatus = 106, kProgress = 107, kSetup = 108;
constexpr int kCalibrate = 109, kPersonFrame = 110;
constexpr int kAutoFrame = 111, kResetFrame = 112, kVlmToggle = 113, kVlmSetup = 114;
constexpr int kMultiview = 115, kExportBvh = 116, kSaveMotion = 117;
constexpr int kUndoCorrection = 118, kRedoCorrection = 119;
constexpr int kExportVrma = 120;
constexpr int kRangeStart = 121, kRangeEnd = 122, kRangeClear = 123, kLoopRange = 124;
constexpr int kCharacterProfile = 125;
constexpr int kHeader = 66, kSteps = 52, kScopeBar = 56, kTimelineHeight = 244;
constexpr int kTimelineLabelWidth = 124;
constexpr int kPadding = 16;
constexpr double kPi = 3.14159265358979323846;

namespace theme {
constexpr COLORREF background=RGB(9,14,20);
constexpr COLORREF header=RGB(12,18,25);
constexpr COLORREF surface=RGB(15,23,32);
constexpr COLORREF surface_raised=RGB(19,29,40);
constexpr COLORREF surface_hover=RGB(25,38,51);
constexpr COLORREF panel_shadow=RGB(4,8,13);
constexpr COLORREF border=RGB(48,63,77);
constexpr COLORREF border_soft=RGB(34,47,60);
constexpr COLORREF text=RGB(232,239,246);
constexpr COLORREF text_muted=RGB(142,157,174);
constexpr COLORREF text_faint=RGB(91,108,126);
constexpr COLORREF accent=RGB(38,180,238);
constexpr COLORREF accent_strong=RGB(11,126,196);
constexpr COLORREF accent_dark=RGB(8,50,70);
constexpr COLORREF accent_soft=RGB(23,92,119);
constexpr COLORREF violet=RGB(143,101,246);
constexpr COLORREF amber=RGB(245,166,35);
constexpr COLORREF green=RGB(88,214,168);
constexpr COLORREF red=RGB(255,91,105);
}

using ManualCorrectionState=animocap::ManualPoseCorrections;

struct AnalysisResult {
    std::optional<animocap::PoseSequence> pose_baseline;
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::PoseOptimizationDiagnostics> optimization_diagnostics;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::MultiviewDiagnostics> diagnostics;
    std::filesystem::path motion_path;
    std::wstring error, warning;
    bool cancelled{};
};
struct AnalysisCancelled final : std::exception {
    const char* what() const noexcept override { return "analysis cancelled"; }
};
struct AppState {
    HWND window{}, timeline{}, status{}, progress{}, play{};
    std::filesystem::path root, video_path, motion_path;
    std::array<std::filesystem::path,4> multiview_videos{};
    std::array<animocap::VideoFrame,4> multiview_preview_frames{};
    std::filesystem::path multiview_manifest;
    std::unique_ptr<animocap::VideoDecoder> decoder;
    animocap::VideoFrame video_frame;
    std::optional<animocap::PoseSequence> pose_baseline;
    std::optional<animocap::PoseSequence> profile_refined_pose;
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::PoseOptimizationDiagnostics> optimization_diagnostics;
    std::optional<animocap::PoseSequence> anchor_drag_snapshot;
    ManualCorrectionState manual_corrections;
    std::vector<ManualCorrectionState> correction_undo, correction_redo;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::CharacterProfile> character_profile;
    std::optional<animocap::MultiviewDiagnostics> multiview_diagnostics;
    bool playing{}, analyzing{}, cancel_requested{}, close_after_analysis{};
    bool rotating{}, calibrating{}, scrubbing{};
    bool has_person_frame{}, selecting_person_frame{}, drawing_person_frame{};
    bool auto_person_frame{true}, manual_person_frame{}, vlm_enabled{true};
    bool multiview_mode{}, calibrated_multiview{};
    bool motion_dirty{};
    bool loop_range{};
    std::optional<double> range_start,range_end;
    int dragging_anchor{-1};
    RECT person_frame{};
    POINT frame_start{}, frame_current{};
    double time_s{}, yaw{28.0}, pitch{-8.0};
    double anchor_drag_delta_u{},anchor_drag_delta_v{};
    POINT last_mouse{};
    std::filesystem::path analysis_mmpose_log, analysis_vlm_log;
    std::chrono::steady_clock::time_point analysis_started{};
    std::jthread worker;
    HFONT font{}, small_font{}, title_font{}, section_font{}, mono_font{};
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
void update_correction_controls();
bool confirm_replace_dirty_motion() {
    if(!app.motion_dirty)return true;
    return MessageBoxW(app.window,
        L"当前手动修正尚未保存。\n\n是否放弃这些修正并继续？\n选择“否”可返回后点击“保存动作”。",
        L"放弃未保存的修正？",MB_YESNO|MB_ICONWARNING)==IDYES;
}

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
        const DWORD corner_preference=2;
        set_attribute(window,33,&corner_preference,sizeof(corner_preference));
        const COLORREF border_color=theme::border;
        const COLORREF caption_color=theme::header;
        const COLORREF text_color=theme::text;
        set_attribute(window,34,&border_color,sizeof(border_color));
        set_attribute(window,35,&caption_color,sizeof(caption_color));
        set_attribute(window,36,&text_color,sizeof(text_color));
    }
    FreeLibrary(library);
}
std::optional<std::filesystem::path> choose(
    bool folder,
    const wchar_t* title,
    const COMDLG_FILTERSPEC* requested_filters = nullptr,
    UINT requested_filter_count = 0
) {
    IFileOpenDialog* dialog{};
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog)))) return std::nullopt;
    dialog->SetTitle(title);
    if (folder) {
        DWORD options{};
        dialog->GetOptions(&options);
        dialog->SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    } else if(requested_filters && requested_filter_count>0) {
        dialog->SetFileTypes(requested_filter_count,requested_filters);
        DWORD options{};
        dialog->GetOptions(&options);
        dialog->SetOptions(options|FOS_FORCEFILESYSTEM|FOS_FILEMUSTEXIST);
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
std::vector<std::filesystem::path> choose_multiple(
    const wchar_t* title,
    const COMDLG_FILTERSPEC* filters,
    UINT filter_count
) {
    IFileOpenDialog* dialog{};
    if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog)))) return {};
    dialog->SetTitle(title);
    dialog->SetFileTypes(filter_count,filters);
    DWORD options{};
    dialog->GetOptions(&options);
    dialog->SetOptions(options|FOS_FORCEFILESYSTEM|FOS_FILEMUSTEXIST|FOS_ALLOWMULTISELECT);

    std::vector<std::filesystem::path> results;
    if (SUCCEEDED(dialog->Show(app.window))) {
        IShellItemArray* items{};
        if (SUCCEEDED(dialog->GetResults(&items))) {
            DWORD count{};
            items->GetCount(&count);
            results.reserve(count);
            for (DWORD index=0;index<count;++index) {
                IShellItem* item{};
                if (FAILED(items->GetItemAt(index,&item))) continue;
                PWSTR path{};
                if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&path))) {
                    results.emplace_back(path);
                    CoTaskMemFree(path);
                }
                item->Release();
            }
            items->Release();
        }
    }
    dialog->Release();
    return results;
}
std::optional<std::filesystem::path> choose_export_output(
    const wchar_t* title,
    const wchar_t* label,
    const wchar_t* pattern,
    const wchar_t* extension,
    const wchar_t* default_name
) {
    IFileSaveDialog* dialog{};
    if (FAILED(CoCreateInstance(CLSID_FileSaveDialog,nullptr,CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog)))) return std::nullopt;
    dialog->SetTitle(title);
    const COMDLG_FILTERSPEC filters[]={{label,pattern}};
    dialog->SetFileTypes(1,filters);
    dialog->SetDefaultExtension(extension);
    dialog->SetFileName(default_name);
    DWORD options{};
    dialog->GetOptions(&options);
    dialog->SetOptions(options|FOS_FORCEFILESYSTEM|FOS_PATHMUSTEXIST|FOS_OVERWRITEPROMPT);
    std::optional<std::filesystem::path> result;
    if(SUCCEEDED(dialog->Show(app.window))) {
        IShellItem* item{};
        if(SUCCEEDED(dialog->GetResult(&item))) {
            PWSTR path{};
            if(SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH,&path))) {
                result=std::filesystem::path(path);
                CoTaskMemFree(path);
            }
            item->Release();
        }
    }
    dialog->Release();
    if(result&&result->extension().empty())result->replace_extension(
        std::wstring(L".")+extension);
    return result;
}
RECT canvas_rect() {
    RECT client{}; GetClientRect(app.window, &client);
    return {kPadding, kHeader + kSteps + kScopeBar,
            client.right - kPadding, client.bottom - kTimelineHeight};
}
int workspace_split() {
    RECT canvas=canvas_rect();
    return canvas.left+static_cast<int>((canvas.right-canvas.left)*.64);
}
RECT video_area() {
    RECT canvas=canvas_rect();
    return {canvas.left,canvas.top,workspace_split()-6,canvas.bottom};
}
RECT motion_area() {
    RECT canvas=canvas_rect();
    int split=workspace_split();
    int right_height=canvas.bottom-canvas.top;
    return {split+6,canvas.top,canvas.right,
            canvas.top+static_cast<int>(right_height*.56)};
}
RECT issues_area() {
    RECT canvas=canvas_rect();
    RECT motion=motion_area();
    return {motion.left,motion.bottom+8,canvas.right,canvas.bottom};
}
RECT timeline_area() {
    RECT client{}; GetClientRect(app.window,&client);
    return {kPadding,client.bottom-kTimelineHeight+10,
            client.right-kPadding,client.bottom-48};
}
RECT timeline_track() {
    RECT area=timeline_area();
    // The visible bar is near the bottom of the panel, but the whole video
    // track row must be easy to grab instead of being a one-pixel hit target.
    return {area.left+kTimelineLabelWidth,area.top+148,
            area.right-12,area.bottom-4};
}
struct TimelineRange { double start{}, end{}; };
std::optional<TimelineRange> timeline_range() {
    if(app.decoder&&app.decoder->is_open()) {
        return TimelineRange{0.0,std::max(0.001,app.decoder->info().duration_s)};
    }
    if(app.motion&&!app.motion->motion.time_s.empty()) {
        const auto& times=app.motion->motion.time_s;
        return TimelineRange{times.front(),std::max(times.front()+0.001,times.back())};
    }
    return {};
}
std::optional<TimelineRange> selected_range() {
    const auto full=timeline_range();
    if(!full||!app.range_start||!app.range_end)return {};
    const double start=std::clamp(std::min(*app.range_start,*app.range_end),full->start,full->end);
    const double end=std::clamp(std::max(*app.range_start,*app.range_end),full->start,full->end);
    if(end-start<1e-6)return {};
    return TimelineRange{start,end};
}
TimelineRange playback_range() {
    if(const auto selected=selected_range())return *selected;
    return *timeline_range();
}
void reset_range_selection() {
    app.range_start.reset(); app.range_end.reset(); app.loop_range=false;
    if(app.window)SetWindowTextW(GetDlgItem(app.window,kLoopRange),L"区间循环 · 关");
}
std::optional<animocap::MotionPackage> selected_motion_for_export() {
    if(!app.motion)return {};
    const auto selected=selected_range();
    if(!selected)return *app.motion;
    const auto& times=app.motion->motion.time_s;
    auto first=std::lower_bound(times.begin(),times.end(),selected->start);
    auto after_last=std::upper_bound(times.begin(),times.end(),selected->end);
    if(first==times.end())first=std::prev(times.end());
    if(after_last==times.begin())after_last=std::next(times.begin());
    const auto first_index=static_cast<std::size_t>(first-times.begin());
    const auto last_index=static_cast<std::size_t>(std::prev(after_last)-times.begin());
    return animocap::clip_motion_package(*app.motion,first_index,
        std::max(first_index,last_index));
}
RECT video_source_rect() {
    // Keep the preview in original video coordinates.  Both automatic and
    // manual ROIs are inference inputs; neither should reframe the preview.
    return {0,0,static_cast<LONG>(app.video_frame.width),
           static_cast<LONG>(app.video_frame.height)};
}
RECT frame_destination(RECT area,const animocap::VideoFrame& frame) {
    if(frame.width==0||frame.height==0)return area;
    RECT source{0,0,static_cast<LONG>(frame.width),static_cast<LONG>(frame.height)};
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
RECT video_destination(RECT area) {
    return frame_destination(area,app.video_frame);
}
void update_timeline() {
    const auto range=timeline_range();
    if(!range)return;
    const double duration=range->end-range->start;
    SendMessageW(app.timeline, TBM_SETPOS, TRUE,
                 static_cast<int>(std::clamp(
                     (app.time_s-range->start)/duration*10000.0,0.0,10000.0)));
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
        const auto& info=app.decoder->info();
        const double frame_step=1.0/std::max(1.0,info.fps);
        const double target=std::clamp(
            time_s,0.0,std::max(0.0,info.duration_s-frame_step));
        app.decoder->seek(target);
        animocap::VideoFrame candidate;
        bool decoded=false;
        while (app.decoder->read_frame(candidate)) {
            app.video_frame=std::move(candidate);
            decoded=true;
            if (app.video_frame.time_s>=target) break;
        }
        if (decoded) {
            app.time_s=app.video_frame.time_s;
            update_timeline();
            InvalidateRect(app.window,nullptr,FALSE);
        }
    } catch (const std::exception& error) {
        stop_playback(L"视频定位失败 · " + widen(error.what()));
    }
}
std::optional<double> timeline_time_from_point(POINT point) {
    const auto range=timeline_range();
    if(!range)return {};
    RECT track=timeline_track();
    if (point.x<track.left || point.x>track.right ||
        point.y<track.top || point.y>track.bottom) return {};
    const double ratio=static_cast<double>(point.x-track.left)/
        std::max<LONG>(1,track.right-track.left);
    return range->start+(range->end-range->start)*std::clamp(ratio,0.0,1.0);
}
bool open_video(const std::filesystem::path& path) {
    try {
        auto decoder = std::make_unique<animocap::VideoDecoder>();
        decoder->open(path);
        animocap::VideoFrame frame;
        if (!decoder->read_frame(frame)) throw std::runtime_error("video contains no decodable frames");
        app.video_path = path;
        app.decoder = std::move(decoder);
        app.video_frame = std::move(frame);
        app.time_s = app.video_frame.time_s;
        app.pose_baseline.reset(); app.profile_refined_pose.reset(); app.pose.reset();
        app.motion.reset(); app.multiview_diagnostics.reset();
        reset_range_selection();
        app.anchor_drag_snapshot.reset();
        app.manual_corrections.clear();
        app.correction_undo.clear(); app.correction_redo.clear();
        EnableWindow(GetDlgItem(app.window,kUndoCorrection),FALSE);
        EnableWindow(GetDlgItem(app.window,kRedoCorrection),FALSE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),FALSE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),FALSE);
        EnableWindow(GetDlgItem(app.window,kSaveMotion),FALSE);
        app.motion_dirty=false;
        app.multiview_mode=false; app.calibrated_multiview=false;
        app.multiview_videos={}; app.multiview_manifest.clear();
        app.multiview_preview_frames={};
        SetWindowTextW(GetDlgItem(app.window,kMultiview),L"导入四视角");
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
        return true;
    } catch (const std::exception& error) {
        MessageBoxW(app.window, widen(error.what()).c_str(), L"\u89c6\u9891\u5bfc\u5165\u5931\u8d25", MB_ICONERROR);
        return false;
    }
}
bool open_multiview_previews(const std::array<std::filesystem::path,4>& videos) {
    if(videos[0].empty()) {
        MessageBoxW(app.window,L"四视角预览缺少正面视频。",L"四视角导入失败",MB_ICONWARNING);
        return false;
    }
    const std::array<std::wstring,4> labels{L"正面",L"右侧",L"背面",L"左侧"};
    std::array<animocap::VideoFrame,4> frames{};
    for(std::size_t index=0;index<videos.size();++index) {
        if(videos[index].empty())continue;
        try {
            animocap::VideoDecoder decoder;
            decoder.open(videos[index]);
            if(!decoder.read_frame(frames[index]))
                throw std::runtime_error("video contains no decodable frames");
        } catch(const std::exception& error) {
            const auto message=labels[index]+L"视频无法预览："+
                videos[index].filename().wstring()+L"\n"+widen(error.what());
            MessageBoxW(app.window,message.c_str(),L"四视角导入失败",MB_ICONERROR);
            return false;
        }
    }
    if(!open_video(videos[0]))return false;
    frames[0]=app.video_frame;
    app.multiview_preview_frames=std::move(frames);
    return true;
}
void import_video() {
    if(!confirm_replace_dirty_motion())return;
    auto path = choose(false, L"\u5bfc\u5165\u52a8\u4f5c\u89c6\u9891");
    if (!path) return;
    open_video(*path);
}

void import_character_profile() {
    if(app.analyzing)return;
    const COMDLG_FILTERSPEC filters[] = {
        {L"\u89d2\u8272\u9884\u8bbe JSON",L"*.json"},
        {L"\u6240\u6709\u6587\u4ef6",L"*.*"},
    };
    const auto path=choose(false,L"\u5bfc\u5165\u89d2\u8272\u9aa8\u67b6\u9884\u8bbe\uff08profile.json \u6216 skeleton.json\uff09",
        filters,static_cast<UINT>(std::size(filters)));
    if(!path)return;
    try {
        auto loaded=animocap::load_character_profile(*path);
        std::optional<animocap::PoseSequence> updated_pose;
        std::optional<animocap::MotionPackage> updated_motion;
        std::optional<animocap::PoseOptimizationDiagnostics> updated_diagnostics;
        if(app.pose) {
            const auto baseline=app.pose_baseline.value_or(*app.pose);
            auto refinement=animocap::optimize_pose_sequence_detailed(
                baseline,loaded.optimization_options,&loaded.skeleton,
                loaded.proportion_policy);
            refinement.diagnostics.profile_id=loaded.profile_id;
            auto new_refined=std::move(refinement.sequence);
            updated_diagnostics=std::move(refinement.diagnostics);
            updated_pose=animocap::apply_manual_pose_corrections(
                new_refined,app.manual_corrections);
            app.pose_baseline=baseline;
            app.profile_refined_pose=new_refined;
            updated_motion=animocap::reconstruct_canonical_motion(
                *updated_pose,&loaded.skeleton);
            if(app.motion&&!app.motion->cameras.empty())
                updated_motion->cameras=app.motion->cameras;
        }

        app.character_profile=std::move(loaded);
        app.optimization_diagnostics=updated_diagnostics;
        if(updated_pose)app.pose=std::move(updated_pose);
        if(updated_motion) {
            app.motion=std::move(updated_motion);
            app.motion_dirty=true;
            EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
            EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
            EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
            update_timeline();
        }
        SetWindowTextW(GetDlgItem(app.window,kCharacterProfile),
            L"\u52a8\u753b\u89d2\u8272\u53c2\u8003 \u00b7 \u5df2\u542f\u7528");
        const int confidence_percent=static_cast<int>(std::round(
            app.character_profile->optimization_options.low_confidence_threshold*100.0));
        const auto policy=app.character_profile->proportion_policy==
            animocap::ProportionPolicy::SimilarReference
            ?L"\u76f8\u4f3c\u6bd4\u4f8b":L"\u7cbe\u786e\u6bd4\u4f8b";
        set_status(L"\u52a8\u753b\u89d2\u8272\u53c2\u8003\u5df2\u5bfc\u5165 \u00b7 "+
            widen(app.character_profile->skeleton.skeleton_id)+L" \u00b7 \u4f4e\u7f6e\u4fe1\u5ea6\u9608\u503c "+
            std::to_wstring(confidence_percent)+L"% \u00b7 "+policy+
            (updated_diagnostics
                ?L" \u00b7 \u4fee\u6b63 "+std::to_wstring(
                    updated_diagnostics->corrected_joint_samples)+L" \u4e2a\u4f4e\u7f6e\u4fe1\u5ea6\u6837\u672c \u00b7 \u6700\u5927 "+
                    std::to_wstring(static_cast<int>(std::round(
                        updated_diagnostics->maximum_correction_m*1000.0)))+L" mm"
                :L"")+
            (updated_motion?L" \u00b7 \u5df2\u91cd\u5efa\u5f53\u524d\u52a8\u4f5c":
                L" \u00b7 \u5c06\u5e94\u7528\u4e8e\u4e0b\u6b21\u6355\u6349"));
        InvalidateRect(app.window,nullptr,TRUE);
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),
            L"\u89d2\u8272\u9884\u8bbe\u5bfc\u5165\u5931\u8d25",MB_ICONERROR);
    }
}
std::string read_log_tail(const std::filesystem::path& path) {
    std::ifstream file(path, std::ios::binary);
    if (!file) return {};
    file.seekg(0, std::ios::end);
    const auto end=file.tellg();
    if (end <= 0) return {};
    constexpr std::streamoff kMaximumLogBytes=8192;
    const auto size=static_cast<std::streamoff>(end);
    const auto start=size>kMaximumLogBytes?size-kMaximumLogBytes:0;
    file.seekg(start, std::ios::beg);
    std::string text((std::istreambuf_iterator<char>(file)), {});
    if (start>0) text="...[log truncated]...\n"+text;
    return text;
}
int run_hidden(const std::wstring& command, const std::filesystem::path& directory,
               const std::filesystem::path& log_path={}, std::stop_token stop={}) {
    std::vector<wchar_t> buffer(command.begin(), command.end()); buffer.push_back(L'\0');
    STARTUPINFOW startup{}; startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
    SECURITY_ATTRIBUTES security{sizeof(SECURITY_ATTRIBUTES),nullptr,TRUE};
    HANDLE log_handle=INVALID_HANDLE_VALUE, input_handle=INVALID_HANDLE_VALUE;
    BOOL inherit_handles=FALSE;
    if(!log_path.empty()) {
        log_handle=CreateFileW(log_path.c_str(),GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,
                               &security,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,nullptr);
        input_handle=CreateFileW(L"NUL",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,
                                 &security,OPEN_EXISTING,FILE_ATTRIBUTE_NORMAL,nullptr);
        if(log_handle==INVALID_HANDLE_VALUE || input_handle==INVALID_HANDLE_VALUE) {
            if(log_handle!=INVALID_HANDLE_VALUE)CloseHandle(log_handle);
            if(input_handle!=INVALID_HANDLE_VALUE)CloseHandle(input_handle);
            throw std::runtime_error("cannot create Python inference log");
        }
        startup.dwFlags|=STARTF_USESTDHANDLES;
        startup.hStdInput=input_handle;
        startup.hStdOutput=log_handle;
        startup.hStdError=log_handle;
        inherit_handles=TRUE;
    }
    HANDLE job=CreateJobObjectW(nullptr,nullptr);
    if(job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
        limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,
                                    &limits,sizeof(limits))) {
            CloseHandle(job); job=nullptr;
        }
    }
    PROCESS_INFORMATION process{};
    if (!CreateProcessW(nullptr, buffer.data(), nullptr, nullptr, inherit_handles,
                        CREATE_NO_WINDOW|CREATE_SUSPENDED,nullptr, directory.c_str(),
                        &startup, &process)) {
        if(log_handle!=INVALID_HANDLE_VALUE)CloseHandle(log_handle);
        if(input_handle!=INVALID_HANDLE_VALUE)CloseHandle(input_handle);
        if(job)CloseHandle(job);
        throw std::runtime_error("cannot start Python inference process");
    }
    if(log_handle!=INVALID_HANDLE_VALUE)CloseHandle(log_handle);
    if(input_handle!=INVALID_HANDLE_VALUE)CloseHandle(input_handle);
    const bool assigned_to_job=job&&AssignProcessToJobObject(job,process.hProcess);
    ResumeThread(process.hThread);
    bool cancelled=false;
    while(WaitForSingleObject(process.hProcess,100)==WAIT_TIMEOUT) {
        if(!stop.stop_requested())continue;
        cancelled=true;
        if(assigned_to_job)TerminateJobObject(job,ERROR_CANCELLED);
        else TerminateProcess(process.hProcess,ERROR_CANCELLED);
        WaitForSingleObject(process.hProcess,5000);
        break;
    }
    DWORD code{}; GetExitCodeProcess(process.hProcess, &code);
    CloseHandle(process.hThread); CloseHandle(process.hProcess);
    if(job)CloseHandle(job);
    return cancelled ? static_cast<int>(ERROR_CANCELLED) : static_cast<int>(code);
}
bool load_multiview_folder(const std::filesystem::path& folder) {
    if(!confirm_replace_dirty_motion())return false;
    const auto synchronized_manifest=folder/"capture.json";
    if(std::filesystem::is_regular_file(synchronized_manifest)) {
        try {
            const auto manifest=animocap::load_capture_manifest(synchronized_manifest);
            if(manifest.mode==animocap::CaptureMode::SynchronizedMultiview) {
                std::array<std::filesystem::path,4> videos{};
                for(std::size_t index=0;index<manifest.views.size();++index) {
                    auto path=std::filesystem::path(manifest.views[index].video);
                    if(path.is_relative())path=folder/path;
                    if(!std::filesystem::is_regular_file(path))
                        throw std::runtime_error("synchronized view video is missing");
                    videos[index]=std::filesystem::weakly_canonical(path);
                }
                if(!open_multiview_previews(videos))return false;
                app.multiview_videos=std::move(videos);
                app.multiview_manifest=synchronized_manifest;
                app.multiview_mode=true;
                app.calibrated_multiview=true;
                app.auto_person_frame=true; app.manual_person_frame=false;
                app.has_person_frame=false;
                EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
                EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
                SetWindowTextW(GetDlgItem(app.window,kMultiview),L"4 视角已导入");
                set_status(L"同步标定多机已导入 · 将逐机提取关键点并执行透视三角化");
                InvalidateRect(app.window,nullptr,TRUE);
                return true;
            }
        } catch(const std::exception& error) {
            MessageBoxW(app.window,widen(error.what()).c_str(),
                L"同步多机导入失败",MB_ICONWARNING);
            return false;
        }
    }
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
    if(!open_multiview_previews(videos))return false;
    const auto imported_status=L"四视角已导入 · 正面 "+videos[0].filename().wstring()+
        L" / 右侧 "+videos[1].filename().wstring()+
        L" / 背面 "+videos[2].filename().wstring()+
        L" / 左侧 "+videos[3].filename().wstring();
    app.multiview_videos=std::move(videos);
    app.multiview_manifest.clear();
    app.multiview_mode=true;
    app.calibrated_multiview=false;
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    SetWindowTextW(GetDlgItem(app.window,kMultiview),L"4 视角已导入");
    set_status(imported_status);
    InvalidateRect(app.window,nullptr,TRUE);
    return true;
}
bool load_multiview_videos(const std::vector<std::filesystem::path>& selected) {
    if(selected.size()!=4) {
        MessageBoxW(app.window,L"请一次选择 4 个视频文件。\n文件名需分别包含 front、right、back、left（也支持正面、右侧、背面、左侧）。",
            L"四视角导入失败",MB_ICONWARNING);
        return false;
    }
    if(!confirm_replace_dirty_motion())return false;

    const std::array<std::vector<std::wstring>,4> aliases{{
        {L"front",L"正面"},{L"right",L"右侧"},
        {L"back",L"背面"},{L"left",L"左侧"}
    }};
    const std::array<std::wstring,4> labels{L"正面 front",L"右侧 right",L"背面 back",L"左侧 left"};
    std::array<std::vector<std::filesystem::path>,4> matches;
    for(const auto& path:selected) {
        std::wstring stem=path.stem().wstring();
        std::transform(stem.begin(),stem.end(),stem.begin(),::towlower);
        std::optional<std::size_t> matched_direction;
        for(std::size_t direction=0;direction<aliases.size();++direction) {
            bool direction_matches=false;
            for(const auto& alias:aliases[direction])
                if(stem.find(alias)!=std::wstring::npos) {
                    direction_matches=true;
                    break;
                }
            if(!direction_matches)continue;
            if(matched_direction&&*matched_direction!=direction) {
                MessageBoxW(app.window,
                    (L"文件“"+path.filename().wstring()+L"”包含多个方向词。\n"
                     L"每个文件名只能表示 front、right、back、left 中的一个方向。").c_str(),
                    L"四视角导入失败",MB_ICONWARNING);
                return false;
            }
            matched_direction=direction;
        }
        if(!matched_direction) {
            MessageBoxW(app.window,
                (L"无法识别文件“"+path.filename().wstring()+L"”的拍摄方向。\n"
                 L"请在文件名中加入 front、right、back 或 left。").c_str(),
                L"四视角导入失败",MB_ICONWARNING);
            return false;
        }
        matches[*matched_direction].push_back(path);
    }
    for(std::size_t direction=0;direction<matches.size();++direction) {
        if(matches[direction].size()!=1) {
            MessageBoxW(app.window,
                (L"无法唯一识别“"+labels[direction]+L"”视频。\n"
                 L"请让每个文件名仅包含一个对应方向词：front、right、back、left。").c_str(),
                L"四视角导入失败",MB_ICONWARNING);
            return false;
        }
    }

    std::array<std::filesystem::path,4> videos{
        std::filesystem::weakly_canonical(matches[0][0]),
        std::filesystem::weakly_canonical(matches[1][0]),
        std::filesystem::weakly_canonical(matches[2][0]),
        std::filesystem::weakly_canonical(matches[3][0])};
    if(!open_multiview_previews(videos))return false;
    const auto imported_status=L"四视角已导入 · 正面 "+videos[0].filename().wstring()+
        L" / 右侧 "+videos[1].filename().wstring()+
        L" / 背面 "+videos[2].filename().wstring()+
        L" / 左侧 "+videos[3].filename().wstring();
    app.multiview_videos=std::move(videos);
    app.multiview_manifest.clear();
    app.multiview_mode=true;
    app.calibrated_multiview=false;
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    SetWindowTextW(GetDlgItem(app.window,kMultiview),L"4 视角已导入");
    set_status(imported_status);
    InvalidateRect(app.window,nullptr,TRUE);
    return true;
}
void import_multiview() {
    const COMDLG_FILTERSPEC filters[] = {
        {L"四视角视频（请选择 4 个）",L"*.mp4;*.mov;*.avi;*.mkv;*.webm;*.m4v"},
        {L"同步采集清单",L"capture.json"}
    };
    auto selected=choose_multiple(
        L"选择 4 个方向视频（front / right / back / left），或选择 capture.json",
        filters,2);
    if(selected.empty())return;
    if(selected.size()==1&&_wcsicmp(selected[0].filename().c_str(),L"capture.json")==0) {
        load_multiview_folder(selected[0].parent_path());
        return;
    }
    load_multiview_videos(selected);
}
std::optional<std::string> log_event_name(const std::string& line) {
    const auto key=line.find("\"event\"");
    if(key==std::string::npos)return {};
    const auto colon=line.find(':',key+7);
    if(colon==std::string::npos)return {};
    const auto quote=line.find('"',colon+1);
    if(quote==std::string::npos)return {};
    const auto end=line.find('"',quote+1);
    if(end==std::string::npos)return {};
    return line.substr(quote+1,end-quote-1);
}
std::optional<std::size_t> log_integer(const std::string& line,const char* key) {
    const auto marker=std::string("\"")+key+"\"";
    const auto position=line.find(marker);
    if(position==std::string::npos)return {};
    const auto colon=line.find(':',position+marker.size());
    if(colon==std::string::npos)return {};
    std::size_t begin=colon+1;
    while(begin<line.size()&&(line[begin]<'0'||line[begin]>'9'))++begin;
    if(begin==line.size())return {};
    std::size_t end=begin;
    while(end<line.size()&&line[end]>='0'&&line[end]<='9')++end;
    try { return static_cast<std::size_t>(std::stoull(line.substr(begin,end-begin))); }
    catch(const std::exception&) { return {}; }
}
struct AnalysisLogState {
    bool found{};
    std::string event;
    std::size_t item{}, total{};
};
AnalysisLogState read_analysis_log(const std::filesystem::path& path) {
    AnalysisLogState state;
    std::ifstream file(path);
    if(!file)return state;
    std::string line;
    while(std::getline(file,line)) {
        const auto event=log_event_name(line);
        if(!event)continue;
        state.found=true;
        state.event=*event;
        if(const auto value=log_integer(line,"frame"))state.item=*value;
        if(const auto value=log_integer(line,"item"))state.item=*value;
        if(const auto value=log_integer(line,"total"))state.total=*value;
    }
    return state;
}
std::wstring format_elapsed(double seconds) {
    if(!std::isfinite(seconds)||seconds<1.0)return L"计算中";
    const auto rounded=static_cast<long long>(std::lround(seconds));
    if(rounded<60)return std::to_wstring(rounded)+L"秒";
    const auto minutes=rounded/60;
    const auto remainder=rounded%60;
    if(minutes<60)return std::to_wstring(minutes)+L"分"+std::to_wstring(remainder)+L"秒";
    return std::to_wstring(minutes/60)+L"小时"+
           std::to_wstring(minutes%60)+L"分";
}
void update_analysis_progress() {
    if(!app.analyzing)return;
    if(app.cancel_requested) {
        set_status(L"正在取消动作捕捉 · 已生成的中间结果会保留…");
        return;
    }
    const auto mmpose=read_analysis_log(app.analysis_mmpose_log);
    const auto vlm=read_analysis_log(app.analysis_vlm_log);
    const auto stage_ratio=[](std::size_t item,std::size_t total) {
        return total?std::clamp(static_cast<double>(item)/total,0.0,1.0):0.0;
    };
    double fraction=0.0;
    std::wstring stage=L"正在加载 MMPose 模型";
    std::size_t item=0,total=0;
    if(vlm.event=="vlm_progress") {
        stage=L"本地视觉纠错";
        item=vlm.item; total=vlm.total;
        fraction=.86+.10*stage_ratio(item,total);
    } else if(vlm.event=="complete"||vlm.event=="error") {
        stage=L"正在整理视觉纠错结果";
        fraction=.96;
    } else if(mmpose.event=="progress") {
        stage=L"HRNet + 光流动作捕捉";
        item=mmpose.item; total=mmpose.total;
        fraction=.04+.82*stage_ratio(item,total);
    } else if(mmpose.event=="complete") {
        stage=app.vlm_enabled?L"正在启动本地视觉纠错":L"正在整理动作数据";
        fraction=app.vlm_enabled?.86:.94;
    } else if(mmpose.event=="error") {
        stage=L"正在整理失败信息";
        fraction=.12;
    }
    const int percent=static_cast<int>(std::lround(std::clamp(fraction,0.0,1.0)*100.0));
    SendMessageW(app.progress,PBM_SETPOS,percent,0);
    const double elapsed=std::chrono::duration<double>(
        std::chrono::steady_clock::now()-app.analysis_started).count();
    std::wstring message=L"Mocap · "+stage+L" · "+std::to_wstring(percent)+L"%";
    if(total)message+=L" · 帧 "+std::to_wstring(item)+L"/"+std::to_wstring(total);
    message+=L" · 已用 "+format_elapsed(elapsed);
    if(fraction>.08&&fraction<.995) {
        const double remaining=elapsed*(1.0/fraction-1.0);
        message+=L" · 预计剩余 "+format_elapsed(remaining);
    } else if(fraction<.995) {
        message+=L" · 正在估算剩余时间";
    }
    set_status(message);
}
std::filesystem::path unique_output() {
    auto stamp = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    return app.root / "outputs" / (app.video_path.stem().wstring() + L"-" + std::to_wstring(stamp));
}
void cancel_analysis() {
    if(!app.analyzing||app.cancel_requested)return;
    app.cancel_requested=true;
    app.worker.request_stop();
    EnableWindow(GetDlgItem(app.window,kAnalyze),FALSE);
    set_status(L"正在取消动作捕捉 · 已生成的中间结果会保留…");
}
void start_analysis() {
    if (app.analyzing) { cancel_analysis(); return; }
    if(!confirm_replace_dirty_motion())return;
    if (app.video_path.empty()) {
        MessageBoxW(app.window,L"请先导入一个视频。",L"AniMocap Fusion",MB_ICONINFORMATION);
        return;
    }
    if (app.selecting_person_frame || app.drawing_person_frame) {
        MessageBoxW(app.window,L"请先完成手动框选，再开始捕捉。",L"人物范围尚未完成",MB_ICONINFORMATION);
        return;
    }
    auto video=app.video_path,root=app.root,output=unique_output();
    const auto mmpose_log=output/"mmpose.log";
    const auto vlm_log=output/"vlm.log";
    app.analyzing=true;
    app.cancel_requested=false;
    app.analysis_mmpose_log=mmpose_log;
    app.analysis_vlm_log=vlm_log;
    app.analysis_started=std::chrono::steady_clock::now();
    SetWindowTextW(GetDlgItem(app.window,kAnalyze),L"取消捕捉");
    EnableWindow(GetDlgItem(app.window,kAnalyze),TRUE);
    EnableWindow(GetDlgItem(app.window,kAutoFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kImport),FALSE);
    EnableWindow(GetDlgItem(app.window,kMultiview),FALSE);
    EnableWindow(GetDlgItem(app.window,kCharacterProfile),FALSE);
    EnableWindow(GetDlgItem(app.window,kExportBvh),FALSE);
    EnableWindow(GetDlgItem(app.window,kExportVrma),FALSE);
    EnableWindow(GetDlgItem(app.window,kSaveMotion),FALSE);
    if (app.multiview_mode) {
        SendMessageW(app.progress,PBM_SETMARQUEE,TRUE,35);
        ShowWindow(app.progress,SW_SHOW);
        set_status(app.calibrated_multiview
            ? L"同步多机捕捉 · 正在逐机提取关节，随后执行标定透视三角化…"
            : L"四视角捕捉 · 正在逐视角提取关节，随后自动相位对齐并联合求解…");
    } else {
        SendMessageW(app.progress,PBM_SETMARQUEE,FALSE,0);
        SendMessageW(app.progress,PBM_SETRANGE32,0,100);
        SendMessageW(app.progress,PBM_SETPOS,0,0);
        ShowWindow(app.progress,SW_SHOW);
        SetTimer(app.window,kTimerAnalysisProgress,250,nullptr);
        if (app.manual_person_frame && app.has_person_frame) {
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
    }
    const bool has_person_frame=app.manual_person_frame && app.has_person_frame;
    const RECT person_frame=app.person_frame;
    const bool use_vlm=app.vlm_enabled;
    const bool multiview_mode=app.multiview_mode;
    const bool calibrated_multiview=app.calibrated_multiview;
    const auto multiview_manifest=app.multiview_manifest;
    const auto multiview_videos=app.multiview_videos;
    const auto character_profile=app.character_profile;
    const double capture_fps=app.decoder ? app.decoder->info().fps : 30.0;
    HWND window=app.window;
    app.worker=std::jthread([video,root,output,mmpose_log,vlm_log,window,has_person_frame,
                             person_frame,use_vlm,multiview_mode,
                             calibrated_multiview,multiview_manifest,
                             multiview_videos,capture_fps,
                             character_profile](std::stop_token stop) {
        auto result=std::make_unique<AnalysisResult>();
        try {
            const auto* profile=character_profile?
                &character_profile->skeleton:nullptr;
            const auto optimization_options=character_profile?
                character_profile->optimization_options:
                animocap::PoseOptimizationOptions{};
            const auto proportion_policy=character_profile?
                character_profile->proportion_policy:
                animocap::ProportionPolicy::ExactReference;
            auto throw_if_cancelled=[&stop]() {
                if(stop.stop_requested())throw AnalysisCancelled{};
            };
            throw_if_cancelled();
            std::filesystem::create_directories(output);
            auto python=root/".venv-mmpose/Scripts/python.exe";
            if(!std::filesystem::exists(python))python=L"python.exe";
            if(multiview_mode) {
                auto manifest_path=multiview_manifest;
                if(manifest_path.empty()) {
                    animocap::CaptureManifest manifest;
                    manifest.mode=animocap::CaptureMode::DirectionalRepeat;
                    manifest.fps=capture_fps;
                    manifest.output_directory=output.generic_string();
                    const std::array<std::string,4> ids{"front","right","back","left"};
                    const std::array<double,4> yaws{0.0,90.0,180.0,-90.0};
                    for(std::size_t index=0;index<ids.size();++index)
                        manifest.views.push_back({
                            ids[index],multiview_videos[index].generic_string(),yaws[index]});
                    manifest_path=output/"capture.multiview.json";
                    animocap::save_capture_manifest(manifest,manifest_path);
                }
                auto pipeline=root/"python/animocap_ml_adapters/multiview_pipeline.py";
                std::wstring command=quote(python)+L" "+quote(pipeline)+
                    L" --manifest "+quote(manifest_path)+L" --output "+quote(output)+
                    L" --quality maximum --segmentation auto";
                if(!use_vlm)command+=L" --no-vlm";
                const auto pipeline_exit=run_hidden(command,root,{},stop);
                if(pipeline_exit==static_cast<int>(ERROR_CANCELLED))throw AnalysisCancelled{};
                if(pipeline_exit!=0)
                    throw std::runtime_error(
                        "multiview pipeline failed; intermediate per-view poses were preserved");
                throw_if_cancelled();
                result->pose_baseline=animocap::load_pose_sequence_json(
                    output/"fused_pose_sequence.json");
                auto refinement=animocap::optimize_pose_sequence_detailed(
                    *result->pose_baseline,optimization_options,profile,
                    proportion_policy);
                if(character_profile)
                    refinement.diagnostics.profile_id=character_profile->profile_id;
                result->pose=std::move(refinement.sequence);
                result->optimization_diagnostics=std::move(refinement.diagnostics);
                result->motion_path=output/"motion.amotion";
                auto generated_motion=animocap::load_motion_package(result->motion_path);
                if(profile) {
                    result->motion=animocap::reconstruct_canonical_motion(
                        *result->pose,profile);
                    result->motion->cameras=std::move(generated_motion.cameras);
                    animocap::save_motion_package(*result->motion,result->motion_path);
                } else result->motion=std::move(generated_motion);
                if(!calibrated_multiview)
                    result->diagnostics=animocap::load_multiview_diagnostics(
                        output/"multiview-diagnostics.json");
            } else {
                auto adapter=root/"python/animocap_ml_adapters/mmpose_adapter.py";
                auto observations=output/"pose_sequence.json";
            std::wstring command=quote(python)+L" "+quote(adapter)+
                L" --input "+quote(video)+L" --output "+quote(observations)+
                L" --quality maximum --segmentation auto";
            if(has_person_frame) {
                command+=L" --roi "+std::to_wstring(person_frame.left)+L" "+
                    std::to_wstring(person_frame.top)+L" "+
                    std::to_wstring(person_frame.right-person_frame.left)+L" "+
                    std::to_wstring(person_frame.bottom-person_frame.top);
            }
            const auto mmpose_exit_code=run_hidden(command,root,mmpose_log,stop);
            if(mmpose_exit_code==static_cast<int>(ERROR_CANCELLED))throw AnalysisCancelled{};
            if(mmpose_exit_code!=0) {
                auto message="MMPose inference failed (exit code "+
                    std::to_string(static_cast<unsigned long>(mmpose_exit_code))+
                    "). See "+mmpose_log.string()+".";
                const auto details=read_log_tail(mmpose_log);
                if(!details.empty()) message+="\n"+details;
                throw std::runtime_error(message);
            }

            auto final_observations=observations;
            throw_if_cancelled();
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
                const auto vlm_exit_code=run_hidden(vlm_command,root,vlm_log,stop);
                if(vlm_exit_code==static_cast<int>(ERROR_CANCELLED))throw AnalysisCancelled{};
                if(vlm_exit_code==0 &&
                    std::filesystem::exists(corrected))
                    final_observations=corrected;
                else
                    result->warning=
                        L"本地视觉纠错未运行；已保留 HRNet + 光流结果。请配置 Qwen3-VL。";
            }
            throw_if_cancelled();
            result->pose_baseline=animocap::smooth_pose_sequence(
                animocap::load_pose_sequence_json(final_observations));
            auto refinement=animocap::optimize_pose_sequence_detailed(
                *result->pose_baseline,optimization_options,profile,
                proportion_policy);
            if(character_profile)
                refinement.diagnostics.profile_id=character_profile->profile_id;
            result->pose=std::move(refinement.sequence);
            result->optimization_diagnostics=std::move(refinement.diagnostics);
            result->motion=animocap::reconstruct_canonical_motion(
                *result->pose,profile);
            result->motion_path=output/"motion.amotion";
            animocap::save_motion_package(*result->motion,result->motion_path);
            }
        } catch(const AnalysisCancelled&) {
            result->cancelled=true;
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
    if(!confirm_replace_dirty_motion())return;
    auto path = choose(true, L"\u9009\u62e9 motion.amotion \u6587\u4ef6\u5939");
    if (!path) return;
    try {
        app.motion = animocap::load_motion_package(*path);
        app.pose.reset();
        app.pose_baseline.reset();
        app.profile_refined_pose.reset();
        app.multiview_diagnostics.reset();
        app.anchor_drag_snapshot.reset();
        app.manual_corrections.clear();
        app.correction_undo.clear(); app.correction_redo.clear();
        update_correction_controls();
        app.motion_path = *path;
        app.time_s = app.motion->motion.time_s.front();
        reset_range_selection();
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        app.motion_dirty=false;
        update_timeline();
        set_status(L"\u52a8\u4f5c\u5df2\u52a0\u8f7d \u00b7 " + std::to_wstring(app.motion->motion.frame_count) + L" \u5e27");
        InvalidateRect(app.window, nullptr, TRUE);
    } catch (const std::exception& error) {
        MessageBoxW(app.window, widen(error.what()).c_str(), L"\u52a8\u4f5c\u52a0\u8f7d\u5931\u8d25", MB_ICONERROR);
    }
}
void export_bvh_file() {
    if(!app.motion) {
        MessageBoxW(app.window,L"请先完成捕捉或打开一个动作包。",L"无法导出 BVH",MB_ICONINFORMATION);
        return;
    }
    const auto output=choose_export_output(
        L"导出 BVH 动作",L"Biovision Hierarchy",L"*.bvh",L"bvh",L"motion.bvh");
    if(!output)return;
    try {
        const auto export_motion=selected_motion_for_export();
        animocap::export_bvh(*export_motion,*output,{animocap::BvhUnit::Centimeters,true});
        set_status(L"BVH 已导出 · "+output->wstring()+
                   L" · 厘米单位 · 置信度与诊断仍保留在原始 .amotion 中");
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"BVH 导出失败",MB_ICONERROR);
    }
}
void export_vrma_file() {
    if(!app.motion) {
        MessageBoxW(app.window,L"请先完成捕捉或打开一个动作包。",L"无法导出 VRMA",MB_ICONINFORMATION);
        return;
    }
    const auto output=choose_export_output(
        L"导出 VRM Animation",L"VRM Animation 1.0",L"*.vrma",L"vrma",L"motion.vrma");
    if(!output)return;
    try {
        const auto export_motion=selected_motion_for_export();
        animocap::export_vrma(*export_motion,*output,{true});
        set_status(L"VRMA 1.0 已导出 · "+output->wstring()+
                   L" · 置信度与诊断仍保留在原始 .amotion 中");
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"VRMA 导出失败",MB_ICONERROR);
    }
}
bool save_motion_copy() {
    if(!app.motion) {
        MessageBoxW(app.window,L"当前没有可保存的规范动作。",L"保存动作",MB_ICONINFORMATION);
        return false;
    }
    const auto folder=choose(true,L"选择修正动作的保存位置");
    if(!folder)return false;
    std::wstring stem=L"motion";
    if(!app.motion_path.empty()&&!app.motion_path.stem().wstring().empty()) {
        stem=app.motion_path.stem().wstring();
    }
    const auto stamp=std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    const auto output=*folder/(stem+L"-corrected-"+std::to_wstring(stamp)+L".amotion");
    try {
        animocap::save_motion_package(*app.motion,output);
        app.motion_path=output;
        app.motion_dirty=false;
        set_status(L"动作已保存 · "+output.wstring());
        return true;
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"动作保存失败",MB_ICONERROR);
        return false;
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
RECT inset(RECT rect,int amount) {
    InflateRect(&rect,-amount,-amount);
    return rect;
}
void rounded_box(HDC dc,RECT rect,COLORREF background,COLORREF border,int radius=8) {
    HBRUSH brush=CreateSolidBrush(background);
    HPEN pen=CreatePen(PS_SOLID,1,border);
    auto old_brush=SelectObject(dc,brush);
    auto old_pen=SelectObject(dc,pen);
    RoundRect(dc,rect.left,rect.top,rect.right,rect.bottom,radius,radius);
    SelectObject(dc,old_pen);SelectObject(dc,old_brush);
    DeleteObject(pen);DeleteObject(brush);
}
void panel_box(HDC dc,RECT rect,COLORREF background,COLORREF border,int radius=8) {
    RECT shadow=rect;
    OffsetRect(&shadow,0,2);
    rounded_box(dc,shadow,theme::panel_shadow,theme::panel_shadow,radius);
    rounded_box(dc,rect,background,border,radius);
}
void panel_accent(HDC dc,RECT area,COLORREF color) {
    RECT bar{area.left+1,area.top+10,area.left+4,
             std::min<LONG>(area.bottom-10,area.top+34)};
    if(bar.bottom>bar.top) fill(dc,bar,color);
}
void rounded_outline(HDC dc,RECT rect,COLORREF color,int radius=8) {
    HPEN pen=CreatePen(PS_SOLID,1,color);
    auto old_pen=SelectObject(dc,pen);
    auto old_brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
    RoundRect(dc,rect.left,rect.top,rect.right,rect.bottom,radius,radius);
    SelectObject(dc,old_brush);SelectObject(dc,old_pen);DeleteObject(pen);
}
void stroke(HDC dc,POINT from,POINT to,COLORREF color,int width=1) {
    HPEN pen=CreatePen(PS_SOLID,width,color);
    auto old=SelectObject(dc,pen);
    MoveToEx(dc,from.x,from.y,nullptr);LineTo(dc,to.x,to.y);
    SelectObject(dc,old);DeleteObject(pen);
}
void text(HDC dc, const std::wstring& value, RECT rect, COLORREF color, HFONT font,
          UINT flags = DT_LEFT | DT_VCENTER | DT_SINGLELINE) {
    SetBkMode(dc, TRANSPARENT); SetTextColor(dc, color); SelectObject(dc, font);
    DrawTextW(dc, value.c_str(), -1, &rect, flags);
}
std::wstring timecode(double time_s) {
    const auto milliseconds=static_cast<long long>(std::llround(std::max(0.0,time_s)*1000.0));
    const auto minutes=milliseconds/60000;
    const auto seconds=(milliseconds/1000)%60;
    const auto millis=milliseconds%1000;
    wchar_t buffer[32]{};
    swprintf_s(buffer,L"%02lld:%02lld.%03lld",minutes,seconds,millis);
    return buffer;
}
void draw_person_frame_selection(HDC dc) {
    if (!app.drawing_person_frame) return;
    RECT box{
        std::min(app.frame_start.x,app.frame_current.x),
        std::min(app.frame_start.y,app.frame_current.y),
        std::max(app.frame_start.x,app.frame_current.x),
        std::max(app.frame_start.y,app.frame_current.y)
    };
    HPEN pen=CreatePen(PS_DASH,2,theme::amber);
    auto old_pen=SelectObject(dc,pen);
    auto old_brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
    Rectangle(dc,box.left,box.top,box.right,box.bottom);
    SelectObject(dc,old_brush);
    SelectObject(dc,old_pen);
    DeleteObject(pen);
}
void draw_person_frame_box(HDC dc, RECT destination, RECT source) {
    if (!app.manual_person_frame || !app.has_person_frame) return;
    const LONG source_width=source.right-source.left;
    const LONG source_height=source.bottom-source.top;
    const LONG destination_width=destination.right-destination.left;
    const LONG destination_height=destination.bottom-destination.top;
    if (source_width<=0 || source_height<=0 || destination_width<=0 || destination_height<=0)
        return;

    const double sx=static_cast<double>(destination_width)/source_width;
    const double sy=static_cast<double>(destination_height)/source_height;
    RECT box{
        destination.left+static_cast<LONG>(std::lround((app.person_frame.left-source.left)*sx)),
        destination.top+static_cast<LONG>(std::lround((app.person_frame.top-source.top)*sy)),
        destination.left+static_cast<LONG>(std::lround((app.person_frame.right-source.left)*sx)),
        destination.top+static_cast<LONG>(std::lround((app.person_frame.bottom-source.top)*sy))
    };
    HPEN pen=CreatePen(PS_SOLID,3,theme::amber);
    auto old_pen=SelectObject(dc,pen);
    auto old_brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
    Rectangle(dc,box.left,box.top,box.right,box.bottom);
    SelectObject(dc,old_brush);
    SelectObject(dc,old_pen);
    DeleteObject(pen);
}
bool draw_frame_bitmap(HDC dc,RECT area,const animocap::VideoFrame& frame) {
    if(frame.bgra.empty()||frame.width==0||frame.height==0)return false;
    const RECT destination=frame_destination(area,frame);
    BITMAPINFO bitmap{};bitmap.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    bitmap.bmiHeader.biWidth=static_cast<LONG>(frame.width);
    bitmap.bmiHeader.biHeight=-static_cast<LONG>(frame.height);
    bitmap.bmiHeader.biPlanes=1;bitmap.bmiHeader.biBitCount=32;
    bitmap.bmiHeader.biCompression=BI_RGB;
    POINT old_origin{};
    const int old_stretch_mode=SetStretchBltMode(dc,HALFTONE);
    SetBrushOrgEx(dc,destination.left,destination.top,&old_origin);
    StretchDIBits(dc,destination.left,destination.top,
        destination.right-destination.left,destination.bottom-destination.top,
        0,0,static_cast<int>(frame.width),static_cast<int>(frame.height),
        frame.bgra.data(),&bitmap,DIB_RGB_COLORS,SRCCOPY);
    SetBrushOrgEx(dc,old_origin.x,old_origin.y,nullptr);
    SetStretchBltMode(dc,old_stretch_mode);
    return true;
}
void draw_multiview_preview(HDC dc,RECT area) {
    panel_box(dc,area,RGB(7,12,18),theme::border,8);
    const RECT inner=inset(area,8);
    constexpr int gap=8;
    const int middle_x=(inner.left+inner.right)/2;
    const int middle_y=(inner.top+inner.bottom)/2;
    const std::array<RECT,4> cells{{
        {inner.left,inner.top,middle_x-gap/2,middle_y-gap/2},
        {middle_x+gap/2,inner.top,inner.right,middle_y-gap/2},
        {inner.left,middle_y+gap/2,middle_x-gap/2,inner.bottom},
        {middle_x+gap/2,middle_y+gap/2,inner.right,inner.bottom}
    }};
    const std::array<std::wstring,4> labels{L"正面 · FRONT",L"右侧 · RIGHT",
        L"背面 · BACK",L"左侧 · LEFT"};
    const std::array<COLORREF,4> accents{theme::accent,theme::violet,theme::amber,theme::green};
    for(std::size_t index=0;index<cells.size();++index) {
        const RECT cell=cells[index];
        panel_box(dc,cell,RGB(10,16,23),theme::border_soft,6);
        RECT header{cell.left+1,cell.top+1,cell.right-1,cell.top+31};
        fill(dc,header,theme::surface_raised);
        fill(dc,{header.left,header.top,header.left+4,header.bottom},accents[index]);
        std::wstring title=labels[index];
        if(!app.multiview_videos[index].empty())
            title+=L"  ·  "+app.multiview_videos[index].filename().wstring();
        text(dc,title,{header.left+12,header.top,header.right-8,header.bottom},
             theme::text,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
        RECT preview{cell.left+5,header.bottom+4,cell.right-5,cell.bottom-5};
        fill(dc,preview,RGB(4,8,12));
        if(!draw_frame_bitmap(dc,preview,app.multiview_preview_frames[index])) {
            text(dc,app.multiview_videos[index].empty()?L"未提供此视角":L"预览不可用",
                 preview,theme::text_muted,app.font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        }
        rounded_outline(dc,cell,theme::border,6);
    }
}
std::wstring joint_display_name(animocap::BoneSemantic semantic) {
    using S=animocap::BoneSemantic;
    switch(semantic) {
    case S::SceneRoot:return L"根节点";
    case S::Hips:return L"骨盆";
    case S::Spine:return L"脊柱";
    case S::Chest:return L"胸部";
    case S::UpperChest:return L"上胸";
    case S::Neck:return L"颈部";
    case S::Head:return L"头部";
    case S::LeftShoulder:return L"左锁骨";
    case S::LeftUpperArm:return L"左肩";
    case S::LeftLowerArm:return L"左肘";
    case S::LeftHand:return L"左手";
    case S::RightShoulder:return L"右锁骨";
    case S::RightUpperArm:return L"右肩";
    case S::RightLowerArm:return L"右肘";
    case S::RightHand:return L"右手";
    case S::LeftUpperLeg:return L"左髋";
    case S::LeftLowerLeg:return L"左膝";
    case S::LeftFoot:return L"左踝";
    case S::LeftToes:return L"左脚尖";
    case S::RightUpperLeg:return L"右髋";
    case S::RightLowerLeg:return L"右膝";
    case S::RightFoot:return L"右踝";
    case S::RightToes:return L"右脚尖";
    }
    return L"关节";
}
struct JointOverlayLabel {
    POINT joint{};
    RECT box{};
    std::wstring name;
    COLORREF color{};
    bool left_column{};
};
void layout_joint_label_column(std::vector<JointOverlayLabel>& labels,
                               std::vector<std::size_t> indices,
                               RECT bounds,bool left_column) {
    if(indices.empty())return;
    std::sort(indices.begin(),indices.end(),[&labels](std::size_t a,std::size_t b) {
        return labels[a].joint.y<labels[b].joint.y;
    });
    constexpr int label_width=58,label_height=18,gap=2;
    const int top=static_cast<int>(bounds.top)+6;
    const int bottom=static_cast<int>(bounds.bottom)-6;
    const int x=left_column?static_cast<int>(bounds.left)+6:
        static_cast<int>(bounds.right)-6-label_width;
    std::vector<int> positions(indices.size());
    for(std::size_t rank=0;rank<indices.size();++rank) {
        const int desired=std::clamp(
            static_cast<int>(labels[indices[rank]].joint.y)-label_height/2,
            top,bottom-label_height);
        positions[rank]=rank==0?desired:
            std::max(desired,positions[rank-1]+label_height+gap);
    }
    if(positions.back()+label_height>bottom) {
        positions.back()=bottom-label_height;
        for(std::size_t rank=indices.size()-1;rank>0;--rank)
            positions[rank-1]=std::min(
                positions[rank-1],positions[rank]-label_height-gap);
    }
    if(positions.front()<top) {
        positions.front()=top;
        for(std::size_t rank=1;rank<indices.size();++rank)
            positions[rank]=std::max(
                positions[rank],positions[rank-1]+label_height+gap);
    }
    for(std::size_t rank=0;rank<indices.size();++rank)
        labels[indices[rank]].box={x,positions[rank],x+label_width,
                                  positions[rank]+label_height};
}
void draw_joint_labels(HDC dc,RECT bounds,std::vector<JointOverlayLabel> labels) {
    std::vector<std::size_t> left,right;
    for(std::size_t index=0;index<labels.size();++index)
        (labels[index].left_column?left:right).push_back(index);
    layout_joint_label_column(labels,std::move(left),bounds,true);
    layout_joint_label_column(labels,std::move(right),bounds,false);
    for(const auto& label:labels) {
        const POINT edge{label.left_column?label.box.right:label.box.left,
                         (label.box.top+label.box.bottom)/2};
        stroke(dc,label.joint,edge,theme::text_faint,1);
    }
    for(const auto& label:labels) {
        rounded_box(dc,label.box,RGB(7,13,20),label.color,6);
        text(dc,label.name,label.box,theme::text,app.small_font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    }
}
void draw_video(HDC dc, RECT area) {
    panel_box(dc,area,RGB(7,12,18),theme::border,8);
    if (app.video_frame.bgra.empty()) {
        const int center_x=(area.left+area.right)/2;
        const int center_y=(area.top+area.bottom)/2-18;
        RECT icon{center_x-28,center_y-20,center_x+28,center_y+20};
        rounded_outline(dc,icon,theme::border,8);
        POINT play[]={{center_x-5,center_y-9},{center_x-5,center_y+9},{center_x+11,center_y}};
        HBRUSH brush=CreateSolidBrush(theme::accent);auto old=SelectObject(dc,brush);
        Polygon(dc,play,3);SelectObject(dc,old);DeleteObject(brush);
        text(dc,L"打开视频开始动作捕捉",
             {area.left+20,center_y+32,area.right-20,center_y+64},theme::text,
             app.section_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        text(dc,L"原始画面与 2D 关键点会在这里保持同步",
             {area.left+20,center_y+62,area.right-20,center_y+92},theme::text_muted,
             app.font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
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
    draw_person_frame_box(dc,destination,source);
    if (!app.pose || app.scrubbing) {
        rounded_outline(dc,area,theme::border,8);
        return;
    }
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
    HPEN pen = CreatePen(PS_SOLID, 3, theme::accent);
    auto old_pen=SelectObject(dc,pen);
    for (std::size_t i=1; i<skeleton.bones.size(); ++i) {
        auto parent = static_cast<std::size_t>(skeleton.bones[i].parent);
        if (!frame.joints[i].valid || !frame.joints[parent].valid) continue;
        auto a=point(parent), b=point(i); MoveToEx(dc,a.x,a.y,nullptr); LineTo(dc,b.x,b.y);
    }
    SelectObject(dc,old_pen); DeleteObject(pen);
    std::vector<JointOverlayLabel> labels;
    labels.reserve(skeleton.bones.size());
    const int video_center=(destination.left+destination.right)/2;
    for (std::size_t i=0; i<skeleton.bones.size(); ++i) {
        if (!frame.joints[i].valid) continue;
        auto p=point(i); float confidence=frame.joints[i].confidence;
        COLORREF color = confidence>=.65f ? theme::green :
                         confidence>=.3f ? theme::amber : theme::red;
        int radius=app.calibrating ? 7 : 4;
        if (app.dragging_anchor==static_cast<int>(i)) color=RGB(255,255,255);
        HBRUSH brush=CreateSolidBrush(color); auto old=SelectObject(dc,brush);
        Ellipse(dc,p.x-radius,p.y-radius,p.x+radius+1,p.y+radius+1);
        SelectObject(dc,old); DeleteObject(brush);
        bool left_column=p.x<video_center;
        if(std::abs(p.x-video_center)<14)left_column=(i%2)==0;
        labels.push_back({p,{},joint_display_name(skeleton.bones[i].semantic),
                          color,left_column});
    }
    draw_joint_labels(dc,destination,std::move(labels));
    RestoreDC(dc,saved_dc);
    rounded_outline(dc,area,theme::border,8);
}
animocap::Vec2 project(const animocap::Vec3& value, RECT area) {
    double yaw=app.yaw*kPi/180.0, pitch=app.pitch*kPi/180.0;
    double cy=std::cos(yaw), sy=std::sin(yaw), cp=std::cos(pitch), sp=std::sin(pitch);
    double x=cy*value.x+sy*value.z, z=-sy*value.x+cy*value.z;
    double y=cp*value.y-sp*z, scale=static_cast<double>(area.bottom-area.top)/2.28;
    return {(area.left+area.right)*.5+x*scale, area.bottom-28.0-y*scale};
}
void draw_motion(HDC dc, RECT area) {
    panel_box(dc,area,theme::surface,theme::border,8);
    panel_accent(dc,area,app.pose?theme::violet:theme::accent);
    RECT label=area; label.left+=18; label.top+=8; label.bottom=label.top+28;
    text(dc,app.pose ? L"OBSERVED 2.5D" : L"CANONICAL 3D",
         label,theme::accent,app.small_font);
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
            motion.scene_root_rotation[frame],
            motion.hips_translation_m[frame]);
        positions=std::move(fk.positions_m);
        auto confidence_begin=motion.confidence.begin()+
            static_cast<std::ptrdiff_t>(frame*motion.joint_count);
        confidences.assign(confidence_begin,
            confidence_begin+static_cast<std::ptrdiff_t>(motion.joint_count));
    }
    HPEN grid=CreatePen(PS_SOLID,1,theme::border_soft);
    auto old_pen=SelectObject(dc,grid);
    int ground=static_cast<int>(project({0,0,0},area).y);
    const int center=(area.left+area.right)/2;
    for(int depth=0;depth<6;++depth) {
        const double ratio=depth/5.0;
        const int y=ground-static_cast<int>(ratio*std::max<LONG>(18,ground-area.top-54));
        const int half=static_cast<int>((area.right-area.left-56)*(1.0-ratio*.72)/2.0);
        MoveToEx(dc,center-half,y,nullptr);LineTo(dc,center+half,y);
    }
    for(int lane=-4;lane<=4;++lane) {
        MoveToEx(dc,center+lane*(area.right-area.left-56)/8,ground,nullptr);
        LineTo(dc,center+lane*12,area.top+54);
    }
    SelectObject(dc,old_pen); DeleteObject(grid);
    stroke(dc,{center,ground},{area.right-28,ground},theme::red,1);
    stroke(dc,{center,ground},{center,area.top+48},theme::green,1);
    stroke(dc,{center,ground},{area.left+28,ground},theme::accent,1);
    HPEN shadow=CreatePen(PS_SOLID,7,RGB(24,30,42)), bone=CreatePen(PS_SOLID,3,theme::violet);
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
        COLORREF color=confidence>=.65f?theme::green:confidence>=.3f?theme::amber:theme::red;
        HBRUSH brush=CreateSolidBrush(color); auto old=SelectObject(dc,brush);
        Ellipse(dc,static_cast<int>(p.x)-4,static_cast<int>(p.y)-4,
                static_cast<int>(p.x)+5,static_cast<int>(p.y)+5);
        SelectObject(dc,old); DeleteObject(brush);
    }
    RECT hint=area; hint.left+=18; hint.top=hint.bottom-34;
    text(dc,L"拖动旋转视角",hint,theme::text_faint,app.small_font);
}
std::wstring issue_joint_name(animocap::BoneSemantic semantic) {
    return joint_display_name(semantic);
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
    fill(dc,area,theme::header);
    const wchar_t* labels[]={L"视频",L"人物",L"捕捉",L"检查",L"导出"};
    int active=0;
    if(app.decoder&&app.decoder->is_open())active=1;
    if(app.analyzing)active=2;
    else if(app.pose)active=3;
    else if(app.decoder&&app.decoder->is_open())active=2;
    if(app.motion&&app.pose)active=4;
    RECT strip{area.left+kPadding,area.top+5,area.right-kPadding,area.bottom-5};
    const int segment_width=(strip.right-strip.left)/5;
    for(int index=0;index<5;++index) {
        const int left=strip.left+index*segment_width;
        const int right=index==4?strip.right:left+segment_width;
        const int tip=index==4?right:right+14;
        POINT shape[6]={{left,strip.top},{right,strip.top},{tip,(strip.top+strip.bottom)/2},
                        {right,strip.bottom},{left,strip.bottom},
                        {index==0?left:left+14,(strip.top+strip.bottom)/2}};
        const COLORREF background=index==active?theme::accent_strong:
            index<active?theme::surface_hover:theme::surface;
        const COLORREF border=index==active?theme::accent:theme::border;
        HBRUSH brush=CreateSolidBrush(background);HPEN pen=CreatePen(PS_SOLID,1,border);
        auto old_brush=SelectObject(dc,brush);auto old_pen=SelectObject(dc,pen);
        Polygon(dc,shape,6);
        SelectObject(dc,old_pen);SelectObject(dc,old_brush);DeleteObject(pen);DeleteObject(brush);
        const std::wstring label=std::to_wstring(index+1)+L"   "+labels[index];
        text(dc,label,{left+16,strip.top,right-4,strip.bottom},
             index==active?RGB(250,253,255):index<active?theme::text:theme::text_muted,
             index==active?app.section_font:app.font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    }
}
void draw_issues(HDC dc,RECT area) {
    panel_box(dc,area,theme::surface,theme::border,8);
    panel_accent(dc,area,theme::amber);
    text(dc,L"检查与修正",{area.left+16,area.top+5,area.right-326,area.top+39},
         theme::text,app.section_font);
    stroke(dc,{area.left+1,area.top+44},{area.right-1,area.top+44},theme::border_soft);
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
    text(dc,heading,{area.left+16,area.top+50,area.right-16,area.top+80},
         issues.empty()?theme::green:theme::text,app.font);
    int issue_y=area.top+84;
    if(app.multiview_diagnostics) {
        std::wstring alignment=L"时间对齐";
        for(const auto& item:app.multiview_diagnostics->alignments) {
            alignment+=L" · "+widen(item.view_id)+L" "+
                std::to_wstring(static_cast<int>(std::lround(item.mean_offset_s*1000.0)))+L"ms";
        }
        text(dc,alignment,{area.left+16,area.top+76,area.right-16,area.top+104},
             theme::text_muted,app.small_font);
        issue_y=area.top+108;
    }
    if(issues.empty()) {
        text(dc,app.multiview_diagnostics
            ? L"遮挡观测已由其他视角恢复；拖动时间轴检查全段冲突"
            : L"本地视觉纠错只会在遮挡、跳点或左右歧义时介入",
             {area.left+16,area.top+84,area.right-16,area.bottom-12},
             theme::text_muted,app.font,DT_LEFT|DT_TOP|DT_WORDBREAK);
        return;
    }
    int y=issue_y;
    for(std::size_t index=0;index<std::min<std::size_t>(3,issues.size());++index) {
        RECT row{area.left+12,y,area.right-12,std::min<LONG>(area.bottom-8,y+50)};
        rounded_box(dc,row,theme::surface_raised,theme::border_soft,6);
        const COLORREF severity=issues[index].confidence<.3f?theme::red:theme::amber;
        HBRUSH dot=CreateSolidBrush(severity); auto old=SelectObject(dc,dot);
        Ellipse(dc,row.left+12,row.top+18,row.left+22,row.top+28);
        SelectObject(dc,old);DeleteObject(dot);
        text(dc,issues[index].name,{row.left+32,row.top+4,row.right-102,row.top+27},
             theme::text,app.font);
        const std::wstring detail=issues[index].detail.empty()?L"置信度偏低":issues[index].detail;
        text(dc,detail,{row.left+32,row.top+24,row.right-102,row.bottom-3},
             theme::text_muted,app.small_font);
        text(dc,std::to_wstring(static_cast<int>(issues[index].confidence*100))+L"%",
             {row.right-92,row.top,row.right-16,row.bottom},severity,app.mono_font,
             DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
        y+=58;
        if(y>=area.bottom-30)break;
    }
}
void draw_timeline_panel(HDC dc,RECT area) {
    panel_box(dc,area,theme::surface,theme::border,8);
    panel_accent(dc,area,theme::accent);
    const int label_width=kTimelineLabelWidth;
    const int plot_left=area.left+label_width;
    const int plot_right=area.right-12;
    const int confidence_top=area.top+62,confidence_bottom=area.top+101;
    const int ambiguity_top=area.top+106,ambiguity_bottom=area.top+143;
    stroke(dc,{area.left+1,area.top+46},{area.right-1,area.top+46},theme::border_soft);

    const auto range=timeline_range();
    const std::wstring current=timecode(app.time_s);
    const std::wstring duration=range?timecode(range->end-range->start):L"--:--.---";
    text(dc,current+L"  /  "+duration,
         {area.right-270,area.top+6,area.right-16,area.top+40},theme::accent,
         app.mono_font,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"置信度",{area.left+14,confidence_top,area.left+label_width-8,confidence_bottom},
         theme::amber,app.small_font);
    text(dc,L"歧义度",{area.left+14,ambiguity_top,area.left+label_width-8,ambiguity_bottom},
         theme::violet,app.small_font);
    text(dc,app.decoder&&app.decoder->is_open()?L"视频轨道":L"动作轨道",
         {area.left+14,area.top+148,area.left+label_width-8,area.bottom-7},
         theme::text_muted,app.small_font);

    for(int y:{confidence_top,confidence_bottom,ambiguity_top,ambiguity_bottom})
        stroke(dc,{plot_left,y},{plot_right,y},theme::border_soft);
    for(int tick=0;tick<=10;++tick) {
        const int x=plot_left+(plot_right-plot_left)*tick/10;
        stroke(dc,{x,confidence_top},{x,area.bottom-7},RGB(26,38,50));
    }
    if(range) {
        text(dc,timecode(range->start),{plot_left,area.top+46,plot_left+110,confidence_top},
             theme::text_faint,app.mono_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
        text(dc,timecode(range->end),{plot_right-110,area.top+46,plot_right,confidence_top},
             theme::text_faint,app.mono_font,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
    }

    if(app.pose&&app.pose->frames.size()>1) {
        HPEN confidence_pen=CreatePen(PS_SOLID,2,theme::amber);
        auto old_pen=SelectObject(dc,confidence_pen);
        bool first=true;
        for(std::size_t frame_index=0;frame_index<app.pose->frames.size();++frame_index) {
            const auto& frame=app.pose->frames[frame_index];
            double sum=0.0;int count=0;
            for(const auto& joint:frame.joints)if(joint.valid){sum+=joint.confidence;++count;}
            const double confidence=count?sum/count:0.0;
            const int x=plot_left+static_cast<int>((plot_right-plot_left)*
                frame_index/(app.pose->frames.size()-1.0));
            const int y=confidence_bottom-3-static_cast<int>(confidence*(confidence_bottom-confidence_top-6));
            if(first){MoveToEx(dc,x,y,nullptr);first=false;}else LineTo(dc,x,y);
        }
        SelectObject(dc,old_pen);DeleteObject(confidence_pen);

        HPEN ambiguity_pen=CreatePen(PS_SOLID,2,theme::violet);
        old_pen=SelectObject(dc,ambiguity_pen);first=true;
        for(std::size_t frame_index=0;frame_index<app.pose->frames.size();++frame_index) {
            float lowest=1.0f;
            for(const auto& joint:app.pose->frames[frame_index].joints)
                if(joint.valid)lowest=std::min(lowest,joint.confidence);
            const double ambiguity=1.0-std::clamp<double>(lowest,0.0,1.0);
            const int x=plot_left+static_cast<int>((plot_right-plot_left)*
                frame_index/(app.pose->frames.size()-1.0));
            const int y=ambiguity_bottom-3-static_cast<int>(ambiguity*(ambiguity_bottom-ambiguity_top-6));
            if(first){MoveToEx(dc,x,y,nullptr);first=false;}else LineTo(dc,x,y);
        }
        SelectObject(dc,old_pen);DeleteObject(ambiguity_pen);
    }

    RECT track=timeline_track();
    RECT bar{track.left,area.top+151,track.right,area.bottom-8};
    rounded_box(dc,bar,RGB(12,20,28),theme::border_soft,4);
    for(int tick=1;tick<20;++tick) {
        const int x=bar.left+(bar.right-bar.left)*tick/20;
        stroke(dc,{x,bar.top+1},{x,bar.bottom-1},theme::border_soft);
    }
    if(range) {
        const auto x_at_time=[&](double time) {
            return bar.left+static_cast<int>((bar.right-bar.left)*
                std::clamp((time-range->start)/std::max(.001,range->end-range->start),0.0,1.0));
        };
        if(app.motion&&app.motion->motion.frame_count>0) {
            const auto& motion=app.motion->motion;
            for(std::size_t side=0;side<2;++side) {
                std::size_t frame=0;
                while(frame<motion.frame_count) {
                    while(frame<motion.frame_count&&motion.foot_contacts[frame*2+side]==0)++frame;
                    if(frame==motion.frame_count)break;
                    const auto first_frame=frame;
                    while(frame+1<motion.frame_count&&motion.foot_contacts[(frame+1)*2+side]!=0)++frame;
                    const double after=frame+1<motion.frame_count?motion.time_s[frame+1]:
                        motion.time_s[frame]+1.0/std::max(1.0,motion.fps);
                    const int left=x_at_time(motion.time_s[first_frame]);
                    const int right=static_cast<int>(std::max<LONG>(left+1,x_at_time(after)));
                    const int side_offset=static_cast<int>(side)*4;
                    fill(dc,{left,bar.bottom-7-side_offset,right,bar.bottom-4-side_offset},
                         side==0?theme::accent:theme::amber);
                    ++frame;
                }
            }
        }
        if(const auto selected=selected_range()) {
            const int start_x=x_at_time(selected->start),end_x=x_at_time(selected->end);
            fill(dc,{start_x,bar.top+2,end_x,bar.top+6},theme::violet);
            stroke(dc,{start_x,bar.top},{start_x,bar.bottom},theme::violet,2);
            stroke(dc,{end_x,bar.top},{end_x,bar.bottom},theme::violet,2);
        }
        const int cursor=x_at_time(app.time_s);
        stroke(dc,{cursor,area.top+48},{cursor,area.bottom-7},theme::accent,2);
        HBRUSH thumb=CreateSolidBrush(theme::accent);auto old_brush=SelectObject(dc,thumb);
        POINT marker[]={{cursor-7,area.top+48},{cursor+7,area.top+48},{cursor,area.top+57}};
        Polygon(dc,marker,3);SelectObject(dc,old_brush);DeleteObject(thumb);
    }
}
void paint(HWND window) {
    PAINTSTRUCT ps{};
    HDC paint_dc=BeginPaint(window,&ps);
    RECT client{};GetClientRect(window,&client);
    HDC dc=CreateCompatibleDC(paint_dc);
    HBITMAP buffer=CreateCompatibleBitmap(paint_dc,client.right,client.bottom);
    auto old_bitmap=SelectObject(dc,buffer);
    fill(dc,client,theme::background);
    fill(dc,{0,0,client.right,kHeader},theme::header);
    fill(dc,{0,0,client.right,3},theme::accent_soft);
    fill(dc,{18,21,22,45},theme::accent);
    text(dc,L"AniMocap Fusion",{34,7,216,kHeader-7},theme::text,app.title_font);
    stroke(dc,{0,kHeader-1},{client.right,kHeader-1},theme::border_soft);
    draw_steps(dc,{0,kHeader,client.right,kHeader+kSteps});
    RECT scope{0,kHeader+kSteps,client.right,kHeader+kSteps+kScopeBar};
    fill(dc,scope,theme::surface);
    stroke(dc,{0,scope.top},{client.right,scope.top},theme::border_soft);
    stroke(dc,{0,scope.bottom-1},{client.right,scope.bottom-1},theme::border_soft);
    text(dc,app.multiview_mode?L"四视角范围":L"人物范围",{20,scope.top,112,scope.bottom},
         theme::text,app.section_font);
    text(dc,app.multiview_mode
        ? L"正面 / 右侧 / 背面 / 左侧分别自动识别完整人体，再联合恢复遮挡关节"
        : app.auto_person_frame
            ? L"仅识别人体骨架，不包含翅膀、武器、宠物和 UI"
            : app.has_person_frame?L"使用手动人物框":L"使用完整视频画面",
        {548,scope.top,workspace_split()-12,scope.bottom},
        theme::text_muted,app.small_font);
    if(app.multiview_mode&&!app.pose&&!app.motion)
        draw_multiview_preview(dc,video_area());
    else
        draw_video(dc,video_area());
    draw_motion(dc,motion_area());
    draw_issues(dc,issues_area());
    draw_timeline_panel(dc,timeline_area());
    stroke(dc,{0,client.bottom-48},{client.right,client.bottom-48},theme::border_soft);
    BitBlt(paint_dc,0,0,client.right,client.bottom,dc,0,0,SRCCOPY);
    SelectObject(dc,old_bitmap);DeleteObject(buffer);DeleteDC(dc);
    EndPaint(window,&ps);
}
void draw_owner_button(const DRAWITEMSTRUCT* item) {
    RECT rect=item->rcItem;
    const int id=GetDlgCtrlID(item->hwndItem);
    const bool pressed=(item->itemState&ODS_SELECTED)!=0;
    const bool disabled=(item->itemState&ODS_DISABLED)!=0;
    const bool hot=(item->itemState&ODS_HOTLIGHT)!=0;
    const bool primary=id==kAnalyze;
    const bool selected=(id==kAutoFrame&&app.auto_person_frame)||
                        (id==kPersonFrame&&app.manual_person_frame)||
                        (id==kVlmToggle&&app.vlm_enabled)||
                        (id==kLoopRange&&app.loop_range)||
                        (id==kCalibrate&&app.calibrating);
    COLORREF background=primary?theme::accent_strong:
        selected?theme::accent_dark:theme::surface_raised;
    COLORREF border=primary?theme::accent:selected?theme::accent:theme::border;
    if(pressed)background=primary?RGB(8,103,164):theme::surface_hover;
    else if(hot&&!disabled)background=primary?RGB(28,155,211):theme::surface_hover;
    if(disabled){background=RGB(14,21,29);border=theme::border_soft;}
    rounded_box(item->hDC,rect,background,border,8);
    wchar_t label[128]{};
    GetWindowTextW(item->hwndItem,label,128);
    const COLORREF label_color=disabled?theme::text_faint:theme::text;
    if(id==kVlmToggle) {
        text(item->hDC,L"本地视觉纠错",{rect.left+14,rect.top,rect.right-64,rect.bottom},
             label_color,app.font);
        RECT track{rect.right-52,(rect.top+rect.bottom)/2-10,rect.right-12,(rect.top+rect.bottom)/2+10};
        rounded_box(item->hDC,track,app.vlm_enabled?theme::accent_strong:theme::border_soft,
                    app.vlm_enabled?theme::accent:theme::border,12);
        const int thumb_x=app.vlm_enabled?track.right-10:track.left+10;
        HBRUSH thumb=CreateSolidBrush(disabled?theme::text_faint:RGB(246,250,253));
        auto old=SelectObject(item->hDC,thumb);
        Ellipse(item->hDC,thumb_x-7,(track.top+track.bottom)/2-7,
                thumb_x+8,(track.top+track.bottom)/2+8);
        SelectObject(item->hDC,old);DeleteObject(thumb);
    } else {
        RECT label_rect=rect;
        if(id==kAnalyze||id==kPlay)label_rect.left+=22;
        text(item->hDC,label,label_rect,label_color,
             primary?app.section_font:app.font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        if(id==kAnalyze||id==kPlay) {
            const int center_y=(rect.top+rect.bottom)/2;
            const int center_x=rect.left+18;
            HBRUSH icon=CreateSolidBrush(disabled?theme::text_faint:theme::text);
            auto old=SelectObject(item->hDC,icon);
            if(id==kPlay&&app.playing) {
                RECT first{center_x-5,center_y-7,center_x-1,center_y+8};
                RECT second{center_x+3,center_y-7,center_x+7,center_y+8};
                FillRect(item->hDC,&first,icon);FillRect(item->hDC,&second,icon);
            } else {
                POINT play[]={{center_x-5,center_y-8},{center_x-5,center_y+8},{center_x+8,center_y}};
                Polygon(item->hDC,play,3);
            }
            SelectObject(item->hDC,old);DeleteObject(icon);
        }
    }
}
HWND button(HWND parent,int id,const wchar_t* label) {
    HWND result=CreateWindowExW(0,L"BUTTON",label,
        WS_CHILD|WS_VISIBLE|WS_TABSTOP|BS_NOTIFY|BS_FLAT|BS_OWNERDRAW,0,0,0,0,parent,
        reinterpret_cast<HMENU>(static_cast<INT_PTR>(id)),
        GetModuleHandleW(nullptr),nullptr);
    SendMessageW(result,WM_SETFONT,reinterpret_cast<WPARAM>(app.font),TRUE);
    return result;
}
void layout(HWND window) {
    RECT client{};GetClientRect(window,&client);
    int header_x=224;
    for(int id:{kImport,kMultiview,kLoad,kSaveMotion,kExportBvh,kExportVrma,kSetup,kVlmSetup}) {
        const int width=id==kMultiview?100:id==kVlmSetup?112:
            id==kExportVrma?96:(id==kExportBvh||id==kSetup)?92:84;
        MoveWindow(GetDlgItem(window,id),header_x,13,width,40,TRUE);
        header_x+=width+((id==kMultiview||id==kSaveMotion||id==kExportVrma)?14:6);
    }
    MoveWindow(GetDlgItem(window,kVlmToggle),client.right-218,13,202,40,TRUE);
    const int scope_y=kHeader+kSteps+9;
    MoveWindow(GetDlgItem(window,kAutoFrame),112,scope_y,94,38,TRUE);
    MoveWindow(GetDlgItem(window,kPersonFrame),212,scope_y,94,38,TRUE);
    MoveWindow(GetDlgItem(window,kResetFrame),312,scope_y,74,38,TRUE);
    MoveWindow(GetDlgItem(window,kCharacterProfile),392,scope_y,142,38,TRUE);
    RECT issues=issues_area();
    MoveWindow(GetDlgItem(window,kUndoCorrection),issues.right-302,issues.top+6,86,32,TRUE);
    MoveWindow(GetDlgItem(window,kRedoCorrection),issues.right-208,issues.top+6,86,32,TRUE);
    MoveWindow(GetDlgItem(window,kCalibrate),issues.right-114,issues.top+6,98,32,TRUE);
    RECT timeline=timeline_area();
    MoveWindow(app.play,timeline.left+8,timeline.top+6,82,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeStart),timeline.left+96,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeEnd),timeline.left+190,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeClear),timeline.left+284,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kLoopRange),timeline.left+378,timeline.top+6,124,34,TRUE);
    ShowWindow(app.timeline,SW_HIDE);
    MoveWindow(GetDlgItem(window,kAnalyze),client.right-210,client.bottom-42,194,36,TRUE);
    MoveWindow(app.progress,client.right-210,client.bottom-52,194,6,TRUE);
    MoveWindow(app.status,20,client.bottom-42,std::max<LONG>(180,client.right-250),34,TRUE);
    InvalidateRect(window,nullptr,FALSE);
}
void set_range_boundary(bool start) {
    const auto full=timeline_range();
    if(!full)return;
    const double frame_step=1.0/std::max(1.0,
        app.motion?app.motion->motion.fps:
        app.decoder&&app.decoder->is_open()?app.decoder->info().fps:30.0);
    if(start) {
        app.range_start=std::clamp(app.time_s,full->start,std::max(full->start,full->end-frame_step));
        if(!app.range_end||*app.range_end<=*app.range_start)app.range_end=full->end;
    } else {
        app.range_end=std::clamp(app.time_s,std::min(full->end,full->start+frame_step),full->end);
        if(!app.range_start||*app.range_start>=*app.range_end)app.range_start=full->start;
    }
    const auto selected=selected_range();
    if(selected)set_status((start?L"区间起点已设置 · ":L"区间终点已设置 · ")+
        std::to_wstring(selected->start)+L"s — "+std::to_wstring(selected->end)+L"s");
    InvalidateRect(app.window,nullptr,FALSE);
}
void clear_range_selection() {
    reset_range_selection();
    set_status(L"已清除播放/导出区间");
    InvalidateRect(app.window,nullptr,FALSE);
}
void toggle_range_loop() {
    if(!selected_range()) {
        MessageBoxW(app.window,L"请先在时间线上设置区间起点和终点。",
                    L"区间循环",MB_ICONINFORMATION);
        return;
    }
    app.loop_range=!app.loop_range;
    SetWindowTextW(GetDlgItem(app.window,kLoopRange),
        app.loop_range?L"区间循环 · 开":L"区间循环 · 关");
    set_status(app.loop_range?L"区间循环已开启":L"区间循环已关闭");
}
void toggle_play() {
    if (!timeline_range()) return;
    app.playing=!app.playing; SetWindowTextW(app.play,app.playing?L"\u6682\u505c":L"\u64ad\u653e");
    if (app.playing) {
        const auto active=playback_range();
        if(app.time_s<active.start||app.time_s>=active.end) {
            app.time_s=active.start;
            if(app.decoder&&app.decoder->is_open())decode_at(active.start);
            else update_timeline();
        }
        const double fps=app.decoder&&app.decoder->is_open()
            ? app.decoder->info().fps
            : app.motion?app.motion->motion.fps:30.0;
        UINT interval=static_cast<UINT>(std::max(1.0,std::round(
            1000.0/std::max(1.0,fps))));
        SetTimer(app.window,kTimerPlayback,interval,nullptr);
    }
    else KillTimer(app.window,kTimerPlayback);
}
void step_timeline(int frame_delta) {
    const auto full=timeline_range();
    if(!full)return;
    stop_playback();
    const double fps=app.decoder&&app.decoder->is_open()
        ? app.decoder->info().fps
        : app.motion?app.motion->motion.fps:30.0;
    const double target=std::clamp(
        app.time_s+static_cast<double>(frame_delta)/std::max(1.0,fps),
        full->start,full->end);
    if(app.decoder&&app.decoder->is_open())decode_at(target);
    else {
        app.time_s=target;
        update_timeline();
        InvalidateRect(app.window,nullptr,FALSE);
    }
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
    app.has_person_frame=false;
    app.selecting_person_frame=false;
    app.drawing_person_frame=false;
    set_status(app.pose
        ? L"人物范围 · 自动识别已启用，预览保持完整视频画面"
        : L"人物范围 · 捕捉首帧将自动识别人体，随后排除翅膀、宠物和 UI");
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
    app.scrubbing=false;
    ReleaseCapture();
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
    app.scrubbing=false;
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
    app.anchor_drag_snapshot=*app.pose;
    app.anchor_drag_delta_u=0.0;
    app.anchor_drag_delta_v=0.0;
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
    auto& frame=app.pose->frames[pose_frame()];
    const auto head_xy=frame.joints[head].image_xy;
    const auto left_xy=frame.joints[left_foot].image_xy;
    const auto right_xy=frame.joints[right_foot].image_xy;
    const double foot_x=(left_xy.x+right_xy.x)*0.5;
    const double foot_y=(left_xy.y+right_xy.y)*0.5;
    const double body_pixels=std::max(1.0,std::hypot(head_xy.x-foot_x,head_xy.y-foot_y));
    const double meters_per_pixel=1.55/body_pixels;
    auto& joint=frame.joints[selected];
    joint.image_xy.x+=delta_u;
    joint.image_xy.y+=delta_v;
    joint.position_m.x-=delta_u*meters_per_pixel;
    joint.position_m.y-=delta_v*meters_per_pixel;
    app.anchor_drag_delta_u+=delta_u;
    app.anchor_drag_delta_v+=delta_v;
    app.last_mouse=mouse;
    InvalidateRect(app.window,nullptr,FALSE);
}
void update_correction_controls() {
    EnableWindow(GetDlgItem(app.window,kUndoCorrection),!app.correction_undo.empty());
    EnableWindow(GetDlgItem(app.window,kRedoCorrection),!app.correction_redo.empty());
}
void rebuild_corrected_motion() {
    auto corrected=animocap::reconstruct_canonical_motion(
        *app.pose,app.character_profile?&app.character_profile->skeleton:nullptr);
    if(app.motion&&!app.motion->cameras.empty())corrected.cameras=app.motion->cameras;
    app.motion=std::move(corrected);
}
void push_correction_history(
    std::vector<ManualCorrectionState>& history,
    ManualCorrectionState value
) {
    constexpr std::size_t kMaximumCorrectionHistory=12;
    if(history.size()==kMaximumCorrectionHistory)history.erase(history.begin());
    history.push_back(std::move(value));
}
void finish_anchor_drag() {
    if (app.dragging_anchor<0) return;
    const auto selected=static_cast<std::size_t>(app.dragging_anchor);
    app.dragging_anchor=-1;
    ReleaseCapture();
    if(!app.anchor_drag_snapshot)return;
    auto before=std::move(*app.anchor_drag_snapshot);
    app.anchor_drag_snapshot.reset();
    if(std::abs(app.anchor_drag_delta_u)<1e-9&&std::abs(app.anchor_drag_delta_v)<1e-9) {
        app.pose=std::move(before);
        return;
    }
    const auto before_corrections=app.manual_corrections;
    try {
        auto skeleton=animocap::make_default_skeleton();
        const auto head=animocap::bone_index(skeleton,animocap::BoneSemantic::Head);
        const auto left_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::LeftFoot);
        const auto right_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::RightFoot);
        animocap::ManualPoseCorrection correction;
        correction.joint_index=selected;
        correction.image_delta={app.anchor_drag_delta_u,app.anchor_drag_delta_v};
        correction.position_deltas_m.reserve(before.frames.size());
        for(const auto& frame:before.frames) {
            const auto head_xy=frame.joints[head].image_xy;
            const auto left_xy=frame.joints[left_foot].image_xy;
            const auto right_xy=frame.joints[right_foot].image_xy;
            const double foot_x=(left_xy.x+right_xy.x)*0.5;
            const double foot_y=(left_xy.y+right_xy.y)*0.5;
            const double body_pixels=std::max(1.0,
                std::hypot(head_xy.x-foot_x,head_xy.y-foot_y));
            const double meters_per_pixel=1.55/body_pixels;
            correction.position_deltas_m.push_back({
                -app.anchor_drag_delta_u*meters_per_pixel,
                -app.anchor_drag_delta_v*meters_per_pixel,
                0.0,
            });
        }
        app.manual_corrections.push_back(std::move(correction));
        const auto* refined=app.profile_refined_pose
            ?&*app.profile_refined_pose
            :(app.pose_baseline?&*app.pose_baseline:&before);
        app.pose=animocap::apply_manual_pose_corrections(
            *refined,app.manual_corrections);
        rebuild_corrected_motion();
        push_correction_history(app.correction_undo,before_corrections);
        app.correction_redo.clear();
        app.motion_dirty=true;
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        update_correction_controls();
        set_status(L"锚点修正已传播到全部帧 · 尚未保存");
    } catch (const std::exception& error) {
        app.manual_corrections=before_corrections;
        app.pose=std::move(before);
        set_status(L"锚点修正失败 · 已恢复拖动前状态");
        MessageBoxW(app.window,widen(error.what()).c_str(),L"校准失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void restore_correction(bool redo) {
    if(!app.pose)return;
    auto& source=redo?app.correction_redo:app.correction_undo;
    auto& destination=redo?app.correction_undo:app.correction_redo;
    if(source.empty())return;
    auto current_pose=*app.pose;
    auto current=app.manual_corrections;
    auto target=std::move(source.back());
    source.pop_back();
    app.manual_corrections=target;
    try {
        const auto* refined=app.profile_refined_pose
            ?&*app.profile_refined_pose
            :(app.pose_baseline?&*app.pose_baseline:&current_pose);
        app.pose=animocap::apply_manual_pose_corrections(
            *refined,app.manual_corrections);
        rebuild_corrected_motion();
        push_correction_history(destination,std::move(current));
        app.motion_dirty=true;
        set_status(redo?L"已重做锚点修正 · 尚未保存":L"已撤销锚点修正 · 尚未保存");
    } catch(const std::exception& error) {
        app.pose=std::move(current_pose);
        app.manual_corrections=std::move(current);
        source.push_back(std::move(target));
        MessageBoxW(app.window,widen(error.what()).c_str(),L"恢复修正失败",MB_ICONERROR);
    }
    update_correction_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void toggle_calibration() {
    if (!app.pose) {
        MessageBoxW(app.window,L"请先运行动作捕捉或加载观测数据。",
                    L"锚点校准",MB_ICONINFORMATION);
        return;
    }
    const bool finishing=app.calibrating;
    const bool saving_on_finish=finishing&&app.motion_dirty;
    if(saving_on_finish&&!save_motion_copy()) {
        set_status(L"修正仍未保存 · 继续处于手动修正模式");
        return;
    }
    app.calibrating=!app.calibrating;
    app.playing=false;
    KillTimer(app.window,kTimerPlayback);
    SetWindowTextW(app.play,L"播放");
    SetWindowTextW(GetDlgItem(app.window,kCalibrate),
        app.calibrating ? L"保存并完成" : L"手动修正");
    if(app.calibrating) {
        set_status(L"锚点校准 · 拖动错位关节，偏移自动应用到整段视频");
    } else if(saving_on_finish) {
        set_status(L"修正已保存并完成 · "+app.motion_path.wstring());
    } else {
        set_status(L"已退出手动修正 · 当前动作没有未保存改动");
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
LRESULT CALLBACK window_proc(HWND window,UINT message,WPARAM wparam,LPARAM lparam) {
    switch(message) {
    case WM_CREATE:
        app.window=window; app.root=find_root();
        app.font=CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.small_font=CreateFontW(-14,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.title_font=CreateFontW(-23,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.section_font=CreateFontW(-16,0,0,0,FW_SEMIBOLD,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Segoe UI");
        app.mono_font=CreateFontW(-15,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,CLIP_DEFAULT_PRECIS,CLEARTYPE_QUALITY,DEFAULT_PITCH,L"Cascadia Mono");
        app.panel_brush=CreateSolidBrush(theme::background);
        button(window,kImport,L"打开视频");
        button(window,kMultiview,L"导入四视角");
        button(window,kLoad,L"打开动作");
        button(window,kSaveMotion,L"保存动作");
        EnableWindow(GetDlgItem(window,kSaveMotion),FALSE);
        button(window,kExportBvh,L"导出 BVH");
        EnableWindow(GetDlgItem(window,kExportBvh),FALSE);
        button(window,kExportVrma,L"导出 VRMA");
        EnableWindow(GetDlgItem(window,kExportVrma),FALSE);
        button(window,kSetup,L"推理环境");
        button(window,kVlmSetup,L"配置本地 AI");
        button(window,kVlmToggle,L"本地视觉纠错 · 开");
        button(window,kAutoFrame,L"自动识别");
        button(window,kPersonFrame,L"手动框选");
        button(window,kResetFrame,L"重置");
        button(window,kUndoCorrection,L"撤销修正");
        button(window,kRedoCorrection,L"重做修正");
        button(window,kCharacterProfile,L"\u5bfc\u5165\u52a8\u753b\u89d2\u8272\u53c2\u8003");
        EnableWindow(GetDlgItem(window,kUndoCorrection),FALSE);
        EnableWindow(GetDlgItem(window,kRedoCorrection),FALSE);
        button(window,kCalibrate,L"手动修正");
        button(window,kAnalyze,L"开始捕捉");
        app.play=button(window,kPlay,L"\u64ad\u653e");
        button(window,kRangeStart,L"设为起点");
        button(window,kRangeEnd,L"设为终点");
        button(window,kRangeClear,L"清除区间");
        button(window,kLoopRange,L"区间循环 · 关");
        app.timeline=CreateWindowExW(0,TRACKBAR_CLASSW,nullptr,WS_CHILD|WS_VISIBLE|TBS_HORZ,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kTimeline)),
            GetModuleHandleW(nullptr),nullptr);
        SendMessageW(app.timeline,TBM_SETRANGE,TRUE,MAKELPARAM(0,10000));
        app.progress=CreateWindowExW(0,PROGRESS_CLASSW,nullptr,WS_CHILD|PBS_MARQUEE|PBS_SMOOTH,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kProgress)),
            GetModuleHandleW(nullptr),nullptr); ShowWindow(app.progress,SW_HIDE);
        SendMessageW(app.progress,PBM_SETBARCOLOR,0,theme::accent);
        SendMessageW(app.progress,PBM_SETBKCOLOR,0,theme::surface_raised);
        app.status=CreateWindowExW(0,L"STATIC",L"\u7a7a\u95f2 \u00b7 \u5bfc\u5165\u89c6\u9891\u5f00\u59cb",WS_CHILD|WS_VISIBLE|SS_LEFT,
            0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kStatus)),
            GetModuleHandleW(nullptr),nullptr);
        SendMessageW(app.status,WM_SETFONT,reinterpret_cast<WPARAM>(app.font),TRUE);
        layout(window); return 0;
    case WM_GETMINMAXINFO: {
        auto* limits=reinterpret_cast<MINMAXINFO*>(lparam);
        limits->ptMinTrackSize={1320,860};
        return 0;
    }
    case WM_SIZE: layout(window); InvalidateRect(window,nullptr,TRUE); return 0;
    case WM_DRAWITEM:
        draw_owner_button(reinterpret_cast<const DRAWITEMSTRUCT*>(lparam));
        return TRUE;
    case WM_COMMAND:
        if(lparam!=0&&HIWORD(wparam)!=BN_CLICKED)return 0;
        switch(LOWORD(wparam)) {
        case kImport: import_video(); return 0;
        case kMultiview: import_multiview(); return 0;
        case kLoad: load_motion(); return 0;
        case kSaveMotion: save_motion_copy(); return 0;
        case kExportBvh: export_bvh_file(); return 0;
        case kExportVrma: export_vrma_file(); return 0;
        case kSetup: setup_mmpose(); return 0;
        case kVlmSetup: setup_local_vlm(); return 0;
        case kVlmToggle: toggle_local_vlm(); return 0;
        case kAutoFrame: use_auto_person_frame(); return 0;
        case kPersonFrame: begin_person_frame_selection(); return 0;
        case kResetFrame: reset_person_frame(); return 0;
        case kCharacterProfile: import_character_profile(); return 0;
        case kUndoCorrection: restore_correction(false); return 0;
        case kRedoCorrection: restore_correction(true); return 0;
        case kAnalyze: start_analysis(); return 0;
        case kCalibrate: toggle_calibration(); return 0;
        case kPlay: toggle_play(); return 0;
        case kRangeStart: set_range_boundary(true); return 0;
        case kRangeEnd: set_range_boundary(false); return 0;
        case kRangeClear: clear_range_selection(); return 0;
        case kLoopRange: toggle_range_loop(); return 0;
        default: break;
        }
        break;    case WM_HSCROLL:
        if (reinterpret_cast<HWND>(lparam)==app.timeline) {
            int value=static_cast<int>(SendMessageW(app.timeline,TBM_GETPOS,0,0));
            if(const auto range=timeline_range()) {
                const double time=range->start+(range->end-range->start)*value/10000.0;
                if(app.decoder&&app.decoder->is_open())decode_at(time);
                else { app.time_s=time; update_timeline(); InvalidateRect(window,nullptr,FALSE); }
            }
        } return 0;
    case WM_KEYDOWN: {
        const bool control=(GetKeyState(VK_CONTROL)&0x8000)!=0;
        const bool shift=(GetKeyState(VK_SHIFT)&0x8000)!=0;
        if(control&&wparam=='Z') { restore_correction(false); return 0; }
        if(control&&wparam=='Y') { restore_correction(true); return 0; }
        if(control&&wparam=='S') { save_motion_copy(); return 0; }
        if(control&&wparam=='P') { import_character_profile(); return 0; }
        if(!control&&wparam==VK_SPACE) { toggle_play(); return 0; }
        if(!control&&wparam==VK_LEFT) { step_timeline(shift?-10:-1); return 0; }
        if(!control&&wparam==VK_RIGHT) { step_timeline(shift?10:1); return 0; }
        if(!control&&wparam=='I') { set_range_boundary(true); return 0; }
        if(!control&&wparam=='O') { set_range_boundary(false); return 0; }
        if(!control&&wparam=='L') { toggle_range_loop(); return 0; }
        break;
    }
    case WM_TIMER:
        if (wparam==kTimerAnalysisProgress) {
            update_analysis_progress();
            return 0;
        }
        if (wparam==kTimerPlayback && app.playing) {
            if(app.decoder&&app.decoder->is_open()) {
                try {
                    if (app.decoder->read_frame(app.video_frame)) {
                        app.time_s=app.video_frame.time_s;
                        const auto active=playback_range();
                        if(app.time_s>=active.end) {
                            if(app.loop_range&&selected_range())decode_at(active.start);
                            else {
                                app.time_s=active.end;
                                update_timeline();
                                stop_playback();
                                InvalidateRect(window,nullptr,FALSE);
                            }
                        } else {
                            update_timeline();
                            InvalidateRect(window,nullptr,FALSE);
                        }
                    } else {
                        stop_playback();
                    }
                } catch (const std::exception& error) {
                    stop_playback(L"视频解码已停止 · " + widen(error.what()));
                }
            } else if(app.motion&&!app.motion->motion.time_s.empty()) {
                const auto range=playback_range();
                app.time_s+=1.0/std::max(1.0,app.motion->motion.fps);
                if(app.time_s>=range.end) {
                    if(app.loop_range&&selected_range())app.time_s=range.start;
                    else { app.time_s=range.end; stop_playback(); }
                }
                update_timeline();
                InvalidateRect(window,nullptr,FALSE);
            } else {
                stop_playback();
            }
        } return 0;
    case kAnalysisDone: {
        std::unique_ptr<AnalysisResult> result(reinterpret_cast<AnalysisResult*>(lparam));
        const bool close_after_analysis=app.close_after_analysis;
        app.close_after_analysis=false;
        app.analyzing=false;
        app.cancel_requested=false;
        KillTimer(window,kTimerAnalysisProgress);
        SendMessageW(app.progress,PBM_SETPOS,100,0);
        ShowWindow(app.progress,SW_HIDE);
        SetWindowTextW(GetDlgItem(window,kAnalyze),L"开始捕捉");
        EnableWindow(GetDlgItem(window,kAnalyze),TRUE);
        EnableWindow(GetDlgItem(window,kAutoFrame),TRUE);
        EnableWindow(GetDlgItem(window,kPersonFrame),!app.multiview_mode);
        EnableWindow(GetDlgItem(window,kResetFrame),!app.multiview_mode);
        EnableWindow(GetDlgItem(window,kImport),TRUE);
        EnableWindow(GetDlgItem(window,kMultiview),TRUE);
        EnableWindow(GetDlgItem(window,kCharacterProfile),TRUE);
        EnableWindow(GetDlgItem(window,kExportBvh),app.motion.has_value());
        EnableWindow(GetDlgItem(window,kExportVrma),app.motion.has_value());
        EnableWindow(GetDlgItem(window,kSaveMotion),app.motion.has_value());
        if(result->cancelled) {
            set_status(L"动作捕捉已取消 · 中间结果已保留");
        } else if (!result->error.empty()) {
            set_status(L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25 \u00b7 \u4e2d\u95f4\u4ea7\u7269\u5df2\u4fdd\u7559");
            MessageBoxW(window,result->error.c_str(),L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25",MB_ICONERROR);
        } else {
            reset_range_selection();
            app.pose_baseline=std::move(result->pose_baseline);
            app.pose=std::move(result->pose);
            app.profile_refined_pose=app.pose;
            app.optimization_diagnostics=std::move(result->optimization_diagnostics);
            app.anchor_drag_snapshot.reset();
            app.manual_corrections.clear();
            app.correction_undo.clear(); app.correction_redo.clear();
            update_correction_controls();
            app.motion=std::move(result->motion);
            EnableWindow(GetDlgItem(window,kExportBvh),TRUE);
            EnableWindow(GetDlgItem(window,kExportVrma),TRUE);
            EnableWindow(GetDlgItem(window,kSaveMotion),TRUE);
            app.motion_dirty=false;
              app.motion_path=std::move(result->motion_path);
              app.multiview_diagnostics=std::move(result->diagnostics);
              if(app.multiview_diagnostics) {
                  set_status(L"四视角联合求解完成 · 恢复 "+
                      std::to_wstring(app.multiview_diagnostics->recovered_observations)+
                    L" 个遮挡观测 · "+
                      std::to_wstring(app.multiview_diagnostics->conflicts.size())+
                      L" 个跨视角冲突待检查");
              } else if(!result->warning.empty())
                  set_status(L"捕捉完成 · "+result->warning);
            else if(app.character_profile&&app.optimization_diagnostics)
                set_status(L"\u6355\u6349\u5b8c\u6210 \u00b7 \u52a8\u753b\u89d2\u8272\u53c2\u8003\u4fee\u6b63 "+
                    std::to_wstring(app.optimization_diagnostics->corrected_joint_samples)+
                    L" \u4e2a\u4f4e\u7f6e\u4fe1\u5ea6\u6837\u672c \u00b7 \u9ad8\u7f6e\u4fe1\u5ea6\u79fb\u52a8尝试 "+
                    std::to_wstring(app.optimization_diagnostics->high_confidence_move_attempts));
            else if(app.pose&&app.pose->backend.find("qwen3-vl-local")!=std::string::npos)
                set_status(L"捕捉完成 · HRNet、光流、本地视觉纠错和时序平滑已应用");
            else
                set_status(L"捕捉完成 · HRNet、光流和时序平滑已应用");
            InvalidateRect(window,nullptr,TRUE);
        }
        if(close_after_analysis)PostMessageW(window,WM_CLOSE,0,0);
        return 0;
    }
    case WM_CTLCOLORSTATIC:
        if (reinterpret_cast<HWND>(lparam)==app.status) {
            auto dc=reinterpret_cast<HDC>(wparam);
            SetTextColor(dc,theme::text_muted);
            SetBkColor(dc,theme::background);
            return reinterpret_cast<LRESULT>(app.panel_brush);
        } break;
    case WM_LBUTTONDOWN: {
        POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
        if (begin_person_frame_drag(point)) return 0;
        if (begin_anchor_drag(point)) return 0;
        if (const auto time=timeline_time_from_point(point)) {
            stop_playback();
            app.scrubbing=true;
            app.time_s=*time;
            update_timeline();
            InvalidateRect(window,nullptr,FALSE);
            SetCapture(window); return 0;
        }
        RECT motion=motion_area();
        if (PtInRect(&motion,point)) {
            app.rotating=true; app.last_mouse=point; SetCapture(window);
        } return 0;
    }
    case WM_MOUSEMOVE:
        if (app.drawing_person_frame) {
            move_person_frame({GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)});
            return 0;
        }
        if (app.scrubbing) {
            POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
            RECT track=timeline_track();
            point.x=std::clamp<LONG>(point.x,track.left,track.right);
            point.y=(track.top+track.bottom)/2;
            if (const auto time=timeline_time_from_point(point)) {
                app.time_s=*time;
                update_timeline();
                InvalidateRect(window,nullptr,FALSE);
            }
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
        if (app.drawing_person_frame) { finish_person_frame(); return 0; }
        if (app.scrubbing) {
            const double time=app.time_s;
            app.scrubbing=false;
            ReleaseCapture();
            decode_at(time);
            return 0;
        }
        if (app.dragging_anchor>=0) { finish_anchor_drag(); return 0; }
        if (app.rotating) { app.rotating=false; ReleaseCapture(); } return 0;
    case WM_PAINT: paint(window); return 0;
    case WM_ERASEBKGND: return 1;
    case WM_CLOSE:
        if(app.analyzing) {
            if(!app.cancel_requested) {
                const int choice=MessageBoxW(window,
                    L"动作捕捉仍在运行。是否取消捕捉并退出？\n已生成的中间结果会保留。",
                    L"取消动作捕捉",MB_YESNO|MB_ICONWARNING);
                if(choice!=IDYES)return 0;
            }
            app.close_after_analysis=true;
            cancel_analysis();
            return 0;
        }
        if(app.motion_dirty) {
            const int choice=MessageBoxW(window,
                L"手动修正尚未保存。是否先保存一个新的动作包？",
                L"保存修正",MB_YESNOCANCEL|MB_ICONWARNING);
            if(choice==IDCANCEL)return 0;
            if(choice==IDYES&&!save_motion_copy())return 0;
        }
        DestroyWindow(window);
        return 0;
    case WM_DESTROY:
        KillTimer(window,kTimerPlayback);
        KillTimer(window,kTimerAnalysisProgress);
        if(app.font)DeleteObject(app.font); if(app.small_font)DeleteObject(app.small_font);
        if(app.title_font)DeleteObject(app.title_font); if(app.section_font)DeleteObject(app.section_font);
        if(app.mono_font)DeleteObject(app.mono_font);
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
    for(int index=1;arguments && index+1<argument_count;++index) {
        if(std::wstring_view(arguments[index])==L"--character-profile") {
            try {
                app.character_profile=animocap::load_character_profile(
                    std::filesystem::path(arguments[++index]));
                SetWindowTextW(GetDlgItem(window,kCharacterProfile),
                    L"\u52a8\u753b\u89d2\u8272\u53c2\u8003 \u00b7 \u5df2\u542f\u7528");
                set_status(L"动画角色骨架参考已加载 · "+
                    widen(app.character_profile->skeleton.skeleton_id));
            } catch(const std::exception& error) {
                MessageBoxW(window,widen(error.what()).c_str(),
                    L"角色骨架预设加载失败",MB_ICONERROR);
            }
        }
    }
    for (int index = 1; arguments && index + 1 < argument_count; ++index) {
        if(std::wstring_view(arguments[index])==L"--character-profile") {
            ++index;
        } else if (std::wstring_view(arguments[index]) == L"--multiview-folder") {
            load_multiview_folder(std::filesystem::path(arguments[++index]));
        } else if (std::wstring_view(arguments[index]) == L"--video") {
            open_video(std::filesystem::path(arguments[++index]));
        } else if (std::wstring_view(arguments[index]) == L"--pose") {
            try {
                app.pose_baseline=animocap::smooth_pose_sequence(
                    animocap::load_pose_sequence_json(
                        std::filesystem::path(arguments[++index])));
                auto refinement=animocap::optimize_pose_sequence_detailed(
                    *app.pose_baseline,
                    app.character_profile?
                        app.character_profile->optimization_options:
                        animocap::PoseOptimizationOptions{},
                    app.character_profile?
                        &app.character_profile->skeleton:nullptr,
                    app.character_profile?
                        app.character_profile->proportion_policy:
                        animocap::ProportionPolicy::ExactReference);
                if(app.character_profile)
                    refinement.diagnostics.profile_id=app.character_profile->profile_id;
                app.pose=std::move(refinement.sequence);
                app.optimization_diagnostics=std::move(refinement.diagnostics);
                app.profile_refined_pose=app.pose;
                app.anchor_drag_snapshot.reset();
                app.manual_corrections.clear();
                app.correction_undo.clear(); app.correction_redo.clear();
                update_correction_controls();
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
                        animocap::reconstruct_canonical_motion(
                            *app.pose,app.character_profile?
                                &app.character_profile->skeleton:nullptr))
                    : std::optional<animocap::MotionPackage>(
                        animocap::load_motion_package(app.motion_path));
                reset_range_selection();
                app.time_s = app.motion->motion.time_s.front();
                EnableWindow(GetDlgItem(window,kExportBvh),TRUE);
                EnableWindow(GetDlgItem(window,kExportVrma),TRUE);
                EnableWindow(GetDlgItem(window,kSaveMotion),TRUE);
                app.motion_dirty=false;
                update_timeline();
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

