from __future__ import annotations

import base64
import json
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from .batch_crop import batch_crop_files, batch_crop_images
from .classification_dataset import create_class_folder, move_images_to_class, move_val_back_to_train
from .duplicate_images import delete_images, duplicate_images, find_duplicate_images
from .mask_noise import export_folder as mask_noise_export_folder
from .mask_noise import preview_base64 as mask_noise_preview_base64
from .mask_noise import save_one as mask_noise_save_one
from .mask_noise import save_temp_image as mask_noise_save_temp_image
from .mask_noise import settings_from_json as mask_noise_settings_from_json
from .path_access import PathAccess
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
from .yolo_pt_classifier import classify_folder_with_pt
from .yolo_pt_detector import detect_folder_with_pt
from .image_preview import image_scaled_jpeg_base64
from .image_pool import image_pool_thumbnail_base64, mark_image_pool_seen, scan_image_pool
from .metadata_assign import (
    _workspace_clf_out,
    build_workspace_links,
    get_workspace_classes,
    list_clf_dataset_classes,
    read_metadata_rows,
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
    IMAGE_EXTENSIONS,
    infer_dataset_task,
    create_workspace,
    init_stats_payload,
    is_workspace_root,
    is_dataset_index_file,
    list_workspace_files,
    parse_class_names,
    read_app_settings,
    read_workspace_session,
    resolve_open_folder,
    workspace_info,
    write_app_settings,
    write_workspace_session,
)
from .yolo_tracker import track_yolo_forward_from_json


class BackendService:
    def __init__(
        self,
        path_access: PathAccess,
        session_dir: Path,
        session_file: Path,
        *,
        choose_directory: Callable[[str], str] | None = None,
        choose_image_file: Callable[[str], str] | None = None,
        choose_classifier_model: Callable[[str], str] | None = None,
        choose_train_model_file: Callable[[str], str] | None = None,
        choose_video_files: Callable[[str], list[Path]] | None = None,
        open_directory: Callable[[Path], bool] | None = None,
    ) -> None:
        self.path_access = path_access
        self.session_dir = session_dir
        self.session_file = session_file
        self.choose_directory = choose_directory
        self.choose_image_file = choose_image_file
        self.choose_classifier_model = choose_classifier_model
        self.choose_train_model_file = choose_train_model_file
        self.choose_video_files = choose_video_files
        self.open_directory_callback = open_directory
        self._capture_jobs: dict[str, dict[str, Any]] = {}
        self._capture_jobs_lock = threading.Lock()
        self._pt_jobs: dict[str, dict[str, Any]] = {}
        self._pt_jobs_lock = threading.Lock()
        self._build_jobs: dict[str, dict[str, Any]] = {}
        self._build_jobs_lock = threading.Lock()
        self._handlers = self._build_handlers()

    def _build_handlers(self) -> dict[str, Callable[[list[Any]], object]]:
        return {
            "ping": self._handle_ping,
            "torchRuntimeInfo": self._handle_torchRuntimeInfo,
            "chooseDirectory": self._handle_chooseDirectory,
            "chooseImageFile": self._handle_chooseImageFile,
            "chooseClassifierModel": self._handle_chooseClassifierModel,
            "chooseTrainModelFile": self._handle_chooseTrainModelFile,
            "chooseVideoFiles": self._handle_chooseVideoFiles,
            "chooseVideoFolder": self._handle_chooseVideoFolder,
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
            "openFolder": self._handle_openFolder,
            "createWorkspace": self._handle_createWorkspace,
            "getWorkspaceInfo": self._handle_getWorkspaceInfo,
            "listWorkspaceFiles": self._handle_listWorkspaceFiles,
            "scanImagePool": self._handle_scanImagePool,
            "markImagePoolSeen": self._handle_markImagePoolSeen,
            "readMetadataRows": self._handle_readMetadataRows,
            "listClfDatasetClasses": self._handle_listClfDatasetClasses,
            "upsertMetadataRows": self._handle_upsertMetadataRows,
            "getWorkspaceClasses": self._handle_getWorkspaceClasses,
            "buildYoloLinks": self._handle_buildYoloLinks,
            "startBuildYoloLinks": self._handle_startBuildYoloLinks,
            "getBuildJob": self._handle_getBuildJob,
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
            "classifyDatasetImages": self._handle_classifyDatasetImages,
            "classifyFolderWithPt": self._handle_classifyFolderWithPt,
            "detectFolderWithPt": self._handle_detectFolderWithPt,
            "startClassifyFolderWithPt": self._handle_startClassifyFolderWithPt,
            "startDetectFolderWithPt": self._handle_startDetectFolderWithPt,
            "getPtJob": self._handle_getPtJob,
            "cancelPtJob": self._handle_cancelPtJob,
            "trackYoloForward": self._handle_trackYoloForward,
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

    def _handle_chooseClassifierModel(self, args: list[Any]) -> object:
            return self._choose_classifier_model(args[0] if args else "Choose ONNX Classifier")

    def _handle_chooseTrainModelFile(self, args: list[Any]) -> object:
            return self._choose_train_model_file(args[0] if args else "Choose YOLO Model")

    def _handle_chooseVideoFiles(self, args: list[Any]) -> object:
            return self._choose_video_files(args[0] if args else "Choose Videos")

    def _handle_chooseVideoFolder(self, args: list[Any]) -> object:
            folder = self._choose_directory(args[0] if args else "Choose Video Folder")
            return videos_json(find_videos(self.path_access.require_path(folder))) if folder else "[]"

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
            root_path = self.path_access.require_path(args[0])
            if not root_path.is_dir():
                return "[]"
            files = []
            for path in root_path.rglob("*"):
                if not is_dataset_index_file(path):
                    continue
                rel = path.relative_to(root_path).as_posix()
                if "originals_before_edit" in rel.lower():
                    continue
                try:
                    if not path.is_file():
                        continue
                    if path.suffix.lower() in IMAGE_EXTENSIONS and path.stat().st_size <= 0:
                        continue
                except OSError:
                    continue
                files.append(rel)
            return json.dumps(sorted(files), ensure_ascii=False)

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
            return json.dumps(read_app_settings(self.session_dir), ensure_ascii=False)

    def _handle_writeAppSettings(self, args: list[Any]) -> object:
            write_app_settings(self.session_dir, json.loads(args[0] or "{}"))
            return True

    def _handle_openFolder(self, args: list[Any]) -> object:
            root = self.path_access.remember_parent(str(args[0]))
            init_if_needed = bool(args[1]) if len(args) > 1 else True
            try:
                payload = resolve_open_folder(Path(root), init_if_needed=init_if_needed)
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

    def _handle_getWorkspaceInfo(self, args: list[Any]) -> object:
            try:
                root = self.path_access.require_path(args[0])
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
            root = self.path_access.require_path(args[0])
            updates = json.loads(args[1] or "[]")
            return json.dumps(upsert_metadata_rows(Path(root), updates), ensure_ascii=False)

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
        job_id = uuid.uuid4().hex
        state: dict[str, Any] = {
            "id": job_id,
            "status": "running",
            "done": 0,
            "total": 1,
            "detail": "准备构建...",
            "errors": [],
            "result": None,
        }
        with self._build_jobs_lock:
            self._build_jobs[job_id] = state

        def update(done: int, total: int, detail: str) -> None:
            with self._build_jobs_lock:
                current = self._build_jobs.get(job_id)
                if current:
                    current["done"] = done
                    current["total"] = max(total, 1)
                    current["detail"] = detail

        def run() -> None:
            try:
                result = build_workspace_links(
                    Path(root),
                    rebuild=rebuild,
                    filenames=filenames,
                    progress_callback=update,
                )
                with self._build_jobs_lock:
                    current = self._build_jobs.get(job_id)
                    if current:
                        current["status"] = "done" if result.get("ok", True) else "error"
                        current["done"] = current.get("total") or current.get("done") or 0
                        current["errors"] = result.get("errors") or []
                        current["result"] = result
                        current["detail"] = "构建完成" if result.get("ok", True) else "构建完成但有错误"
            except Exception as error:
                with self._build_jobs_lock:
                    current = self._build_jobs.get(job_id)
                    if current:
                        current["status"] = "error"
                        current["errors"] = [str(error)]
                        current["detail"] = str(error)

        threading.Thread(target=run, daemon=True).start()
        return self._build_job_snapshot(job_id)

    def _build_job_snapshot(self, job_id: str) -> dict[str, Any]:
        with self._build_jobs_lock:
            state = self._build_jobs.get(job_id)
            if not state:
                raise ValueError("Build job not found.")
            return {key: value for key, value in state.items()}

    def _handle_readImagePoolThumb(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            max_size = int(args[2]) if len(args) > 2 else 128
            quality = int(args[3]) if len(args) > 3 else 54
            return image_pool_thumbnail_base64(
                Path(root),
                str(args[1]),
                max_size=max_size,
                quality=quality,
                session_dir=self.session_dir,
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
            return read_workspace_session(root)

    def _handle_writeWorkspaceSession(self, args: list[Any]) -> object:
            root = self.path_access.require_path(args[0])
            return write_workspace_session(root, str(args[1]))

    def _handle_readSessionFile(self, args: list[Any]) -> object:
            return self.session_file.read_text(encoding="utf-8") if self.session_file.exists() else ""

    def _handle_writeSessionFile(self, args: list[Any]) -> object:
            json.loads(args[0])
            self.session_dir.mkdir(parents=True, exist_ok=True)
            self.session_file.write_text(args[0], encoding="utf-8")
            return str(self.session_file)

    def _handle_saveMaskNoiseTempImage(self, args: list[Any]) -> object:
            self.session_dir.mkdir(parents=True, exist_ok=True)
            return mask_noise_save_temp_image(self.session_dir, args[0], args[1])

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

    def _handle_startClassifyFolderWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_job("classify", args), ensure_ascii=False)

    def _handle_startDetectFolderWithPt(self, args: list[Any]) -> object:
            return json.dumps(self._start_pt_job("detect", args), ensure_ascii=False)

    def _handle_getPtJob(self, args: list[Any]) -> object:
            return json.dumps(self._pt_job_snapshot(str(args[0])), ensure_ascii=False)

    def _handle_cancelPtJob(self, args: list[Any]) -> object:
            return json.dumps(self._cancel_pt_job(str(args[0])), ensure_ascii=False)

    def _start_pt_job(self, kind: str, args: list[Any]) -> dict[str, Any]:
        job_id = uuid.uuid4().hex
        cancel_event = threading.Event()
        state: dict[str, Any] = {
            "id": job_id,
            "kind": kind,
            "status": "running",
            "done": 0,
            "total": 0,
            "detail": "Starting...",
            "errors": [],
            "result": None,
            "cancelEvent": cancel_event,
        }
        with self._pt_jobs_lock:
            self._pt_jobs[job_id] = state

        def update(done: int, total: int, detail: str) -> None:
            with self._pt_jobs_lock:
                current = self._pt_jobs.get(job_id)
                if current:
                    current["done"] = done
                    current["total"] = total
                    current["detail"] = detail

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
                with self._pt_jobs_lock:
                    current = self._pt_jobs.get(job_id)
                    if current:
                        current["status"] = "cancelled" if result.get("cancelled") else "done"
                        current["done"] = max(int(current.get("done") or 0), done)
                        current["total"] = int(result.get("total") or current.get("total") or 0)
                        current["errors"] = result.get("errors") or []
                        current["result"] = result
                        current["detail"] = "Cancelled." if result.get("cancelled") else "Done."
            except Exception as error:
                with self._pt_jobs_lock:
                    current = self._pt_jobs.get(job_id)
                    if current:
                        current["status"] = "error"
                        current["errors"] = [str(error)]
                        current["detail"] = str(error)

        threading.Thread(target=run, daemon=True).start()
        return self._pt_job_snapshot(job_id)

    def _pt_job_snapshot(self, job_id: str) -> dict[str, Any]:
        with self._pt_jobs_lock:
            state = self._pt_jobs.get(job_id)
            if not state:
                raise ValueError("PT job not found.")
            return {key: value for key, value in state.items() if key != "cancelEvent"}

    def _cancel_pt_job(self, job_id: str) -> dict[str, Any]:
        with self._pt_jobs_lock:
            state = self._pt_jobs.get(job_id)
            if not state:
                raise ValueError("PT job not found.")
            cancel_event = state.get("cancelEvent")
            if cancel_event:
                cancel_event.set()
            state["detail"] = "Cancelling..."
            return {key: value for key, value in state.items() if key != "cancelEvent"}

    def _start_capture_video_screenshot_jobs(self, args: list[Any]) -> dict[str, Any]:
        jobs = json.loads(args[0] or "[]")
        for job in jobs:
            job["path"] = str(self.path_access.require_path(job.get("path") or ""))
        output_dir = self.path_access.require_path(args[1])
        interval = float(args[2])
        prefix = str(args[3]) if len(args) > 3 else ""
        image_format = str(args[4]) if len(args) > 4 else "jpg"
        total = int(args[5]) if len(args) > 5 else 0
        job_id = uuid.uuid4().hex
        cancel_event = threading.Event()
        state: dict[str, Any] = {
            "id": job_id,
            "status": "running",
            "saved": 0,
            "total": total,
            "detail": "Starting export...",
            "errors": [],
            "result": None,
            "cancelEvent": cancel_event,
        }
        with self._capture_jobs_lock:
            self._capture_jobs[job_id] = state

        def update(saved: int, detail: str) -> None:
            with self._capture_jobs_lock:
                current = self._capture_jobs.get(job_id)
                if current:
                    current["saved"] = saved
                    current["detail"] = detail

        def run() -> None:
            try:
                result = capture_video_screenshot_jobs(jobs, output_dir, interval, prefix, image_format, update, cancel_event)
                with self._capture_jobs_lock:
                    current = self._capture_jobs.get(job_id)
                    if current:
                        current["status"] = "cancelled" if result.get("cancelled") else "done"
                        current["saved"] = int(result.get("saved") or current["saved"])
                        current["errors"] = result.get("errors") or []
                        current["result"] = result
                        current["detail"] = "Cancelled." if result.get("cancelled") else "Done."
            except Exception as error:
                with self._capture_jobs_lock:
                    current = self._capture_jobs.get(job_id)
                    if current:
                        current["status"] = "error"
                        current["errors"] = [str(error)]
                        current["detail"] = str(error)

        threading.Thread(target=run, daemon=True).start()
        return self._capture_job_snapshot(job_id)

    def _capture_job_snapshot(self, job_id: str) -> dict[str, Any]:
        with self._capture_jobs_lock:
            state = self._capture_jobs.get(job_id)
            if not state:
                raise ValueError("Capture job not found.")
            return {key: value for key, value in state.items() if key != "cancelEvent"}

    def _cancel_capture_job(self, job_id: str) -> dict[str, Any]:
        with self._capture_jobs_lock:
            state = self._capture_jobs.get(job_id)
            if not state:
                raise ValueError("Capture job not found.")
            cancel_event = state.get("cancelEvent")
            if cancel_event:
                cancel_event.set()
            state["detail"] = "Cancelling..."
            return {key: value for key, value in state.items() if key != "cancelEvent"}

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

    def _unique_path(self, path: Path) -> Path:
        if not path.exists():
            return path
        for index in range(2, 10000):
            candidate = path.with_name(f"{path.stem}_{index}{path.suffix}")
            if not candidate.exists():
                return candidate
        raise FileExistsError(f"Cannot create a unique path for {path}")
