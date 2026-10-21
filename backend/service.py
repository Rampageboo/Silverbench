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
from .duplicate_images import delete_images, duplicate_images
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
    prepare_classification_validation_split,
    prepare_validation_split,
)
from .yolo_pt_classifier import classify_folder_with_pt, classify_image_with_pt
from .yolo_pt_detector import detect_folder_with_pt, detect_image_with_pt
from .yolo_pt_model_info import pt_model_info
from .image_preview import image_scaled_jpeg_base64
from .image_pool import mark_image_pool_seen
from .media_import import import_media_files, list_workspace_videos
from .app_settings import forget_workspace, read_settings, remember_workspace, write_settings
from .classes_store import classify_classes, read_classes
from .dataset_export import export_dataset, export_dirs
from .image_status import status_payload, upsert_status_rows
from .image_pool_backup import backup_stats, ensure_image_backup, ensure_label_backup, restore_image_backup
from .image_pool_cleanup import (
    clear_image_pool_duplicates,
    delete_pool_image_completely,
    find_image_pool_duplicates,
)
from .workspace import infer_dataset_task, list_dataset_files, list_workspace_files, open_folder, workspace_info
from .workspace_layout import WorkspaceLayout, create_workspace, layout_payload, open_workspace
from .workspace_migration import execute_migration, finish_migration, has_pending_migration, plan_migration, rollback_migration
from .workspace_session import lite_session, read_session, write_session
from .workspace_versions import create_snapshot, delete_snapshot, read_versions, restore_snapshot
from .yolo_tracker import track_yolo_forward_from_json


_PT_JOB_TTL_SECONDS = 10 * 60
_MAX_RETAINED_PT_JOBS = 64


class BackendService:
    def __init__(
        self,
        path_access: PathAccess,
        session_dir: Path,
        *,
        app_settings_dir: Path | None = None,
        legacy_settings_dir: Path | None = None,
        choose_directory: Callable[[str], str] | None = None,
        choose_file: Callable[[str, list[tuple[str, str]]], str] | None = None,
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
        self.app_settings_dir = app_settings_dir or session_dir
        self.legacy_settings_dir = legacy_settings_dir
        self.choose_directory = choose_directory
        self.choose_file = choose_file
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
            "chooseFile": self._handle_chooseFile,
            "chooseImageFile": self._handle_chooseImageFile,
            "chooseImageFiles": self._handle_chooseImageFiles,
            "chooseMediaFiles": self._handle_chooseMediaFiles,
            "chooseClassifierModel": self._handle_chooseClassifierModel,
            "chooseTrainModelFile": self._handle_chooseTrainModelFile,
            "chooseVideoFiles": self._handle_chooseVideoFiles,
            "chooseVideoFolder": self._handle_chooseVideoFolder,
            "listWorkspaceVideos": self._handle_listWorkspaceVideos,
            "getVideoInfo": self._handle_getVideoInfo,
            "getVideoFrameBase64": self._handle_getVideoFrameBase64,
            "saveVideoFrame": self._handle_saveVideoFrame,
            "captureVideoScreenshots": self._handle_captureVideoScreenshots,
            "captureVideoScreenshotJobs": self._handle_captureVideoScreenshotJobs,
            "startCaptureVideoScreenshotJobs": self._handle_startCaptureVideoScreenshotJobs,
            "getCaptureVideoScreenshotJob": self._handle_getCaptureVideoScreenshotJob,
            "cancelCaptureVideoScreenshotJob": self._handle_cancelCaptureVideoScreenshotJob,
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
            "planWorkspaceMigration": self._handle_planWorkspaceMigration,
            "migrateWorkspace": self._handle_migrateWorkspace,
            "rollbackWorkspaceMigration": self._handle_rollbackWorkspaceMigration,
            "finishWorkspaceMigration": self._handle_finishWorkspaceMigration,
            "listSnapshots": self._handle_listSnapshots,
            "createSnapshot": self._handle_createSnapshot,
            "restoreSnapshot": self._handle_restoreSnapshot,
            "deleteSnapshot": self._handle_deleteSnapshot,
            "getWorkspaceInfo": self._handle_getWorkspaceInfo,
            "listWorkspaceFiles": self._handle_listWorkspaceFiles,
            "importMediaFiles": self._handle_importMediaFiles,
            "markImagePoolSeen": self._handle_markImagePoolSeen,
            "readMetadataRows": self._handle_readMetadataRows,
            "listClfDatasetClasses": self._handle_listClfDatasetClasses,
            "upsertMetadataRows": self._handle_upsertMetadataRows,
            "getWorkspaceClasses": self._handle_getWorkspaceClasses,
            "startExportDataset": self._handle_startExportDataset,
            "getBuildJob": self._handle_getBuildJob,
            "ensureImagePoolBackup": self._handle_ensureImagePoolBackup,
            "ensureImagePoolLabelBackup": self._handle_ensureImagePoolLabelBackup,
            "restoreImagePoolBackup": self._handle_restoreImagePoolBackup,
            "getImagePoolBackupStats": self._handle_getImagePoolBackupStats,
            "findImagePoolDuplicates": self._handle_findImagePoolDuplicates,
            "clearImagePoolDuplicates": self._handle_clearImagePoolDuplicates,
            "deletePoolImageCompletely": self._handle_deletePoolImageCompletely,
            "readWorkspaceSession": self._handle_readWorkspaceSession,
            "writeWorkspaceSession": self._handle_writeWorkspaceSession,
            "saveMaskNoiseTempImage": self._handle_saveMaskNoiseTempImage,
            "maskNoisePreview": self._handle_maskNoisePreview,
            "maskNoiseSaveOne": self._handle_maskNoiseSaveOne,
            "maskNoiseExportFolder": self._handle_maskNoiseExportFolder,
            "prepareValidationSplit": self._handle_prepareValidationSplit,
            "prepareClassificationValidationSplit": self._handle_prepareClassificationValidationSplit,
            "ensureDataYaml": self._handle_ensureDataYaml,
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

    def _handle_chooseFile(self, args: list[Any]) -> object:
            # args: [title, filters?] with filters as [[label, "*.ext *.ext"], ...]
            raw = args[1] if len(args) > 1 else []
            filters = json.loads(raw) if isinstance(raw, str) else raw
            if not isinstance(filters, list) or not all(isinstance(f, list) and len(f) == 2 for f in filters):
                raise ValueError("chooseFile filters must be [[label, patterns], ...].")
            if not self.choose_file:
                raise RuntimeError("File picker is not available in this backend.")
            path = self.choose_file(str(args[0]) if args else "Choose File", [(str(a), str(b)) for a, b in filters])
            if path:
                self.path_access.remember_parent(path)
            return path

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
            return json.dumps(list_workspace_videos(self._layout(args[0])), ensure_ascii=False)

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
                    similarity_threshold=None if len(args) <= 6 or not args[6] else float(args[7]) if len(args) > 7 else 0.98,
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
                    similarity_threshold=None if len(args) <= 5 or not args[5] else float(args[6]) if len(args) > 6 else 0.98,
                ),
                ensure_ascii=False,
            )

    def _handle_startCaptureVideoScreenshotJobs(self, args: list[Any]) -> object:
            return json.dumps(self._start_capture_video_screenshot_jobs(args), ensure_ascii=False)

    def _handle_getCaptureVideoScreenshotJob(self, args: list[Any]) -> object:
            return json.dumps(self._capture_job_snapshot(str(args[0])), ensure_ascii=False)

    def _handle_cancelCaptureVideoScreenshotJob(self, args: list[Any]) -> object:
            return json.dumps(self._cancel_capture_job(str(args[0])), ensure_ascii=False)

    def _handle_readImageFileBase64(self, args: list[Any]) -> object:
            path = self.path_access.require_path(args[0])
            if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".bmp", ".webp"}:
                raise ValueError("Only image files can be previewed.")
            return base64.b64encode(path.read_bytes()).decode("ascii")

    def _handle_openDirectory(self, args: list[Any]) -> object:
            path = self.path_access.require_path(args[0])
            # Directories only: os.startfile on a file would execute it.
            if not path.is_dir():
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
        return read_settings(self.app_settings_dir, legacy_dir=self.legacy_settings_dir)

    def _handle_writeAppSettings(self, args: list[Any]) -> object:
        payload = args[0] if args else {}
        settings = json.loads(payload or "{}") if isinstance(payload, str) else payload
        if not isinstance(settings, dict):
            raise ValueError("App settings must be a JSON object.")
        return write_settings(settings, self.app_settings_dir, legacy_dir=self.legacy_settings_dir)

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

    # ── Workspaces ──────────────────────────────────────────────────────────

    def _layout(self, root_arg: object) -> WorkspaceLayout:
        return open_workspace(self.path_access.require_path(str(root_arg)))

    def _remember_workspace(self, root: str) -> None:
        self.path_access.remember_path(root)
        remember_workspace(root, self.app_settings_dir, legacy_dir=self.legacy_settings_dir)

    def _handle_openFolder(self, args: list[Any]) -> object:
        folder = self.path_access.remember_path(str(args[0]))
        try:
            payload = open_folder(folder)
        except (NotADirectoryError, OSError, ValueError) as error:
            return {"ok": False, "error": str(error), "root": str(folder)}
        if payload.get("root"):
            self.path_access.remember_path(payload["root"])
        if payload.get("kind") == "workspace":
            self._remember_workspace(payload["root"])
            payload["migrationPending"] = has_pending_migration(payload["root"])
        return payload

    def _handle_createWorkspace(self, args: list[Any]) -> object:
        folder = self.path_access.remember_path(str(args[0]))
        classes = json.loads(args[1]) if len(args) > 1 and args[1] else None
        if folder.exists():
            kind = open_folder(folder)["kind"]
            if kind != "folder":
                raise ValueError(f"{folder} already holds a {kind}; open it instead.")
        layout = create_workspace(folder, classes=classes)
        self._remember_workspace(str(layout.root))
        return layout_payload(layout)

    def _handle_planWorkspaceMigration(self, args: list[Any]) -> object:
        return plan_migration(self.path_access.require_path(str(args[0]))).summary()

    def _handle_migrateWorkspace(self, args: list[Any]) -> object:
        source = self.path_access.require_path(str(args[0]))
        plan = plan_migration(source)
        result = execute_migration(plan)
        layout = open_workspace(plan.root)
        # The old version folders are gone (or left only as copies to delete): drop them from recents.
        former = [source, plan.source["base"], *(Path(v["path"]) for v in plan.source.get("otherVersions") or [])]
        for path in former:
            if Path(path).resolve() != layout.root.resolve():
                forget_workspace(str(path), self.app_settings_dir, legacy_dir=self.legacy_settings_dir)
        self._remember_workspace(str(layout.root))
        return {**result, "workspace": {**layout_payload(layout), "migrationPending": True}}

    def _handle_rollbackWorkspaceMigration(self, args: list[Any]) -> object:
        return rollback_migration(self.path_access.require_path(str(args[0])))

    def _handle_finishWorkspaceMigration(self, args: list[Any]) -> object:
        finish_migration(self.path_access.require_path(str(args[0])))
        return {"ok": True}

    def _handle_listSnapshots(self, args: list[Any]) -> object:
        return read_versions(self._layout(args[0]))

    def _handle_createSnapshot(self, args: list[Any]) -> object:
        return create_snapshot(self._layout(args[0]), str(args[1]) if len(args) > 1 else "")

    def _handle_restoreSnapshot(self, args: list[Any]) -> object:
        return restore_snapshot(self._layout(args[0]), str(args[1]))

    def _handle_deleteSnapshot(self, args: list[Any]) -> object:
        return delete_snapshot(self._layout(args[0]), str(args[1]))

    def _handle_getWorkspaceInfo(self, args: list[Any]) -> object:
        try:
            return workspace_info(self._layout(args[0]))
        except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
            return {"ok": False, "error": str(error)}

    def _handle_listWorkspaceFiles(self, args: list[Any]) -> object:
        return list_workspace_files(self._layout(args[0]))

    def _handle_importMediaFiles(self, args: list[Any]) -> object:
        layout = self._layout(args[0])
        raw_sources = args[1] if len(args) > 1 else []
        sources = json.loads(raw_sources or "[]") if isinstance(raw_sources, str) else raw_sources
        if not isinstance(sources, list):
            raise ValueError("Media source paths must be a list.")
        mode = str(args[2]) if len(args) > 2 else "copy"
        source_paths = [self.path_access.require_path(path) for path in sources]
        return import_media_files(layout, source_paths, mode)

    def _handle_markImagePoolSeen(self, args: list[Any]) -> object:
        return mark_image_pool_seen(self._layout(args[0]))

    # ── Image status and classes ────────────────────────────────────────────

    def _handle_readMetadataRows(self, args: list[Any]) -> object:
        try:
            return status_payload(self._layout(args[0]))
        except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
            return {"ok": False, "error": str(error), "rows": [], "classes": [], "clfClasses": [], "detectClasses": []}

    def _handle_listClfDatasetClasses(self, args: list[Any]) -> object:
        layout = self._layout(args[0])
        keys = [item["key"] for item in classify_classes(read_classes(layout))]
        return {"ok": True, "classes": keys, "clfDataset": str(export_dirs(layout)["classify"])}

    def _handle_upsertMetadataRows(self, args: list[Any]) -> object:
        try:
            return upsert_status_rows(self._layout(args[0]), json.loads(args[1] or "[]"))
        except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
            return {"ok": False, "error": str(error)}

    def _handle_getWorkspaceClasses(self, args: list[Any]) -> object:
        try:
            keys = [item["key"] for item in classify_classes(read_classes(self._layout(args[0])))]
            return {"ok": True, "classes": keys}
        except (PermissionError, FileNotFoundError, ValueError, OSError) as error:
            return {"ok": False, "error": str(error), "classes": []}

    # ── Dataset export ──────────────────────────────────────────────────────

    def _handle_startExportDataset(self, args: list[Any]) -> object:
        layout = self._layout(args[0])
        raw = args[1] if len(args) > 1 else {}
        options = json.loads(raw or "{}") if isinstance(raw, str) else (raw or {})
        destination = options.get("destination")
        destination_path = self.path_access.require_path(destination) if destination else None
        filenames = options.get("filenames") or None
        rebuild = bool(options.get("rebuild", True))
        name = str(options.get("name") or "dataset")
        state: dict[str, Any] = {"status": "running", "done": 0, "total": 1, "detail": "准备导出...", "errors": [], "result": None}
        job_id, _ = self._build_jobs.create(state)

        def update(done: int, total: int, detail: str) -> None:
            self._build_jobs.update(job_id, {"done": done, "total": max(total, 1), "detail": detail})

        def run() -> None:
            try:
                result = export_dataset(
                    layout,
                    name=name,
                    destination=destination_path,
                    rebuild=rebuild,
                    filenames=filenames,
                    progress=update,
                    link=bool(options.get("link")),
                )
                ok = bool(result.get("ok", True))
                current = self._build_jobs.snapshot(job_id)
                self._build_jobs.finish(
                    job_id,
                    {
                        "status": "done" if ok else "error",
                        "done": current.get("total") or current.get("done") or 0,
                        "errors": result.get("errors") or [],
                        "result": result,
                        "detail": "导出完成" if ok else "导出完成但有错误",
                    },
                )
            except Exception as error:
                self._build_jobs.finish(job_id, {"status": "error", "errors": [str(error)], "detail": str(error)})

        threading.Thread(target=run, daemon=True).start()
        return self._build_job_snapshot(job_id)

    def _handle_getBuildJob(self, args: list[Any]) -> object:
        return self._build_job_snapshot(str(args[0]))

    def _build_job_snapshot(self, job_id: str) -> dict[str, Any]:
        return self._build_jobs.snapshot(job_id)

    # ── Originals, duplicates, deletion ─────────────────────────────────────

    def _handle_ensureImagePoolBackup(self, args: list[Any]) -> object:
        return ensure_image_backup(self._layout(args[0]), str(args[1]))

    def _handle_ensureImagePoolLabelBackup(self, args: list[Any]) -> object:
        return ensure_label_backup(self._layout(args[0]), str(args[1]))

    def _handle_restoreImagePoolBackup(self, args: list[Any]) -> object:
        return restore_image_backup(self._layout(args[0]), str(args[1]))

    def _handle_getImagePoolBackupStats(self, args: list[Any]) -> object:
        return backup_stats(self._layout(args[0]))

    def _handle_findImagePoolDuplicates(self, args: list[Any]) -> object:
        return find_image_pool_duplicates(self._layout(args[0]))

    def _handle_clearImagePoolDuplicates(self, args: list[Any]) -> object:
        return clear_image_pool_duplicates(self._layout(args[0]))

    def _handle_deletePoolImageCompletely(self, args: list[Any]) -> object:
        return delete_pool_image_completely(self._layout(args[0]), str(args[1]))

    # ── Session ─────────────────────────────────────────────────────────────

    def _handle_readWorkspaceSession(self, args: list[Any]) -> object:
        session = read_session(self._layout(args[0]))
        lite = len(args) > 1 and str(args[1]).lower() in {"1", "true", "yes", "lite"}
        return json.dumps(lite_session(session) if lite else session, ensure_ascii=False)

    def _handle_writeWorkspaceSession(self, args: list[Any]) -> object:
        return write_session(self._layout(args[0]), json.loads(str(args[1]) or "{}"))

    def _handle_saveMaskNoiseTempImage(self, args: list[Any]) -> object:
        temp_dir = self.session_dir
        if len(args) > 2 and str(args[2] or "").strip():
            temp_dir = self._layout(args[2]).cache
        temp_dir.mkdir(parents=True, exist_ok=True)
        return mask_noise_save_temp_image(temp_dir, args[0], args[1])

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

    def _handle_ensureDataYaml(self, args: list[Any]) -> object:
            return json.dumps(ensure_data_yaml(self.path_access.require_path(args[0])), ensure_ascii=False)

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
        deduplicate = bool(args[6]) if len(args) > 6 else False
        similarity_threshold = float(args[7]) if deduplicate and len(args) > 7 else None
        state: dict[str, Any] = {
            "status": "running",
            "saved": 0,
            "processed": 0,
            "skipped": 0,
            "total": total,
            "detail": "Starting export...",
            "errors": [],
            "result": None,
        }
        job_id, cancel_event = self._capture_jobs.create(state, cancelable=True)

        def update(processed: int, saved: int, skipped: int, detail: str) -> None:
            self._capture_jobs.update(
                job_id,
                {"processed": processed, "saved": saved, "skipped": skipped, "detail": detail},
            )

        def run() -> None:
            try:
                result = capture_video_screenshot_jobs(
                    jobs,
                    output_dir,
                    interval,
                    prefix,
                    image_format,
                    update,
                    cancel_event,
                    similarity_threshold,
                )
                current = self._capture_jobs.snapshot(job_id)
                self._capture_jobs.finish(
                    job_id,
                    {
                        "status": "cancelled" if result.get("cancelled") else "done",
                        "saved": int(result.get("saved") or current["saved"]),
                        "processed": int(result.get("processed") or current["processed"]),
                        "skipped": int(result.get("skipped") or current["skipped"]),
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
        return open_workspace(workspace_root).path("modelRegistry")

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
