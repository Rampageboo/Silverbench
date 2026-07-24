from __future__ import annotations

import base64
import json
import shutil
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic
from .batch_crop import batch_crop_files, batch_crop_images
from .classification_dataset import create_class_folder, move_images_to_class, move_val_back_to_train
from .duplicate_images import delete_images, duplicate_images, find_duplicate_images
from .job_store import JobStore
from .mask_noise import export_folder as mask_noise_export_folder
from .mask_noise import preview_base64 as mask_noise_preview_base64
from .mask_noise import save_one as mask_noise_save_one
from .mask_noise import save_temp_image as mask_noise_save_temp_image
from .mask_noise import settings_from_json as mask_noise_settings_from_json
from .image_safety import open_image_checked
from .path_access import PathAccess
from .pt_safety import assert_safe_pt_file
from .ui_orchestrator_predictions import build_predictions
from .ui_orchestrator_store import load_ui_map, save_ui_map
from .torch_runtime import torch_runtime_info
from .video_screenshot import capture_video_screenshot_jobs, capture_video_screenshots, find_videos, frame_base64, save_video_frame, video_info, videos_json
from .yolo_classifier import classify_dataset_images, model_info
from .yolo_prep import (
    ensure_data_yaml,
    move_detect_val_back_to_train,
    move_pairs_to_val,
    prepare_classification_validation_split,
    prepare_validation_split,
)
from .yolo_pt_classifier import classify_folder_with_pt, classify_image_with_pt
from .yolo_pt_detector import detect_folder_with_pt, detect_image_with_pt
from .yolo_pt_model_info import pt_model_info
from .image_preview import image_scaled_jpeg_base64
from .image_pool import image_pool_thumbnail_base64, mark_image_pool_seen, scan_image_pool
from .media_import import import_media_files, list_workspace_videos
from .metadata_assign import (
    _workspace_clf_out,
    build_workspace_links,
    get_workspace_classes,
    list_clf_dataset_classes,
    read_metadata_rows,
    remove_clf_dataset_links,
    remove_detect_dataset_links,
    upsert_metadata_rows,
)
from .image_pool_backup import (
    ensure_image_pool_backup,
    ensure_image_pool_label_backup,
    image_pool_backup_stats,
    restore_image_pool_backup,
)
from .image_pool_cleanup import (
    clear_image_pool_duplicates,
    delete_pool_image_completely,
    find_image_pool_duplicates,
)
from .yolo_workspace import (
    infer_dataset_task,
    create_workspace,
    init_stats_payload,
    is_workspace_root,
    list_dataset_files,
    list_workspace_files,
    load_workspace_config,
    looks_like_workspace,
    parse_class_names,
    read_app_settings,
    read_workspace_session,
    resolve_open_folder,
    workspace_info,
    write_app_settings,
    write_workspace_session,
    workspace_meta_dir,
)
from .workspace_snapshot_versions import (
    create_snapshot_version,
    initialize_snapshot_versioning,
    read_snapshot_versions,
    resolve_active_version_path,
    set_active_snapshot_version,
)
from .yolo_tracker import track_yolo_forward_from_json


_PT_JOB_TTL_SECONDS = 10 * 60
_MAX_RETAINED_PT_JOBS = 64


class BackendService:
    def __init__(
        self,
        path_access: PathAccess,
        session_dir: Path,
        session_file: Path,
        *,
        app_settings_dir: Path | None = None,
        choose_directory: Callable[[str], str] | None = None,
        choose_image_file: Callable[[str], str] | None = None,
        choose_image_files: Callable[[str], list[Path]] | None = None,
        choose_media_files: Callable[[str], list[Path]] | None = None,
        choose_classifier_model: Callable[[str], str] | None = None,
        choose_train_model_file: Callable[[str], str] | None = None,
        choose_video_files: Callable[[str], list[Path]] | None = None,
        open_directory: Callable[[Path], bool] | None = None,
    ) -> None:
        self.path_access = path_access
        self.session_dir = session_dir
        self.session_file = session_file
        self.app_settings_dir = app_settings_dir or session_dir
        self.choose_directory = choose_directory
        self.choose_image_file = choose_image_file
        self.choose_image_files = choose_image_files
        self.choose_media_files = choose_media_files
        self.choose_classifier_model = choose_classifier_model
        self.choose_train_model_file = choose_train_model_file
        self.choose_video_files = choose_video_files
        self.open_directory_callback = open_directory
        self._capture_jobs = JobStore(not_found_message="Capture job not found.")
        self._pt_jobs = JobStore(
            not_found_message="PT job not found.",
            ttl_seconds=_PT_JOB_TTL_SECONDS,
            max_retained=_MAX_RETAINED_PT_JOBS,
        )
        self._build_jobs = JobStore(not_found_message="Build job not found.")
        self._auto_label_model_lock = threading.Lock()
        self._handlers = self._build_handlers()

    def _build_handlers(self) -> dict[str, Callable[[list[Any]], object]]:
        return {
            "ping": self._handle_ping,
            "torchRuntimeInfo": self._handle_torchRuntimeInfo,
            "chooseDirectory": self._handle_chooseDirectory,
            "chooseImageFile": self._handle_chooseImageFile,
            "chooseImageFiles": self._handle_chooseImageFiles,
            "chooseMediaFiles": self._handle_chooseMediaFiles,
            "chooseClassifierModel": self._handle_chooseClassifierModel,
            "chooseTrainModelFile": self._handle_chooseTrainModelFile,
            "chooseVideoFiles": self._handle_chooseVideoFiles,
            "chooseVideoFolder": self._handle_chooseVideoFolder,
            "listWorkspaceVideos": self._handle_listWorkspaceVideos,
            "videosFromPaths": self._handle_videosFromPaths,
            "getVideoInfo": self._handle_getVideoInfo,
            "getVideoFrameBase64": self._handle_getVideoFrameBase64,
            "saveVideoFrame": self._handle_saveVideoFrame,
            "captureVideoScreenshots": self._handle_captureVideoScreenshots,
            "captureVideoScreenshotJobs": self._handle_captureVideoScreenshotJobs,
            "startCaptureVideoScreenshotJobs": self._handle_startCaptureVideoScreenshotJobs,
            "getCaptureVideoScreenshotJob": self._handle_getCaptureVideoScreenshotJob,
            "cancelCaptureVideoScreenshotJob": self._handle_cancelCaptureVideoScreenshotJob,
            "writeBase64File": self._handle_writeBase64File,
            "readImageFileBase64": self._handle_readImageFileBase64,
            "openDirectory": self._handle_openDirectory,
            "listDatasetFiles": self._handle_listDatasetFiles,
            "readTextFile": self._handle_readTextFile,
            "readLabelTextsBatch": self._handle_readLabelTextsBatch,
            "writeTextFile": self._handle_writeTextFile,
            "readFileBase64": self._handle_readFileBase64,
            "readFilePreviewBase64": self._handle_readFilePreviewBase64,
            "writeFileBase64": self._handle_writeFileBase64,
            "readAppSettings": self._handle_readAppSettings,
            "writeAppSettings": self._handle_writeAppSettings,
            "loadUiMap": self._handle_loadUiMap,
            "saveUiMap": self._handle_saveUiMap,
            "runReferencePredictions": self._handle_runReferencePredictions,
            "openFolder": self._handle_openFolder,
            "createWorkspace": self._handle_createWorkspace,
            "readSnapshotVersions": self._handle_readSnapshotVersions,
            "initializeSnapshotVersioning": self._handle_initializeSnapshotVersioning,
            "createSnapshotVersion": self._handle_createSnapshotVersion,
            "setActiveSnapshotVersion": self._handle_setActiveSnapshotVersion,
            "resolveActiveSnapshotWorkspacePath": self._handle_resolveActiveSnapshotWorkspacePath,
            "getWorkspaceInfo": self._handle_getWorkspaceInfo,
            "listWorkspaceFiles": self._handle_listWorkspaceFiles,
            "scanImagePool": self._handle_scanImagePool,
            "importMediaFiles": self._handle_importMediaFiles,
            "markImagePoolSeen": self._handle_markImagePoolSeen,
            "readMetadataRows": self._handle_readMetadataRows,
            "listClfDatasetClasses": self._handle_listClfDatasetClasses,
            "upsertMetadataRows": self._handle_upsertMetadataRows,
            "getWorkspaceClasses": self._handle_getWorkspaceClasses,
            "buildYoloLinks": self._handle_buildYoloLinks,
            "startBuildYoloLinks": self._handle_startBuildYoloLinks,
            "getBuildJob": self._handle_getBuildJob,
            "removeDetectDatasetLinks": self._handle_removeDetectDatasetLinks,
            "removeClfDatasetLinks": self._handle_removeClfDatasetLinks,
            "readImagePoolThumb": self._handle_readImagePoolThumb,
            "ensureImagePoolBackup": self._handle_ensureImagePoolBackup,
            "ensureImagePoolLabelBackup": self._handle_ensureImagePoolLabelBackup,
            "restoreImagePoolBackup": self._handle_restoreImagePoolBackup,
            "getImagePoolBackupStats": self._handle_getImagePoolBackupStats,
            "findImagePoolDuplicates": self._handle_findImagePoolDuplicates,
            "clearImagePoolDuplicates": self._handle_clearImagePoolDuplicates,
            "deletePoolImageCompletely": self._handle_deletePoolImageCompletely,
            "readWorkspaceSession": self._handle_readWorkspaceSession,
            "writeWorkspaceSession": self._handle_writeWorkspaceSession,
            "readSessionFile": self._handle_readSessionFile,
            "writeSessionFile": self._handle_writeSessionFile,
            "saveMaskNoiseTempImage": self._handle_saveMaskNoiseTempImage,
            "maskNoisePreview": self._handle_maskNoisePreview,
            "maskNoiseSaveOne": self._handle_maskNoiseSaveOne,
            "maskNoiseExportFolder": self._handle_maskNoiseExportFolder,
            "prepareValidationSplit": self._handle_prepareValidationSplit,
            "prepareClassificationValidationSplit": self._handle_prepareClassificationValidationSplit,
            "movePairsToVal": self._handle_movePairsToVal,
            "ensureDataYaml": self._handle_ensureDataYaml,
            "findDuplicateImages": self._handle_findDuplicateImages,
            "duplicateImages": self._handle_duplicateImages,
            "deleteImages": self._handle_deleteImages,
            "batchCropImages": self._handle_batchCropImages,
            "batchCropFiles": self._handle_batchCropFiles,
            "createClassFolder": self._handle_createClassFolder,
            "moveValBackToTrain": self._handle_moveValBackToTrain,
            "inferDatasetTask": self._handle_inferDatasetTask,
            "moveImagesToClass": self._handle_moveImagesToClass,
            "classifierModelInfo": self._handle_classifierModelInfo,
            "ptModelInfo": self._handle_ptModelInfo,
            "classifyDatasetImages": self._handle_classifyDatasetImages,
            "classifyFolderWithPt": self._handle_classifyFolderWithPt,
            "detectFolderWithPt": self._handle_detectFolderWithPt,
            "startClassifyFolderWithPt": self._handle_startClassifyFolderWithPt,
            "startDetectFolderWithPt": self._handle_startDetectFolderWithPt,
            "startClassifyImageWithPt": self._handle_startClassifyImageWithPt,
            "startDetectImageWithPt": self._handle_startDetectImageWithPt,
            "classifyImageWithPt": self._handle_classifyImageWithPt,
            "detectImageWithPt": self._handle_detectImageWithPt,
            "classifyImageBase64WithPt": self._handle_classifyImageBase64WithPt,
            "detectImageBase64WithPt": self._handle_detectImageBase64WithPt,
            "getPtJob": self._handle_getPtJob,
            "cancelPtJob": self._handle_cancelPtJob,
            "readAutoLabelModelRegistry": self._handle_readAutoLabelModelRegistry,
            "importAutoLabelModel": self._handle_importAutoLabelModel,
            "trackYoloForward": self._handle_trackYoloForward,
            "copyModelToWorkspace": self._handle_copyModelToWorkspace,
        }

    def call(self, method: str, args: list[Any]) -> object:
        handler = self._handlers.get(method)
        if handler is None:
            raise ValueError(f"Unknown API method: {method}")
        return handler(args)

    def api_methods(self) -> frozenset[str]:
        return frozenset(self._handlers)

    def _handle_ping(self, args: list[Any]) -> object:
        return "python-backend-ready"

    def _handle_torchRuntimeInfo(self, args: list[Any]) -> object:
            return json.dumps(torch_runtime_info(), ensure_ascii=False)

    def _handle_chooseDirectory(self, args: list[Any]) -> object:
            return self._choose_directory(args[0] if args else "Choose Folder")

    def _handle_chooseImageFile(self, args: list[Any]) -> object:
            return self._choose_image_file(args[0] if args else "Choose Image")

    def _handle_chooseImageFiles(self, args: list[Any]) -> object:
            return self._choose_image_files(args[0] if args else "Choose Images")

    def _handle_chooseMediaFiles(self, args: list[Any]) -> object:
            return self._choose_media_files(args[0] if args else "Choose Media")

    def _handle_chooseClassifierModel(self, args: list[Any]) -> object:
            return self._choose_classifier_model(args[0] if args else "Choose ONNX Classifier")

    def _handle_chooseTrainModelFile(self, args: list[Any]) -> object:
            return self._choose_train_model_file(args[0] if args else "Choose YOLO Model")

    def _handle_chooseVideoFiles(self, args: list[Any]) -> object:
            return self._choose_video_files(args[0] if args else "Choose Videos")

    def _handle_chooseVideoFolder(self, args: list[Any]) -> object:
            folder = self._choose_directory(args[0] if args else "Choose Video Folder")
            return videos_json(find_videos(self.path_access.require_path(folder))) if folder else "[]"

    def _handle_listWorkspaceVideos(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(list_workspace_videos(Path(root)), ensure_ascii=False)

    def _handle_videosFromPaths(self, args: list[Any]) -> object:
            paths = [self.path_access.remember_parent(path) for path in json.loads(args[0] or "[]")]
            return videos_json(paths)

    def _handle_getVideoInfo(self, args: list[Any]) -> object:
            return json.dumps(video_info(self.path_access.require_path(args[0])), ensure_ascii=False)

    def _handle_getVideoFrameBase64(self, args: list[Any]) -> object:
            try:
                return frame_base64(
                    self.path_access.require_path(args[0]),
                    float(args[1]),
                    args[2] if len(args) > 2 else "jpg",
                    int(args[3]) if len(args) > 3 else 0,
                    int(args[4]) if len(args) > 4 else 72,
                )
            except ValueError:
                return ""

    def _handle_saveVideoFrame(self, args: list[Any]) -> object:
            return save_video_frame(
                self.path_access.require_path(args[0]),
                self.path_access.require_path(args[1]),
                float(args[2]),
                str(args[3]) if len(args) > 3 else "",
                str(args[4]) if len(args) > 4 else "jpg",
            )

    def _handle_captureVideoScreenshots(self, args: list[Any]) -> object:
            return json.dumps(
                capture_video_screenshots(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    json.loads(args[2] or "[]"),
                    float(args[3]),
                    str(args[4]) if len(args) > 4 else "",
                    str(args[5]) if len(args) > 5 else "jpg",
                ),
                ensure_ascii=False,
            )

    def _handle_captureVideoScreenshotJobs(self, args: list[Any]) -> object:
            jobs = json.loads(args[0] or "[]")
            for job in jobs:
                job["path"] = str(self.path_access.require_path(job.get("path") or ""))
            return json.dumps(
                capture_video_screenshot_jobs(
                    jobs,
                    self.path_access.require_path(args[1]),
                    float(args[2]),
                    str(args[3]) if len(args) > 3 else "",
                    str(args[4]) if len(args) > 4 else "jpg",
                ),
                ensure_ascii=False,
            )

    def _handle_startCaptureVideoScreenshotJobs(self, args: list[Any]) -> object:
            return json.dumps(self._start_capture_video_screenshot_jobs(args), ensure_ascii=False)

    def _handle_getCaptureVideoScreenshotJob(self, args: list[Any]) -> object:
            return json.dumps(self._capture_job_snapshot(str(args[0])), ensure_ascii=False)

    def _handle_cancelCaptureVideoScreenshotJob(self, args: list[Any]) -> object:
            return json.dumps(self._cancel_capture_job(str(args[0])), ensure_ascii=False)

    def _handle_writeBase64File(self, args: list[Any]) -> object:
            target = self._unique_path(self.path_access.require_path(args[0]))
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(base64.b64decode(args[1]))
            return str(target)

    def _handle_readImageFileBase64(self, args: list[Any]) -> object:
            path = self.path_access.require_path(args[0])
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
                raise ValueError("Only image files can be previewed.")
            return base64.b64encode(path.read_bytes()).decode("ascii")

    def _handle_openDirectory(self, args: list[Any]) -> object:
            path = self.path_access.require_path(args[0])
            if not path.exists():
                return False
            if not self.open_directory_callback:
                raise RuntimeError("Open directory is not available in this backend.")
            return self.open_directory_callback(path)

    def _handle_listDatasetFiles(self, args: list[Any]) -> object:
            root_path = Path(self.path_access.remember_parent(str(args[0])))
            return json.dumps(list_dataset_files(root_path), ensure_ascii=False)

    def _handle_readTextFile(self, args: list[Any]) -> object:
            return self.path_access.safe_child_path(args[0], args[1]).read_text(encoding="utf-8", errors="replace")

    def _handle_readLabelTextsBatch(self, args: list[Any]) -> object:
            root_path = self.path_access.require_path(args[0])
            if not root_path.is_dir():
                return "{}"
            labels: dict[str, str] = {}
            for relative_path in json.loads(args[1] or "[]"):
                if not relative_path or not isinstance(relative_path, str):
                    continue
                try:
                    path = self.path_access.safe_child_path(args[0], relative_path)
                    labels[relative_path] = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
                except (OSError, ValueError):
                    labels[relative_path] = ""
            return json.dumps(labels, ensure_ascii=False)

    def _handle_trackYoloForward(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return track_yolo_forward_from_json(
                root,
                str(args[1]),
                str(args[2] if len(args) > 2 else "{}"),
                str(args[3] if len(args) > 3 else "[]"),
                str(args[4] if len(args) > 4 else "{}"),
            )

    def _handle_writeTextFile(self, args: list[Any]) -> object:
            path = self.path_access.safe_child_path(args[0], args[1])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(args[2], encoding="utf-8")
            return True

    def _handle_readFileBase64(self, args: list[Any]) -> object:
            path = self.path_access.safe_child_path(args[0], args[1])
            if not path.is_file():
                raise FileNotFoundError(path)
            try:
                return base64.b64encode(path.read_bytes()).decode("ascii")
            except OSError as error:
                raise FileNotFoundError(path) from error

    def _handle_readFilePreviewBase64(self, args: list[Any]) -> object:
            path = self.path_access.safe_child_path(args[0], args[1])
            if not path.is_file():
                raise FileNotFoundError(path)
            max_edge = int(args[2]) if len(args) > 2 else 1280
            quality = int(args[3]) if len(args) > 3 else 70
            try:
                return image_scaled_jpeg_base64(path, max_edge=max_edge, quality=quality)
            except OSError as error:
                raise FileNotFoundError(path) from error

    def _handle_writeFileBase64(self, args: list[Any]) -> object:
            path = self.path_access.safe_child_path(args[0], args[1])
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(base64.b64decode(args[2]))
            return True

    def _handle_readAppSettings(self, args: list[Any]) -> object:
            return json.dumps(read_app_settings(self.app_settings_dir), ensure_ascii=False)

    def _handle_writeAppSettings(self, args: list[Any]) -> object:
            payload = args[0] if args else {}
            if isinstance(payload, str):
                settings = json.loads(payload or "{}")
            elif isinstance(payload, dict):
                settings = payload
            else:
                settings = {}
            write_app_settings(self.app_settings_dir, settings)
            return True

    def _handle_loadUiMap(self, args: list[Any]) -> object:
            if len(args) != 1:
                raise ValueError("loadUiMap expects positional args [name].")
            return load_ui_map(str(args[0]))

    def _handle_saveUiMap(self, args: list[Any]) -> object:
            if len(args) != 2:
                raise ValueError("saveUiMap expects positional args [name, doc].")
            return save_ui_map(str(args[0]), args[1])

    def _handle_runReferencePredictions(self, args: list[Any]) -> object:
            # args: [imagePath, detModelPath|None, clfModelPath|None, options?]
            try:
                image_arg = args[0] if args else None
                det_model = args[1] if len(args) > 1 else None
                clf_model = args[2] if len(args) > 2 else None
                options = args[3] if len(args) > 3 and isinstance(args[3], dict) else {}
                if not image_arg:
                    raise ValueError("A reference image path is required.")
                if not det_model and not clf_model:
                    raise ValueError("Choose a detector and/or classifier model.")

                image_path = self.path_access.require_path(image_arg)
                image_size = int(options.get("imageSize") or 0)
                confidence = float(options.get("confidence") or 0.25)
                device = str(options.get("device") or "0")

                # image_safety: open + size-check the reference frame, and read (w, h).
                image = open_image_checked(Path(image_path))
                try:
                    width, height = image.size
                finally:
                    close = getattr(image, "close", None)
                    if callable(close):
                        close()

                raw_det = None
                if det_model:
                    det_path = self.path_access.require_path(det_model)
                    assert_safe_pt_file(Path(det_path))
                    raw_det = detect_image_with_pt(
                        Path(det_path), Path(image_path), image_size or 640, confidence, device
                    )

                raw_clf = None
                if clf_model:
                    clf_path = self.path_access.require_path(clf_model)
                    assert_safe_pt_file(Path(clf_path))
                    raw_clf = classify_image_with_pt(
                        Path(clf_path), Path(image_path), image_size, device, 5
                    )

                predictions = build_predictions((width, height), raw_det, raw_clf)
                return json.dumps({"ok": True, "predictions": predictions}, ensure_ascii=False)
            except (PermissionError, FileNotFoundError, ValueError, RuntimeError, OSError) as error:
                return json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False)

    def _remember_workspace_paths(self, workspace_root: Path | str) -> Path:
        root = Path(self.path_access.remember_parent(workspace_root))
        if not looks_like_workspace(root):
            return root
        try:
            paths = load_workspace_config(root)
        except (FileNotFoundError, ValueError, OSError):
            return root
        for path in (
            paths.root,
            paths.image_pool,
            paths.metadata,
            paths.detect_out,
            paths.clf_out,
            paths.label_source,
        ):
            self.path_access.remember_path(path)
        return paths.root

    def _handle_openFolder(self, args: list[Any]) -> object:
            root = self._remember_workspace_paths(str(args[0]))
            self._remember_active_snapshot_workspace(root)
            init_if_needed = bool(args[1]) if len(args) > 1 else True
            try:
                payload = resolve_open_folder(root, init_if_needed=init_if_needed)
            except (NotADirectoryError, OSError, ValueError) as error:
                payload = {"ok": False, "error": str(error), "root": str(root)}
            return json.dumps(payload, ensure_ascii=False)

    def _handle_createWorkspace(self, args: list[Any]) -> object:
            root = self.path_access.remember_parent(str(args[0]))
            classes_raw = str(args[1]) if len(args) > 1 else ""
            classes = parse_class_names(classes_raw) if classes_raw else None
            stats = create_workspace(Path(root), classes=classes)
            payload = init_stats_payload(stats)
            payload["root"] = str(Path(root).resolve())
            payload["kind"] = "workspace"
            payload["isWorkspace"] = is_workspace_root(Path(root))
            return json.dumps(payload, ensure_ascii=False)

    def _snapshot_root_arg(self, args: list[Any]) -> Path:
            if not args:
                raise ValueError("Workspace root is required.")
            root = self.path_access.remember_parent(str(args[0]))
            return Path(root).resolve()

    def _remember_snapshot_manifest_paths(self, root: Path, manifest: dict[str, Any]) -> None:
            self.path_access.remember_path(root)
            for entry in manifest.get("versions", []):
                if not isinstance(entry, dict):
                    continue
                rel = Path(str(entry.get("path") or entry.get("id") or ""))
                version_path = rel if rel.is_absolute() else root / rel
                self.path_access.remember_path(version_path)

    def _remember_active_snapshot_workspace(self, root: Path) -> None:
            try:
                manifest = read_snapshot_versions(root)
                self._remember_snapshot_manifest_paths(root, manifest)
                active_path = resolve_active_version_path(root)
                self._remember_workspace_paths(active_path)
            except (FileNotFoundError, ValueError, OSError):
                return

    def _handle_readSnapshotVersions(self, args: list[Any]) -> object:
            root = self._snapshot_root_arg(args)
            manifest = read_snapshot_versions(root)
            self._remember_snapshot_manifest_paths(root, manifest)
            return json.dumps(manifest, ensure_ascii=False)

    def _handle_initializeSnapshotVersioning(self, args: list[Any]) -> object:
            root = self._snapshot_root_arg(args)
            manifest = initialize_snapshot_versioning(root)
            self._remember_snapshot_manifest_paths(root, manifest)
            return json.dumps(manifest, ensure_ascii=False)

    def _handle_createSnapshotVersion(self, args: list[Any]) -> object:
            root = self._snapshot_root_arg(args)
            from_version_id = str(args[1]).strip() if len(args) > 1 and str(args[1]).strip() else None
            manifest = create_snapshot_version(root, from_version_id)
            self._remember_snapshot_manifest_paths(root, manifest)
            return json.dumps(manifest, ensure_ascii=False)

    def _handle_setActiveSnapshotVersion(self, args: list[Any]) -> object:
            root = self._snapshot_root_arg(args)
            if len(args) < 2:
                raise ValueError("Version id is required.")
            manifest = set_active_snapshot_version(root, str(args[1]))
            self._remember_snapshot_manifest_paths(root, manifest)
            return json.dumps(manifest, ensure_ascii=False)

    def _handle_resolveActiveSnapshotWorkspacePath(self, args: list[Any]) -> object:
            root = self._snapshot_root_arg(args)
            active_path = resolve_active_version_path(root)
            self.path_access.remember_path(active_path)
            return str(active_path)

    def _handle_getWorkspaceInfo(self, args: list[Any]) -> object:
            try:
                root = self._remember_workspace_paths(str(args[0]))
                return json.dumps(workspace_info(root), ensure_ascii=False)
            except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
                return json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False)

    def _handle_listWorkspaceFiles(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(list_workspace_files(root), ensure_ascii=False)

    def _handle_scanImagePool(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            fast = False
            if len(args) > 1:
                fast = str(args[1]).lower() in {"1", "true", "yes", "fast"}
            return json.dumps(scan_image_pool(Path(root), fast=fast), ensure_ascii=False)

    def _handle_importMediaFiles(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            raw_sources = args[1] if len(args) > 1 else []
            if isinstance(raw_sources, str):
                sources = json.loads(raw_sources or "[]")
            elif isinstance(raw_sources, list):
                sources = raw_sources
            else:
                raise ValueError("Media source paths must be a list.")
            mode = str(args[2]) if len(args) > 2 else "copy"
            source_paths = [self.path_access.require_path(path) for path in sources]
            return json.dumps(import_media_files(Path(root), source_paths, mode), ensure_ascii=False)

    def _handle_markImagePoolSeen(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(mark_image_pool_seen(Path(root)), ensure_ascii=False)

    def _handle_readMetadataRows(self, args: list[Any]) -> object:
            try:
                root = self.path_access.require_path(args[0])
                return json.dumps(read_metadata_rows(Path(root)), ensure_ascii=False)
            except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
                return json.dumps(
                    {
                        "ok": False,
                        "error": str(error),
                        "rows": [],
                        "classes": [],
                        "clfClasses": [],
                        "metadataClasses": [],
                        "detectClasses": [],
                    },
                    ensure_ascii=False,
                )

    def _handle_listClfDatasetClasses(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            root_path = Path(root)
            return json.dumps(
                {
                    "ok": True,
                    "classes": list_clf_dataset_classes(root_path),
                    "clfDataset": str(_workspace_clf_out(root_path)),
                },
                ensure_ascii=False,
            )

    def _handle_upsertMetadataRows(self, args: list[Any]) -> object:
            try:
                root = self.path_access.require_path(args[0])
                updates = json.loads(args[1] or "[]")
                return json.dumps(upsert_metadata_rows(Path(root), updates), ensure_ascii=False)
            except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
                return json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False)

    def _handle_getWorkspaceClasses(self, args: list[Any]) -> object:
            try:
                root = self.path_access.require_path(args[0])
                return json.dumps(
                    {"ok": True, "classes": get_workspace_classes(Path(root))},
                    ensure_ascii=False,
                )
            except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
                return json.dumps({"ok": False, "error": str(error), "classes": []}, ensure_ascii=False)

    def _handle_buildYoloLinks(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            rebuild = bool(args[1]) if len(args) > 1 else False
            filenames = None
            if len(args) > 2 and args[2]:
                filenames = json.loads(args[2] or "[]")
            return json.dumps(
                build_workspace_links(Path(root), rebuild=rebuild, filenames=filenames),
                ensure_ascii=False,
            )

    def _handle_removeDetectDatasetLinks(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            filenames = json.loads(args[1] or "[]") if len(args) > 1 else []
            return json.dumps(
                remove_detect_dataset_links(Path(root), filenames=filenames),
                ensure_ascii=False,
            )

    def _handle_removeClfDatasetLinks(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            filenames = json.loads(args[1] or "[]") if len(args) > 1 else []
            return json.dumps(
                remove_clf_dataset_links(Path(root), filenames=filenames),
                ensure_ascii=False,
            )

    def _handle_startBuildYoloLinks(self, args: list[Any]) -> object:
            return json.dumps(self._start_build_job(args), ensure_ascii=False)

    def _handle_getBuildJob(self, args: list[Any]) -> object:
            return json.dumps(self._build_job_snapshot(str(args[0])), ensure_ascii=False)

    def _start_build_job(self, args: list[Any]) -> dict[str, Any]:
        root = self.path_access.require_path(args[0])
        rebuild = bool(args[1]) if len(args) > 1 else False
        filenames = None
        if len(args) > 2 and args[2]:
            filenames = json.loads(args[2] or "[]")
        state: dict[str, Any] = {
            "status": "running",
            "done": 0,
            "total": 1,
            "detail": "准备构建...",
            "errors": [],
            "result": None,
        }
        job_id, _ = self._build_jobs.create(state)

        def update(done: int, total: int, detail: str) -> None:
            self._build_jobs.update(job_id, {"done": done, "total": max(total, 1), "detail": detail})

        def run() -> None:
            try:
                result = build_workspace_links(
                    Path(root),
                    rebuild=rebuild,
                    filenames=filenames,
                    progress_callback=update,
                )
                current = self._build_jobs.snapshot(job_id)
                self._build_jobs.finish(
                    job_id,
                    {
                        "status": "done" if result.get("ok", True) else "error",
                        "done": current.get("total") or current.get("done") or 0,
                        "errors": result.get("errors") or [],
                        "result": result,
                        "detail": "构建完成" if result.get("ok", True) else "构建完成但有错误",
                    },
                )
            except Exception as error:
                self._build_jobs.finish(
                    job_id,
                    {
                        "status": "error",
                        "errors": [str(error)],
                        "detail": str(error),
                    },
                )

        threading.Thread(target=run, daemon=True).start()
        return self._build_job_snapshot(job_id)

    def _build_job_snapshot(self, job_id: str) -> dict[str, Any]:
        return self._build_jobs.snapshot(job_id)

    def _handle_readImagePoolThumb(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            max_size = int(args[2]) if len(args) > 2 else 128
            quality = int(args[3]) if len(args) > 3 else 54
            cache_dir = workspace_meta_dir(Path(root))
            return image_pool_thumbnail_base64(
                Path(root),
                str(args[1]),
                max_size=max_size,
                quality=quality,
                session_dir=cache_dir,
            )

    def _handle_ensureImagePoolBackup(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(ensure_image_pool_backup(Path(root), str(args[1])), ensure_ascii=False)

    def _handle_ensureImagePoolLabelBackup(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(ensure_image_pool_label_backup(Path(root), str(args[1])), ensure_ascii=False)

    def _handle_restoreImagePoolBackup(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(restore_image_pool_backup(Path(root), str(args[1])), ensure_ascii=False)

    def _handle_getImagePoolBackupStats(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(image_pool_backup_stats(Path(root)), ensure_ascii=False)

    def _handle_findImagePoolDuplicates(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(find_image_pool_duplicates(Path(root)), ensure_ascii=False)

    def _handle_clearImagePoolDuplicates(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(clear_image_pool_duplicates(Path(root)), ensure_ascii=False)

    def _handle_deletePoolImageCompletely(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return json.dumps(delete_pool_image_completely(Path(root), str(args[1])), ensure_ascii=False)

    def _handle_readWorkspaceSession(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            lite = False
            if len(args) > 1:
                lite = str(args[1]).lower() in {"1", "true", "yes", "lite"}
            return read_workspace_session(root, lite=lite)

    def _handle_writeWorkspaceSession(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return write_workspace_session(root, str(args[1]))

    def _handle_readSessionFile(self, args: list[Any]) -> object:
            return self.session_file.read_text(encoding="utf-8") if self.session_file.exists() else ""

    def _handle_writeSessionFile(self, args: list[Any]) -> object:
            json.loads(args[0])
            write_text_atomic(self.session_file, args[0])
            return str(self.session_file)

    def _handle_saveMaskNoiseTempImage(self, args: list[Any]) -> object:
            session_dir = self.session_dir
            if len(args) > 2 and str(args[2] or "").strip():
                workspace_root = self.path_access.require_path(args[2])
                session_dir = workspace_meta_dir(Path(workspace_root))
            session_dir.mkdir(parents=True, exist_ok=True)
            return mask_noise_save_temp_image(session_dir, args[0], args[1])

    def _handle_maskNoisePreview(self, args: list[Any]) -> object:
            settings = mask_noise_settings_from_json(args[2] if len(args) > 2 else "{}")
            return json.dumps(
                mask_noise_preview_base64(self.path_access.require_path(args[0]), self.path_access.require_path(args[1]), settings),
                ensure_ascii=False,
            )

    def _handle_maskNoiseSaveOne(self, args: list[Any]) -> object:
            settings = mask_noise_settings_from_json(args[3] if len(args) > 3 else "{}")
            return json.dumps(
                mask_noise_save_one(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    self.path_access.require_path(args[2]),
                    settings,
                ),
                ensure_ascii=False,
            )

    def _handle_maskNoiseExportFolder(self, args: list[Any]) -> object:
            settings = mask_noise_settings_from_json(args[3] if len(args) > 3 else "{}")
            return json.dumps(
                mask_noise_export_folder(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    self.path_access.require_path(args[2]),
                    settings,
                ),
                ensure_ascii=False,
            )

    def _handle_prepareValidationSplit(self, args: list[Any]) -> object:
            ratio = float(args[1]) if len(args) > 1 else 0.15
            return json.dumps(prepare_validation_split(self.path_access.require_path(args[0]), ratio), ensure_ascii=False)

    def _handle_prepareClassificationValidationSplit(self, args: list[Any]) -> object:
            ratio = float(args[1]) if len(args) > 1 else 0.15
            return json.dumps(prepare_classification_validation_split(self.path_access.require_path(args[0]), ratio), ensure_ascii=False)

    def _handle_movePairsToVal(self, args: list[Any]) -> object:
            return json.dumps(move_pairs_to_val(self.path_access.require_path(args[0]), json.loads(args[1] or "[]")), ensure_ascii=False)

    def _handle_ensureDataYaml(self, args: list[Any]) -> object:
            return json.dumps(ensure_data_yaml(self.path_access.require_path(args[0])), ensure_ascii=False)

    def _handle_findDuplicateImages(self, args: list[Any]) -> object:
            return json.dumps(find_duplicate_images(self.path_access.require_path(args[0])), ensure_ascii=False)

    def _handle_duplicateImages(self, args: list[Any]) -> object:
            return json.dumps(
                duplicate_images(self.path_access.require_path(args[0]), json.loads(args[1] or "[]"), float(args[2]), float(args[3])),
                ensure_ascii=False,
            )

    def _handle_deleteImages(self, args: list[Any]) -> object:
            return json.dumps(delete_images(self.path_access.require_path(args[0]), json.loads(args[1] or "[]")), ensure_ascii=False)

    def _handle_batchCropImages(self, args: list[Any]) -> object:
            class_anchors = json.loads(args[5] or "{}") if len(args) > 5 else {}
            if not isinstance(class_anchors, dict):
                raise ValueError("Class anchors must be a JSON object.")
            workers = int(args[6]) if len(args) > 6 and str(args[6]).strip() else None
            return json.dumps(
                batch_crop_images(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    int(args[2]),
                    int(args[3]),
                    str(args[4]) if len(args) > 4 else "center",
                    class_anchors,
                    workers,
                ),
                ensure_ascii=False,
            )

    def _handle_batchCropFiles(self, args: list[Any]) -> object:
            files = json.loads(args[0] or "[]")
            if not isinstance(files, list):
                raise ValueError("Files must be a JSON array.")
            class_anchors = json.loads(args[5] or "{}") if len(args) > 5 else {}
            if not isinstance(class_anchors, dict):
                raise ValueError("Class anchors must be a JSON object.")
            workers = int(args[6]) if len(args) > 6 and str(args[6]).strip() else None
            return json.dumps(
                batch_crop_files(
                    files,
                    self.path_access.require_path(args[1]),
                    int(args[2]),
                    int(args[3]),
                    str(args[4]) if len(args) > 4 else "center",
                    class_anchors,
                    workers,
                ),
                ensure_ascii=False,
            )

    def _handle_createClassFolder(self, args: list[Any]) -> object:
            return json.dumps(create_class_folder(self.path_access.require_path(args[0]), str(args[1])), ensure_ascii=False)

    def _handle_moveValBackToTrain(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            task = str(args[1] if len(args) > 1 else "auto").strip().lower()
            if task in {"", "auto"}:
                task = infer_dataset_task(root)
            if task == "detect":
                return json.dumps(move_detect_val_back_to_train(root), ensure_ascii=False)
            return json.dumps(move_val_back_to_train(root), ensure_ascii=False)

    def _handle_inferDatasetTask(self, args: list[Any]) -> object:
            return json.dumps({"ok": True, "task": infer_dataset_task(self.path_access.require_path(args[0]))}, ensure_ascii=False)

    def _handle_moveImagesToClass(self, args: list[Any]) -> object:
            return json.dumps(
                move_images_to_class(self.path_access.require_path(args[0]), json.loads(args[1] or "[]"), str(args[2])),
                ensure_ascii=False,
            )

    def _handle_classifierModelInfo(self, args: list[Any]) -> object:
            return json.dumps(model_info(self.path_access.require_path(args[0])), ensure_ascii=False)

    def _handle_ptModelInfo(self, args: list[Any]) -> object:
            if len(args) > 1:
                path = self.path_access.safe_child_path(args[0], str(args[1]))
            else:
                path = self.path_access.require_path(args[0])
            return json.dumps(pt_model_info(path), ensure_ascii=False)

    def _handle_classifyDatasetImages(self, args: list[Any]) -> object:
            paths = json.loads(args[2] or "[]")
            top_k = int(args[3]) if len(args) > 3 else 5
            return json.dumps(
                classify_dataset_images(self.path_access.require_path(args[0]), self.path_access.require_path(args[1]), paths, top_k),
                ensure_ascii=False,
            )

    def _handle_classifyFolderWithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 224
            device = str(args[4]) if len(args) > 4 else "0"
            confidence_prefix = bool(args[5]) if len(args) > 5 else True
            include_filenames = json.loads(args[6] or "[]") if len(args) > 6 else None
            return json.dumps(
                classify_folder_with_pt(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    self.path_access.require_path(args[2]),
                    image_size,
                    device,
                    confidence_prefix,
                    include_filenames,
                ),
                ensure_ascii=False,
            )

    def _handle_detectFolderWithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 640
            confidence = float(args[4]) if len(args) > 4 else 0.25
            device = str(args[5]) if len(args) > 5 else "0"
            include_filenames = json.loads(args[6] or "[]") if len(args) > 6 else None
            return json.dumps(
                detect_folder_with_pt(
                    self.path_access.require_path(args[0]),
                    self.path_access.require_path(args[1]),
                    self.path_access.require_path(args[2]),
                    image_size,
                    confidence,
                    device,
                    include_filenames,
                ),
                ensure_ascii=False,
            )

    def _handle_detectImageWithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 640
            confidence = float(args[4]) if len(args) > 4 else 0.25
            device = str(args[5]) if len(args) > 5 else "0"
            return json.dumps(
                detect_image_with_pt(
                    self.path_access.safe_child_path(args[0], str(args[1])),
                    self.path_access.safe_child_path(args[0], str(args[2])),
                    image_size,
                    confidence,
                    device,
                ),
                ensure_ascii=False,
            )

    def _temporary_base64_image(self, image_base64: str) -> Path:
            raw = str(image_base64 or "")
            if "," in raw and raw.strip().lower().startswith("data:"):
                raw = raw.split(",", 1)[1]
            payload = base64.b64decode(raw, validate=True)
            if not payload:
                raise ValueError("Image payload is empty.")
            handle = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
            try:
                handle.write(payload)
                return Path(handle.name)
            finally:
                handle.close()

    def _handle_detectImageBase64WithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 640
            confidence = float(args[4]) if len(args) > 4 else 0.25
            device = str(args[5]) if len(args) > 5 else "0"
            temp_path = self._temporary_base64_image(str(args[2]))
            try:
                return json.dumps(
                    detect_image_with_pt(
                        self.path_access.safe_child_path(args[0], str(args[1])),
                        temp_path,
                        image_size,
                        confidence,
                        device,
                    ),
                    ensure_ascii=False,
                )
            finally:
                temp_path.unlink(missing_ok=True)

    def _handle_classifyImageWithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 0
            device = str(args[4]) if len(args) > 4 else "0"
            top_k = int(args[5]) if len(args) > 5 else 5
            return json.dumps(
                classify_image_with_pt(
                    self.path_access.safe_child_path(args[0], str(args[1])),
                    self.path_access.safe_child_path(args[0], str(args[2])),
                    image_size,
                    device,
                    top_k,
                ),
                ensure_ascii=False,
            )

    def _handle_classifyImageBase64WithPt(self, args: list[Any]) -> object:
            image_size = int(args[3]) if len(args) > 3 else 0
            device = str(args[4]) if len(args) > 4 else "0"
            top_k = int(args[5]) if len(args) > 5 else 5
            temp_path = self._temporary_base64_image(str(args[2]))
            try:
                return json.dumps(
                    classify_image_with_pt(
                        self.path_access.safe_child_path(args[0], str(args[1])),
                        temp_path,
                        image_size,
                        device,
                        top_k,
                    ),
                    ensure_ascii=False,
                )
            finally:
                temp_path.unlink(missing_ok=True)

    def _handle_startClassifyFolderWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_job("classify", args), ensure_ascii=False)

    def _handle_startDetectFolderWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_job("detect", args), ensure_ascii=False)

    def _handle_startClassifyImageWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_image_job("classify", args), ensure_ascii=False)

    def _handle_startDetectImageWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_image_job("detect", args), ensure_ascii=False)

    def _handle_getPtJob(self, args: list[Any]) -> object:
            return json.dumps(self._pt_job_snapshot(str(args[0])), ensure_ascii=False)

    def _handle_cancelPtJob(self, args: list[Any]) -> object:
            return json.dumps(self._cancel_pt_job(str(args[0])), ensure_ascii=False)

    def _start_pt_job(self, kind: str, args: list[Any]) -> dict[str, Any]:
        state: dict[str, Any] = {
            "kind": kind,
            "status": "running",
            "done": 0,
            "total": 0,
            "detail": "Starting...",
            "errors": [],
            "result": None,
        }
        job_id, cancel_event = self._pt_jobs.create(state, cancelable=True)

        def update(done: int, total: int, detail: str) -> None:
            self._pt_jobs.update(job_id, {"done": done, "total": total, "detail": detail})

        def run() -> None:
            try:
                if kind == "classify":
                    image_size = int(args[3]) if len(args) > 3 else 224
                    device = str(args[4]) if len(args) > 4 else "0"
                    confidence_prefix = bool(args[5]) if len(args) > 5 else True
                    include_filenames = json.loads(args[6] or "[]") if len(args) > 6 else None
                    result = classify_folder_with_pt(
                        self.path_access.require_path(args[0]),
                        self.path_access.require_path(args[1]),
                        self.path_access.require_path(args[2]),
                        image_size,
                        device,
                        confidence_prefix,
                        include_filenames,
                        update,
                        cancel_event,
                    )
                    done = int(result.get("copied") or 0)
                else:
                    image_size = int(args[3]) if len(args) > 3 else 640
                    confidence = float(args[4]) if len(args) > 4 else 0.25
                    device = str(args[5]) if len(args) > 5 else "0"
                    include_filenames = json.loads(args[6] or "[]") if len(args) > 6 else None
                    result = detect_folder_with_pt(
                        self.path_access.require_path(args[0]),
                        self.path_access.require_path(args[1]),
                        self.path_access.require_path(args[2]),
                        image_size,
                        confidence,
                        device,
                        include_filenames,
                        update,
                        cancel_event,
                    )
                    done = int(result.get("copied") or 0)
                current = self._pt_jobs.snapshot(job_id)
                self._pt_jobs.finish(
                    job_id,
                    {
                        "status": "cancelled" if result.get("cancelled") else "done",
                        "done": max(int(current.get("done") or 0), done),
                        "total": int(result.get("total") or current.get("total") or 0),
                        "errors": result.get("errors") or [],
                        "result": result,
                        "detail": "Cancelled." if result.get("cancelled") else "Done.",
                    },
                )
            except Exception as error:
                self._pt_jobs.finish(
                    job_id,
                    {
                        "status": "error",
                        "errors": [str(error)],
                        "detail": str(error),
                    },
                )

        threading.Thread(target=run, daemon=True).start()
        return self._pt_job_snapshot(job_id)

    def _start_pt_image_job(self, kind: str, args: list[Any]) -> dict[str, Any]:
        state: dict[str, Any] = {
            "kind": f"{kind}-image",
            "status": "running",
            "done": 0,
            "total": 1,
            "detail": "Starting...",
            "errors": [],
            "result": None,
        }
        job_id, cancel_event = self._pt_jobs.create(state, cancelable=True)

        def run() -> None:
            try:
                if cancel_event.is_set():
                    result: dict[str, Any] = {"ok": True, "cancelled": True}
                elif kind == "classify":
                    self._pt_jobs.update(job_id, {"detail": "Running classify..."})
                    image_size = int(args[3]) if len(args) > 3 else 0
                    device = str(args[4]) if len(args) > 4 else "0"
                    top_k = int(args[5]) if len(args) > 5 else 5
                    result = classify_image_with_pt(
                        self.path_access.safe_child_path(args[0], str(args[1])),
                        self.path_access.safe_child_path(args[0], str(args[2])),
                        image_size,
                        device,
                        top_k,
                    )
                else:
                    self._pt_jobs.update(job_id, {"detail": "Running detect..."})
                    image_size = int(args[3]) if len(args) > 3 else 640
                    confidence = float(args[4]) if len(args) > 4 else 0.25
                    device = str(args[5]) if len(args) > 5 else "0"
                    result = detect_image_with_pt(
                        self.path_access.safe_child_path(args[0], str(args[1])),
                        self.path_access.safe_child_path(args[0], str(args[2])),
                        image_size,
                        confidence,
                        device,
                    )
                self._pt_jobs.finish(
                    job_id,
                    {
                        "status": "cancelled" if result.get("cancelled") else "done",
                        "done": 0 if result.get("cancelled") else 1,
                        "total": 1,
                        "errors": [],
                        "result": result,
                        "detail": "Cancelled." if result.get("cancelled") else "Done.",
                    },
                )
            except Exception as error:
                self._pt_jobs.finish(
                    job_id,
                    {
                        "status": "error",
                        "errors": [str(error)],
                        "detail": str(error),
                    },
                )

        threading.Thread(target=run, daemon=True).start()
        return self._pt_job_snapshot(job_id)

    def _pt_job_snapshot(self, job_id: str) -> dict[str, Any]:
        return self._pt_jobs.snapshot(job_id)

    def _cancel_pt_job(self, job_id: str) -> dict[str, Any]:
        return self._pt_jobs.cancel(job_id)

    def _start_capture_video_screenshot_jobs(self, args: list[Any]) -> dict[str, Any]:
        jobs = json.loads(args[0] or "[]")
        for job in jobs:
            job["path"] = str(self.path_access.require_path(job.get("path") or ""))
        output_dir = self.path_access.require_path(args[1])
        interval = float(args[2])
        prefix = str(args[3]) if len(args) > 3 else ""
        image_format = str(args[4]) if len(args) > 4 else "jpg"
        total = int(args[5]) if len(args) > 5 else 0
        state: dict[str, Any] = {
            "status": "running",
            "saved": 0,
            "total": total,
            "detail": "Starting export...",
            "errors": [],
            "result": None,
        }
        job_id, cancel_event = self._capture_jobs.create(state, cancelable=True)

        def update(saved: int, detail: str) -> None:
            self._capture_jobs.update(job_id, {"saved": saved, "detail": detail})

        def run() -> None:
            try:
                result = capture_video_screenshot_jobs(jobs, output_dir, interval, prefix, image_format, update, cancel_event)
                current = self._capture_jobs.snapshot(job_id)
                self._capture_jobs.finish(
                    job_id,
                    {
                        "status": "cancelled" if result.get("cancelled") else "done",
                        "saved": int(result.get("saved") or current["saved"]),
                        "errors": result.get("errors") or [],
                        "result": result,
                        "detail": "Cancelled." if result.get("cancelled") else "Done.",
                    },
                )
            except Exception as error:
                self._capture_jobs.finish(
                    job_id,
                    {
                        "status": "error",
                        "errors": [str(error)],
                        "detail": str(error),
                    },
                )

        threading.Thread(target=run, daemon=True).start()
        return self._capture_job_snapshot(job_id)

    def _capture_job_snapshot(self, job_id: str) -> dict[str, Any]:
        return self._capture_jobs.snapshot(job_id)

    def _cancel_capture_job(self, job_id: str) -> dict[str, Any]:
        return self._capture_jobs.cancel(job_id)

    def _choose_directory(self, title: str) -> str:
        if not self.choose_directory:
            raise RuntimeError("Directory picker is not available in this backend.")
        path = self.choose_directory(title)
        if path:
            self.path_access.remember_path(path)
        return path

    def _choose_image_file(self, title: str) -> str:
        if not self.choose_image_file:
            raise RuntimeError("Image picker is not available in this backend.")
        path = self.choose_image_file(title)
        if path:
            self.path_access.remember_parent(path)
        return path

    def _choose_image_files(self, title: str) -> str:
        if not self.choose_image_files:
            raise RuntimeError("Image picker is not available in this backend.")
        paths = [self.path_access.remember_parent(path) for path in self.choose_image_files(title)]
        return json.dumps([str(path) for path in paths], ensure_ascii=False)

    def _choose_media_files(self, title: str) -> str:
        if not self.choose_media_files:
            raise RuntimeError("Media picker is not available in this backend.")
        paths = [self.path_access.remember_parent(path) for path in self.choose_media_files(title)]
        return json.dumps([str(path) for path in paths], ensure_ascii=False)

    def _choose_classifier_model(self, title: str) -> str:
        if not self.choose_classifier_model:
            raise RuntimeError("Classifier model picker is not available in this backend.")
        path = self.choose_classifier_model(title)
        if path:
            self.path_access.remember_parent(path)
        return path

    def _choose_train_model_file(self, title: str) -> str:
        if not self.choose_train_model_file:
            raise RuntimeError("Train model picker is not available in this backend.")
        path = self.choose_train_model_file(title)
        if path:
            self.path_access.remember_parent(path)
        return path

    def _choose_video_files(self, title: str) -> str:
        if not self.choose_video_files:
            raise RuntimeError("Video picker is not available in this backend.")
        paths = [self.path_access.remember_parent(path) for path in self.choose_video_files(title)]
        return videos_json(paths)

    def _handle_copyModelToWorkspace(self, args: list[Any]) -> object:
        source = self.path_access.require_path(args[0])
        if source.suffix.lower() != ".pt":
            raise ValueError("Only .pt model files are accepted.")
        dest = self.path_access.safe_child_path(args[1], args[2])
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
        return str(dest)

    def _handle_readAutoLabelModelRegistry(self, args: list[Any]) -> object:
        root = self.path_access.require_path(args[0])
        return json.dumps(self._read_auto_label_model_registry(root), ensure_ascii=False)

    def _handle_importAutoLabelModel(self, args: list[Any]) -> object:
        source = self.path_access.require_path(args[0])
        if source.suffix.lower() != ".pt":
            raise ValueError("Only .pt model files are accepted.")
        kind = str(args[2] if len(args) > 2 else "").strip().lower()
        if kind not in {"detect", "classify"}:
            raise ValueError("Auto label model kind must be detect or classify.")

        rel_dest = f"models/autolabel/{kind}/{source.name}"
        dest = self.path_access.safe_child_path(args[1], rel_dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)

        workspace_root = self.path_access.require_path(args[1])
        registry_path = self._auto_label_model_registry_path(workspace_root)
        with self._auto_label_model_lock:
            registry = self._read_auto_label_model_registry_unlocked(workspace_root)

            registry[kind] = {
                "activeModel": rel_dest,
                "updatedAt": str(args[3] if len(args) > 3 else ""),
            }
            write_text_atomic(registry_path, json.dumps(registry, ensure_ascii=False, indent=2) + "\n")
        return json.dumps(registry, ensure_ascii=False)

    def _auto_label_model_registry_path(self, workspace_root: Path) -> Path:
        return self.path_access.safe_child_path(workspace_root, "workspace/autolabel_models.json")

    def _auto_label_model_rel_path(self, kind: str, path: Path) -> str:
        return f"models/autolabel/{kind}/{path.name}"

    def _discover_auto_label_model(self, workspace_root: Path, kind: str) -> str:
        model_dir = self.path_access.safe_child_path(workspace_root, f"models/autolabel/{kind}")
        if not model_dir.is_dir():
            return ""
        candidates = [path for path in model_dir.iterdir() if path.is_file() and path.suffix.lower() == ".pt"]
        if not candidates:
            return ""
        latest = max(candidates, key=lambda path: (path.stat().st_mtime, path.name.lower()))
        return self._auto_label_model_rel_path(kind, latest)

    def _read_auto_label_model_registry_unlocked(self, workspace_root: Path) -> dict[str, Any]:
        registry_path = self._auto_label_model_registry_path(workspace_root)
        registry: dict[str, Any] = {}
        if registry_path.is_file():
            try:
                existing = json.loads(registry_path.read_text(encoding="utf-8"))
                if isinstance(existing, dict):
                    registry = existing
            except json.JSONDecodeError:
                registry = {}

        changed = False
        for kind in ("detect", "classify"):
            entry = registry.get(kind)
            active = str(entry.get("activeModel") or "") if isinstance(entry, dict) else ""
            active_path = self.path_access.safe_child_path(workspace_root, active) if active else None
            if active_path is not None and active_path.is_file():
                continue
            discovered = self._discover_auto_label_model(workspace_root, kind)
            if discovered:
                registry[kind] = {
                    "activeModel": discovered,
                    "updatedAt": str(entry.get("updatedAt") or "") if isinstance(entry, dict) else "",
                }
            elif kind in registry:
                registry.pop(kind, None)
            else:
                continue
            changed = True

        if changed:
            write_text_atomic(registry_path, json.dumps(registry, ensure_ascii=False, indent=2) + "\n")
        return registry

    def _read_auto_label_model_registry(self, workspace_root: Path) -> dict[str, Any]:
        with self._auto_label_model_lock:
            return self._read_auto_label_model_registry_unlocked(workspace_root)

    def _unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        for index in range(2, 10000):
            candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
            if not candidate.exists():
                return candidate
        raise FileExistsError(f"Cannot create a unique path for {path}")
