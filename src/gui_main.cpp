#include "animocap/animation_curve.hpp"
#include "animocap/blender_exchange.hpp"
#include "animocap/math.hpp"
#include "animocap/character_profile.hpp"
#include "animocap/contracts.hpp"
#include "animocap/export.hpp"
#include "animocap/multiview.hpp"
#include "animocap/package.hpp"
#include "animocap/pose_sequence.hpp"
#include "animocap/pose_review.hpp"
#include "animocap/video.hpp"

#include <nlohmann/json.hpp>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#include <commctrl.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <windowsx.h>
#include <wincodec.h>
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cwchar>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <tuple>
#include <vector>

#pragma comment(lib,"msimg32.lib")
#pragma comment(lib,"windowscodecs.lib")

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
constexpr int kDeleteKeyframe = 126;
constexpr int kSelectAllKeyframes = 127, kClearKeyframeSelection = 128;
constexpr int kSmoothKeyframes = 129;
constexpr int kAppearanceReference = 130, kAppearanceToggle = 131;
constexpr int kTimelineMode = 132, kCurvePreset = 133;
constexpr int kSelectExportFrames = 134, kSelectAuthoredExportFrames = 135;
constexpr int kClearExportFrames = 136, kExportBlenderSelected = 137;
constexpr int kReviewJoint=138,kReviewLock=139,kReviewWeight=140,kReviewExclude=141;
constexpr int kReviewClear=142,kReviewRebuild=143,kReviewCompare=144,kReviewOpen=145;
constexpr int kReviewFront=146,kReviewSide=147;
constexpr int kExpertInterval=148;
constexpr int kHeader = 58, kWorkspaceBar = 40, kTimelineHeight = 328;
constexpr int kFooterHeight = 34;
constexpr int kRailWidth = 64, kAssetPanelWidth = 236, kInspectorWidth = 380;
constexpr int kInspectorTabs = 36;
constexpr int kTimelineLabelWidth = 156;
constexpr int kPadding = 12;
constexpr std::size_t kMaximumMultiviewViews = 8;
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
enum class TimelineMode { DopeSheet, CurveEditor };
enum class CurvePreset { Linear, EaseIn, EaseOut, Smooth, Hold };
struct CorrectionEditState {
    ManualCorrectionState corrections;
    std::vector<std::size_t> smoothed_keyframes;
    animocap::PoseReview review;
};

struct NpuReviewIssue {
    std::size_t view_index{}, frame_index{};
    double source_time_s{}, reference_time_s{}, mean_normalized_error{};
    std::size_t invalid_joints{}, left_right_swaps{};
    std::wstring detail;
};

struct AnalysisResult {
    std::optional<animocap::PoseSequence> comparison_pose;
    std::optional<animocap::PoseSequence> pose_baseline;
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::PoseOptimizationDiagnostics> optimization_diagnostics;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::MultiviewDiagnostics> diagnostics;
    std::array<std::optional<animocap::PoseSequence>,kMaximumMultiviewViews>
        per_view_poses{};
    std::filesystem::path motion_path;
    std::wstring error, warning;
    std::vector<NpuReviewIssue> npu_review_issues;
    std::size_t npu_sampled_frames{},npu_total_frames{};
    std::size_t npu_reprocess_requested{},npu_reprocess_processed{};
    std::size_t npu_reprocess_accepted{};
    std::size_t npu_reprocess_unavailable_views{};
    bool cancelled{}, motion_dirty{}, recovered_motion{}, npu_shadow_active{};
};
struct AnalysisCancelled final : std::exception {
    const char* what() const noexcept override { return "analysis cancelled"; }
};
struct AppState {
    HWND window{}, timeline{}, status{}, progress{}, play{};
    std::filesystem::path root, video_path, motion_path;
    std::filesystem::path appearance_reference_path;
    std::array<std::filesystem::path,kMaximumMultiviewViews> multiview_videos{};
    std::array<animocap::VideoFrame,kMaximumMultiviewViews> multiview_preview_frames{};
    std::array<std::string,kMaximumMultiviewViews> multiview_view_ids{};
    std::array<double,kMaximumMultiviewViews> multiview_view_yaws{};
    std::array<std::wstring,kMaximumMultiviewViews> multiview_view_labels{};
    std::array<std::optional<animocap::PoseSequence>,kMaximumMultiviewViews>
        multiview_poses{};
    std::filesystem::path multiview_manifest;
    std::unique_ptr<animocap::VideoDecoder> decoder;
    animocap::VideoFrame video_frame;
    std::optional<animocap::PoseSequence> pose_baseline;
    std::optional<animocap::PoseSequence> comparison_pose;
    std::optional<animocap::PoseSequence> profile_refined_pose;
    std::optional<animocap::PoseSequence> pose;
    std::optional<animocap::PoseOptimizationDiagnostics> optimization_diagnostics;
    std::optional<animocap::PoseSequence> anchor_drag_snapshot;
    ManualCorrectionState manual_corrections;
    animocap::PoseReview review;
    std::vector<bool> review_inferred;
    std::optional<animocap::PoseSequence> review_base;
    std::size_t review_joint{10};
    bool review_compare{};
    std::wstring expert_interval{L"2"};
    std::vector<std::pair<POINT,std::size_t>> review_hit_points;
    std::vector<CorrectionEditState> correction_undo, correction_redo;
    std::vector<std::size_t> selected_keyframes;
    std::vector<std::size_t> smoothed_keyframes;
    animocap::BlenderFrameSelection selected_export_frames;
    std::optional<animocap::MotionPackage> motion;
    std::optional<animocap::CharacterProfile> character_profile;
    std::optional<animocap::MultiviewDiagnostics> multiview_diagnostics;
    std::vector<NpuReviewIssue> npu_review_issues;
    bool playing{}, analyzing{}, cancel_requested{}, close_after_analysis{};
    bool rotating{}, calibrating{}, scrubbing{}, video_eof{};
    bool has_person_frame{}, selecting_person_frame{}, drawing_person_frame{};
    bool auto_person_frame{true}, manual_person_frame{}, vlm_enabled{true};
    bool appearance_assist_enabled{true};
    bool multiview_mode{}, calibrated_multiview{}, multiview_overview{};
    std::size_t multiview_review_view{};
    bool motion_dirty{};
    bool selecting_export_frames{};
    TimelineMode timeline_mode{TimelineMode::DopeSheet};
    CurvePreset curve_preset{CurvePreset::Smooth};
    int active_curve_correction{-1};
    bool dragging_curve_handle{};
    int curve_handle_side{};
    bool curve_drag_changed{};
    std::optional<CorrectionEditState> curve_drag_before_state;
    std::optional<animocap::PoseSequence> curve_drag_before_pose;
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
    HBITMAP human_reference_bitmap{};
    HDC human_reference_dc{};
    SIZE human_reference_size{};
    bool human_reference_attempted{};
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
void append_status(const std::wstring& suffix) {
    const int length=GetWindowTextLengthW(app.status);
    std::wstring value(static_cast<std::size_t>(std::max(0,length))+1,L'\0');
    GetWindowTextW(app.status,value.data(),static_cast<int>(value.size()));
    value.resize(static_cast<std::size_t>(std::max(0,length)));
    set_status(value+suffix);
}
void update_correction_controls();
void update_blender_selection_controls();
std::wstring blender_selection_summary(std::size_t limit=12);
bool contains_keyframe(const std::vector<std::size_t>& frames,std::size_t frame);
std::size_t pose_frame();
void rebuild_corrected_pose();
CorrectionEditState current_correction_state();
void push_correction_history(std::vector<CorrectionEditState>& history,
                             CorrectionEditState value);
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
enum class MotionOpenSource { Cancelled, AniMocapPackage, ExchangeFile };
MotionOpenSource choose_motion_open_source() {
    const int selected=MessageBoxW(
        app.window,
        L"\u8bf7\u9009\u62e9\u52a8\u4f5c\u6765\u6e90\uff1a\n\n"
        L"\u662f  = AniMocap \u52a8\u4f5c\u5305\uff08\u9009\u62e9 .amotion \u6587\u4ef6\u5939\uff09\n"
        L"\u5426  = BVH / VRMA \u52a8\u4f5c\uff08\u9009\u62e9 .bvh \u6216 .vrma \u6587\u4ef6\uff09",
        L"\u6253\u5f00\u52a8\u4f5c",
        MB_YESNOCANCEL|MB_ICONQUESTION);
    if(selected==IDYES)return MotionOpenSource::AniMocapPackage;
    if(selected==IDNO)return MotionOpenSource::ExchangeFile;
    return MotionOpenSource::Cancelled;
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
    return {kRailWidth + kAssetPanelWidth + kPadding,
            kHeader + kWorkspaceBar + kPadding,
            client.right - kInspectorWidth - kPadding,
            client.bottom - kTimelineHeight - kFooterHeight - kPadding};
}
RECT inspector_rect() {
    RECT client{}; GetClientRect(app.window, &client);
    const RECT canvas=canvas_rect();
    return {canvas.right + kPadding,canvas.top,client.right-kPadding,canvas.bottom};
}
int workspace_split() {
    return canvas_rect().right;
}
RECT video_area() {
    return canvas_rect();
}
RECT motion_area() {
    const RECT inspector=inspector_rect();
    const LONG available=std::max<LONG>(0,inspector.bottom-inspector.top-kInspectorTabs);
    const LONG height=std::clamp<LONG>(available*78/100,300,560);
    return {inspector.left,inspector.top+kInspectorTabs,inspector.right,
            std::min<LONG>(inspector.bottom,inspector.top+kInspectorTabs+height)};
}
RECT issues_area() {
    const RECT inspector=inspector_rect();
    const RECT motion=motion_area();
    return {inspector.left,motion.bottom+8,inspector.right,inspector.bottom};
}
RECT timeline_area() {
    RECT client{}; GetClientRect(app.window,&client);
    return {kPadding,client.bottom-kFooterHeight-kTimelineHeight,
            client.right-kPadding,client.bottom-kFooterHeight-8};
}
RECT timeline_track() {
    RECT area=timeline_area();
    // The visible bar is near the bottom of the panel, but the whole video
    // track row must be easy to grab instead of being a one-pixel hit target.
    return {area.left+kTimelineLabelWidth,area.top+148,
            area.right-12,area.bottom-4};
}
RECT timeline_hit_area() {
    RECT area=timeline_area();
    return {area.left+kTimelineLabelWidth,area.top+46,
            area.right-12,area.bottom-4};
}
RECT curve_graph_area() {
    const RECT area=timeline_area();
    return {area.left+kTimelineLabelWidth,area.top+56,
            area.right-12,area.bottom-12};
}
std::wstring curve_preset_label(CurvePreset preset) {
    switch(preset) {
    case CurvePreset::Linear:return L"曲线 · 线性";
    case CurvePreset::EaseIn:return L"曲线 · 缓入";
    case CurvePreset::EaseOut:return L"曲线 · 缓出";
    case CurvePreset::Smooth:return L"曲线 · 平滑";
    case CurvePreset::Hold:return L"曲线 · 保持";
    }
    return L"曲线 · 平滑";
}
double editor_curve_weight(double normalized_distance,CurvePreset preset) {
    const double value=std::clamp(normalized_distance,0.0,1.0);
    switch(preset) {
    case CurvePreset::Linear:
        return 1.0-value;
    case CurvePreset::EaseIn:
        return 1.0-value*value;
    case CurvePreset::EaseOut:
        return (1.0-value)*(1.0-value);
    case CurvePreset::Smooth:
        return 1.0-value*value*(3.0-2.0*value);
    case CurvePreset::Hold:
        return 1.0;
    }
    return 1.0-value*value*(3.0-2.0*value);
}
std::vector<double> editor_curve_weights(
    std::size_t frame_count,std::size_t keyframe,std::size_t radius,CurvePreset preset
) {
    if(frame_count==0||keyframe>=frame_count)return {};
    radius=std::max<std::size_t>(1,radius);
    std::vector<double> result(frame_count,0.0);
    for(std::size_t frame=0;frame<frame_count;++frame) {
        const std::size_t distance=frame>keyframe?frame-keyframe:keyframe-frame;
        if(distance>radius)continue;
        result[frame]=editor_curve_weight(
            static_cast<double>(distance)/static_cast<double>(radius),preset);
    }
    return result;
}
std::size_t correction_curve_radius(const animocap::ManualPoseCorrection& correction) {
    std::size_t radius=1;
    if(correction.frame_weights.empty())return 4;
    for(std::size_t frame=0;frame<correction.frame_weights.size();++frame) {
        if(correction.frame_weights[frame]<=1e-5)continue;
        const auto distance=frame>correction.keyframe_frame_index
            ?frame-correction.keyframe_frame_index
            :correction.keyframe_frame_index-frame;
        radius=std::max(radius,distance);
    }
    return radius;
}
std::optional<std::size_t> active_curve_correction_index() {
    if(app.active_curve_correction>=0&&
       static_cast<std::size_t>(app.active_curve_correction)<app.manual_corrections.size())
        return static_cast<std::size_t>(app.active_curve_correction);
    const auto selected=app.selected_keyframes;
    for(std::size_t index=0;index<app.manual_corrections.size();++index) {
        const auto& correction=app.manual_corrections[index];
        if(!correction.frame_weights.empty()&&
           contains_keyframe(selected,correction.keyframe_frame_index))return index;
    }
    const auto current=app.pose?pose_frame():0;
    for(std::size_t index=0;index<app.manual_corrections.size();++index) {
        if(app.manual_corrections[index].keyframe_frame_index==current&&
           !app.manual_corrections[index].frame_weights.empty())return index;
    }
    if(!app.manual_corrections.empty())return std::size_t{0};
    return {};
}
void update_timeline_labels() {
    if(!app.window)return;
    if(HWND control=GetDlgItem(app.window,kTimelineMode))
        SetWindowTextW(control,app.timeline_mode==TimelineMode::DopeSheet
            ?L"曲线编辑器":L"关键帧轨道");
    if(HWND control=GetDlgItem(app.window,kCurvePreset))
        SetWindowTextW(control,curve_preset_label(app.curve_preset).c_str());
}
struct TimelineRange { double start{}, end{}; };
std::size_t multiview_reference_view() {
    std::size_t best=0;
    double best_yaw=std::numeric_limits<double>::infinity();
    for(std::size_t index=0;index<kMaximumMultiviewViews;++index) {
        if(app.multiview_videos[index].empty())continue;
        const double yaw=std::abs(app.multiview_view_yaws[index]);
        if(yaw<best_yaw) { best=index; best_yaw=yaw; }
    }
    return best;
}
bool has_multiview_review() {
    return app.multiview_mode && app.multiview_review_view<kMaximumMultiviewViews &&
        app.multiview_poses[app.multiview_review_view].has_value();
}
double review_source_time(double reference_time) {
    if(!has_multiview_review() || !app.pose || app.pose->frames.empty() ||
       !app.multiview_diagnostics ||
       app.multiview_review_view>=app.multiview_diagnostics->alignments.size())
        return reference_time;
    const auto& reference=*app.pose;
    const auto& alignment=
        app.multiview_diagnostics->alignments[app.multiview_review_view];
    if(alignment.source_frame_at_reference.empty())return reference_time;
    auto found=std::lower_bound(reference.frames.begin(),reference.frames.end(),reference_time,
        [](const animocap::ObservedPoseFrame& frame,double time) {
            return frame.time_s<time;
        });
    std::size_t reference_frame=found==reference.frames.end()
        ?reference.frames.size()-1:static_cast<std::size_t>(found-reference.frames.begin());
    reference_frame=std::min(reference_frame,
        alignment.source_frame_at_reference.size()-1);
    const auto& source=*app.multiview_poses[app.multiview_review_view];
    if(source.frames.empty())return reference_time;
    const double source_frame=std::clamp(
        alignment.source_frame_at_reference[reference_frame],0.0,
        static_cast<double>(source.frames.size()-1));
    const auto before=static_cast<std::size_t>(std::floor(source_frame));
    const auto after=std::min(before+1,source.frames.size()-1);
    const double fraction=source_frame-static_cast<double>(before);
    return source.frames[before].time_s+
        (source.frames[after].time_s-source.frames[before].time_s)*fraction;
}
double reference_time_from_source_frame(std::size_t view_index,double source_frame) {
    if(!app.pose||app.pose->frames.empty()||!app.multiview_diagnostics||
       view_index>=app.multiview_diagnostics->alignments.size())
        return source_frame/std::max(1.0,app.pose?app.pose->fps:30.0);
    const auto& mapping=app.multiview_diagnostics->alignments[view_index]
        .source_frame_at_reference;
    if(mapping.empty())return source_frame/std::max(1.0,app.pose->fps);
    const auto mapped_count=std::min(mapping.size(),app.pose->frames.size());
    if(mapped_count==0)return source_frame/std::max(1.0,app.pose->fps);
    auto after=std::lower_bound(mapping.begin(),mapping.begin()+
        static_cast<std::ptrdiff_t>(mapped_count),source_frame);
    if(after==mapping.begin())return app.pose->frames.front().time_s;
    if(after==mapping.begin()+static_cast<std::ptrdiff_t>(mapped_count))
        return app.pose->frames[mapped_count-1].time_s;
    const auto after_index=static_cast<std::size_t>(after-mapping.begin());
    const auto before_index=after_index-1;
    const double span=mapping[after_index]-mapping[before_index];
    const double fraction=span>1e-9
        ?std::clamp((source_frame-mapping[before_index])/span,0.0,1.0):0.0;
    return app.pose->frames[before_index].time_s+
        (app.pose->frames[after_index].time_s-app.pose->frames[before_index].time_s)*fraction;
}
double review_reference_time(double source_time) {
    if(!has_multiview_review())return source_time;
    const auto& source=*app.multiview_poses[app.multiview_review_view];
    if(source.frames.empty())return source_time;
    auto after=std::lower_bound(source.frames.begin(),source.frames.end(),source_time,
        [](const animocap::ObservedPoseFrame& frame,double time){return frame.time_s<time;});
    double source_frame=0.0;
    if(after==source.frames.end())source_frame=static_cast<double>(source.frames.size()-1);
    else if(after==source.frames.begin())source_frame=0.0;
    else {
        const auto after_index=static_cast<std::size_t>(after-source.frames.begin());
        const auto before_index=after_index-1;
        const double span=source.frames[after_index].time_s-source.frames[before_index].time_s;
        const double fraction=span>1e-9
            ?std::clamp((source_time-source.frames[before_index].time_s)/span,0.0,1.0):0.0;
        source_frame=static_cast<double>(before_index)+fraction;
    }
    return reference_time_from_source_frame(app.multiview_review_view,source_frame);
}
std::optional<TimelineRange> timeline_range() {
    if(app.multiview_mode&&app.motion&&!app.motion->motion.time_s.empty()) {
        const auto& times=app.motion->motion.time_s;
        return TimelineRange{times.front(),std::max(times.front()+0.001,times.back())};
    }
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
std::vector<std::size_t> authored_keyframe_frames() {
    std::vector<std::size_t> frames;
    const std::size_t frame_count=app.pose?app.pose->frames.size():0;
    for(const auto& correction:app.manual_corrections) {
        if(correction.frame_weights.empty() ||
           correction.keyframe_frame_index>=frame_count) continue;
        frames.push_back(correction.keyframe_frame_index);
    }
    std::sort(frames.begin(),frames.end());
    frames.erase(std::unique(frames.begin(),frames.end()),frames.end());
    return frames;
}
bool contains_keyframe(const std::vector<std::size_t>& frames,std::size_t frame) {
    return std::binary_search(frames.begin(),frames.end(),frame);
}
bool keyframe_is_selected(std::size_t frame) {
    return contains_keyframe(app.selected_keyframes,frame);
}
void prune_keyframe_selection() {
    const auto available=authored_keyframe_frames();
    app.selected_keyframes.erase(
        std::remove_if(app.selected_keyframes.begin(),app.selected_keyframes.end(),
            [&](std::size_t frame) { return !contains_keyframe(available,frame); }),
        app.selected_keyframes.end());
    std::sort(app.selected_keyframes.begin(),app.selected_keyframes.end());
    app.selected_keyframes.erase(std::unique(
        app.selected_keyframes.begin(),app.selected_keyframes.end()),
        app.selected_keyframes.end());
}
bool all_keyframes_selected() {
    const auto available=authored_keyframe_frames();
    return !available.empty() && app.selected_keyframes==available;
}
std::optional<std::size_t> keyframe_from_point(POINT point) {
    if(!app.pose)return {};
    const auto range=timeline_range();
    if(!range)return {};
    RECT hit=timeline_hit_area();
    if(point.x<hit.left || point.x>hit.right ||
       point.y<hit.top || point.y>hit.bottom) return {};
    const RECT track=timeline_track();
    const auto frames=authored_keyframe_frames();
    std::optional<std::size_t> result;
    int closest=14;
    for(const auto frame:frames) {
        const int x=track.left+static_cast<int>((track.right-track.left)*
            std::clamp(app.pose->frames[frame].time_s-range->start,0.0,range->end-range->start)/
            std::max(.001,range->end-range->start));
        const int distance=std::abs(point.x-x);
        if(distance<closest) {
            closest=distance;
            result=frame;
        }
    }
    return result;
}
int curve_x_for_frame(RECT graph,std::size_t frame) {
    if(!app.pose||app.pose->frames.empty())return graph.left;
    if(const auto range=timeline_range()) {
        const double time=app.pose->frames[std::min(frame,app.pose->frames.size()-1)].time_s;
        return graph.left+static_cast<int>(std::lround(
            (graph.right-graph.left)*std::clamp(
                (time-range->start)/std::max(.001,range->end-range->start),0.0,1.0)));
    }
    return graph.left+static_cast<int>(std::lround(
        (graph.right-graph.left)*frame/
        std::max<double>(1.0,static_cast<double>(app.pose->frames.size()-1))));
}
std::optional<std::size_t> curve_keyframe_from_point(POINT point) {
    if(app.timeline_mode!=TimelineMode::CurveEditor||!app.pose)return {};
    const RECT graph=curve_graph_area();
    if(point.x<graph.left-14||point.x>graph.right+14||
       point.y<graph.top||point.y>graph.bottom)return {};
    std::optional<std::size_t> result;
    int closest=14;
    for(const auto frame:authored_keyframe_frames()) {
        const int distance=std::abs(point.x-curve_x_for_frame(graph,frame));
        if(distance<closest) { closest=distance; result=frame; }
    }
    return result;
}
int curve_handle_y(RECT graph) { return graph.bottom-18; }
std::optional<std::pair<int,int>> curve_handle_from_point(POINT point) {
    if(app.timeline_mode!=TimelineMode::CurveEditor||!app.pose)return {};
    const auto index=active_curve_correction_index();
    if(!index||*index>=app.manual_corrections.size())return {};
    const RECT graph=curve_graph_area();
    if(point.x<graph.left||point.x>graph.right||point.y<graph.top||point.y>graph.bottom)
        return {};
    const auto& correction=app.manual_corrections[*index];
    if(correction.frame_weights.empty()||
       correction.keyframe_frame_index>=app.pose->frames.size())return {};
    const auto radius=correction_curve_radius(correction);
    const int key_x=curve_x_for_frame(graph,correction.keyframe_frame_index);
    const int left_x=curve_x_for_frame(graph,
        correction.keyframe_frame_index>radius
            ?correction.keyframe_frame_index-radius:0);
    const int right_x=curve_x_for_frame(graph,std::min(
        app.pose->frames.size()-1,correction.keyframe_frame_index+radius));
    if(std::abs(point.x-left_x)<=10&&std::abs(point.y-curve_handle_y(graph))<=12)
        return std::pair<int,int>{-1,key_x};
    if(std::abs(point.x-right_x)<=10&&std::abs(point.y-curve_handle_y(graph))<=12)
        return std::pair<int,int>{1,key_x};
    return {};
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
    update_correction_controls();
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
        const auto info=app.decoder->info();
        const double frame_step=1.0/std::max(1.0,info.fps);
        const double source_time=review_source_time(time_s);
        const double target=std::clamp(
            source_time,0.0,std::max(0.0,info.duration_s-frame_step));
        // Media Foundation can leave the source reader exhausted after an
        // end-of-stream result. Recreate it before the first seek back so a
        // completed playback never makes the timeline appear permanently stuck.
        if(app.video_eof&&!app.video_path.empty()) {
            auto decoder=std::make_unique<animocap::VideoDecoder>();
            decoder->open(app.video_path);
            app.decoder=std::move(decoder);
        }
        app.decoder->seek(target);
        animocap::VideoFrame candidate;
        bool decoded=false;
        while (app.decoder->read_frame(candidate)) {
            app.video_frame=std::move(candidate);
            decoded=true;
            if (app.video_frame.time_s>=target) break;
        }
        if (decoded) {
            app.video_eof=false;
            app.time_s=has_multiview_review()?time_s:app.video_frame.time_s;
            update_timeline();
            InvalidateRect(app.window,nullptr,FALSE);
        } else {
            throw std::runtime_error("video seek reached end of stream");
        }
    } catch (const std::exception& error) {
        stop_playback(L"视频定位失败 · " + widen(error.what()));
    }
}
std::optional<double> timeline_time_from_point(POINT point) {
    const auto range=timeline_range();
    if(!range)return {};
    RECT hit=timeline_hit_area();
    if (point.x<hit.left || point.x>hit.right ||
        point.y<hit.top || point.y>hit.bottom) return {};
    RECT track=timeline_track();
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
        app.video_eof=false;
        app.time_s = app.video_frame.time_s;
        app.pose_baseline.reset(); app.comparison_pose.reset();
        app.profile_refined_pose.reset(); app.pose.reset();
        app.motion.reset(); app.multiview_diagnostics.reset();
        reset_range_selection();
        app.anchor_drag_snapshot.reset();
        app.manual_corrections.clear();
        app.review={}; app.review_inferred.clear(); app.review_base.reset(); app.review_compare=false;
        app.correction_undo.clear(); app.correction_redo.clear();
        app.selected_keyframes.clear(); app.smoothed_keyframes.clear();
        app.selected_export_frames.clear(); app.selecting_export_frames=false;
        app.active_curve_correction=-1;
        EnableWindow(GetDlgItem(app.window,kUndoCorrection),FALSE);
        EnableWindow(GetDlgItem(app.window,kRedoCorrection),FALSE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),FALSE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),FALSE);
        EnableWindow(GetDlgItem(app.window,kSaveMotion),FALSE);
        update_blender_selection_controls();
        app.motion_dirty=false;
        app.multiview_mode=false; app.calibrated_multiview=false;
        app.multiview_overview=false;
        app.multiview_videos={}; app.multiview_manifest.clear();
        app.multiview_preview_frames={};
        app.multiview_view_ids={}; app.multiview_view_yaws={};
        app.multiview_view_labels={};
        app.multiview_poses={}; app.multiview_review_view=0;
        app.npu_review_issues.clear();
        SetWindowTextW(GetDlgItem(app.window,kResetFrame),L"重置");
        SetWindowTextW(GetDlgItem(app.window,kMultiview),L"导入多视角");
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
bool open_multiview_previews(
    const std::array<std::filesystem::path,kMaximumMultiviewViews>& videos,
    const std::array<std::wstring,kMaximumMultiviewViews>& labels
) {
    std::size_t first_view = kMaximumMultiviewViews;
    for(std::size_t index=0;index<videos.size();++index) {
        if(!videos[index].empty()) { first_view=index; break; }
    }
    if(first_view==kMaximumMultiviewViews) {
        MessageBoxW(app.window,L"多视角预览至少需要一个视频。",L"多视角导入失败",MB_ICONWARNING);
        return false;
    }
    std::array<animocap::VideoFrame,kMaximumMultiviewViews> frames{};
    for(std::size_t index=0;index<videos.size();++index) {
        if(videos[index].empty())continue;
        try {
            animocap::VideoDecoder decoder;
            decoder.open(videos[index]);
            if(!decoder.read_frame(frames[index]))
                throw std::runtime_error("video contains no decodable frames");
        } catch(const std::exception& error) {
            std::wstring label=labels[index];
            if(label.empty())label=L"view "+std::to_wstring(index+1);
            const auto message=label+L"视频无法预览："+
                videos[index].filename().wstring()+L"\n"+widen(error.what());
            MessageBoxW(app.window,message.c_str(),L"多视角导入失败",MB_ICONERROR);
            return false;
        }
    }
    if(!open_video(videos[first_view]))return false;
    frames[first_view]=app.video_frame;
    app.multiview_preview_frames=std::move(frames);
    return true;
}
bool open_multiview_previews(
    const std::array<std::filesystem::path,kMaximumMultiviewViews>& videos
) {
    std::array<std::wstring,kMaximumMultiviewViews> labels{};
    for(std::size_t index=0;index<labels.size();++index)
        labels[index]=L"view "+std::to_wstring(index+1);
    return open_multiview_previews(videos,labels);
}
bool select_multiview_review(std::size_t requested) {
    if(!app.multiview_mode)return false;
    for(std::size_t offset=0;offset<kMaximumMultiviewViews;++offset) {
        const auto index=(requested+offset)%kMaximumMultiviewViews;
        if(app.multiview_videos[index].empty()||!app.multiview_poses[index])continue;
        try {
            stop_playback();
            auto decoder=std::make_unique<animocap::VideoDecoder>();
            decoder->open(app.multiview_videos[index]);
            animocap::VideoFrame frame;
            if(!decoder->read_frame(frame))
                throw std::runtime_error("video contains no decodable frames");
            app.decoder=std::move(decoder);
            app.video_frame=std::move(frame);
            app.video_path=app.multiview_videos[index];
            app.multiview_review_view=index;
            app.multiview_overview=false;
            app.video_eof=false;
            decode_at(app.time_s);
            SetWindowTextW(GetDlgItem(app.window,kResetFrame),L"多视角总览");
            const auto label=app.multiview_view_labels[index].empty()
                ?L"view "+std::to_wstring(index+1)
                :app.multiview_view_labels[index];
            set_status(L"同步视角检查 · "+label+
                (index==multiview_reference_view()
                    ?L" · 可进行手动修正"
                    :L" · 只读；其他视角仅辅助深度和遮挡恢复"));
            InvalidateRect(app.window,nullptr,TRUE);
            return true;
        } catch(const std::exception& error) {
            MessageBoxW(app.window,widen(error.what()).c_str(),
                L"切换检查视角失败",MB_ICONERROR);
            return false;
        }
    }
    return false;
}
void cycle_multiview_review() {
    if(!select_multiview_review(
        (app.multiview_review_view+1)%kMaximumMultiviewViews))
        set_status(L"没有可用的逐视角姿势结果");
}
void toggle_multiview_overview() {
    if(!app.multiview_mode||!has_multiview_review())return;
    stop_playback();
    app.multiview_overview=!app.multiview_overview;
    SetWindowTextW(GetDlgItem(app.window,kResetFrame),
        app.multiview_overview?L"返回当前视角":L"多视角总览");
    set_status(app.multiview_overview
        ?L"捕捉后多视角总览 · 点击任一画面进入同步检查"
        :L"已返回当前同步视角");
    InvalidateRect(app.window,nullptr,TRUE);
}
void import_video() {
    if(!confirm_replace_dirty_motion())return;
    auto path = choose(false, L"\u5bfc\u5165\u52a8\u4f5c\u89c6\u9891");
    if (!path) return;
    open_video(*path);
}

void import_appearance_reference() {
    if(app.analyzing)return;
    const COMDLG_FILTERSPEC filters[] = {
        {L"外观参考图像",L"*.png;*.jpg;*.jpeg;*.webp;*.bmp"},
        {L"所有图像",L"*.*"},
    };
    const auto path=choose(false,L"导入目标角色外观参考（最多使用 3 张）",
        filters,static_cast<UINT>(std::size(filters)));
    if(!path)return;
    if(!std::filesystem::is_regular_file(*path)) {
        MessageBoxW(app.window,L"外观参考不是可读取的图像文件。",
                    L"外观参考导入失败",MB_ICONWARNING);
        return;
    }
    app.appearance_reference_path=*path;
    app.appearance_assist_enabled=true;
    SetWindowTextW(GetDlgItem(app.window,kAppearanceReference),L"外观参考 · 已载入");
    SetWindowTextW(GetDlgItem(app.window,kAppearanceToggle),L"外观辅助 · 开");
    set_status(L"外观参考已载入 · 只用于低置信度视觉纠错，不覆盖当前帧空间坐标");
    InvalidateRect(app.window,nullptr,TRUE);
}

void toggle_appearance_assist() {
    if(app.appearance_reference_path.empty()) {
        set_status(L"请先导入外观参考图；当前仍可使用骨骼、轮廓和时序辅助");
        return;
    }
    app.appearance_assist_enabled=!app.appearance_assist_enabled;
    SetWindowTextW(GetDlgItem(app.window,kAppearanceToggle),
        app.appearance_assist_enabled?L"外观辅助 · 开":L"外观辅助 · 关");
    set_status(app.appearance_assist_enabled
        ?L"外观辅助已启用 · 参考图参与低置信度/遮挡帧复核"
        :L"外观辅助已关闭 · 当前捕捉只使用骨骼、轮廓和时序信息");
    InvalidateRect(app.window,nullptr,FALSE);
}

std::wstring profile_effect_summary(
    const animocap::PoseOptimizationDiagnostics& diagnostics
) {
    if(diagnostics.corrected_joint_samples==0)
        return L"\u672c\u6b21\u672a\u4ea7\u751f\u5f71\u54cd \u00b7 0 \u6837\u672c \u00b7 0 mm";
    return L"\u5b9e\u9645\u4fee\u6b63 "+
        std::to_wstring(diagnostics.corrected_joint_samples)+
        L" \u6837\u672c \u00b7 \u5e73\u5747 "+
        std::to_wstring(static_cast<int>(std::lround(
            diagnostics.mean_correction_m*1000.0)))+L" mm \u00b7 \u6700\u5927 "+
        std::to_wstring(static_cast<int>(std::lround(
            diagnostics.maximum_correction_m*1000.0)))+L" mm";
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
            auto reviewed=animocap::rebuild_reviewed_pose(*updated_pose,app.review);
            app.review_base=*updated_pose;
            app.review_inferred=std::move(reviewed.inferred);
            updated_pose=std::move(reviewed.sequence);
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
        const auto profile_effect=updated_diagnostics
            ?profile_effect_summary(*updated_diagnostics)
            :L"\u5c06\u5e94\u7528\u4e8e\u4e0b\u6b21\u6355\u6349";
        SetWindowTextW(GetDlgItem(app.window,kCharacterProfile),
            (L"\u52a8\u753b\u89d2\u8272\u53c2\u8003 \u00b7 "+profile_effect).c_str());
        const int confidence_percent=static_cast<int>(std::round(
            app.character_profile->optimization_options.low_confidence_threshold*100.0));
        const auto policy=app.character_profile->proportion_policy==
            animocap::ProportionPolicy::SimilarReference
            ?L"\u76f8\u4f3c\u6bd4\u4f8b":L"\u7cbe\u786e\u6bd4\u4f8b";
        set_status(L"\u52a8\u753b\u89d2\u8272\u53c2\u8003\u5df2\u5bfc\u5165 \u00b7 "+
            widen(app.character_profile->skeleton.skeleton_id)+L" \u00b7 \u4f4e\u7f6e\u4fe1\u5ea6\u9608\u503c "+
            std::to_wstring(confidence_percent)+L"% \u00b7 "+policy+
            L" \u00b7 "+profile_effect+
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
enum class DirectViewKind { FanLeft, Front, FanRight, Right, Back, Left };
struct DirectMultiviewSelection {
    std::array<std::filesystem::path,kMaximumMultiviewViews> videos{};
    std::array<std::string,kMaximumMultiviewViews> ids{};
    std::array<double,kMaximumMultiviewViews> yaws{};
    std::array<std::wstring,kMaximumMultiviewViews> labels{};
    std::size_t count{};
};
bool has_delimited_alias(const std::wstring& value,std::wstring_view alias) {
    const auto is_word=[](wchar_t character) { return std::iswalnum(character)!=0; };
    std::size_t position=value.find(alias);
    while(position!=std::wstring::npos) {
        const bool left_boundary=position==0||!is_word(value[position-1]);
        const auto end=position+alias.size();
        const bool right_boundary=end>=value.size()||!is_word(value[end]);
        if(left_boundary&&right_boundary)return true;
        position=value.find(alias,position+1);
    }
    return false;
}
std::optional<DirectViewKind> classify_direct_view(const std::filesystem::path& path) {
    std::wstring stem=path.stem().wstring();
    std::transform(stem.begin(),stem.end(),stem.begin(),::towlower);
    // Compound aliases are checked before the exact front token so that
    // front_left/front_right never also match front.
    if(has_delimited_alias(stem,L"front_left")||
       has_delimited_alias(stem,L"front-left")||
       has_delimited_alias(stem,L"frontleft")||
       stem.find(L"左前")!=std::wstring::npos||stem.find(L"前左")!=std::wstring::npos)
        return DirectViewKind::FanLeft;
    if(has_delimited_alias(stem,L"front_right")||
       has_delimited_alias(stem,L"front-right")||
       has_delimited_alias(stem,L"frontright")||
       stem.find(L"右前")!=std::wstring::npos||stem.find(L"前右")!=std::wstring::npos)
        return DirectViewKind::FanRight;
    if(has_delimited_alias(stem,L"front")||stem.find(L"正面")!=std::wstring::npos)
        return DirectViewKind::Front;
    if(has_delimited_alias(stem,L"right")||stem.find(L"右侧")!=std::wstring::npos)
        return DirectViewKind::Right;
    if(has_delimited_alias(stem,L"back")||stem.find(L"背面")!=std::wstring::npos)
        return DirectViewKind::Back;
    if(has_delimited_alias(stem,L"left")||stem.find(L"左侧")!=std::wstring::npos)
        return DirectViewKind::Left;
    return {};
}
std::optional<DirectMultiviewSelection> select_direct_multiview(
    const std::vector<std::filesystem::path>& candidates,bool strict_count
) {
    std::array<std::vector<std::filesystem::path>,3> fan;
    std::array<std::vector<std::filesystem::path>,4> cardinal;
    for(const auto& path:candidates) {
        const auto kind=classify_direct_view(path);
        if(!kind) { if(strict_count)return {}; else continue; }
        switch(*kind) {
        case DirectViewKind::FanLeft:fan[0].push_back(path);break;
        case DirectViewKind::Front:fan[1].push_back(path);cardinal[0].push_back(path);break;
        case DirectViewKind::FanRight:fan[2].push_back(path);break;
        case DirectViewKind::Right:cardinal[1].push_back(path);break;
        case DirectViewKind::Back:cardinal[2].push_back(path);break;
        case DirectViewKind::Left:cardinal[3].push_back(path);break;
        }
    }
    const bool fan_complete=std::all_of(fan.begin(),fan.end(),
        [](const auto& matches){return matches.size()==1;})&&
        (!strict_count||candidates.size()==3);
    const bool cardinal_complete=std::all_of(cardinal.begin(),cardinal.end(),
        [](const auto& matches){return matches.size()==1;})&&
        (!strict_count||candidates.size()==4);
    if(!fan_complete&&!cardinal_complete)return {};
    DirectMultiviewSelection selection;
    if(fan_complete) {
        selection.count=3;
        selection.videos[0]=std::filesystem::weakly_canonical(fan[0][0]);
        selection.videos[1]=std::filesystem::weakly_canonical(fan[1][0]);
        selection.videos[2]=std::filesystem::weakly_canonical(fan[2][0]);
        selection.ids[0]="front_left"; selection.ids[1]="front";
        selection.ids[2]="front_right";
        selection.yaws[0]=-45.0; selection.yaws[1]=0.0; selection.yaws[2]=45.0;
        selection.labels[0]=L"front-left -45°";
        selection.labels[1]=L"front 0°";
        selection.labels[2]=L"front-right +45°";
    } else {
        selection.count=4;
        for(std::size_t index=0;index<cardinal.size();++index)
            selection.videos[index]=std::filesystem::weakly_canonical(cardinal[index][0]);
        selection.ids={"front","right","back","left","","","",""};
        selection.yaws={0.0,90.0,180.0,-90.0,0.0,0.0,0.0,0.0};
        selection.labels={L"front 0°",L"right +90°",L"back +180°",L"left -90°",
                          L"",L"",L"",L""};
    }
    return selection;
}
std::wstring direct_view_summary(const DirectMultiviewSelection& selection) {
    std::wstring result=std::to_wstring(selection.count)+L" views · ";
    for(std::size_t index=0;index<selection.count;++index) {
        if(index)result+=L" / ";
        result+=selection.labels[index]+L" "+selection.videos[index].filename().wstring();
    }
    return result;
}
std::wstring manifest_view_label(const animocap::CaptureView& view) {
    std::wstring result=widen(view.id);
    if(view.yaw_degrees)
        result+=L" "+std::to_wstring(static_cast<int>(std::lround(*view.yaw_degrees)))+L"°";
    return result;
}
std::wstring manifest_view_summary(
    const std::array<std::wstring,kMaximumMultiviewViews>& labels,
    std::size_t count
) {
    std::wstring result=std::to_wstring(count)+L" views";
    for(std::size_t index=0;index<count;++index) {
        result+=index==0?L" · ":L" / ";
        result+=labels[index];
    }
    return result;
}
void apply_multiview_selection(const DirectMultiviewSelection& selection) {
    app.multiview_videos=selection.videos;
    app.multiview_view_ids=selection.ids;
    app.multiview_view_yaws=selection.yaws;
    app.multiview_view_labels=selection.labels;
}
bool load_multiview_folder(const std::filesystem::path& folder) {
    if(!confirm_replace_dirty_motion())return false;
    const auto synchronized_manifest=folder/"capture.json";
    if(std::filesystem::is_regular_file(synchronized_manifest)) {
        try {
            const auto manifest=animocap::load_capture_manifest(synchronized_manifest);
            if(manifest.mode==animocap::CaptureMode::SynchronizedMultiview||
               manifest.mode==animocap::CaptureMode::DirectionalRepeat) {
                std::array<std::filesystem::path,kMaximumMultiviewViews> videos{};
                std::array<std::string,kMaximumMultiviewViews> ids{};
                std::array<double,kMaximumMultiviewViews> yaws{};
                std::array<std::wstring,kMaximumMultiviewViews> labels{};
                for(std::size_t index=0;index<manifest.views.size();++index) {
                    const auto& view=manifest.views[index];
                    if(manifest.mode==animocap::CaptureMode::DirectionalRepeat&&
                       !view.yaw_degrees)
                        throw animocap::ContractError(
                            "directional capture view requires an explicit yaw");
                    auto path=std::filesystem::path(view.video);
                    if(path.is_relative())path=folder/path;
                    if(!std::filesystem::is_regular_file(path))
                        throw std::runtime_error("multiview view video is missing");
                    videos[index]=std::filesystem::weakly_canonical(path);
                    ids[index]=view.id;
                    if(view.yaw_degrees)yaws[index]=*view.yaw_degrees;
                    labels[index]=manifest_view_label(view);
                }
                if(!open_multiview_previews(videos,labels))return false;
                app.multiview_videos=videos;
                app.multiview_view_ids=ids;
                app.multiview_view_yaws=yaws;
                app.multiview_view_labels=labels;
                app.multiview_manifest=synchronized_manifest;
                app.multiview_mode=true;
                app.calibrated_multiview=
                    manifest.mode==animocap::CaptureMode::SynchronizedMultiview;
                app.auto_person_frame=true; app.manual_person_frame=false;
                app.has_person_frame=false;
                EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
                EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
                SetWindowTextW(GetDlgItem(app.window,kMultiview),L"多视角已导入");
                set_status(app.calibrated_multiview
                    ? L"同步标定多机已导入 · 将逐机提取关键点并执行透视三角化"
                    : L"方向重复多视角已导入 · "+
                      manifest_view_summary(labels,manifest.views.size()));
                InvalidateRect(app.window,nullptr,TRUE);
                return true;
            }
        } catch(const std::exception& error) {
            MessageBoxW(app.window,widen(error.what()).c_str(),
                L"同步多机导入失败",MB_ICONWARNING);
            return false;
        }
    }
    const std::array<std::wstring,6> extensions{
        L".mp4",L".mov",L".avi",L".mkv",L".webm",L".m4v"};
    std::vector<std::filesystem::path> candidates;
    for(const auto& entry:std::filesystem::directory_iterator(folder)) {
        if(!entry.is_regular_file())continue;
        std::wstring extension=entry.path().extension().wstring();
        std::transform(extension.begin(),extension.end(),extension.begin(),
            [](wchar_t value){return static_cast<wchar_t>(std::towlower(value));});
        if(std::find(extensions.begin(),extensions.end(),extension)!=extensions.end())
            candidates.push_back(entry.path());
    }
    const auto selection=select_direct_multiview(candidates,false);
    if(!selection) {
        MessageBoxW(app.window,
            L"未找到可识别的三视角 fan（front_left / front / front_right）或传统四视角（front / right / back / left）。\n"
            L"任意角度或 2–8 视角请使用带明确 yaw_degrees 的 capture.json。",
            L"多视角导入失败",MB_ICONWARNING);
        return false;
    }
    if(!open_multiview_previews(selection->videos,selection->labels))return false;
    apply_multiview_selection(*selection);
    app.multiview_manifest.clear();
    app.multiview_mode=true;
    app.calibrated_multiview=false;
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    SetWindowTextW(GetDlgItem(app.window,kMultiview),L"多视角已导入");
    set_status(L"原始视频已导入 · "+direct_view_summary(*selection));
    InvalidateRect(app.window,nullptr,TRUE);
    return true;
}
bool load_multiview_videos(const std::vector<std::filesystem::path>& selected) {
    if(selected.size()!=3&&selected.size()!=4) {
        MessageBoxW(app.window,L"请一次选择 3 个 fan 视频或 4 个传统方向视频。\n"
            L"推荐 front_left、front、front_right；任意角度请使用 capture.json。",
            L"多视角导入失败",MB_ICONWARNING);
        return false;
    }
    if(!confirm_replace_dirty_motion())return false;
    const auto selection=select_direct_multiview(selected,true);
    if(!selection) {
        MessageBoxW(app.window,
            L"请选择完整的三视角 fan（front_left / front / front_right）或传统四视角（front / right / back / left）。\n"
            L"front_left 与 front_right 是独立标签；任意角度请改用带 yaw_degrees 的 capture.json。",
            L"多视角导入失败",MB_ICONWARNING);
        return false;
    }
    if(!open_multiview_previews(selection->videos,selection->labels))return false;
    apply_multiview_selection(*selection);
    app.multiview_manifest.clear();
    app.multiview_mode=true;
    app.calibrated_multiview=false;
    app.auto_person_frame=true;
    app.manual_person_frame=false;
    app.has_person_frame=false;
    EnableWindow(GetDlgItem(app.window,kPersonFrame),FALSE);
    EnableWindow(GetDlgItem(app.window,kResetFrame),FALSE);
    SetWindowTextW(GetDlgItem(app.window,kMultiview),L"多视角已导入");
    set_status(L"原始视频已导入 · "+direct_view_summary(*selection));
    InvalidateRect(app.window,nullptr,TRUE);
    return true;
}
void import_multiview() {
    const COMDLG_FILTERSPEC filters[] = {
        {L"动画优先多视角视频（请选择 3 或 4 个）",L"*.mp4;*.mov;*.avi;*.mkv;*.webm;*.m4v"},
        {L"同步采集清单",L"capture.json"}
    };
    auto selected=choose_multiple(
        L"选择推荐 fan：front_left -45° / front 0° / front_right +45°；\n"
        L"也支持传统四方向，或使用带明确 yaw_degrees 的 2–8 视角 capture.json",
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
std::optional<std::string> log_string(const std::string& line,const char* key) {
    const auto marker=std::string("\"")+key+"\"";
    const auto position=line.find(marker);
    if(position==std::string::npos)return {};
    const auto colon=line.find(':',position+marker.size());
    if(colon==std::string::npos)return {};
    const auto quote=line.find('"',colon+1);
    if(quote==std::string::npos)return {};
    std::string value;
    for(std::size_t cursor=quote+1;cursor<line.size();++cursor) {
        if(line[cursor]=='"')return value;
        if(line[cursor]=='\\'&&cursor+1<line.size())++cursor;
        value.push_back(line[cursor]);
    }
    return {};
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
    std::string event,view,stage;
    std::size_t item{}, total{};
    std::size_t view_index{},view_total{};
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
        if(*event=="view_started") {
            state.view=log_string(line,"view").value_or("");
            state.stage="pose_2d_25d";
            state.view_index=log_integer(line,"index").value_or(0U);
            state.view_total=log_integer(line,"total").value_or(0U);
            state.item=0;state.total=0;
        } else if(*event=="progress") {
            if(const auto value=log_integer(line,"frame"))state.item=*value;
            if(const auto value=log_integer(line,"item"))state.item=*value;
            if(const auto value=log_integer(line,"total"))state.total=*value;
        } else if(*event=="stage_started"||*event=="stage_output"||
                  *event=="stage_finished") {
            if(const auto value=log_string(line,"view"))state.view=*value;
            if(const auto value=log_string(line,"stage"))state.stage=*value;
        } else if(*event=="view_finished") {
            if(const auto value=log_string(line,"view"))state.view=*value;
        } else if(*event=="complete") {
            state.view="all";state.stage="complete";
        }
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
    if(app.multiview_mode) {
        std::size_t view_count=0,view_position=0;
        std::wstring view_label=widen(mmpose.view);
        for(std::size_t index=0;index<app.multiview_videos.size();++index) {
            if(app.multiview_videos[index].empty())continue;
            ++view_count;
            if(app.multiview_view_ids[index]==mmpose.view) {
                view_position=view_count;
                if(!app.multiview_view_labels[index].empty())
                    view_label=app.multiview_view_labels[index];
            }
        }
        if(!view_count)view_count=mmpose.view_total;
        if(!view_position)view_position=mmpose.view_index;

        double fraction=.01;
        std::wstring stage=L"\u6b63\u5728\u52a0\u8f7d\u5171\u4eab GPU \u6a21\u578b";
        bool show_frames=false;
        if(mmpose.stage=="pose_2d_25d"||mmpose.event=="progress") {
            const double current=stage_ratio(mmpose.item,mmpose.total);
            const double completed=view_position>0?static_cast<double>(view_position-1):0.0;
            fraction=.02+.78*std::clamp(
                (completed+current)/std::max<std::size_t>(1,view_count),0.0,1.0);
            stage=L"\u9010\u89c6\u89d2\u63d0\u53d6\u5173\u8282";
            show_frames=mmpose.total>0;
        } else if(mmpose.stage=="local_visual_recovery") {
            const bool finished=mmpose.event=="stage_finished"||
                mmpose.event=="view_finished";
            const double completed=view_position>0?
                static_cast<double>(view_position-1)+(finished?1.0:0.08):0.0;
            fraction=.80+.14*std::clamp(
                completed/std::max<std::size_t>(1,view_count),0.0,1.0);
            stage=L"\u9010\u89c6\u89d2\u672c\u5730\u89c6\u89c9\u7ea0\u9519";
        } else if(mmpose.stage=="phase_align_and_joint_solve") {
            fraction=.96;stage=L"\u76f8\u4f4d\u5bf9\u9f50\u4e0e\u591a\u89c6\u89d2\u8054\u5408\u6c42\u89e3";
        } else if(mmpose.stage=="calibrated_triangulation") {
            fraction=.96;stage=L"\u6807\u5b9a\u900f\u89c6\u4e09\u89d2\u5316";
        } else if(mmpose.stage=="kinematic_reconstruction") {
            fraction=.985;stage=L"\u8fd0\u52a8\u5b66\u91cd\u5efa";
        } else if(mmpose.event=="complete") {
            fraction=.995;stage=L"\u6b63\u5728\u6574\u7406\u591a\u89c6\u89d2\u7ed3\u679c";
        } else if(mmpose.event=="error") {
            fraction=.02;stage=L"\u6b63\u5728\u6574\u7406\u5931\u8d25\u4fe1\u606f";
        }

        const int percent=static_cast<int>(std::lround(
            std::clamp(fraction,0.0,1.0)*100.0));
        SendMessageW(app.progress,PBM_SETPOS,percent,0);
        const double elapsed=std::chrono::duration<double>(
            std::chrono::steady_clock::now()-app.analysis_started).count();
        std::wstring message=L"\u591a\u89c6\u89d2 Mocap \u00b7 "+stage;
        if(view_position&&view_count&&mmpose.view!="all") {
            message+=L" \u00b7 "+view_label+L" \u00b7 \u89c6\u89d2 "+
                std::to_wstring(view_position)+L"/"+std::to_wstring(view_count);
        }
        if(show_frames)
            message+=L" \u00b7 \u5e27 "+std::to_wstring(mmpose.item)+L"/"+
                std::to_wstring(mmpose.total);
        message+=L" \u00b7 "+std::to_wstring(percent)+L"% \u00b7 \u5df2\u7528 "+
            format_elapsed(elapsed);
        if(fraction>.04&&fraction<.94) {
            const double remaining=elapsed*(1.0/fraction-1.0);
            message+=L" \u00b7 \u9884\u8ba1\u5269\u4f59 "+format_elapsed(remaining);
        } else if(fraction<.94) {
            message+=L" \u00b7 \u6b63\u5728\u4f30\u7b97\u5269\u4f59\u65f6\u95f4";
        }
        set_status(message);
        return;
    }
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
    EnableWindow(GetDlgItem(app.window,kAppearanceReference),FALSE);
    EnableWindow(GetDlgItem(app.window,kAppearanceToggle),FALSE);
    EnableWindow(GetDlgItem(app.window,kExportBvh),FALSE);
    EnableWindow(GetDlgItem(app.window,kExportVrma),FALSE);
    EnableWindow(GetDlgItem(app.window,kSelectExportFrames),FALSE);
    EnableWindow(GetDlgItem(app.window,kSelectAuthoredExportFrames),FALSE);
    EnableWindow(GetDlgItem(app.window,kClearExportFrames),FALSE);
    EnableWindow(GetDlgItem(app.window,kExportBlenderSelected),FALSE);
    EnableWindow(GetDlgItem(app.window,kSaveMotion),FALSE);
    SendMessageW(app.progress,PBM_SETMARQUEE,FALSE,0);
    SendMessageW(app.progress,PBM_SETRANGE32,0,100);
    SendMessageW(app.progress,PBM_SETPOS,0,0);
    ShowWindow(app.progress,SW_SHOW);
    SetTimer(app.window,kTimerAnalysisProgress,250,nullptr);
    if (app.multiview_mode) {
        set_status(app.calibrated_multiview
            ? L"同步多机捕捉 · 正在逐机提取关节，随后执行标定透视三角化…"
            : L"方向重复多视角捕捉 · 正在逐视角提取关节，随后自动相位对齐并联合求解…");
    } else {
        if (app.manual_person_frame && app.has_person_frame) {
        set_status(L"正在使用手动框 → Maxine VSR 2× → 姿态捕捉 · x="+
            std::to_wstring(app.person_frame.left)+L" y="+
            std::to_wstring(app.person_frame.top)+L" w="+
            std::to_wstring(app.person_frame.right-app.person_frame.left)+L" h="+
            std::to_wstring(app.person_frame.bottom-app.person_frame.top));
    } else {
        set_status(app.vlm_enabled
                ? (app.appearance_assist_enabled&&!app.appearance_reference_path.empty()
                    ? L"正在自动框人 → Maxine VSR 2× → 姿态与视觉纠错（含外观参考）…"
                    : L"正在自动框人 → Maxine VSR 2× → 姿态与视觉纠错…")
                : L"正在自动框人 → Maxine VSR 2× → 姿态捕捉…");
    }
    }
    const bool has_person_frame=app.manual_person_frame && app.has_person_frame;
    const RECT person_frame=app.person_frame;
    const bool use_vlm=app.vlm_enabled;
    const bool multiview_mode=app.multiview_mode;
    const bool calibrated_multiview=app.calibrated_multiview;
    const auto multiview_manifest=app.multiview_manifest;
    const auto multiview_videos=app.multiview_videos;
    const auto multiview_view_ids=app.multiview_view_ids;
    const auto multiview_view_yaws=app.multiview_view_yaws;
    const auto character_profile=app.character_profile;
    const auto appearance_reference=app.appearance_reference_path;
    const bool appearance_assist=app.appearance_assist_enabled;
    const auto expert_interval=app.expert_interval;
    EnableWindow(GetDlgItem(app.window,kExpertInterval),FALSE);
    const double capture_fps=app.decoder ? app.decoder->info().fps : 30.0;
    HWND window=app.window;
    app.worker=std::jthread([video,root,output,mmpose_log,vlm_log,window,has_person_frame,
                             person_frame,use_vlm,multiview_mode,
                             calibrated_multiview,multiview_manifest,
                             multiview_videos,multiview_view_ids,
                             multiview_view_yaws,capture_fps,
                             character_profile,appearance_reference,
                             appearance_assist,expert_interval](std::stop_token stop) {
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
                    for(std::size_t index=0;index<multiview_videos.size();++index) {
                        if(multiview_videos[index].empty())continue;
                        const auto id=multiview_view_ids[index].empty()
                            ? "view_"+std::to_string(index+1)
                            : multiview_view_ids[index];
                        manifest.views.push_back({
                            id,multiview_videos[index].generic_string(),
                            multiview_view_yaws[index]});
                    }
                    manifest_path=output/"capture.multiview.json";
                    animocap::save_capture_manifest(manifest,manifest_path);
                }
                auto pipeline=root/"python/animocap_ml_adapters/multiview_pipeline.py";
                std::wstring command=quote(python)+L" "+quote(pipeline)+
                    L" --manifest "+quote(manifest_path)+L" --output "+quote(output)+
                    L" --quality maximum --segmentation auto --npu-mode shadow"
                    L" --upscale maxine-vsr --upscale-scale 2";
                command+=L" --expert-interval "+expert_interval;
                if(!use_vlm)command+=L" --no-vlm";
                if(use_vlm&&appearance_assist&&!appearance_reference.empty())
                    command+=L" --reference-image "+quote(appearance_reference);
                const auto pipeline_exit=run_hidden(command,root,mmpose_log,stop);
                if(pipeline_exit==static_cast<int>(ERROR_CANCELLED))throw AnalysisCancelled{};
                if(pipeline_exit!=0) {
                    auto message=std::string(
                        "multiview pipeline failed with exit code ")+
                        std::to_string(pipeline_exit)+
                        "; intermediate per-view poses were preserved. See "+
                        mmpose_log.string()+".";
                    const auto details=read_log_tail(mmpose_log);
                    if(!details.empty())message+="\n"+details;
                    throw std::runtime_error(message);
                }
                const auto pipeline_log_tail=read_log_tail(mmpose_log);
                result->npu_shadow_active=
                    pipeline_log_tail.find("npu_shadow_diagnostics")!=std::string::npos&&
                    pipeline_log_tail.find("\"status\": \"active\"")!=std::string::npos;
                throw_if_cancelled();
                result->pose_baseline=animocap::load_pose_sequence_json(
                    output/"fused_pose_sequence.json");
                const auto comparison_path=output/"comparison_pose_sequence.json";
                if(std::filesystem::exists(comparison_path))
                    result->comparison_pose=animocap::load_pose_sequence_json(
                        comparison_path);
                if(character_profile) {
                    auto refinement=animocap::optimize_pose_sequence_detailed(
                        *result->pose_baseline,optimization_options,profile,
                        proportion_policy);
                    refinement.diagnostics.profile_id=character_profile->profile_id;
                    result->pose=std::move(refinement.sequence);
                    result->optimization_diagnostics=std::move(refinement.diagnostics);
                } else {
                    // The CLI already stabilized, optimized, and reference-plane
                    // pinned this fused sequence. A second generic pass here moves
                    // 3D joints away from the accurate front-view observations.
                    result->pose=*result->pose_baseline;
                }
                result->motion_path=output/"motion.amotion";
                auto generated_motion=animocap::load_motion_package(result->motion_path);
                if(profile) {
                    result->motion=animocap::reconstruct_canonical_motion(
                        *result->pose,profile);
                    result->motion->cameras=std::move(generated_motion.cameras);
                    // The pipeline has already persisted the immutable raw package.
                    // Keep the profile-refined variant in memory and let Save Motion
                    // create an explicit corrected copy instead of overwriting raw.
                    result->motion_dirty=true;
                } else result->motion=std::move(generated_motion);
                if(!calibrated_multiview)
                    result->diagnostics=animocap::load_multiview_diagnostics(
                        output/"multiview-diagnostics.json");
                for(std::size_t index=0;index<multiview_videos.size();++index) {
                    if(multiview_videos[index].empty())continue;
                    const auto id=multiview_view_ids[index].empty()
                        ?"view_"+std::to_string(index+1)
                        :multiview_view_ids[index];
                    const auto view_output=output/"poses"/id;
                    const auto pose_path=view_output/"pose_sequence.json";
                    if(std::filesystem::exists(pose_path))
                        result->per_view_poses[index]=
                            animocap::load_pose_sequence_json(pose_path);
                    const auto npu_path=view_output/"npu-shadow-diagnostics.json";
                    if(std::filesystem::exists(npu_path)) {
                        try {
                            std::ifstream input(npu_path,std::ios::binary);
                            nlohmann::json value; input>>value;
                            result->npu_sampled_frames+=value.value(
                                "sampled_frames",std::size_t{});
                            result->npu_total_frames+=value.value(
                                "total_frames",result->per_view_poses[index]
                                    ?result->per_view_poses[index]->frames.size()
                                    :std::size_t{});
                            if(value.contains("gpu_reprocess")&&
                               value["gpu_reprocess"].is_object()) {
                                const auto& reprocess=value["gpu_reprocess"];
                                result->npu_reprocess_requested+=reprocess.value(
                                    "requested_frames",std::size_t{});
                                result->npu_reprocess_processed+=reprocess.value(
                                    "processed_frames",std::size_t{});
                                result->npu_reprocess_accepted+=reprocess.value(
                                    "accepted_joint_corrections",std::size_t{});
                                if(reprocess.value("status",std::string{})==
                                   "unavailable")
                                    ++result->npu_reprocess_unavailable_views;
                            }
                            if(value.contains("review_frames")&&
                               value["review_frames"].is_array()) {
                                for(const auto& review:value["review_frames"]) {
                                    NpuReviewIssue issue;
                                    issue.view_index=index;
                                    issue.frame_index=review.value("frame_index",std::size_t{});
                                    issue.source_time_s=review.value("time_s",0.0);
                                    issue.invalid_joints=review.value("invalid_joints",std::size_t{});
                                    issue.left_right_swaps=review.value("left_right_swaps",std::size_t{});
                                    if(review.contains("mean_normalized_error")&&
                                       review["mean_normalized_error"].is_number())
                                        issue.mean_normalized_error=
                                            review["mean_normalized_error"].get<double>();
                                    std::vector<std::wstring> reasons;
                                    if(review.contains("reasons")&&review["reasons"].is_array())
                                        for(const auto& reason:review["reasons"]) {
                                            const auto code=reason.get<std::string>();
                                            if(code=="left_right_swap")reasons.push_back(L"左右交换");
                                            else if(code=="missing_joints")reasons.push_back(L"关节缺失");
                                            else if(code=="gpu_npu_disagreement")reasons.push_back(L"双设备分歧");
                                        }
                                    for(std::size_t reason=0;reason<reasons.size();++reason) {
                                        if(reason)issue.detail+=L" · ";
                                        issue.detail+=reasons[reason];
                                    }
                                    result->npu_review_issues.push_back(std::move(issue));
                                }
                            }
                        } catch(...) {
                            // NPU shadow diagnostics never decide capture success.
                        }
                    }
                }
                result->npu_shadow_active=result->npu_sampled_frames>0;
            } else {
                auto adapter=root/"python/animocap_ml_adapters/mmpose_adapter.py";
                auto observations=output/"pose_sequence.json";
            std::wstring command=quote(python)+L" "+quote(adapter)+
                L" --input "+quote(video)+L" --output "+quote(observations)+
                L" --quality maximum --segmentation auto --npu-mode shadow"
                L" --upscale maxine-vsr --upscale-scale 2";
            command+=L" --expert-interval "+expert_interval;
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
                if(appearance_assist&&!appearance_reference.empty())
                    vlm_command+=L" --reference-image "+quote(appearance_reference);
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
            result->npu_shadow_active=result->pose_baseline->backend.find(
                "openvino-npu-shadow")!=std::string::npos;
            const auto npu_path=output/"npu-shadow-diagnostics.json";
            if(std::filesystem::exists(npu_path)) {
                try {
                    std::ifstream input(npu_path,std::ios::binary);
                    nlohmann::json value; input>>value;
                    result->npu_sampled_frames=value.value(
                        "sampled_frames",std::size_t{});
                    result->npu_total_frames=value.value(
                        "total_frames",result->pose_baseline->frames.size());
                    result->npu_shadow_active=result->npu_sampled_frames>0;
                } catch(...) {
                    // Capture output remains authoritative if shadow telemetry fails.
                }
            }
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
            const auto failure=widen(error.what());
            if(multiview_mode) {
                const auto generated_path=output/"motion.amotion";
                try {
                    result->motion=animocap::load_motion_package(generated_path);
                    result->motion_path=generated_path;
                    result->motion_dirty=false;
                    result->recovered_motion=true;
                    result->warning=
                        L"\u6838\u5fc3\u52a8\u4f5c\u5df2\u6062\u590d\uff1b\u540e\u5904\u7406\u672a\u5b8c\u6210\u3002\u539f\u59cb\u5305\u53ef\u5bfc\u51fa\u6216\u53e6\u5b58\u3002\n"+
                        generated_path.wstring()+L"\n\n"+failure;
                } catch(const std::exception& recovery_error) {
                    result->error=failure+L"\n\nMotion recovery failed: "+
                        widen(recovery_error.what());
                }
            } else result->error=failure;
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
    const auto source = choose_motion_open_source();
    if(source==MotionOpenSource::Cancelled)return;
    std::optional<std::filesystem::path> path;
    if(source==MotionOpenSource::AniMocapPackage) {
        path=choose(true,L"\u9009\u62e9 motion.amotion \u6587\u4ef6\u5939");
    } else {
        const COMDLG_FILTERSPEC filters[] = {
            {L"BVH / VRMA \u52a8\u4f5c",L"*.bvh;*.vrma"},
            {L"Biovision Hierarchy",L"*.bvh"},
            {L"VRM Animation",L"*.vrma"},
        };
        path=choose(false,L"\u9009\u62e9 BVH \u6216 VRMA \u52a8\u4f5c\u6587\u4ef6",filters,
                    static_cast<UINT>(std::size(filters)));
    }
    if (!path) return;
    try {
        std::wstring format=L"AniMocap";
        if(source==MotionOpenSource::AniMocapPackage) {
            app.motion=animocap::load_motion_package(*path);
        } else {
            auto extension=path->extension().wstring();
            std::transform(extension.begin(),extension.end(),extension.begin(),
                [](wchar_t value){return static_cast<wchar_t>(std::towlower(value));});
            if(extension==L".bvh") {
                app.motion=animocap::import_bvh(*path);
                format=L"BVH";
            } else if(extension==L".vrma") {
                app.motion=animocap::import_vrma(*path);
                format=L"VRMA";
            } else {
                throw animocap::ContractError("motion file must use the .bvh or .vrma extension");
            }
        }
        app.pose.reset();
        app.pose_baseline.reset();
        app.comparison_pose.reset();
        app.profile_refined_pose.reset();
        app.multiview_diagnostics.reset();
        app.multiview_mode=false;
        app.multiview_overview=false;
        app.multiview_poses={};
        app.npu_review_issues.clear();
        SetWindowTextW(GetDlgItem(app.window,kResetFrame),L"重置");
        app.anchor_drag_snapshot.reset();
        app.manual_corrections.clear();
        app.review={}; app.review_inferred.clear(); app.review_base.reset(); app.review_compare=false;
        app.correction_undo.clear(); app.correction_redo.clear();
        app.selected_keyframes.clear(); app.smoothed_keyframes.clear();
        app.selected_export_frames.clear(); app.selecting_export_frames=false;
        app.active_curve_correction=-1;
        update_correction_controls();
        app.motion_path = *path;
        app.time_s = app.motion->motion.time_s.front();
        reset_range_selection();
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        app.motion_dirty=false;
        update_timeline();
        set_status(format+L" \u52a8\u4f5c\u5df2\u52a0\u8f7d \u00b7 "+
                   std::to_wstring(app.motion->motion.frame_count)+L" \u5e27");
        InvalidateRect(app.window, nullptr, TRUE);
    } catch (const std::exception& error) {
        MessageBoxW(app.window, widen(error.what()).c_str(), L"\u52a8\u4f5c\u6253\u5f00\u5931\u8d25", MB_ICONERROR);
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
void export_blender_selected_file() {
    if(!app.motion) {
        MessageBoxW(app.window,L"请先完成捕捉或打开一个动作包。",
                    L"无法导入到 Blender",MB_ICONINFORMATION);
        return;
    }
    app.selected_export_frames.prune(app.motion->motion.frame_count);
    if(app.selected_export_frames.empty()) {
        MessageBoxW(app.window,
            L"默认不会导入全部帧。请先点击“选择导入帧”，再在时间线上选择至少一帧。",
            L"尚未选择 Blender 导入帧",MB_ICONINFORMATION);
        update_blender_selection_controls();
        return;
    }
    const auto summary=blender_selection_summary();
    if(MessageBoxW(app.window,(summary+L"\n\n将生成选中帧文件；Blender 会创建新 Action，不覆盖原 Action。")
            .c_str(),L"确认导入选中帧到 Blender",MB_OKCANCEL|MB_ICONINFORMATION)!=IDOK)
        return;
    const auto output=choose_export_output(
        L"导入选中帧到 Blender",L"AniMocap Blender selected frames",
        L"*.animocap-blender.json",L"animocap-blender.json",
        L"selected.animocap-blender.json");
    if(!output)return;
    try {
        animocap::export_blender_selected_frames(
            *app.motion,app.selected_export_frames.frames(),*output,{true});
        set_status(summary+L" · 已生成 "+output->wstring()+
                   L" · 在 Blender 的 AniMocap 面板创建新 Action");
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),
                    L"Blender 选中帧导出失败",MB_ICONERROR);
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
        if(app.pose) {
            const auto& base=app.review_base?*app.review_base:*app.pose;
            auto review_path=output; review_path+=L".areview";
            animocap::save_pose_review(base,app.review,review_path);
        }
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
const animocap::PoseSequence* review_overlay_pose() {
    if(has_multiview_review())
        return &*app.multiview_poses[app.multiview_review_view];
    return app.pose?&*app.pose:nullptr;
}
std::size_t review_overlay_frame(const animocap::PoseSequence& sequence) {
    if(sequence.frames.empty())return 0;
    const double target=has_multiview_review()?review_source_time(app.time_s):app.time_s;
    auto found=std::lower_bound(sequence.frames.begin(),sequence.frames.end(),target,
        [](const animocap::ObservedPoseFrame& frame,double time) {
            return frame.time_s<time;
        });
    if(found==sequence.frames.end())return sequence.frames.size()-1;
    if(found==sequence.frames.begin())return 0;
    const auto after=static_cast<std::size_t>(found-sequence.frames.begin());
    const auto before=after-1;
    return std::abs(sequence.frames[before].time_s-target)<
        std::abs(sequence.frames[after].time_s-target)?before:after;
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
std::optional<std::size_t> motion_frame_from_time(double time_s) {
    if(!app.motion||app.motion->motion.time_s.empty())return {};
    const auto& times=app.motion->motion.time_s;
    const auto after=std::lower_bound(times.begin(),times.end(),time_s);
    if(after==times.begin())return std::size_t{0};
    if(after==times.end())return times.size()-1;
    const auto after_index=static_cast<std::size_t>(after-times.begin());
    const auto before_index=after_index-1;
    return time_s-times[before_index]<=times[after_index]-time_s
        ?before_index:after_index;
}
std::wstring blender_selection_summary(std::size_t limit) {
    if(!app.motion||app.selected_export_frames.empty())
        return L"将导入 0 帧（默认不导入全部帧）";
    const auto& frames=app.selected_export_frames.frames();
    std::wstring result=L"将导入 "+std::to_wstring(frames.size())+L" 帧：";
    for(std::size_t index=0;index<std::min(limit,frames.size());++index) {
        if(index>0)result+=L"、";
        const auto frame=frames[index];
        result+=std::to_wstring(frame)+L"（"+
            timecode(app.motion->motion.time_s[frame])+L"）";
    }
    if(frames.size()>limit)result+=L"…";
    return result;
}
void update_blender_selection_controls() {
    const bool has_motion=app.motion&&app.motion->motion.frame_count>0;
    if(has_motion)app.selected_export_frames.prune(app.motion->motion.frame_count);
    else app.selected_export_frames.clear();
    EnableWindow(GetDlgItem(app.window,kSelectExportFrames),has_motion);
    EnableWindow(GetDlgItem(app.window,kSelectAuthoredExportFrames),
                 has_motion&&!authored_keyframe_frames().empty());
    EnableWindow(GetDlgItem(app.window,kClearExportFrames),
                 has_motion&&!app.selected_export_frames.empty());
    EnableWindow(GetDlgItem(app.window,kExportBlenderSelected),
                 has_motion&&!app.selected_export_frames.empty());
    SetWindowTextW(GetDlgItem(app.window,kSelectExportFrames),
        app.selecting_export_frames?L"完成选择导入帧":L"选择导入帧");
}
void toggle_export_frame_selection_mode() {
    if(!app.motion)return;
    app.selecting_export_frames=!app.selecting_export_frames;
    stop_playback();
    update_blender_selection_controls();
    set_status(app.selecting_export_frames
        ?L"选择 Blender 导入帧 · 单击选择，Ctrl+单击多选，Shift+单击选择区间"
        :blender_selection_summary());
    InvalidateRect(app.window,nullptr,FALSE);
}
void select_authored_frames_for_blender() {
    if(!app.motion)return;
    const auto authored=authored_keyframe_frames();
    if(authored.empty()) {
        set_status(L"当前没有已创建关键帧；未改为导入全部帧");
        return;
    }
    try {
        app.selected_export_frames.select_only(authored,app.motion->motion.frame_count);
        set_status(blender_selection_summary());
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"选择导入帧失败",MB_ICONERROR);
    }
    update_blender_selection_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void clear_blender_frame_selection() {
    app.selected_export_frames.clear();
    set_status(L"已清除 Blender 导入帧 · 默认不会导入全部帧");
    update_blender_selection_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void select_blender_frame_at_time(double time_s,bool control,bool shift) {
    if(!app.motion)return;
    const auto frame=motion_frame_from_time(time_s);
    if(!frame)return;
    try {
        app.selected_export_frames.select(
            *frame,app.motion->motion.frame_count,control,shift);
        app.time_s=app.motion->motion.time_s[*frame];
        update_timeline();
        set_status(blender_selection_summary());
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"选择导入帧失败",MB_ICONERROR);
    }
    update_blender_selection_controls();
    InvalidateRect(app.window,nullptr,FALSE);
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
std::array<RECT,kMaximumMultiviewViews> multiview_preview_cells(RECT area) {
    const RECT inner=inset(area,8);
    constexpr int gap=8;
    constexpr int columns=4;
    constexpr int rows=2;
    const int cell_width=(inner.right-inner.left-gap*(columns-1))/columns;
    const int cell_height=(inner.bottom-inner.top-gap*(rows-1))/rows;
    std::array<RECT,kMaximumMultiviewViews> cells{};
    for(std::size_t index=0;index<cells.size();++index) {
        const int column=static_cast<int>(index)%columns;
        const int row=static_cast<int>(index)/columns;
        const int left=inner.left+column*(cell_width+gap);
        const int top=inner.top+row*(cell_height+gap);
        cells[index]={left,top,left+cell_width,top+cell_height};
    }
    return cells;
}
void draw_multiview_preview(HDC dc,RECT area) {
    panel_box(dc,area,RGB(7,12,18),theme::border,8);
    const auto cells=multiview_preview_cells(area);
    const std::array<std::wstring,kMaximumMultiviewViews> fallback_labels{
        L"view 1",L"view 2",L"view 3",L"view 4",
        L"view 5",L"view 6",L"view 7",L"view 8"};
    const std::array<COLORREF,kMaximumMultiviewViews> accents{
        theme::accent,theme::violet,theme::amber,theme::green,
        theme::accent,theme::violet,theme::amber,theme::green};
    for(std::size_t index=0;index<cells.size();++index) {
        const RECT cell=cells[index];
        panel_box(dc,cell,RGB(10,16,23),theme::border_soft,6);
        RECT header{cell.left+1,cell.top+1,cell.right-1,cell.top+31};
        fill(dc,header,theme::surface_raised);
        fill(dc,{header.left,header.top,header.left+4,header.bottom},accents[index]);
        std::wstring title=app.multiview_view_labels[index].empty()
            ? fallback_labels[index] : app.multiview_view_labels[index];
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
        if(app.multiview_overview&&!app.multiview_videos[index].empty())
            text(dc,L"点击进入同步检查",{preview.left+5,preview.bottom-28,
                preview.right-5,preview.bottom-5},theme::text,app.small_font,
                DT_CENTER|DT_VCENTER|DT_SINGLELINE);
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
    // A transient resize/DPI layout can produce a drawing band shorter than a
    // label. Keep std::clamp's interval valid; clipping handles the overflow.
    const int maximum_top=std::max(top,bottom-label_height);
    const int x=left_column?static_cast<int>(bounds.left)+6:
        static_cast<int>(bounds.right)-6-label_width;
    std::vector<int> positions(indices.size());
    for(std::size_t rank=0;rank<indices.size();++rank) {
        const int desired=std::clamp(
            static_cast<int>(labels[indices[rank]].joint.y)-label_height/2,
            top,maximum_top);
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
    const auto* overlay=review_overlay_pose();
    if (!overlay || overlay->frames.empty() || app.scrubbing) {
        rounded_outline(dc,area,theme::border,8);
        return;
    }
    int saved_dc=SaveDC(dc);
    IntersectClipRect(dc,destination.left,destination.top,destination.right,destination.bottom);
    const auto& frame = overlay->frames[review_overlay_frame(*overlay)];
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
struct MotionProjection {
    double cos_yaw{},sin_yaw{},cos_pitch{},sin_pitch{};
    double scale{1.0},origin_x{},origin_y{},floor_y{};
    animocap::Vec2 raw(const animocap::Vec3& value) const {
        const double x=cos_yaw*value.x+sin_yaw*value.z;
        const double z=-sin_yaw*value.x+cos_yaw*value.z;
        return {x,cos_pitch*value.y-sin_pitch*z};
    }
    animocap::Vec2 operator()(const animocap::Vec3& value) const {
        const auto transformed=raw(value);
        return {origin_x+transformed.x*scale,origin_y-transformed.y*scale};
    }
    double depth(const animocap::Vec3& value) const {
        const double z=-sin_yaw*value.x+cos_yaw*value.z;
        return sin_pitch*value.y+cos_pitch*z;
    }
};
MotionProjection make_motion_projection(
    RECT viewport,const std::vector<animocap::Vec3>& positions,
    const std::vector<animocap::Vec3>& comparison_positions
) {
    MotionProjection result{};
    const double yaw=app.yaw*kPi/180.0, pitch=app.pitch*kPi/180.0;
    result.cos_yaw=std::cos(yaw); result.sin_yaw=std::sin(yaw);
    result.cos_pitch=std::cos(pitch); result.sin_pitch=std::sin(pitch);
    double min_x=std::numeric_limits<double>::infinity();
    double max_x=-std::numeric_limits<double>::infinity();
    double min_y=std::numeric_limits<double>::infinity();
    double max_y=-std::numeric_limits<double>::infinity();
    const auto include=[&](const std::vector<animocap::Vec3>& values) {
        for(const auto& value:values) {
            const auto projected=result.raw(value);
            min_x=std::min(min_x,projected.x); max_x=std::max(max_x,projected.x);
            min_y=std::min(min_y,projected.y); max_y=std::max(max_y,projected.y);
        }
    };
    include(positions); include(comparison_positions);
    if(!std::isfinite(min_x)||!std::isfinite(min_y)) {
        min_x=-1.0; max_x=1.0; min_y=0.0; max_y=1.0;
    }
    const double padding=22.0;
    const double width=std::max(0.1,max_x-min_x);
    const double height=std::max(0.1,max_y-min_y);
    const double available_width=std::max(24.0,
        static_cast<double>(viewport.right-viewport.left)-padding*2.0);
    const double available_height=std::max(24.0,
        static_cast<double>(viewport.bottom-viewport.top)-padding*2.0);
    result.scale=std::min(available_width/width,available_height/height);
    result.origin_x=(viewport.left+viewport.right)*.5-
        (min_x+max_x)*.5*result.scale;
    result.floor_y=viewport.bottom-padding;
    result.origin_y=result.floor_y+min_y*result.scale;
    return result;
}
COLORREF motion_bone_color(animocap::BoneSemantic semantic) {
    using S=animocap::BoneSemantic;
    switch(semantic) {
    case S::SceneRoot: case S::Hips: case S::Spine: case S::Chest:
    case S::UpperChest: case S::Neck: case S::Head:
        return theme::accent;
    case S::LeftShoulder: case S::LeftUpperArm: case S::LeftLowerArm:
    case S::LeftHand: case S::LeftUpperLeg: case S::LeftLowerLeg:
    case S::LeftFoot: case S::LeftToes:
        return RGB(153,126,245);
    case S::RightShoulder: case S::RightUpperArm: case S::RightLowerArm:
    case S::RightHand: case S::RightUpperLeg: case S::RightLowerLeg:
    case S::RightFoot: case S::RightToes:
        return RGB(73,190,213);
    }
    return theme::violet;
}
COLORREF mix_color(COLORREF from,COLORREF to,double amount) {
    amount=std::clamp(amount,0.0,1.0);
    const auto channel=[amount](BYTE a,BYTE b) {
        return static_cast<BYTE>(std::lround(
            static_cast<double>(a)+(static_cast<double>(b)-a)*amount));
    };
    return RGB(channel(GetRValue(from),GetRValue(to)),
               channel(GetGValue(from),GetGValue(to)),
               channel(GetBValue(from),GetBValue(to)));
}
COLORREF human_model_fill(animocap::BoneSemantic semantic,float confidence) {
    using S=animocap::BoneSemantic;
    COLORREF base=RGB(116,164,187);
    switch(semantic) {
    case S::LeftShoulder: case S::LeftUpperArm: case S::LeftLowerArm:
    case S::LeftHand: case S::LeftUpperLeg: case S::LeftLowerLeg:
    case S::LeftFoot: case S::LeftToes:
        base=RGB(143,134,219); break;
    case S::RightShoulder: case S::RightUpperArm: case S::RightLowerArm:
    case S::RightHand: case S::RightUpperLeg: case S::RightLowerLeg:
    case S::RightFoot: case S::RightToes:
        base=RGB(82,188,206); break;
    default: break;
    }
    const double visibility=.68+.32*std::clamp(static_cast<double>(confidence),0.0,1.0);
    return mix_color(RGB(20,31,42),base,visibility);
}
void filled_polygon(HDC dc,const POINT* points,int count,COLORREF fill_color,
                    COLORREF outline_color,int outline_width=1) {
    HBRUSH brush=CreateSolidBrush(fill_color);
    HPEN pen=CreatePen(PS_SOLID,outline_width,outline_color);
    auto old_brush=SelectObject(dc,brush);
    auto old_pen=SelectObject(dc,pen);
    Polygon(dc,points,count);
    SelectObject(dc,old_pen); SelectObject(dc,old_brush);
    DeleteObject(pen); DeleteObject(brush);
}
void draw_body_segment(HDC dc,animocap::Vec2 a,animocap::Vec2 b,
                       double start_radius,double end_radius,
                       COLORREF fill_color,COLORREF outline_color) {
    const double dx=b.x-a.x,dy=b.y-a.y;
    const double length=std::hypot(dx,dy);
    if(length<.5)return;
    const double nx=-dy/length,ny=dx/length;
    POINT body[4]{
        {static_cast<LONG>(std::lround(a.x+nx*start_radius)),
         static_cast<LONG>(std::lround(a.y+ny*start_radius))},
        {static_cast<LONG>(std::lround(b.x+nx*end_radius)),
         static_cast<LONG>(std::lround(b.y+ny*end_radius))},
        {static_cast<LONG>(std::lround(b.x-nx*end_radius)),
         static_cast<LONG>(std::lround(b.y-ny*end_radius))},
        {static_cast<LONG>(std::lround(a.x-nx*start_radius)),
         static_cast<LONG>(std::lround(a.y-ny*start_radius))},
    };
    filled_polygon(dc,body,4,fill_color,outline_color);
    HBRUSH brush=CreateSolidBrush(fill_color);
    HPEN pen=CreatePen(PS_SOLID,1,outline_color);
    auto old_brush=SelectObject(dc,brush);
    auto old_pen=SelectObject(dc,pen);
    const auto cap=[&](animocap::Vec2 point,double radius) {
        Ellipse(dc,static_cast<int>(std::lround(point.x-radius)),
                static_cast<int>(std::lround(point.y-radius)),
                static_cast<int>(std::lround(point.x+radius))+1,
                static_cast<int>(std::lround(point.y+radius))+1);
    };
    cap(a,start_radius); cap(b,end_radius);
    SelectObject(dc,old_pen); SelectObject(dc,old_brush);
    DeleteObject(pen); DeleteObject(brush);
}
void draw_motion_human_model(HDC dc,const MotionProjection& projection,
                             const animocap::Skeleton& skeleton,
                             const std::vector<animocap::Vec3>& positions,
                             const std::vector<float>& confidences) {
    using S=animocap::BoneSemantic;
    if(positions.empty())return;
    const auto index=[&](S semantic) { return animocap::bone_index(skeleton,semantic); };
    const auto point=[&](S semantic) { return projection(positions[index(semantic)]); };
    const auto confidence=[&](S semantic) {
        const auto i=index(semantic);
        return i<confidences.size()?confidences[i]:1.0f;
    };
    const auto radius=[&](double meters) {
        return std::clamp(meters*projection.scale,2.5,18.0);
    };
    struct Segment {
        S start{},end{};
        double start_radius_m{},end_radius_m{},depth{};
    };
    std::vector<Segment> segments{
        {S::LeftShoulder,S::LeftUpperArm,.064,.058},
        {S::LeftUpperArm,S::LeftLowerArm,.058,.047},
        {S::LeftLowerArm,S::LeftHand,.047,.034},
        {S::RightShoulder,S::RightUpperArm,.064,.058},
        {S::RightUpperArm,S::RightLowerArm,.058,.047},
        {S::RightLowerArm,S::RightHand,.047,.034},
        {S::LeftUpperLeg,S::LeftLowerLeg,.082,.062},
        {S::LeftLowerLeg,S::LeftFoot,.062,.043},
        {S::LeftFoot,S::LeftToes,.048,.036},
        {S::RightUpperLeg,S::RightLowerLeg,.082,.062},
        {S::RightLowerLeg,S::RightFoot,.062,.043},
        {S::RightFoot,S::RightToes,.048,.036},
        {S::UpperChest,S::Neck,.055,.046},
    };
    for(auto& segment:segments) {
        const auto a=index(segment.start),b=index(segment.end);
        if(a>=positions.size()||b>=positions.size())continue;
        segment.depth=(projection.depth(positions[a])+projection.depth(positions[b]))*.5;
    }
    std::stable_sort(segments.begin(),segments.end(),[](const Segment& a,const Segment& b) {
        return a.depth<b.depth;
    });
    for(const auto& segment:segments) {
        const float segment_confidence=std::min(confidence(segment.start),confidence(segment.end));
        const COLORREF fill_color=human_model_fill(segment.end,segment_confidence);
        draw_body_segment(dc,point(segment.start),point(segment.end),
                          radius(segment.start_radius_m),radius(segment.end_radius_m),
                          fill_color,mix_color(fill_color,RGB(122,203,224),.42));
    }

    const auto left_shoulder=point(S::LeftShoulder);
    const auto right_shoulder=point(S::RightShoulder);
    const auto hips=point(S::Hips);
    const auto left_leg=point(S::LeftUpperLeg);
    const auto right_leg=point(S::RightUpperLeg);
    animocap::Vec2 shoulder_axis{left_shoulder.x-right_shoulder.x,
                                 left_shoulder.y-right_shoulder.y};
    double shoulder_length=std::hypot(shoulder_axis.x,shoulder_axis.y);
    if(shoulder_length<1.0) {
        const auto upper_chest=point(S::UpperChest);
        shoulder_axis={-(upper_chest.y-hips.y),upper_chest.x-hips.x};
        shoulder_length=std::max(1.0,std::hypot(shoulder_axis.x,shoulder_axis.y));
    }
    shoulder_axis.x/=shoulder_length; shoulder_axis.y/=shoulder_length;
    const animocap::Vec2 shoulder_center{
        (left_shoulder.x+right_shoulder.x)*.5,
        (left_shoulder.y+right_shoulder.y)*.5};
    const animocap::Vec2 pelvis_center{
        (left_leg.x+right_leg.x+hips.x)*.333333333,
        (left_leg.y+right_leg.y+hips.y)*.333333333};
    const double shoulder_half=std::max(shoulder_length*.52,radius(.17));
    const double leg_span=std::hypot(left_leg.x-right_leg.x,left_leg.y-right_leg.y);
    const double pelvis_half=std::max(leg_span*.62,radius(.105));
    POINT torso[4]{
        {static_cast<LONG>(std::lround(shoulder_center.x+shoulder_axis.x*shoulder_half)),
         static_cast<LONG>(std::lround(shoulder_center.y+shoulder_axis.y*shoulder_half))},
        {static_cast<LONG>(std::lround(shoulder_center.x-shoulder_axis.x*shoulder_half)),
         static_cast<LONG>(std::lround(shoulder_center.y-shoulder_axis.y*shoulder_half))},
        {static_cast<LONG>(std::lround(pelvis_center.x-shoulder_axis.x*pelvis_half)),
         static_cast<LONG>(std::lround(pelvis_center.y-shoulder_axis.y*pelvis_half))},
        {static_cast<LONG>(std::lround(pelvis_center.x+shoulder_axis.x*pelvis_half)),
         static_cast<LONG>(std::lround(pelvis_center.y+shoulder_axis.y*pelvis_half))},
    };
    const float torso_confidence=std::min({confidence(S::Hips),confidence(S::Chest),
                                           confidence(S::UpperChest)});
    const COLORREF torso_fill=human_model_fill(S::Chest,torso_confidence);
    filled_polygon(dc,torso,4,torso_fill,mix_color(torso_fill,theme::accent,.5));
    stroke(dc,{torso[0].x,torso[0].y},{torso[3].x,torso[3].y},
           mix_color(torso_fill,RGB(145,220,237),.28));

    const auto neck=point(S::Neck),head=point(S::Head);
    double head_dx=head.x-neck.x,head_dy=head.y-neck.y;
    double head_length=std::hypot(head_dx,head_dy);
    if(head_length<1.0) { head_dx=0.0; head_dy=-1.0; head_length=1.0; }
    head_dx/=head_length; head_dy/=head_length;
    const double head_rx=radius(.078),head_ry=radius(.105);
    const animocap::Vec2 head_center{head.x+head_dx*head_ry*.18,
                                     head.y+head_dy*head_ry*.18};
    std::array<POINT,18> head_points{};
    for(std::size_t i=0;i<head_points.size();++i) {
        const double angle=2.0*kPi*static_cast<double>(i)/head_points.size();
        const double along=std::cos(angle)*head_ry;
        const double across=std::sin(angle)*head_rx;
        head_points[i]={
            static_cast<LONG>(std::lround(head_center.x+head_dx*along-head_dy*across)),
            static_cast<LONG>(std::lround(head_center.y+head_dy*along+head_dx*across))};
    }
    const COLORREF head_fill=human_model_fill(S::Head,confidence(S::Head));
    filled_polygon(dc,head_points.data(),static_cast<int>(head_points.size()),
                   head_fill,mix_color(head_fill,theme::accent,.55));

    // The canonical character faces +Z.  In a front view the anatomical left
    // side therefore appears on the viewer's right; explicit face and L/R cues
    // prevent that correct projection from reading as an accidental mirror.
    const double view_facing=std::cos(app.yaw*kPi/180.0);
    const double view_side=std::sin(app.yaw*kPi/180.0);
    const bool viewing_front=view_facing>.22;
    const bool viewing_back=view_facing<-.22;
    const animocap::Vec2 head_across{-head_dy,head_dx};
    const double face_shift=view_side*head_rx*.24;
    if(viewing_front) {
        const animocap::Vec2 eye_center{
            head_center.x+head_dx*head_ry*.18+head_across.x*face_shift,
            head_center.y+head_dy*head_ry*.18+head_across.y*face_shift};
        const double eye_offset=head_rx*.31;
        const int eye_radius=std::max(1,static_cast<int>(std::lround(head_rx*.09)));
        HBRUSH eye_brush=CreateSolidBrush(RGB(166,231,242));
        auto old_brush=SelectObject(dc,eye_brush);
        for(const double side:{-1.0,1.0}) {
            const double x=eye_center.x+head_across.x*eye_offset*side;
            const double y=eye_center.y+head_across.y*eye_offset*side;
            Ellipse(dc,static_cast<int>(std::lround(x))-eye_radius,
                    static_cast<int>(std::lround(y))-eye_radius,
                    static_cast<int>(std::lround(x))+eye_radius+1,
                    static_cast<int>(std::lround(y))+eye_radius+1);
        }
        SelectObject(dc,old_brush); DeleteObject(eye_brush);
        const POINT nose{
            static_cast<LONG>(std::lround(eye_center.x-head_dx*head_ry*.25)),
            static_cast<LONG>(std::lround(eye_center.y-head_dy*head_ry*.25))};
        const POINT nose_tip{
            static_cast<LONG>(std::lround(nose.x+head_across.x*view_side*head_rx*.18)),
            static_cast<LONG>(std::lround(nose.y+head_across.y*view_side*head_rx*.18))};
        stroke(dc,nose,nose_tip,RGB(126,203,220),1);
    } else if(viewing_back) {
        const POINT crown{
            static_cast<LONG>(std::lround(head_center.x+head_dx*head_ry*.55)),
            static_cast<LONG>(std::lround(head_center.y+head_dy*head_ry*.55))};
        const POINT nape{
            static_cast<LONG>(std::lround(head_center.x-head_dx*head_ry*.55)),
            static_cast<LONG>(std::lround(head_center.y-head_dy*head_ry*.55))};
        stroke(dc,crown,nape,mix_color(head_fill,RGB(8,18,27),.55),2);
    }

    const auto chest=point(S::Chest);
    const wchar_t* facing_mark=viewing_front?L"F":viewing_back?L"B":L"S";
    const COLORREF facing_color=viewing_front?theme::accent:
        viewing_back?theme::violet:theme::amber;
    const RECT facing_badge{
        static_cast<LONG>(std::lround(chest.x))-9,
        static_cast<LONG>(std::lround(chest.y))-9,
        static_cast<LONG>(std::lround(chest.x))+10,
        static_cast<LONG>(std::lround(chest.y))+10};
    rounded_box(dc,facing_badge,RGB(13,29,40),facing_color,9);
    text(dc,facing_mark,facing_badge,facing_color,app.small_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE);

    for(const auto [semantic,label,color]:{
            std::tuple{S::LeftShoulder,L"L",RGB(174,149,247)},
            std::tuple{S::RightShoulder,L"R",RGB(91,211,229)}}) {
        const auto shoulder=point(semantic);
        const RECT badge{
            static_cast<LONG>(std::lround(shoulder.x))-8,
            static_cast<LONG>(std::lround(shoulder.y))-8,
            static_cast<LONG>(std::lround(shoulder.x))+9,
            static_cast<LONG>(std::lround(shoulder.y))+9};
        rounded_box(dc,badge,RGB(13,24,34),color,8);
        text(dc,label,badge,color,app.small_font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    }

    for(const auto semantic:{S::LeftHand,S::RightHand}) {
        const auto hand=point(semantic);
        const int hand_radius=static_cast<int>(std::lround(radius(.044)));
        const COLORREF hand_fill=human_model_fill(semantic,confidence(semantic));
        HBRUSH brush=CreateSolidBrush(hand_fill);
        HPEN pen=CreatePen(PS_SOLID,1,mix_color(hand_fill,RGB(155,218,232),.4));
        auto old_brush=SelectObject(dc,brush); auto old_pen=SelectObject(dc,pen);
        Ellipse(dc,static_cast<int>(std::lround(hand.x))-hand_radius,
                static_cast<int>(std::lround(hand.y))-hand_radius,
                static_cast<int>(std::lround(hand.x))+hand_radius+1,
                static_cast<int>(std::lround(hand.y))+hand_radius+1);
        SelectObject(dc,old_pen); SelectObject(dc,old_brush);
        DeleteObject(pen); DeleteObject(brush);
    }

    for(std::size_t i=0;i<positions.size()&&i<confidences.size()&&i<skeleton.bones.size();++i) {
        if(confidences[i]>=.65f)continue;
        const auto p=projection(positions[i]);
        const COLORREF warning=confidences[i]>=.3f?theme::amber:theme::red;
        HBRUSH brush=CreateSolidBrush(warning);
        auto old_brush=SelectObject(dc,brush);
        const int marker_radius=confidences[i]>=.3f?3:4;
        Ellipse(dc,static_cast<int>(std::lround(p.x))-marker_radius,
                static_cast<int>(std::lround(p.y))-marker_radius,
                static_cast<int>(std::lround(p.x))+marker_radius+1,
                static_cast<int>(std::lround(p.y))+marker_radius+1);
        SelectObject(dc,old_brush); DeleteObject(brush);
    }
}
void draw_motion_view_gizmo(HDC dc,RECT viewport) {
    const RECT reference_chip{viewport.left+12,viewport.top+10,
                              viewport.left+104,viewport.top+34};
    rounded_box(dc,reference_chip,theme::surface_raised,theme::border_soft,6);
    text(dc,L"人体模型 · +Z",reference_chip,theme::text_muted,app.small_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    const double view_facing=std::cos(app.yaw*kPi/180.0);
    const wchar_t* view_label=view_facing>.22?L"正面 3/4":
        view_facing<-.22?L"背面 3/4":L"侧面";
    const RECT chip{viewport.right-92,viewport.top+10,viewport.right-12,viewport.top+34};
    rounded_box(dc,chip,theme::surface_raised,theme::border_soft,6);
    text(dc,view_label,chip,theme::text_muted,app.small_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    const POINT origin{viewport.left+28,viewport.bottom-25};
    stroke(dc,origin,{origin.x+20,origin.y},theme::red,2);
    stroke(dc,origin,{origin.x,origin.y-20},theme::green,2);
    stroke(dc,origin,{origin.x-10,origin.y+7},theme::accent,2);
    text(dc,L"X",{origin.x+21,origin.y-8,origin.x+34,origin.y+8},theme::red,
         app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"Y",{origin.x-5,origin.y-34,origin.x+9,origin.y-20},theme::green,
         app.small_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"Z",{origin.x-24,origin.y+3,origin.x-10,origin.y+18},theme::accent,
         app.small_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
}
void release_human_reference_bitmap() {
    if(app.human_reference_dc) {
        DeleteDC(app.human_reference_dc);
        app.human_reference_dc=nullptr;
    }
    if(app.human_reference_bitmap) {
        DeleteObject(app.human_reference_bitmap);
        app.human_reference_bitmap=nullptr;
    }
    app.human_reference_size={};
}
bool load_human_reference_bitmap() {
    app.human_reference_attempted=true;
    const auto path=app.root/"assets"/"motion"/"human_outline_generic.png";
    if(!std::filesystem::exists(path))return false;

    IWICImagingFactory* factory=nullptr;
    IWICBitmapDecoder* decoder=nullptr;
    IWICBitmapFrameDecode* frame=nullptr;
    IWICFormatConverter* converter=nullptr;
    HBITMAP bitmap=nullptr;
    HDC memory_dc=nullptr;
    auto release_wic=[&]() {
        if(converter)converter->Release();
        if(frame)frame->Release();
        if(decoder)decoder->Release();
        if(factory)factory->Release();
        converter=nullptr; frame=nullptr; decoder=nullptr; factory=nullptr;
    };
    auto fail=[&]() {
        if(memory_dc)DeleteDC(memory_dc);
        if(bitmap)DeleteObject(bitmap);
        memory_dc=nullptr; bitmap=nullptr;
        release_wic();
        return false;
    };
    if(FAILED(CoCreateInstance(CLSID_WICImagingFactory,nullptr,CLSCTX_INPROC_SERVER,
                               IID_PPV_ARGS(&factory))))return fail();
    if(FAILED(factory->CreateDecoderFromFilename(
        path.c_str(),nullptr,GENERIC_READ,WICDecodeMetadataCacheOnLoad,&decoder)))
        return fail();
    UINT frame_count=0;
    if(FAILED(decoder->GetFrameCount(&frame_count))||frame_count==0)return fail();
    if(FAILED(decoder->GetFrame(0,&frame)))return fail();
    if(FAILED(factory->CreateFormatConverter(&converter)))return fail();
    if(FAILED(converter->Initialize(frame,GUID_WICPixelFormat32bppPBGRA,
                                    WICBitmapDitherTypeNone,nullptr,0.0,
                                    WICBitmapPaletteTypeCustom)))return fail();
    UINT width=0,height=0;
    if(FAILED(frame->GetSize(&width,&height))||width==0||height==0)return fail();
    if(width>std::numeric_limits<UINT>::max()/4||
       height>std::numeric_limits<UINT>::max()/(width*4))return fail();
    BITMAPINFO bitmap_info{};
    bitmap_info.bmiHeader.biSize=sizeof(BITMAPINFOHEADER);
    bitmap_info.bmiHeader.biWidth=static_cast<LONG>(width);
    bitmap_info.bmiHeader.biHeight=-static_cast<LONG>(height);
    bitmap_info.bmiHeader.biPlanes=1;
    bitmap_info.bmiHeader.biBitCount=32;
    bitmap_info.bmiHeader.biCompression=BI_RGB;
    void* pixels=nullptr;
    bitmap=CreateDIBSection(nullptr,&bitmap_info,DIB_RGB_COLORS,&pixels,nullptr,0);
    if(!bitmap||!pixels)return fail();
    const UINT stride=width*4;
    const UINT bytes=stride*height;
    if(FAILED(converter->CopyPixels(nullptr,stride,bytes,
                                    static_cast<BYTE*>(pixels))))return fail();
    // Keep the CC0 silhouette's alpha, but tint it to the workspace's subdued
    // blue-gray so it reads as a reference layer rather than captured data.
    auto* pixel_bytes=static_cast<BYTE*>(pixels);
    constexpr BYTE tint_b=86,tint_g=112,tint_r=136;
    for(std::size_t index=0;index<static_cast<std::size_t>(width)*height;++index) {
        const BYTE alpha=pixel_bytes[index*4+3];
        pixel_bytes[index*4+0]=static_cast<BYTE>(tint_b*alpha/255);
        pixel_bytes[index*4+1]=static_cast<BYTE>(tint_g*alpha/255);
        pixel_bytes[index*4+2]=static_cast<BYTE>(tint_r*alpha/255);
    }
    memory_dc=CreateCompatibleDC(nullptr);
    if(!memory_dc)return fail();
    SelectObject(memory_dc,bitmap);
    app.human_reference_bitmap=bitmap;
    app.human_reference_dc=memory_dc;
    app.human_reference_size={static_cast<LONG>(width),static_cast<LONG>(height)};
    bitmap=nullptr; memory_dc=nullptr;
    release_wic();
    return true;
}
void draw_human_reference(HDC dc,RECT viewport,const MotionProjection& projection,
                          const std::vector<animocap::Vec3>& positions) {
    if(!app.human_reference_bitmap||!app.human_reference_dc||positions.empty())return;
    double min_y=std::numeric_limits<double>::infinity();
    double max_y=-std::numeric_limits<double>::infinity();
    for(const auto& value:positions) {
        const auto projected=projection.raw(value);
        min_y=std::min(min_y,projected.y);
        max_y=std::max(max_y,projected.y);
    }
    if(!std::isfinite(min_y)||!std::isfinite(max_y)||
       app.human_reference_size.cx<=0||app.human_reference_size.cy<=0)return;
    const int viewport_height=std::max(
        1,static_cast<int>(viewport.bottom-viewport.top));
    const int maximum_height=std::max(40,viewport_height-24);
    const int desired_height=static_cast<int>(std::lround(
        std::max(1.0,(max_y-min_y)*projection.scale)*1.08));
    const int minimum_height=std::min(92,maximum_height);
    const int figure_height=std::clamp(desired_height,minimum_height,maximum_height);
    const int figure_width=std::max(1,static_cast<int>(std::lround(
        static_cast<double>(figure_height)*app.human_reference_size.cx/
        static_cast<double>(app.human_reference_size.cy)*1.22)));
    const int center=(viewport.left+viewport.right)/2;
    const int bottom=std::min(static_cast<int>(viewport.bottom)-8,
                              static_cast<int>(std::lround(projection.floor_y))+2);
    const RECT destination{center-figure_width/2,bottom-figure_height,
                           center-figure_width/2+figure_width,bottom};
    const BLENDFUNCTION blend{AC_SRC_OVER,0,72,AC_SRC_ALPHA};
    AlphaBlend(dc,destination.left,destination.top,
               destination.right-destination.left,destination.bottom-destination.top,
               app.human_reference_dc,0,0,app.human_reference_size.cx,
               app.human_reference_size.cy,blend);
}
void draw_motion(HDC dc, RECT area) {
    app.review_hit_points.clear();
    panel_box(dc,area,theme::surface,theme::border,8);
    panel_accent(dc,area,app.pose?theme::violet:theme::accent);
    const auto* comparison_source=app.review_compare&&app.review_base?&*app.review_base:
        (app.comparison_pose?&*app.comparison_pose:nullptr);
    const bool has_comparison=app.pose&&comparison_source&&
        comparison_source->frames.size()==app.pose->frames.size();
    RECT label=area; label.left+=18; label.top+=8; label.bottom=label.top+28;
    text(dc,app.pose?L"人体动作 · 按部位修复":L"人体动作预览",
         label,theme::accent,app.small_font);
    if (!app.motion && !app.pose) {
        text(dc,L"\u5b8c\u6210\u6355\u6349\u6216\u52a0\u8f7d\u52a8\u4f5c\u540e\u663e\u793a 3D \u4eba\u4f53\u6a21\u578b",area,RGB(116,126,148),app.font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        return;
    }
    animocap::Skeleton skeleton;
    std::vector<animocap::Vec3> positions;
    std::vector<float> confidences;
    std::vector<animocap::Vec3> comparison_positions;
    std::vector<bool> comparison_valid;
    if (app.pose) {
        skeleton=animocap::make_default_skeleton();
        const auto& observed=app.pose->frames[pose_frame()];
        positions.reserve(observed.joints.size());
        confidences.reserve(observed.joints.size());
        for (const auto& joint : observed.joints) {
            positions.push_back(joint.position_m);
            confidences.push_back(joint.confidence);
        }
        if(has_comparison) {
            const auto& baseline=comparison_source->frames[pose_frame()];
            comparison_positions.reserve(baseline.joints.size());
            comparison_valid.reserve(baseline.joints.size());
            for(const auto& joint:baseline.joints) {
                comparison_positions.push_back(joint.position_m);
                comparison_valid.push_back(joint.valid);
            }
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
    const RECT viewport{area.left+12,area.top+164,area.right-12,area.bottom-42};
    fill(dc,viewport,RGB(8,14,21));
    rounded_outline(dc,viewport,theme::border_soft,7);
    std::vector<animocap::Vec3> projection_comparison_positions;
    projection_comparison_positions.reserve(comparison_positions.size());
    for(std::size_t i=0;i<comparison_positions.size();++i) {
        if(i<comparison_valid.size()&&comparison_valid[i])
            projection_comparison_positions.push_back(comparison_positions[i]);
    }
    const auto projection=make_motion_projection(
        viewport,positions,projection_comparison_positions);
    const int ground=static_cast<int>(std::lround(projection.floor_y));
    const int center=(viewport.left+viewport.right)/2;
    const int horizon=viewport.top+38;
    HPEN grid=CreatePen(PS_SOLID,1,RGB(28,43,56));
    auto old_pen=SelectObject(dc,grid);
    for(int row=0;row<5;++row) {
        const double ratio=static_cast<double>(row)/4.0;
        const int y=ground-static_cast<int>(ratio*(ground-horizon));
        const int half=static_cast<int>((viewport.right-viewport.left)*
            (.16+.34*ratio));
        MoveToEx(dc,center-half,y,nullptr);LineTo(dc,center+half,y);
    }
    for(int lane=-4;lane<=4;++lane) {
        const int bottom_x=center+lane*(viewport.right-viewport.left)/8;
        const int top_x=center+lane*7;
        MoveToEx(dc,bottom_x,ground,nullptr);LineTo(dc,top_x,horizon);
    }
    SelectObject(dc,old_pen); DeleteObject(grid);
    HPEN floor_pen=CreatePen(PS_SOLID,2,RGB(43,67,82));
    old_pen=SelectObject(dc,floor_pen);
    MoveToEx(dc,viewport.left+12,ground,nullptr);
    LineTo(dc,viewport.right-12,ground);
    SelectObject(dc,old_pen); DeleteObject(floor_pen);
    if(!positions.empty()) {
        const auto foot_index=animocap::bone_index(
            skeleton,animocap::BoneSemantic::LeftFoot);
        const auto right_foot_index=animocap::bone_index(
            skeleton,animocap::BoneSemantic::RightFoot);
        const auto foot_a=foot_index<positions.size()?projection(positions[foot_index]):
            animocap::Vec2{static_cast<double>(center),static_cast<double>(ground)};
        const auto foot_b=right_foot_index<positions.size()?projection(positions[right_foot_index]):
            animocap::Vec2{static_cast<double>(center),static_cast<double>(ground)};
        const int shadow_left=static_cast<int>(std::min(foot_a.x,foot_b.x))-12;
        const int shadow_right=static_cast<int>(std::max(foot_a.x,foot_b.x))+12;
        HBRUSH shadow_brush=CreateSolidBrush(RGB(18,27,37));
        auto old_brush=SelectObject(dc,shadow_brush);
        Ellipse(dc,shadow_left,ground-5,shadow_right,ground+5);
        SelectObject(dc,old_brush); DeleteObject(shadow_brush);
    }
    if(!comparison_positions.empty()) {
        HPEN comparison_pen=CreatePen(PS_DOT,1,RGB(112,128,148));
        old_pen=SelectObject(dc,comparison_pen);
        for(std::size_t i=1;i<skeleton.bones.size()&&i<comparison_positions.size();++i) {
            const auto parent=static_cast<std::size_t>(skeleton.bones[i].parent);
            if(parent>=comparison_positions.size()||i>=comparison_valid.size()||
               parent>=comparison_valid.size()||!comparison_valid[i]||
               !comparison_valid[parent])continue;
            const auto a=projection(comparison_positions[parent]);
            const auto b=projection(comparison_positions[i]);
            MoveToEx(dc,static_cast<int>(a.x),static_cast<int>(a.y),nullptr);
            LineTo(dc,static_cast<int>(b.x),static_cast<int>(b.y));
        }
        SelectObject(dc,old_pen);
        DeleteObject(comparison_pen);
    }
    draw_motion_human_model(dc,projection,skeleton,positions,confidences);
    if(app.pose&&app.review_joint<positions.size()) {
        const auto f=pose_frame();
        const auto joint_count=app.pose->frames[f].joints.size();
        for(std::size_t j=0;j<positions.size();++j) {
            if(app.pose->frames[f].joints[j].valid) {
                const auto p=projection(positions[j]);
                app.review_hit_points.push_back({{static_cast<LONG>(p.x),static_cast<LONG>(p.y)},j});
            }
            const auto mark=std::find_if(app.review.marks.begin(),app.review.marks.end(),[&](const auto& m){return m.frame==f&&m.joint==j;});
            const bool inferred=f*joint_count+j<app.review_inferred.size()&&app.review_inferred[f*joint_count+j];
            if(mark==app.review.marks.end()&&!inferred&&j!=app.review_joint)continue;
            const COLORREF color=inferred?theme::amber:mark==app.review.marks.end()?theme::text:
                mark->trust==animocap::ReviewTrust::Locked?theme::green:
                mark->trust==animocap::ReviewTrust::Excluded?theme::red:theme::accent;
            const auto point=projection(positions[j]);
            HPEN pen=CreatePen(PS_SOLID,j==app.review_joint?3:2,color);
            auto old=SelectObject(dc,pen);auto brush=SelectObject(dc,GetStockObject(HOLLOW_BRUSH));
            const int radius=j==app.review_joint?10:6;
            Ellipse(dc,static_cast<int>(point.x)-radius,static_cast<int>(point.y)-radius,
                static_cast<int>(point.x)+radius+1,static_cast<int>(point.y)+radius+1);
            SelectObject(dc,brush);SelectObject(dc,old);DeleteObject(pen);
        }
        const auto mark=std::find_if(app.review.marks.begin(),app.review.marks.end(),[&](const auto& m){return m.frame==f&&m.joint==app.review_joint;});
        const bool inferred=f*joint_count+app.review_joint<app.review_inferred.size()&&app.review_inferred[f*joint_count+app.review_joint];
        const std::wstring state=inferred?L"重建 / 推算":mark==app.review.marks.end()?L"自动观测":
            mark->trust==animocap::ReviewTrust::Locked?L"已锁定":mark->trust==animocap::ReviewTrust::Excluded?L"已排除 / 待重建":
            L"可信 "+std::to_wstring(static_cast<int>(mark->weight))+L"×";
        RECT status{area.left+16,area.top+138,area.right-12,area.top+161};
        text(dc,L"帧 "+std::to_wstring(f)+L" · "+joint_display_name(skeleton.bones[app.review_joint].semantic)+L" · "+state,
            status,inferred?theme::amber:theme::text,app.small_font);
    }
    draw_motion_view_gizmo(dc,viewport);
    RECT hint=area; hint.left+=18; hint.top=hint.bottom-34;
    if(!comparison_positions.empty()) {
        double sum=0.0,maximum=0.0;
        std::size_t samples=0;
        for(std::size_t i=0;i<positions.size()&&i<comparison_positions.size();++i) {
            if(i>=comparison_valid.size()||!comparison_valid[i])continue;
            const auto delta=positions[i]-comparison_positions[i];
            const double distance=std::sqrt(
                delta.x*delta.x+delta.y*delta.y+delta.z*delta.z);
            sum+=distance;
            maximum=std::max(maximum,distance);
            ++samples;
        }
        const auto mean_mm=static_cast<int>(std::lround(
            (samples?sum/static_cast<double>(samples):0.0)*1000.0));
        const auto maximum_mm=static_cast<int>(std::lround(maximum*1000.0));
        text(dc,L"\u7070\u8272\u57fa\u7ebf / \u5f69\u8272\u5f53\u524d \u00b7 \u5e73\u5747 "+
             std::to_wstring(mean_mm)+L" mm \u00b7 \u6700\u5927 "+
             std::to_wstring(maximum_mm)+L" mm \u00b7 \u62d6\u52a8\u65cb\u8f6c",
             hint,theme::text_faint,app.small_font);
        return;
    }
    text(dc,L"绿：锁定  蓝：加权  红：排除  橙：推算\nL/R 人体左右 · 拖动旋转 · 单目深度为估计",
         hint,theme::text_faint,app.small_font,DT_LEFT|DT_WORDBREAK);
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
int workspace_stage() {
    int active=0;
    if(app.decoder&&app.decoder->is_open())active=1;
    if(app.analyzing)active=2;
    else if(app.pose)active=3;
    else if(app.decoder&&app.decoder->is_open())active=2;
    if(app.motion&&app.pose)active=4;
    return active;
}
std::wstring workspace_project_name() {
    const auto choose_name=[](const std::filesystem::path& path) {
        if(path.empty())return std::wstring{};
        const auto name=path.filename().wstring();
        return name.empty()?path.wstring():name;
    };
    if(const auto name=choose_name(app.video_path);!name.empty())return name;
    if(const auto name=choose_name(app.motion_path);!name.empty())return name;
    return L"未命名捕捉";
}
void draw_asset_row(HDC dc,RECT row,const std::wstring& title,
                    const std::wstring& detail,bool active) {
    rounded_box(dc,row,active?theme::surface_raised:theme::surface,
                active?theme::accent_dark:theme::border_soft,6);
    fill(dc,{row.left+10,row.top+12,row.left+14,row.bottom-12},
         active?theme::accent:theme::text_faint);
    text(dc,title,{row.left+24,row.top+5,row.right-12,row.top+25},
         active?theme::text:theme::text_muted,app.small_font,
         DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
    text(dc,detail,{row.left+24,row.top+24,row.right-12,row.bottom-4},
         theme::text_faint,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
}
void draw_workspace_shell(HDC dc,RECT client) {
    const int content_bottom=client.bottom-kFooterHeight;
    const int asset_left=kRailWidth;
    const int asset_right=kRailWidth+kAssetPanelWidth;
    fill(dc,client,theme::background);

    // Top app bar: identity and session context are separated from actions.
    fill(dc,{0,0,client.right,kHeader},theme::header);
    fill(dc,{0,0,client.right,2},theme::accent_soft);
    rounded_box(dc,{14,13,42,42},theme::accent_dark,theme::accent,7);
    text(dc,L"AF",{14,13,42,42},theme::accent,app.small_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"AniMocap Fusion",{52,8,260,34},theme::text,app.title_font,
         DT_LEFT|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"CAPTURE WORKSPACE",{52,32,260,51},theme::text_faint,app.small_font,
         DT_LEFT|DT_VCENTER|DT_SINGLELINE);
    text(dc,L"当前项目",{300,6,670,25},theme::text_faint,app.small_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    text(dc,workspace_project_name(),{300,23,670,50},theme::text,app.section_font,
         DT_CENTER|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
    stroke(dc,{0,kHeader-1},{client.right,kHeader-1},theme::border_soft);

    // Persistent workflow rail.
    fill(dc,{0,kHeader,kRailWidth,content_bottom},theme::header);
    stroke(dc,{kRailWidth-1,kHeader},{kRailWidth-1,content_bottom},theme::border_soft);
    const wchar_t* rail_labels[]={L"视频",L"人物",L"捕捉",L"检查",L"导出"};
    const int active=workspace_stage();
    for(int index=0;index<5;++index) {
        const int top=kHeader+22+index*76;
        if(index==active)fill(dc,{0,top,3,top+52},theme::accent);
        rounded_box(dc,{10,top,54,top+52},index==active?theme::accent_dark:theme::surface,
                    index==active?theme::accent:theme::border_soft,8);
        text(dc,std::to_wstring(index+1),{10,top+7,54,top+27},
             index==active?theme::accent:theme::text_faint,app.small_font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        text(dc,rail_labels[index],{6,top+27,58,top+49},
             index==active?theme::text:theme::text_muted,app.small_font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
    }
    text(dc,L"工作流",{4,content_bottom-34,60,content_bottom-8},
         theme::text_faint,app.small_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);

    // Asset/project drawer under the rail.
    fill(dc,{asset_left,kHeader,asset_right,content_bottom},theme::surface);
    stroke(dc,{asset_right-1,kHeader},{asset_right-1,content_bottom},theme::border_soft);
    text(dc,L"资产",{asset_left+16,kHeader+11,asset_right-16,kHeader+34},
         theme::text,app.section_font);
    text(dc,L"项目输入与输出预设",{asset_left+16,kHeader+33,asset_right-16,kHeader+53},
         theme::text_faint,app.small_font);
    stroke(dc,{asset_left+12,kHeader+59},{asset_right-12,kHeader+59},theme::border_soft);
    text(dc,L"输入源",{asset_left+16,kHeader+61,asset_right-16,kHeader+78},
         theme::text_muted,app.small_font);
    draw_asset_row(dc,{asset_left+12,kHeader+160,asset_right-12,kHeader+204},
        app.video_path.empty()?L"等待导入":app.video_path.filename().wstring(),
        app.decoder&&app.decoder->is_open()?L"视频源 · 已连接":L"视频源 · 未载入",
        app.decoder&&app.decoder->is_open());
    draw_asset_row(dc,{asset_left+12,kHeader+210,asset_right-12,kHeader+254},
        app.motion_path.empty()?L"未生成动作":app.motion_path.filename().wstring(),
        app.motion?L"规范动作包 · 可修正":L"动作包 · 等待捕捉",
        app.motion.has_value());
    text(dc,L"人物与角色",{asset_left+16,kHeader+266,asset_right-16,kHeader+286},
         theme::text_muted,app.small_font);
    text(dc,app.character_profile?L"骨骼参考 · 已加载":L"默认人体骨架",
         {asset_left+16,kHeader+368,asset_right-16,kHeader+384},
         theme::text_faint,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
    text(dc,app.appearance_reference_path.empty()?L"外观参考 · 未载入":
         L"外观参考 · "+app.appearance_reference_path.filename().wstring(),
         {asset_left+16,kHeader+405,asset_right-16,kHeader+423},
         theme::text_faint,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
    text(dc,L"推理与本地 AI",{asset_left+16,kHeader+429,asset_right-16,kHeader+448},
         theme::text_muted,app.small_font);
    text(dc,L"外观参考只参与低置信度视觉纠错",{asset_left+16,kHeader+494,asset_right-16,kHeader+515},
         theme::text_faint,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);

    // Workspace context strip and inspector tabs.
    const int context_right=client.right-kInspectorWidth;
    fill(dc,{asset_right,kHeader,context_right,kHeader+kWorkspaceBar},theme::surface);
    stroke(dc,{asset_right,kHeader+kWorkspaceBar-1},{context_right,kHeader+kWorkspaceBar-1},theme::border_soft);
    text(dc,L"捕捉工作区",{asset_right+16,kHeader+6,asset_right+170,kHeader+33},
         theme::text,app.section_font);
    const std::wstring scope=app.multiview_mode?L"多视角合并复核":
        app.auto_person_frame?L"自动人物范围":
        app.has_person_frame?L"手动人物范围":L"全视频画面";
    text(dc,scope,{asset_right+188,kHeader+6,context_right-210,kHeader+33},
         theme::text_muted,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE|DT_END_ELLIPSIS);
    text(dc,app.analyzing?L"正在处理":app.pose?L"可检查":L"待开始",
         {context_right-200,kHeader+6,context_right-16,kHeader+33},
         app.analyzing?theme::amber:app.pose?theme::green:theme::text_faint,app.small_font,
         DT_RIGHT|DT_VCENTER|DT_SINGLELINE);

    const RECT inspector=inspector_rect();
    fill(dc,{inspector.left,inspector.top,inspector.right,inspector.top+kInspectorTabs},theme::surface);
    stroke(dc,{inspector.left,inspector.top+kInspectorTabs-1},
           {inspector.right,inspector.top+kInspectorTabs-1},theme::border_soft);
    const wchar_t* tabs[]={L"骨架",L"质量",L"工具"};
    const LONG tab_width=(inspector.right-inspector.left)/3;
    for(int index=0;index<3;++index) {
        const LONG left=inspector.left+tab_width*index;
        const LONG right=index==2?inspector.right:left+tab_width;
        text(dc,tabs[index],{left,inspector.top+2,right,inspector.top+kInspectorTabs-5},
             index==0?theme::text:theme::text_muted,app.small_font,
             DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        if(index==0)fill(dc,{left+18,inspector.top+kInspectorTabs-3,
                             right-18,inspector.top+kInspectorTabs},theme::accent);
    }

    fill(dc,{0,client.bottom-kFooterHeight,client.right,client.bottom},theme::background);
    stroke(dc,{0,client.bottom-kFooterHeight},{client.right,client.bottom-kFooterHeight},theme::border_soft);
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
    text(dc,L"检查",{area.left+16,area.top+5,area.left+52,area.top+39},
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
    if(app.pose&&!app.npu_review_issues.empty()) {
        const double tolerance=1.5/std::max(1.0,app.pose->fps);
        for(const auto& npu:app.npu_review_issues) {
            if(std::abs(npu.reference_time_s-app.time_s)>tolerance)continue;
            const auto& view_label=app.multiview_view_labels[npu.view_index];
            std::wstring detail=L"NPU巡检 · "+npu.detail;
            if(npu.mean_normalized_error>0.0)
                detail+=L" · 分歧 "+std::to_wstring(static_cast<int>(
                    std::lround(npu.mean_normalized_error*100.0)))+L"%";
            const float confidence=npu.left_right_swaps>0?0.1f:
                static_cast<float>(std::clamp(1.0-npu.mean_normalized_error,0.0,1.0));
            issues.push_back({L"NPU复核 · "+(view_label.empty()
                ?L"view "+std::to_wstring(npu.view_index+1):view_label),confidence,detail});
        }
    }
    std::wstring heading=issues.empty()
        ? (app.multiview_diagnostics?L"当前帧多视角未见明显冲突":L"当前帧没有明显问题")
        : L"需要检查 · "+std::to_wstring(issues.size())+L" 项";
    text(dc,heading,{area.left+16,area.top+50,area.right-16,area.top+80},
         issues.empty()?theme::green:theme::text,app.font);
    int issue_y=area.top+84;
    if(app.multiview_diagnostics) {
        std::wstring alignment=L"时间对齐";
        for(const auto& item:app.multiview_diagnostics->alignments) {
            alignment+=L" · "+widen(item.view_id)+L" "+
                std::to_wstring(static_cast<int>(std::lround(item.mean_offset_s*1000.0)))+L"ms"+
                L" "+std::to_wstring(item.overlap_reference_frames)+L"/"+
                std::to_wstring(item.overlap_reference_frames+
                    item.out_of_range_reference_frames);
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
void draw_curve_editor(HDC dc,RECT area) {
    const RECT graph=curve_graph_area();
    fill(dc,graph,RGB(10,17,25));
    stroke(dc,{graph.left,graph.top},{graph.right,graph.top},theme::border);
    stroke(dc,{graph.left,graph.bottom},{graph.right,graph.bottom},theme::border);
    const int graph_height=std::max<LONG>(1,graph.bottom-graph.top);
    const int graph_width=std::max<LONG>(1,graph.right-graph.left);
    for(int tick=0;tick<=4;++tick) {
        const int y=graph.bottom-graph_height*tick/4;
        stroke(dc,{graph.left,y},{graph.right,y},
               tick==0||tick==4?theme::border:RGB(27,40,53));
        text(dc,std::to_wstring(tick*25)+L"%",
             {area.left+14,y-10,area.left+kTimelineLabelWidth-12,y+10},
             theme::text_faint,app.mono_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
    }
    for(int tick=0;tick<=10;++tick) {
        const int x=graph.left+graph_width*tick/10;
        stroke(dc,{x,graph.top},{x,graph.bottom},RGB(24,36,48));
    }
    const auto range=timeline_range();
    if(range) {
        text(dc,timecode(range->start),{graph.left,area.top+46,graph.left+110,area.top+56},
             theme::text_faint,app.mono_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
        text(dc,timecode(range->end),{graph.right-110,area.top+46,graph.right,area.top+56},
             theme::text_faint,app.mono_font,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
    }
    const auto active=active_curve_correction_index();
    if(!app.pose||app.pose->frames.empty()) {
        text(dc,L"加载动作后在此编辑关键帧影响曲线",
             {graph.left+16,graph.top+18,graph.right-16,graph.bottom-18},
             theme::text_muted,app.small_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        return;
    }
    text(dc,L"曲线编辑器",
         {area.left+14,area.top+148,area.left+kTimelineLabelWidth-8,area.top+174},
         theme::text_muted,app.small_font,DT_LEFT|DT_VCENTER|DT_SINGLELINE);
    if(active&&*active<app.manual_corrections.size()) {
        const auto& correction=app.manual_corrections[*active];
        text(dc,L"关键帧 "+std::to_wstring(correction.keyframe_frame_index)+
             L" · 影响 "+std::to_wstring(correction_curve_radius(correction))+L" 帧",
             {area.left+14,area.top+178,area.left+kTimelineLabelWidth-8,area.top+220},
             theme::text_faint,app.small_font,DT_LEFT|DT_TOP|DT_WORDBREAK);
    }
    const auto draw_y=[&](double weight) {
        return graph.bottom-static_cast<int>(std::lround(
            std::clamp(weight,0.0,1.0)*graph_height));
    };
    for(std::size_t index=0;index<app.manual_corrections.size();++index) {
        const auto& correction=app.manual_corrections[index];
        if(correction.frame_weights.empty()||
           correction.keyframe_frame_index>=app.pose->frames.size())continue;
        const bool is_active=active&&*active==index;
        HPEN pen=CreatePen(PS_SOLID,is_active?3:1,
            is_active?theme::accent:RGB(82,71,128));
        auto old_pen=SelectObject(dc,pen);
        bool started=false;
        for(std::size_t frame=0;frame<correction.frame_weights.size()&&
            frame<app.pose->frames.size();++frame) {
            if(correction.frame_weights[frame]<=1e-5) { started=false; continue; }
            const int x=curve_x_for_frame(graph,frame);
            const int y=draw_y(correction.frame_weights[frame]);
            if(!started){MoveToEx(dc,x,y,nullptr);started=true;}else LineTo(dc,x,y);
        }
        SelectObject(dc,old_pen);DeleteObject(pen);
        const int key_x=curve_x_for_frame(graph,correction.keyframe_frame_index);
        const int key_y=draw_y(1.0);
        HBRUSH brush=CreateSolidBrush(
            is_active?theme::accent:(keyframe_is_selected(correction.keyframe_frame_index)
                ?theme::amber:theme::violet));
        auto old_brush=SelectObject(dc,brush);
        POINT diamond[]={{key_x,key_y-7},{key_x+7,key_y},
                         {key_x,key_y+7},{key_x-7,key_y}};
        Polygon(dc,diamond,4);
        SelectObject(dc,old_brush);DeleteObject(brush);
        if(is_active) {
            const auto radius=correction_curve_radius(correction);
            const int left_x=curve_x_for_frame(graph,
                correction.keyframe_frame_index>radius
                    ?correction.keyframe_frame_index-radius:0);
            const int right_x=curve_x_for_frame(graph,std::min(
                app.pose->frames.size()-1,correction.keyframe_frame_index+radius));
            const int handle_y=curve_handle_y(graph);
            HPEN handle_pen=CreatePen(PS_DOT,1,theme::accent_soft);
            old_pen=SelectObject(dc,handle_pen);
            MoveToEx(dc,key_x,key_y,nullptr);LineTo(dc,left_x,handle_y);
            MoveToEx(dc,key_x,key_y,nullptr);LineTo(dc,right_x,handle_y);
            SelectObject(dc,old_pen);DeleteObject(handle_pen);
            HBRUSH handle_brush=CreateSolidBrush(theme::accent);
            old_brush=SelectObject(dc,handle_brush);
            Ellipse(dc,left_x-6,handle_y-6,left_x+7,handle_y+7);
            Ellipse(dc,right_x-6,handle_y-6,right_x+7,handle_y+7);
            SelectObject(dc,old_brush);DeleteObject(handle_brush);
            text(dc,L"影响手柄 · 左右拖动调整范围",
                 {graph.left+10,graph.bottom-16,graph.right-10,graph.bottom},
                 theme::text_faint,app.small_font,DT_CENTER|DT_VCENTER|DT_SINGLELINE);
        }
    }
    if(range) {
        const double normalized=std::clamp(
            (app.time_s-range->start)/std::max(.001,range->end-range->start),0.0,1.0);
        const int cursor=graph.left+static_cast<int>(std::lround(graph_width*normalized));
        stroke(dc,{cursor,graph.top},{cursor,graph.bottom},theme::accent,2);
        fill(dc,{cursor-5,graph.top-1,cursor+6,graph.top+7},theme::accent);
    }
}
void draw_timeline_panel(HDC dc,RECT area) {
    panel_box(dc,area,theme::surface,theme::border,8);
    panel_accent(dc,area,theme::accent);
    if(app.timeline_mode==TimelineMode::CurveEditor) {
        const auto range=timeline_range();
        const std::wstring current=timecode(app.time_s);
        const std::wstring duration=range?timecode(range->end-range->start):L"--:--.---";
        text(dc,current+L"  /  "+duration,
             {area.right-270,area.top+6,area.right-16,area.top+40},theme::accent,
             app.mono_font,DT_RIGHT|DT_VCENTER|DT_SINGLELINE);
        draw_curve_editor(dc,area);
        return;
    }
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
    std::wstring track_label=app.manual_corrections.empty()
        ?(app.decoder&&app.decoder->is_open()?L"视频轨道":L"动作轨道")
        :L"关键帧曲线 · "+std::to_wstring(app.manual_corrections.size());
    if(!app.selected_keyframes.empty())
        track_label+=L" · 已选 "+std::to_wstring(app.selected_keyframes.size());
    text(dc,track_label,
         {area.left+14,area.top+148,area.left+label_width-8,area.top+188},
         theme::text_muted,app.small_font);
    const std::wstring export_label=app.selected_export_frames.empty()
        ?L"Blender 导入 · 未选择"
        :L"Blender 导入 · "+std::to_wstring(app.selected_export_frames.size())+L" 帧";
    text(dc,export_label,
         {area.left+14,area.top+188,area.left+label_width-8,area.bottom-7},
         app.selecting_export_frames?theme::green:theme::text_faint,app.small_font,
         DT_LEFT|DT_TOP|DT_WORDBREAK);

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
        if(app.pose&&!app.pose->frames.empty()) {
            for(const auto& mark:app.review.marks) {
                if(mark.joint!=app.review_joint||mark.frame>=app.pose->frames.size())continue;
                const int x=x_at_time(app.pose->frames[mark.frame].time_s);
                const COLORREF color=mark.trust==animocap::ReviewTrust::Locked?theme::green:
                    mark.trust==animocap::ReviewTrust::Excluded?theme::red:theme::accent;
                fill(dc,{x-2,bar.top+27,x+3,bar.top+40},color);
            }
            for(const auto& r:app.review.ranges) {
                if(r.joint!=app.review_joint||r.last>=app.pose->frames.size())continue;
                fill(dc,{x_at_time(app.pose->frames[r.first].time_s),bar.top+44,
                    x_at_time(app.pose->frames[r.last].time_s)+1,bar.top+48},theme::amber);
            }
            for(const auto& correction:app.manual_corrections) {
                if(correction.frame_weights.empty() ||
                   correction.keyframe_frame_index>=app.pose->frames.size()) continue;
                bool curve_started=false;
                HPEN curve_pen=CreatePen(PS_SOLID,1,theme::violet);
                auto old_pen=SelectObject(dc,curve_pen);
                for(std::size_t frame=0;frame<correction.frame_weights.size()&&
                    frame<app.pose->frames.size();++frame) {
                    const double weight=correction.frame_weights[frame];
                    if(weight<=0.0) { curve_started=false; continue; }
                    const int x=x_at_time(app.pose->frames[frame].time_s);
                    const int y=bar.top+15-static_cast<int>(std::lround(8.0*weight));
                    if(!curve_started) { MoveToEx(dc,x,y,nullptr);curve_started=true; }
                    else LineTo(dc,x,y);
                }
                SelectObject(dc,old_pen);DeleteObject(curve_pen);
                const auto keyframe=correction.keyframe_frame_index;
                const int key_x=x_at_time(app.pose->frames[keyframe].time_s);
                const int key_y=bar.top+7;
                const bool is_current_keyframe=pose_frame()==keyframe;
                const bool is_selected_keyframe=keyframe_is_selected(keyframe);
                HBRUSH key_brush=CreateSolidBrush(
                    is_current_keyframe?theme::green:
                    is_selected_keyframe?theme::amber:theme::violet);
                auto old_brush=SelectObject(dc,key_brush);
                POINT diamond[]={{key_x,key_y-5},{key_x+5,key_y},
                                 {key_x,key_y+5},{key_x-5,key_y}};
                Polygon(dc,diamond,4);
                SelectObject(dc,old_brush);DeleteObject(key_brush);
            }
        }
        if(app.motion) {
            for(const auto frame:app.selected_export_frames.frames()) {
                if(frame>=app.motion->motion.frame_count)continue;
                const int x=x_at_time(app.motion->motion.time_s[frame]);
                const int y=bar.top+31;
                fill(dc,{x-3,y-3,x+4,y+4},theme::green);
                stroke(dc,{x,bar.top+23},{x,bar.bottom-12},theme::green,1);
            }
        }
        if(const auto selected=selected_range()) {
            const int start_x=x_at_time(selected->start),end_x=x_at_time(selected->end);
            fill(dc,{start_x,bar.top+2,end_x,bar.top+6},theme::violet);
            stroke(dc,{start_x,bar.top},{start_x,bar.bottom},theme::violet,2);
            stroke(dc,{end_x,bar.top},{end_x,bar.bottom},theme::violet,2);
        }
        for(const auto& issue:app.npu_review_issues) {
            const int x=x_at_time(issue.reference_time_s);
            const auto color=issue.left_right_swaps>0?theme::red:theme::violet;
            stroke(dc,{x,ambiguity_top},{x,ambiguity_bottom},color,1);
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
    draw_workspace_shell(dc,client);
    if(app.multiview_mode&&(!app.pose&&!app.motion||app.multiview_overview))
        draw_multiview_preview(dc,video_area());
    else
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
    const bool hot=(item->itemState&ODS_HOTLIGHT)!=0;
    const bool primary=id==kAnalyze;
    const bool selected=(id==kAutoFrame&&app.auto_person_frame)||
                        (id==kPersonFrame&&app.manual_person_frame)||
                        (id==kVlmToggle&&app.vlm_enabled)||
                        (id==kAppearanceToggle&&app.appearance_assist_enabled)||
                        (id==kLoopRange&&app.loop_range)||
                        (id==kCalibrate&&app.calibrating)||
                        (id==kSelectExportFrames&&app.selecting_export_frames)||
                        (id==kReviewCompare&&app.review_compare);
    COLORREF background=primary?theme::accent_strong:
        selected?theme::accent_dark:theme::surface_raised;
    COLORREF border=primary?theme::accent:selected?theme::accent:theme::border;
    if(pressed)background=primary?RGB(8,103,164):theme::surface_hover;
    else if(hot&&!disabled)background=primary?RGB(28,155,211):theme::surface_hover;
    if(disabled){background=RGB(14,21,29);border=theme::border_soft;}
    fill(item->hDC,rect,theme::surface);
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
    const int asset_left=kRailWidth;
    const int asset_top=kHeader;
    MoveWindow(GetDlgItem(window,kImport),asset_left+12,asset_top+84,212,34,TRUE);
    MoveWindow(GetDlgItem(window,kMultiview),asset_left+12,asset_top+124,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kLoad),asset_left+120,asset_top+124,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kAutoFrame),asset_left+12,asset_top+286,70,34,TRUE);
    MoveWindow(GetDlgItem(window,kPersonFrame),asset_left+86,asset_top+286,70,34,TRUE);
    MoveWindow(GetDlgItem(window,kResetFrame),asset_left+160,asset_top+286,64,34,TRUE);
    MoveWindow(GetDlgItem(window,kCharacterProfile),asset_left+12,asset_top+328,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kAppearanceReference),asset_left+120,asset_top+328,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kAppearanceToggle),asset_left+12,asset_top+368,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kSetup),asset_left+120,asset_top+368,104,34,TRUE);
    MoveWindow(GetDlgItem(window,kVlmSetup),asset_left+12,asset_top+408,212,34,TRUE);
    MoveWindow(GetDlgItem(window,kExpertInterval),asset_left+12,asset_top+448,212,34,TRUE);

    int header_right=client.right-12;
    const int analyze_width=142;
    MoveWindow(GetDlgItem(window,kAnalyze),header_right-analyze_width,9,analyze_width,38,TRUE);
    header_right-=analyze_width+8;
    const int vlm_width=174;
    MoveWindow(GetDlgItem(window,kVlmToggle),header_right-vlm_width,9,vlm_width,38,TRUE);
    header_right-=vlm_width+8;
    const int vrma_width=90;
    MoveWindow(GetDlgItem(window,kExportVrma),header_right-vrma_width,9,vrma_width,38,TRUE);
    header_right-=vrma_width+8;
    const int bvh_width=84;
    MoveWindow(GetDlgItem(window,kExportBvh),header_right-bvh_width,9,bvh_width,38,TRUE);
    header_right-=bvh_width+8;
    const int save_width=88;
    MoveWindow(GetDlgItem(window,kSaveMotion),header_right-save_width,9,save_width,38,TRUE);

    RECT issues=issues_area();
    const auto review=motion_area();
    const int cell=(review.right-review.left-32)/3;
    MoveWindow(GetDlgItem(window,kReviewJoint),review.left+12,review.top+36,cell*2+4,340,TRUE);
    MoveWindow(GetDlgItem(window,kReviewOpen),review.left+20+cell*2,review.top+36,cell,28,TRUE);
    const int review_buttons[]{kReviewLock,kReviewWeight,kReviewExclude,kReviewClear,kReviewRebuild,kReviewCompare};
    for(int i=0;i<6;++i)MoveWindow(GetDlgItem(window,review_buttons[i]),
        review.left+12+(cell+4)*(i%3),review.top+70+(i/3)*32,cell,28,TRUE);
    MoveWindow(GetDlgItem(window,kReviewFront),review.right-122,review.top+6,52,24,TRUE);
    MoveWindow(GetDlgItem(window,kReviewSide),review.right-66,review.top+6,52,24,TRUE);
    MoveWindow(GetDlgItem(window,kUndoCorrection),issues.right-246,issues.top+6,72,32,TRUE);
    MoveWindow(GetDlgItem(window,kRedoCorrection),issues.right-168,issues.top+6,72,32,TRUE);
    MoveWindow(GetDlgItem(window,kCalibrate),issues.right-90,issues.top+6,82,32,TRUE);
    RECT timeline=timeline_area();
    MoveWindow(app.play,timeline.left+8,timeline.top+6,82,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeStart),timeline.left+96,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeEnd),timeline.left+190,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kRangeClear),timeline.left+284,timeline.top+6,88,34,TRUE);
    MoveWindow(GetDlgItem(window,kLoopRange),timeline.left+378,timeline.top+6,124,34,TRUE);
    MoveWindow(GetDlgItem(window,kDeleteKeyframe),timeline.left+508,timeline.top+6,112,34,TRUE);
    for(const int hidden:{kSelectAllKeyframes,kClearKeyframeSelection,kSmoothKeyframes,
                          kTimelineMode,kCurvePreset})
        ShowWindow(GetDlgItem(window,hidden),SW_HIDE);
    MoveWindow(GetDlgItem(window,kSelectExportFrames),timeline.left+626,timeline.top+6,130,34,TRUE);
    MoveWindow(GetDlgItem(window,kSelectAuthoredExportFrames),timeline.left+762,timeline.top+6,154,34,TRUE);
    MoveWindow(GetDlgItem(window,kClearExportFrames),timeline.left+922,timeline.top+6,96,34,TRUE);
    MoveWindow(GetDlgItem(window,kExportBlenderSelected),timeline.left+1024,timeline.top+6,240,34,TRUE);
    update_timeline_labels();
    ShowWindow(app.timeline,SW_HIDE);
    MoveWindow(app.progress,client.right-194,client.bottom-kFooterHeight+13,178,6,TRUE);
    MoveWindow(app.status,16,client.bottom-kFooterHeight+1,
               std::max<LONG>(180,client.right-226),kFooterHeight-2,TRUE);
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
    if(app.multiview_mode&&has_multiview_review()) {
        toggle_multiview_overview();
        return;
    }
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
    if (app.multiview_overview || !app.calibrating || !app.pose || app.video_frame.bgra.empty() ||
        (has_multiview_review()&&
         app.multiview_review_view!=multiview_reference_view())) return false;
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
    for(const int id:{kReviewJoint,kReviewLock,kReviewWeight,kReviewExclude,kReviewClear,kReviewRebuild,kReviewCompare})
        EnableWindow(GetDlgItem(app.window,id),app.pose.has_value()&&!app.analyzing);
    prune_keyframe_selection();
    update_blender_selection_controls();
    EnableWindow(GetDlgItem(app.window,kUndoCorrection),!app.correction_undo.empty());
    EnableWindow(GetDlgItem(app.window,kRedoCorrection),!app.correction_redo.empty());
    const auto current=app.pose?pose_frame():0;
    const bool has_current_key=std::any_of(
        app.manual_corrections.begin(),app.manual_corrections.end(),
        [&](const auto& correction) {
            return !correction.frame_weights.empty()&&
                correction.keyframe_frame_index==current;
        });
    EnableWindow(GetDlgItem(app.window,kDeleteKeyframe),has_current_key);
    const auto available=authored_keyframe_frames();
    SetWindowTextW(GetDlgItem(app.window,kSelectAllKeyframes),
        all_keyframes_selected()?L"全部已选":L"全选关键帧");
    EnableWindow(GetDlgItem(app.window,kSelectAllKeyframes),!available.empty());
    EnableWindow(GetDlgItem(app.window,kClearKeyframeSelection),
        !app.selected_keyframes.empty());
    EnableWindow(GetDlgItem(app.window,kSmoothKeyframes),
        !app.selected_keyframes.empty());
}
void rebuild_corrected_motion() {
    auto corrected=animocap::reconstruct_canonical_motion(
        *app.pose,app.character_profile?&app.character_profile->skeleton:nullptr);
    if(app.motion&&!app.motion->cameras.empty())corrected.cameras=app.motion->cameras;
    app.motion=std::move(corrected);
}
void rebuild_corrected_pose() {
    const auto* refined=app.profile_refined_pose
        ?&*app.profile_refined_pose
        :(app.pose_baseline?&*app.pose_baseline:nullptr);
    if(!refined) return;
    auto corrected=animocap::apply_manual_pose_corrections(
        *refined,app.manual_corrections);
    if(!app.smoothed_keyframes.empty()) {
        const auto authored=authored_keyframe_frames();
        const auto smoothing=animocap::smooth_pose_around_keyframes(
            corrected,app.smoothed_keyframes);
        auto smoothed=smoothing.sequence;
        // Every authored keyframe remains an exact anchor, including keys
        // that were not selected for this pass.  This makes later manual edits
        // compose safely with an earlier local smoothing operation.
        for(const auto frame:authored) {
            if(frame<smoothed.frames.size())
                smoothed.frames[frame]=corrected.frames[frame];
        }
        corrected=std::move(smoothed);
    }
    auto reviewed=animocap::rebuild_reviewed_pose(corrected,app.review);
    auto rebuilt_motion=animocap::reconstruct_canonical_motion(reviewed.sequence,
        app.character_profile?&app.character_profile->skeleton:nullptr);
    if(app.motion&&!app.motion->cameras.empty())rebuilt_motion.cameras=app.motion->cameras;
    app.review_base=corrected;
    app.review_inferred=std::move(reviewed.inferred);
    app.pose=std::move(reviewed.sequence);
    app.motion=std::move(rebuilt_motion);
}
void rebuild_correction_curve(std::size_t index,std::size_t radius) {
    if(!app.pose||index>=app.manual_corrections.size())return;
    auto& correction=app.manual_corrections[index];
    if(correction.frame_weights.empty()||
       correction.keyframe_frame_index>=app.pose->frames.size())return;
    correction.frame_weights=editor_curve_weights(
        app.pose->frames.size(),correction.keyframe_frame_index,radius,app.curve_preset);
    rebuild_corrected_pose();
}
void apply_curve_preset() {
    if(!app.pose)return;
    std::vector<std::size_t> targets;
    const auto selected=app.selected_keyframes;
    if(!selected.empty()) {
        for(std::size_t index=0;index<app.manual_corrections.size();++index) {
            const auto& correction=app.manual_corrections[index];
            if(!correction.frame_weights.empty()&&contains_keyframe(
                selected,correction.keyframe_frame_index))targets.push_back(index);
        }
    } else if(const auto active=active_curve_correction_index()) {
        targets.push_back(*active);
    }
    if(targets.empty()) {
        set_status(curve_preset_label(app.curve_preset)+L" · 将用于下一次关键帧拖动");
        update_timeline_labels();
        InvalidateRect(app.window,nullptr,FALSE);
        return;
    }
    const auto before_state=current_correction_state();
    const auto before_pose=*app.pose;
    try {
        for(const auto index:targets)
            rebuild_correction_curve(index,correction_curve_radius(
                app.manual_corrections[index]));
        push_correction_history(app.correction_undo,before_state);
        app.correction_redo.clear();
        app.motion_dirty=true;
        update_correction_controls();
        set_status(curve_preset_label(app.curve_preset)+L" · 已应用到 "+
            std::to_wstring(targets.size())+L" 条关键帧曲线 · 尚未保存");
    } catch(const std::exception& error) {
        app.manual_corrections=before_state.corrections;
        app.smoothed_keyframes=before_state.smoothed_keyframes;
        app.review=before_state.review;
        app.pose=before_pose;
        MessageBoxW(app.window,widen(error.what()).c_str(),L"曲线预设应用失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void cycle_curve_preset() {
    const auto next=(static_cast<int>(app.curve_preset)+1)%5;
    app.curve_preset=static_cast<CurvePreset>(next);
    update_timeline_labels();
    apply_curve_preset();
}
void toggle_timeline_mode() {
    app.timeline_mode=app.timeline_mode==TimelineMode::DopeSheet
        ?TimelineMode::CurveEditor:TimelineMode::DopeSheet;
    update_timeline_labels();
    set_status(app.timeline_mode==TimelineMode::CurveEditor
        ?L"曲线编辑器 · 拖动底部影响手柄调整曲线范围，点击菱形选择关键帧"
        :L"关键帧轨道 · 单击选择，Ctrl+点击多选；选中后可按中心平滑");
    InvalidateRect(app.window,nullptr,FALSE);
}
void begin_curve_handle_drag(POINT point) {
    const auto handle=curve_handle_from_point(point);
    if(!handle)return;
    const auto active=active_curve_correction_index();
    if(!active)return;
    app.active_curve_correction=static_cast<int>(*active);
    app.dragging_curve_handle=true;
    app.curve_handle_side=handle->first;
    app.curve_drag_changed=false;
    app.curve_drag_before_state=current_correction_state();
    if(app.pose)app.curve_drag_before_pose=*app.pose;
    SetCapture(app.window);
}
void move_curve_handle(POINT point) {
    if(!app.dragging_curve_handle||!app.pose)return;
    const auto active=active_curve_correction_index();
    if(!active||*active>=app.manual_corrections.size())return;
    const auto& correction=app.manual_corrections[*active];
    if(correction.frame_weights.empty()||
       correction.keyframe_frame_index>=app.pose->frames.size())return;
    const RECT graph=curve_graph_area();
    const double normalized=std::clamp(
        static_cast<double>(point.x-graph.left)/std::max<LONG>(1,graph.right-graph.left),0.0,1.0);
    const auto range=timeline_range();
    std::size_t candidate=0;
    if(range&&app.pose->frames.size()>1) {
        const double time=range->start+normalized*(range->end-range->start);
        auto found=std::lower_bound(app.pose->frames.begin(),app.pose->frames.end(),time,
            [](const auto& frame,double target){return frame.time_s<target;});
        candidate=found==app.pose->frames.end()?app.pose->frames.size()-1:
            static_cast<std::size_t>(found-app.pose->frames.begin());
    } else {
        candidate=static_cast<std::size_t>(std::lround(
            normalized*static_cast<double>(app.pose->frames.size()-1)));
    }
    const auto keyframe=correction.keyframe_frame_index;
    std::size_t radius=1;
    if(app.curve_handle_side<0) {
        radius=keyframe>candidate?keyframe-candidate:1;
    } else {
        radius=candidate>keyframe?candidate-keyframe:1;
    }
    const auto previous_radius=correction_curve_radius(correction);
    if(radius==previous_radius)return;
    rebuild_correction_curve(*active,radius);
    app.curve_drag_changed=true;
    InvalidateRect(app.window,nullptr,FALSE);
}
void finish_curve_handle_drag() {
    if(!app.dragging_curve_handle)return;
    app.dragging_curve_handle=false;
    app.curve_handle_side=0;
    ReleaseCapture();
    if(!app.curve_drag_before_state)return;
    auto before=std::move(*app.curve_drag_before_state);
    app.curve_drag_before_state.reset();
    app.curve_drag_before_pose.reset();
    if(app.curve_drag_changed) {
        push_correction_history(app.correction_undo,std::move(before));
        app.correction_redo.clear();
        app.motion_dirty=true;
        update_correction_controls();
        set_status(L"关键帧曲线影响范围已调整 · 尚未保存");
    }
    app.curve_drag_changed=false;
    InvalidateRect(app.window,nullptr,FALSE);
}
void push_correction_history(
    std::vector<CorrectionEditState>& history,
    CorrectionEditState value
) {
    constexpr std::size_t kMaximumCorrectionHistory=12;
    if(history.size()==kMaximumCorrectionHistory)history.erase(history.begin());
    history.push_back(std::move(value));
}
CorrectionEditState current_correction_state() {
    return {app.manual_corrections,app.smoothed_keyframes,app.review};
}
void toggle_keyframe_selection(std::size_t frame) {
    const auto available=authored_keyframe_frames();
    if(!contains_keyframe(available,frame)) return;
    for(std::size_t index=0;index<app.manual_corrections.size();++index) {
        if(!app.manual_corrections[index].frame_weights.empty()&&
           app.manual_corrections[index].keyframe_frame_index==frame) {
            app.active_curve_correction=static_cast<int>(index);
            break;
        }
    }
    const auto found=std::find(app.selected_keyframes.begin(),
        app.selected_keyframes.end(),frame);
    if(found==app.selected_keyframes.end()) {
        app.selected_keyframes.push_back(frame);
        set_status(L"已选关键帧 "+std::to_wstring(frame)+
            L" · Ctrl+点击继续多选，点击“平滑选中键”应用");
    } else {
        app.selected_keyframes.erase(found);
        set_status(L"已取消选择关键帧 "+std::to_wstring(frame));
    }
    std::sort(app.selected_keyframes.begin(),app.selected_keyframes.end());
    update_correction_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void select_all_keyframes() {
    app.selected_keyframes=authored_keyframe_frames();
    if(app.selected_keyframes.empty()) {
        set_status(L"当前没有可选择的手动关键帧");
    } else {
        set_status(L"已选中全部 "+std::to_wstring(app.selected_keyframes.size())+
            L" 个关键帧 · 点击“平滑选中键”应用");
    }
    update_correction_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void clear_keyframe_selection() {
    app.selected_keyframes.clear();
    set_status(L"已清除关键帧选择 · 已应用的平滑保持不变");
    update_correction_controls();
    InvalidateRect(app.window,nullptr,FALSE);
}
void smooth_selected_keyframes() {
    if(!app.pose) return;
    prune_keyframe_selection();
    if(app.selected_keyframes.empty()) {
        set_status(L"请先用 Ctrl+点击关键帧，或点击“全选关键帧”");
        return;
    }
    std::vector<std::size_t> combined=app.smoothed_keyframes;
    combined.insert(combined.end(),app.selected_keyframes.begin(),
                    app.selected_keyframes.end());
    std::sort(combined.begin(),combined.end());
    combined.erase(std::unique(combined.begin(),combined.end()),combined.end());
    if(combined==app.smoothed_keyframes) {
        set_status(L"选中的关键帧已经应用过平滑");
        return;
    }
    const auto before_state=current_correction_state();
    const auto before_pose=*app.pose;
    const double jitter_before=animocap::pose_sequence_jitter_metric(before_pose);
    try {
        app.smoothed_keyframes=std::move(combined);
        rebuild_corrected_pose();
        const double jitter_after=animocap::pose_sequence_jitter_metric(*app.pose);
        std::size_t changed_samples=0;
        for(std::size_t frame=0;frame<before_pose.frames.size();++frame) {
            for(std::size_t joint=0;joint<before_pose.frames[frame].joints.size();++joint) {
                const auto& before=before_pose.frames[frame].joints[joint];
                const auto& after=app.pose->frames[frame].joints[joint];
                if(before.position_m!=after.position_m||before.image_xy!=after.image_xy)
                    ++changed_samples;
            }
        }
        push_correction_history(app.correction_undo,before_state);
        app.correction_redo.clear();
        app.motion_dirty=true;
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        update_correction_controls();
        const int reduction=jitter_before>0.0
            ?static_cast<int>(std::lround(std::clamp(
                1.0-jitter_after/jitter_before,0.0,1.0)*100.0)):0;
        set_status(L"已按 "+std::to_wstring(app.selected_keyframes.size())+
            L" 个关键帧为中心平滑 · 影响 "+std::to_wstring(changed_samples)+
            L" 个样本 · 抖动指标 -"+std::to_wstring(reduction)+L"% · 尚未保存");
    } catch(const std::exception& error) {
        app.manual_corrections=before_state.corrections;
        app.smoothed_keyframes=before_state.smoothed_keyframes;
        app.review=before_state.review;
        app.pose=before_pose;
        set_status(L"关键帧平滑失败 · 已恢复平滑前状态");
        MessageBoxW(app.window,widen(error.what()).c_str(),L"关键帧平滑失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
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
    const auto before_state=current_correction_state();
    try {
        auto skeleton=animocap::make_default_skeleton();
        const auto head=animocap::bone_index(skeleton,animocap::BoneSemantic::Head);
        const auto left_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::LeftFoot);
        const auto right_foot=animocap::bone_index(skeleton,animocap::BoneSemantic::RightFoot);
        const auto keyframe_frame=pose_frame();
        for(auto& mark:app.review.marks)
            if(mark.frame==keyframe_frame&&mark.joint==selected&&mark.trust!=animocap::ReviewTrust::Excluded)
                mark.target=app.pose->frames[keyframe_frame].joints[selected];
        animocap::ManualPoseCorrection correction;
        correction.joint_index=selected;
        correction.image_delta={app.anchor_drag_delta_u,app.anchor_drag_delta_v};
        correction.keyframe_frame_index=keyframe_frame;
        const auto influence_radius=std::max<std::size_t>(4,
            static_cast<std::size_t>(std::lround(std::max(1.0,before.fps)*0.25)));
        correction.frame_weights=editor_curve_weights(
            before.frames.size(),correction.keyframe_frame_index,influence_radius,
            app.curve_preset);
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
        app.active_curve_correction=static_cast<int>(app.manual_corrections.size()-1);
        app.selected_keyframes={keyframe_frame};
        rebuild_corrected_pose();
        push_correction_history(app.correction_undo,before_state);
        app.correction_redo.clear();
        app.motion_dirty=true;
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        update_correction_controls();
        set_status(L"关键帧 "+std::to_wstring(keyframe_frame)+
            L" 已创建 · 三次曲线有界传播 · 尚未保存");
    } catch (const std::exception& error) {
        app.manual_corrections=before_state.corrections;
        app.smoothed_keyframes=before_state.smoothed_keyframes;
        app.review=before_state.review;
        app.pose=std::move(before);
        set_status(L"锚点修正失败 · 已恢复拖动前状态");
        MessageBoxW(app.window,widen(error.what()).c_str(),L"校准失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void delete_current_keyframes() {
    if(!app.pose)return;
    const auto frame=pose_frame();
    const auto before_state=current_correction_state();
    const auto before_pose=*app.pose;
    auto kept=app.manual_corrections;
    kept.erase(std::remove_if(kept.begin(),kept.end(),[&](const auto& correction) {
        return !correction.frame_weights.empty()&&
            correction.keyframe_frame_index==frame;
    }),kept.end());
    if(kept.size()==app.manual_corrections.size()) {
        set_status(L"当前帧没有手动关键帧");
        return;
    }
    const auto before_selection=app.selected_keyframes;
    try {
        push_correction_history(app.correction_undo,before_state);
        app.correction_redo.clear();
        app.manual_corrections=std::move(kept);
        app.smoothed_keyframes.erase(std::remove(
            app.smoothed_keyframes.begin(),app.smoothed_keyframes.end(),frame),
            app.smoothed_keyframes.end());
        app.selected_keyframes.erase(std::remove(
            app.selected_keyframes.begin(),app.selected_keyframes.end(),frame),
            app.selected_keyframes.end());
        app.active_curve_correction=-1;
        rebuild_corrected_pose();
        app.motion_dirty=true;
        update_correction_controls();
        set_status(L"已删除当前帧关键帧 · 尚未保存");
    } catch(const std::exception& error) {
        app.manual_corrections=before_state.corrections;
        app.smoothed_keyframes=before_state.smoothed_keyframes;
        app.review=before_state.review;
        app.selected_keyframes=before_selection;
        app.pose=before_pose;
        MessageBoxW(app.window,widen(error.what()).c_str(),
            L"删除关键帧失败",MB_ICONERROR);
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void restore_correction(bool redo) {
    if(!app.pose)return;
    auto& source=redo?app.correction_redo:app.correction_undo;
    auto& destination=redo?app.correction_undo:app.correction_redo;
    if(source.empty())return;
    auto current_pose=*app.pose;
    auto current=current_correction_state();
    auto target=std::move(source.back());
    source.pop_back();
    app.manual_corrections=target.corrections;
    app.smoothed_keyframes=target.smoothed_keyframes;
    app.review=target.review;
    try {
        rebuild_corrected_pose();
        push_correction_history(destination,std::move(current));
        app.motion_dirty=true;
        set_status(redo?L"已重做锚点修正 · 尚未保存":L"已撤销锚点修正 · 尚未保存");
    } catch(const std::exception& error) {
        app.pose=std::move(current_pose);
        app.manual_corrections=std::move(current.corrections);
        app.smoothed_keyframes=std::move(current.smoothed_keyframes);
        app.review=std::move(current.review);
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
        set_status(L"关键帧修正 · 拖动关节创建关键帧；Ctrl+点击关键帧可多选，Ctrl+A 全选后平滑");
    } else if(saving_on_finish) {
        set_status(L"修正已保存并完成 · "+app.motion_path.wstring());
    } else {
        set_status(L"已退出手动修正 · 当前动作没有未保存改动");
    }
    InvalidateRect(app.window,nullptr,FALSE);
}
void review_action(int action) {
    if(!app.pose||app.analyzing||app.dragging_anchor>=0)return;
    app.playing=false;
    const auto before=current_correction_state();
    const auto old_pose=app.pose;
    const auto old_motion=app.motion;
    const auto old_base=app.review_base;
    const auto old_inferred=app.review_inferred;
    auto first=pose_frame(),last=first;
    if(action==kReviewExclude||action==kReviewClear||action==kReviewRebuild) {
        if(const auto range=selected_range()) {
            const auto& frames=app.pose->frames;
            auto a=std::lower_bound(frames.begin(),frames.end(),range->start,[](const auto& f,double t){return f.time_s<t;});
            auto b=std::upper_bound(frames.begin(),frames.end(),range->end,[](double t,const auto& f){return t<f.time_s;});
            if(a==frames.end()||a==b){set_status(L"所选区间没有动作帧");return;}
            first=static_cast<std::size_t>(a-frames.begin());last=static_cast<std::size_t>(b-frames.begin()-1);
        }
    }
    double weight=8;
    if(action==kReviewWeight) {
        HMENU menu=CreatePopupMenu();
        AppendMenuW(menu,MF_STRING,4,L"可信权重 4×");
        AppendMenuW(menu,MF_STRING,8,L"可信权重 8×");
        AppendMenuW(menu,MF_STRING,16,L"可信权重 16×");
        POINT cursor{};GetCursorPos(&cursor);
        const auto choice=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_NONOTIFY,cursor.x,cursor.y,0,app.window,nullptr);
        DestroyMenu(menu);if(!choice)return;weight=choice;
    }
    try {
        if(action==kReviewRebuild) {
            if(first==last)throw animocap::ContractError("Set interval start and end on the timeline; lock this joint at both endpoints");
            app.review.ranges.push_back({first,last,app.review_joint});
        } else {
            // Removing/replacing an endpoint invalidates its previous solve request.
            if(action==kReviewClear||action==kReviewExclude||action==kReviewWeight)
                std::erase_if(app.review.ranges,[&](const auto& r){return r.joint==app.review_joint&&
                    ((r.first>=first&&r.first<=last)||(r.last>=first&&r.last<=last));});
            std::erase_if(app.review.marks,[&](const auto& m){return m.joint==app.review_joint&&m.frame>=first&&m.frame<=last;});
            if(action!=kReviewClear)for(auto f=first;f<=last;++f) {
                const auto trust=action==kReviewExclude?animocap::ReviewTrust::Excluded:
                    action==kReviewWeight?animocap::ReviewTrust::Weighted:animocap::ReviewTrust::Locked;
                app.review.marks.push_back({f,app.review_joint,trust,app.pose->frames[f].joints[app.review_joint],weight});
            }
        }
        rebuild_corrected_pose();
        push_correction_history(app.correction_undo,before);app.correction_redo.clear();
        app.motion_dirty=true;
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        const auto name=joint_display_name(animocap::make_default_skeleton().bones[app.review_joint].semantic);
        set_status(name+L" · 帧 "+std::to_wstring(first)+L"–"+std::to_wstring(last)+
            (action==kReviewRebuild?L" · 区间已重建（推算点为橙色）":
             action==kReviewExclude?L" · 已排除观测；设置两端锁定后重建":
             action==kReviewClear?L" · 已恢复自动观测":
             action==kReviewWeight?L" · 已提高可信权重；重建区间时生效":L" · 已锁定当前姿态"));
    } catch(const std::exception& error) {
        app.review=before.review;app.pose=old_pose;app.motion=old_motion;
        app.review_base=old_base;app.review_inferred=old_inferred;
        MessageBoxW(app.window,widen(error.what()).c_str(),L"局部修复未应用",MB_ICONINFORMATION);
    }
    update_correction_controls();InvalidateRect(app.window,nullptr,FALSE);
}
void open_review_project() {
    if(app.analyzing)return;
    if(app.motion_dirty) {set_status(L"请先保存当前修正，再打开修复工程");return;}
    const auto path=choose(true,L"打开 .areview 修复工程文件夹");if(!path)return;
    try {
        auto [base,review]=animocap::load_pose_review(*path);
        auto repaired=animocap::rebuild_reviewed_pose(base,review);
        auto motion=animocap::reconstruct_canonical_motion(repaired.sequence,
            app.character_profile?&app.character_profile->skeleton:nullptr);
        std::unique_ptr<animocap::VideoDecoder> decoder;
        animocap::VideoFrame video;
        try {
            if(std::filesystem::is_regular_file(base.source_video)) {
                decoder=std::make_unique<animocap::VideoDecoder>();decoder->open(base.source_video);
                decoder->seek(base.frames.front().time_s);
                if(!decoder->read_frame(video))decoder.reset();
            }
        } catch(const std::exception&) {decoder.reset();video={};}
        app.manual_corrections.clear();app.smoothed_keyframes.clear();app.selected_keyframes.clear();
        app.correction_undo.clear();app.correction_redo.clear();
        app.selected_export_frames.clear();app.selecting_export_frames=false;
        app.pose_baseline=base;app.profile_refined_pose=base;app.review_base=base;
        app.review=std::move(review);app.review_inferred=std::move(repaired.inferred);
        app.pose=std::move(repaired.sequence);app.motion=std::move(motion);
        app.comparison_pose.reset();app.review_compare=false;app.playing=false;
        app.time_s=base.frames.front().time_s;app.motion_dirty=false;
        app.multiview_mode=false;app.multiview_overview=false;app.multiview_diagnostics.reset();
        app.npu_review_issues.clear();app.motion_path.clear();reset_range_selection();
        // Do not leave an unrelated clip under the restored pose overlay.
        app.decoder=std::move(decoder);app.video_frame=std::move(video);app.video_path=base.source_video;
        app.video_eof=false;app.calibrating=false;app.dragging_anchor=-1;
        app.multiview_poses={};app.multiview_manifest.clear();app.multiview_videos={};
        app.has_person_frame=false;app.anchor_drag_snapshot.reset();app.active_curve_correction=-1;
        set_status(app.decoder?L"修复工程已打开 · 原视频、标记和区间已恢复":
            L"修复工程已打开 · 原视频不可用，仍可检查和重建动作");
        EnableWindow(GetDlgItem(app.window,kSaveMotion),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportBvh),TRUE);
        EnableWindow(GetDlgItem(app.window,kExportVrma),TRUE);
        update_correction_controls();InvalidateRect(app.window,nullptr,FALSE);
    } catch(const std::exception& error) {
        MessageBoxW(app.window,widen(error.what()).c_str(),L"打开修复工程失败",MB_ICONERROR);
    }
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
        button(window,kMultiview,L"导入多视角");
        button(window,kLoad,L"打开动作");
        button(window,kSaveMotion,L"保存动作");
        EnableWindow(GetDlgItem(window,kSaveMotion),FALSE);
        button(window,kExportBvh,L"导出 BVH");
        EnableWindow(GetDlgItem(window,kExportBvh),FALSE);
        button(window,kExportVrma,L"导出 VRMA");
        EnableWindow(GetDlgItem(window,kExportVrma),FALSE);
        button(window,kSetup,L"推理环境");
        button(window,kVlmSetup,L"配置本地 AI");
        button(window,kExpertInterval,L"辅助 AI · 每 2 帧 ▾");
        button(window,kVlmToggle,L"本地视觉纠错 · 开");
        button(window,kAutoFrame,L"自动识别");
        button(window,kPersonFrame,L"手动框选");
        button(window,kResetFrame,L"重置");
        button(window,kUndoCorrection,L"撤销修正");
        button(window,kRedoCorrection,L"重做修正");
        button(window,kDeleteKeyframe,L"删除当前键");
        EnableWindow(GetDlgItem(window,kDeleteKeyframe),FALSE);
        button(window,kSelectAllKeyframes,L"全选关键帧");
        button(window,kClearKeyframeSelection,L"清除选择");
        button(window,kSmoothKeyframes,L"平滑选中键");
        {
            auto combo=CreateWindowExW(0,L"COMBOBOX",L"",WS_CHILD|WS_VISIBLE|WS_TABSTOP|CBS_DROPDOWNLIST|WS_VSCROLL,
                0,0,0,0,window,reinterpret_cast<HMENU>(static_cast<INT_PTR>(kReviewJoint)),GetModuleHandleW(nullptr),nullptr);
            SendMessageW(combo,WM_SETFONT,reinterpret_cast<WPARAM>(app.font),TRUE);
            for(const auto& bone:animocap::make_default_skeleton().bones)
                SendMessageW(combo,CB_ADDSTRING,0,reinterpret_cast<LPARAM>(joint_display_name(bone.semantic).c_str()));
            SendMessageW(combo,CB_SETCURSEL,app.review_joint,0);
        }
        button(window,kReviewLock,L"锁定此帧");button(window,kReviewWeight,L"可信权重 ▾");
        button(window,kReviewExclude,L"排除此部位");button(window,kReviewClear,L"恢复自动");
        button(window,kReviewRebuild,L"重建区间");button(window,kReviewCompare,L"原始叠影");
        button(window,kReviewOpen,L"打开修复");button(window,kReviewFront,L"正面");button(window,kReviewSide,L"侧面");
        EnableWindow(GetDlgItem(window,kSelectAllKeyframes),FALSE);
        EnableWindow(GetDlgItem(window,kClearKeyframeSelection),FALSE);
        EnableWindow(GetDlgItem(window,kSmoothKeyframes),FALSE);
        button(window,kSelectExportFrames,L"选择导入帧");
        button(window,kSelectAuthoredExportFrames,L"仅选已建关键帧");
        button(window,kClearExportFrames,L"清除导入帧");
        button(window,kExportBlenderSelected,L"导入选中帧到 Blender");
        EnableWindow(GetDlgItem(window,kSelectExportFrames),FALSE);
        EnableWindow(GetDlgItem(window,kSelectAuthoredExportFrames),FALSE);
        EnableWindow(GetDlgItem(window,kClearExportFrames),FALSE);
        EnableWindow(GetDlgItem(window,kExportBlenderSelected),FALSE);
        button(window,kCharacterProfile,L"\u9aa8\u67b6\u53c2\u8003 · \u5bfc\u5165");
        button(window,kAppearanceReference,L"外观参考 · 导入");
        button(window,kAppearanceToggle,L"外观辅助 · 开");
        button(window,kTimelineMode,L"曲线编辑器");
        button(window,kCurvePreset,L"曲线 · 平滑");
        EnableWindow(GetDlgItem(window,kAppearanceToggle),FALSE);
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
        layout(window); update_correction_controls(); return 0;
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
        if(LOWORD(wparam)==kReviewJoint&&HIWORD(wparam)==CBN_SELCHANGE) {
            const auto selected=SendMessageW(GetDlgItem(window,kReviewJoint),CB_GETCURSEL,0,0);
            if(selected>=0)app.review_joint=static_cast<std::size_t>(selected);
            InvalidateRect(window,nullptr,FALSE);return 0;
        }
        if(lparam!=0&&HIWORD(wparam)!=BN_CLICKED)return 0;
        switch(LOWORD(wparam)) {
        case kExpertInterval: {
            if(app.analyzing)return 0;
            HMENU menu=CreatePopupMenu();
            const wchar_t* values[]{L"1",L"2",L"3",L"auto"};
            const wchar_t* labels[]{L"逐帧 · 对照",L"每 2 帧 · 风险时补算",L"每 3 帧 · 风险时补算",L"自动 · 按运动变化调整"};
            for(int i=0;i<4;++i)AppendMenuW(menu,MF_STRING|(app.expert_interval==values[i]?MF_CHECKED:0),i+1,labels[i]);
            RECT button_rect{};GetWindowRect(GetDlgItem(window,kExpertInterval),&button_rect);
            const auto selected=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_NONOTIFY,
                button_rect.left,button_rect.bottom,0,window,nullptr);
            DestroyMenu(menu);
            if(selected>=1&&selected<=4) {
                app.expert_interval=values[selected-1];
                const std::wstring caption=selected==4?L"辅助 AI · 自动 ▾":selected==1?L"辅助 AI · 逐帧 ▾":
                    L"辅助 AI · 每 "+app.expert_interval+L" 帧 ▾";
                SetWindowTextW(GetDlgItem(window,kExpertInterval),caption.c_str());
                set_status(L"已设置下次捕捉的辅助 AI 频率 · 基础动捕和动画仍逐帧 · 风险帧自动加密");
            }
            return 0;
        }
        case kReviewLock:case kReviewWeight:case kReviewExclude:case kReviewClear:case kReviewRebuild:
            review_action(LOWORD(wparam));return 0;
        case kReviewCompare:app.review_compare=!app.review_compare;
            SetWindowTextW(GetDlgItem(window,kReviewCompare),app.review_compare?L"叠影已开":L"原始叠影");
            InvalidateRect(window,nullptr,FALSE);return 0;
        case kReviewOpen:open_review_project();return 0;
        case kReviewFront:app.yaw=0;app.pitch=0;InvalidateRect(window,nullptr,FALSE);return 0;
        case kReviewSide:app.yaw=90;app.pitch=0;InvalidateRect(window,nullptr,FALSE);return 0;
        case kImport: import_video(); return 0;
        case kMultiview: import_multiview(); return 0;
        case kLoad: load_motion(); return 0;
        case kSaveMotion: save_motion_copy(); return 0;
        case kExportBvh: export_bvh_file(); return 0;
        case kExportVrma: export_vrma_file(); return 0;
        case kSelectExportFrames: toggle_export_frame_selection_mode(); return 0;
        case kSelectAuthoredExportFrames: select_authored_frames_for_blender(); return 0;
        case kClearExportFrames: clear_blender_frame_selection(); return 0;
        case kExportBlenderSelected: export_blender_selected_file(); return 0;
        case kSetup: setup_mmpose(); return 0;
        case kVlmSetup: setup_local_vlm(); return 0;
        case kVlmToggle: toggle_local_vlm(); return 0;
        case kAutoFrame: use_auto_person_frame(); return 0;
        case kPersonFrame: begin_person_frame_selection(); return 0;
        case kResetFrame: reset_person_frame(); return 0;
        case kCharacterProfile: import_character_profile(); return 0;
        case kAppearanceReference: import_appearance_reference(); return 0;
        case kAppearanceToggle: toggle_appearance_assist(); return 0;
        case kTimelineMode: toggle_timeline_mode(); return 0;
        case kCurvePreset: cycle_curve_preset(); return 0;
        case kUndoCorrection: restore_correction(false); return 0;
        case kRedoCorrection: restore_correction(true); return 0;
        case kDeleteKeyframe: delete_current_keyframes(); return 0;
        case kSelectAllKeyframes: select_all_keyframes(); return 0;
        case kClearKeyframeSelection: clear_keyframe_selection(); return 0;
        case kSmoothKeyframes: smooth_selected_keyframes(); return 0;
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
        if(control&&wparam=='A') {
            if(app.selecting_export_frames)select_authored_frames_for_blender();
            else select_all_keyframes();
            return 0;
        }
        if(!control&&wparam==VK_SPACE) { toggle_play(); return 0; }
        if(!control&&wparam==VK_LEFT) { step_timeline(shift?-10:-1); return 0; }
        if(!control&&wparam==VK_RIGHT) { step_timeline(shift?10:1); return 0; }
        if(!control&&wparam=='I') { set_range_boundary(true); return 0; }
        if(!control&&wparam=='O') { set_range_boundary(false); return 0; }
        if(!control&&wparam=='L') { toggle_range_loop(); return 0; }
        if(!control&&wparam==VK_DELETE) { delete_current_keyframes(); return 0; }
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
                        app.video_eof=false;
                        // Playback must remain sequential. Per-frame seeking made
                        // post-capture multiview review stutter badly; only explicit
                        // scrubs, loops, and view switches seek.
                        app.time_s=has_multiview_review()
                            ?review_reference_time(app.video_frame.time_s)
                            :app.video_frame.time_s;
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
                        app.video_eof=true;
                        app.time_s=playback_range().end;
                        update_timeline();
                        stop_playback();
                        InvalidateRect(window,nullptr,FALSE);
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
        EnableWindow(GetDlgItem(window,kExpertInterval),TRUE);
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
        EnableWindow(GetDlgItem(window,kAppearanceReference),TRUE);
        EnableWindow(GetDlgItem(window,kAppearanceToggle),
            !app.appearance_reference_path.empty());
        EnableWindow(GetDlgItem(window,kExportBvh),app.motion.has_value());
        EnableWindow(GetDlgItem(window,kExportVrma),app.motion.has_value());
        EnableWindow(GetDlgItem(window,kSaveMotion),app.motion.has_value());
        update_blender_selection_controls();
        if(result->cancelled) {
            set_status(L"动作捕捉已取消 · 中间结果已保留");
        } else if (!result->error.empty()) {
            set_status(L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25 \u00b7 \u4e2d\u95f4\u4ea7\u7269\u5df2\u4fdd\u7559");
            MessageBoxW(window,result->error.c_str(),L"\u52a8\u4f5c\u6355\u6349\u5931\u8d25",MB_ICONERROR);
        } else {
            reset_range_selection();
            app.pose_baseline=std::move(result->pose_baseline);
            app.comparison_pose=std::move(result->comparison_pose);
            app.pose=std::move(result->pose);
            app.profile_refined_pose=app.pose;
            app.optimization_diagnostics=std::move(result->optimization_diagnostics);
            if(app.character_profile&&app.optimization_diagnostics)
                SetWindowTextW(GetDlgItem(window,kCharacterProfile),
                    (L"\u52a8\u753b\u89d2\u8272\u53c2\u8003 \u00b7 "+
                     profile_effect_summary(*app.optimization_diagnostics)).c_str());
            app.anchor_drag_snapshot.reset();
            app.manual_corrections.clear();
        app.review={}; app.review_inferred.clear(); app.review_base.reset(); app.review_compare=false;
            app.correction_undo.clear(); app.correction_redo.clear();
            app.selected_keyframes.clear(); app.smoothed_keyframes.clear();
            app.selected_export_frames.clear(); app.selecting_export_frames=false;
            app.active_curve_correction=-1;
            update_correction_controls();
            app.motion=std::move(result->motion);
            update_blender_selection_controls();
            EnableWindow(GetDlgItem(window,kExportBvh),TRUE);
            EnableWindow(GetDlgItem(window,kExportVrma),TRUE);
            EnableWindow(GetDlgItem(window,kSaveMotion),TRUE);
            app.motion_dirty=result->motion_dirty;
              app.motion_path=std::move(result->motion_path);
	              app.multiview_diagnostics=std::move(result->diagnostics);
	              app.multiview_poses=std::move(result->per_view_poses);
	              app.npu_review_issues=std::move(result->npu_review_issues);
	              if(app.multiview_mode) {
	                  const auto reference=multiview_reference_view();
	                  app.multiview_review_view=reference;
                  const bool review_ready=app.multiview_poses[reference].has_value();
                  EnableWindow(GetDlgItem(window,kResetFrame),review_ready);
	                  if(review_ready) {
	                      select_multiview_review(reference);
	                      app.multiview_overview=true;
	                      // Start oblique: a frontal projection hides the depth
	                      // contributed by side cameras.
	                      app.yaw=32.0;
	                      app.pitch=-6.0;
	                      SetWindowTextW(GetDlgItem(window,kResetFrame),L"返回当前视角");
	                      for(auto& issue:app.npu_review_issues)
	                          issue.reference_time_s=reference_time_from_source_frame(
	                              issue.view_index,static_cast<double>(issue.frame_index));
	                  } else SetWindowTextW(GetDlgItem(window,kResetFrame),L"重置");
	              }
	              if(result->recovered_motion) {
	                  set_status(L"\u6355\u6349\u6838\u5fc3\u52a8\u4f5c\u5df2\u6062\u590d \u00b7 \u540e\u5904\u7406\u672a\u5b8c\u6210 \u00b7 \u539f\u59cb\u5305\u53ef\u7528");
	                  MessageBoxW(window,result->warning.c_str(),
	                      L"\u52a8\u4f5c\u5df2\u6062\u590d",MB_ICONWARNING);
	              } else if(app.multiview_diagnostics) {
	                  const auto before=app.multiview_diagnostics->jitter_before_curve;
	                  const auto after=app.multiview_diagnostics->jitter_after_curve;
	                  const int jitter_reduction=before>0.0
	                      ?static_cast<int>(std::lround(
	                          std::clamp(1.0-after/before,0.0,1.0)*100.0)):0;
	                  set_status(L"多视角联合求解完成 · 恢复 "+
	                      std::to_wstring(app.multiview_diagnostics->recovered_observations)+
	                    L" 个遮挡观测 · 剔除 "+
		                      std::to_wstring(app.multiview_diagnostics->rejected_view_observations)+
		                    L" 个离群视角观测 · 可见性降权 "+
		                      std::to_wstring(app.multiview_diagnostics->
		                          visibility_downweighted_observations)+
		                    L" / 增强 "+std::to_wstring(app.multiview_diagnostics->
		                          visibility_boosted_observations)+L" · 曲线修正 "+
	                      std::to_wstring(app.multiview_diagnostics->curve_corrected_samples)+
		                    L" 个样本（抖动指标 -"+
		                      std::to_wstring(jitter_reduction)+L"%，含高置信度微抖 "+
		                      std::to_wstring(app.multiview_diagnostics->
		                          curve_high_confidence_jitter_corrected_samples)+L"） · "+
	                      std::to_wstring(app.multiview_diagnostics->conflicts.size())+
	                      L" 个跨视角冲突待检查");
		                  if(app.multiview_diagnostics->
		                         reference_anchor_suppressed_conflicts>0)
		                      append_status(L" \u00b7 \u4e89\u8bae\u5173\u8282\u89e3\u9664\u6b63\u9762\u9501\u5b9a "+
		                          std::to_wstring(app.multiview_diagnostics->
		                              reference_anchor_suppressed_conflicts));
		                  if(app.multiview_diagnostics->
		                         temporal_outlier_downweighted_observations>0)
		                      append_status(L" \u00b7 \u72ec\u7acb\u89c6\u89d2\u5c16\u5cf0\u964d\u6743 "+
		                          std::to_wstring(app.multiview_diagnostics->
		                              temporal_outlier_downweighted_observations));
		                  if(app.character_profile&&app.optimization_diagnostics)
		                      append_status(L" \u00b7 \u89d2\u8272\u53c2\u8003: "+
		                          profile_effect_summary(*app.optimization_diagnostics));
	              } else if(!result->warning.empty())
                  set_status(L"捕捉完成 · "+result->warning);
            else if(app.character_profile&&app.optimization_diagnostics)
                set_status(L"\u6355\u6349\u5b8c\u6210 \u00b7 \u52a8\u753b\u89d2\u8272\u53c2\u8003: "+
                    profile_effect_summary(*app.optimization_diagnostics));
            else if(app.pose&&app.pose->backend.find("qwen3-vl-local")!=std::string::npos)
                set_status(L"捕捉完成 · HRNet、光流、本地视觉纠错和时序平滑已应用");
            else
                set_status(L"捕捉完成 · HRNet、光流和时序平滑已应用");
            if(app.appearance_assist_enabled&&!app.appearance_reference_path.empty()&&
               result->warning.empty())
                append_status(L" · 外观参考已参与低置信度复核");
            bool evidence_calibrated=app.pose&&app.pose->backend.find(
                "confidence-calibration-evidence-backed")!=std::string::npos;
            for(const auto& per_view:app.multiview_poses)
                if(per_view&&per_view->backend.find(
                       "confidence-calibration-evidence-backed")!=std::string::npos)
                    evidence_calibrated=true;
            append_status(evidence_calibrated
                ?L" \u00b7 \u6a21\u578b\u7f6e\u4fe1\u5ea6: \u6807\u6ce8\u4fdd\u6301\u96c6\u5df2\u6821\u51c6"
                :L" \u00b7 \u6a21\u578b\u7f6e\u4fe1\u5ea6: identity\uff08\u7f3a\u5c11\u6807\u6ce8\u4fdd\u6301\u96c6\uff09");
            if(result->npu_shadow_active) {
                const int sample_percent=result->npu_total_frames
                    ?static_cast<int>(std::lround(
                        100.0*result->npu_sampled_frames/result->npu_total_frames))
                    :0;
                append_status(L" · Intel NPU 风险巡检 "+
                    std::to_wstring(result->npu_sampled_frames)+L"/"+
                    std::to_wstring(result->npu_total_frames)+L"（"+
                    std::to_wstring(sample_percent)+L"%） · 标记 "+
                    std::to_wstring(app.npu_review_issues.size())+L" 个待复核帧");
                if(result->npu_reprocess_requested>0)
                    append_status(L" \u00b7 NPU\u89e6\u53d1GPU/VLM\u91cd\u7b97 "+
                        std::to_wstring(result->npu_reprocess_processed)+L"/"+
                        std::to_wstring(result->npu_reprocess_requested)+
                        L" \u00b7 \u63a5\u53d7\u5173\u8282\u4fee\u6b63 "+
                        std::to_wstring(result->npu_reprocess_accepted)+
                        (result->npu_reprocess_unavailable_views>0
                            ?L" \u00b7 \u672c\u5730\u6062\u590d\u90e8\u5206\u4e0d\u53ef\u7528"
                            :L""));
            }
            InvalidateRect(window,nullptr,TRUE);
        }
        if(close_after_analysis)PostMessageW(window,WM_CLOSE,0,0);
        return 0;
    }
    case WM_CTLCOLORSTATIC:
        if(reinterpret_cast<HWND>(lparam)==GetDlgItem(window,kReviewJoint)) {
            auto dc=reinterpret_cast<HDC>(wparam);
            SetTextColor(dc,theme::text);SetBkColor(dc,theme::surface);
            return reinterpret_cast<LRESULT>(app.panel_brush);
        }
        if (reinterpret_cast<HWND>(lparam)==app.status) {
            auto dc=reinterpret_cast<HDC>(wparam);
            SetTextColor(dc,theme::text_muted);
            SetBkColor(dc,theme::background);
            return reinterpret_cast<LRESULT>(app.panel_brush);
        } break;
    case WM_CTLCOLORLISTBOX: {
        auto dc=reinterpret_cast<HDC>(wparam);
        SetTextColor(dc,theme::text);SetBkColor(dc,theme::surface);
        return reinterpret_cast<LRESULT>(app.panel_brush);
    }
    case WM_LBUTTONDOWN: {
        POINT point{GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)};
        const auto video_rect=video_area();
        if(app.multiview_overview&&PtInRect(&video_rect,point)) {
            const auto cells=multiview_preview_cells(video_rect);
            for(std::size_t index=0;index<cells.size();++index) {
                if(PtInRect(&cells[index],point)&&
                   !app.multiview_videos[index].empty()&&app.multiview_poses[index]) {
                    select_multiview_review(index);
                    return 0;
                }
            }
        }
        if (begin_person_frame_drag(point)) return 0;
        if (begin_anchor_drag(point)) return 0;
        if(app.timeline_mode==TimelineMode::CurveEditor&&!app.selecting_export_frames) {
            begin_curve_handle_drag(point);
            if(app.dragging_curve_handle)return 0;
        }
        const bool control=(GetKeyState(VK_CONTROL)&0x8000)!=0;
        const bool shift=(GetKeyState(VK_SHIFT)&0x8000)!=0;
        if(app.selecting_export_frames) {
            if(const auto time=timeline_time_from_point(point)) {
                select_blender_frame_at_time(*time,control,shift);
                return 0;
            }
        }
        const auto keyframe=app.timeline_mode==TimelineMode::CurveEditor
            ?curve_keyframe_from_point(point):keyframe_from_point(point);
        if(keyframe) {
            if(control) {
                toggle_keyframe_selection(*keyframe);
            } else {
                app.selected_keyframes={*keyframe};
                for(std::size_t index=0;index<app.manual_corrections.size();++index)
                    if(!app.manual_corrections[index].frame_weights.empty()&&
                       app.manual_corrections[index].keyframe_frame_index==*keyframe) {
                        app.active_curve_correction=static_cast<int>(index);break;
                    }
                if(app.pose&&*keyframe<app.pose->frames.size()) {
                    app.time_s=app.pose->frames[*keyframe].time_s;
                    update_timeline();
                }
                update_correction_controls();
                InvalidateRect(window,nullptr,FALSE);
            }
            return 0;
        }
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
            double nearest=18;
            std::optional<std::size_t> hit;
            for(const auto& [p,joint]:app.review_hit_points) {
                const double distance=std::hypot(static_cast<double>(point.x-p.x),static_cast<double>(point.y-p.y));
                if(distance<nearest) {nearest=distance;hit=joint;}
            }
            if(hit&&!app.analyzing) {
                app.review_joint=*hit;
                SendMessageW(GetDlgItem(window,kReviewJoint),CB_SETCURSEL,*hit,0);
                InvalidateRect(window,nullptr,FALSE);return 0;
            }
            app.rotating=true; app.last_mouse=point; SetCapture(window);
        } return 0;
    }
    case WM_MOUSEMOVE:
        if (app.drawing_person_frame) {
            move_person_frame({GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)});
            return 0;
        }
        if(app.dragging_curve_handle) {
            move_curve_handle({GET_X_LPARAM(lparam),GET_Y_LPARAM(lparam)});
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
        if(app.dragging_curve_handle) { finish_curve_handle_drag(); return 0; }
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
        release_human_reference_bitmap();
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
        } else if(std::wstring_view(arguments[index])==L"--appearance-reference") {
            app.appearance_reference_path=std::filesystem::path(arguments[++index]);
            app.appearance_assist_enabled=true;
            SetWindowTextW(GetDlgItem(window,kAppearanceReference),L"外观参考 · 已载入");
            EnableWindow(GetDlgItem(window,kAppearanceToggle),TRUE);
        }
    }
    for (int index = 1; arguments && index + 1 < argument_count; ++index) {
        if(std::wstring_view(arguments[index])==L"--character-profile") {
            ++index;
        } else if(std::wstring_view(arguments[index])==L"--appearance-reference") {
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
        app.review={}; app.review_inferred.clear(); app.review_base.reset(); app.review_compare=false;
                app.correction_undo.clear(); app.correction_redo.clear();
                app.selected_keyframes.clear(); app.smoothed_keyframes.clear();
                app.selected_export_frames.clear(); app.selecting_export_frames=false;
                app.active_curve_correction=-1;
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
                update_blender_selection_controls();
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

