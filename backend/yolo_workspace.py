from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .workspace_snapshot_versions import (
    find_snapshot_container_for_version,
    is_snapshot_versioned_workspace,
    snapshot_open_payload,
)

WORKSPACE_CONFIG_FILENAME = "workspace.json"
WORKSPACE_META_DIRNAME = "workspace"
MEDIA_DIRNAME = "media"
LEGACY_IMAGE_POOL_DIRNAME = "image_pool"
APP_SETTINGS_FILENAME = "yolo_app_settings.json"
WORKSPACE_SESSION_DIRNAME = WORKSPACE_META_DIRNAME
LEGACY_WORKSPACE_SESSION_DIRNAME = ".yolo_label_viewer"
WORKSPACE_SESSION_FILENAME = "session.json"
LEGACY_APP_SESSION_FILENAME = "yolo_label_viewer_session.json"
LEGACY_INBOX_WORKFLOW_FILENAME = "inbox_workflow.json"
DEFAULT_APP_SETTINGS = {
    "version": 3,
    "lastOpenedFolder": "",
    "lastOpenedWorkspace": "",
    "lastOpenedYoloFolder": "",
    "startupOverlayMode": "overview",
    "sidebarCollapsed": False,
}
MAX_INBOX_ASSIGN_BATCHES = 2000
MAX_INBOX_BUILD_RUNS = 500
DEFAULT_CLF_CLASSES = ("class_A", "class_B", "unknown", "background")
METADATA_HEADER = "filename,split,detect_enabled,clf_enabled,clf_class,detect_junk,reviewed,flagged\n"
METADATA_EXAMPLE_ROWS = """img001.png,train,1,1,class_A
img002.png,train,1,1,class_B
img003.png,val,1,1,background
img004.png,val,1,0,
img005.png,train,0,1,unknown
"""
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
DATASET_META_EXTENSIONS = frozenset({".txt", ".yaml", ".yml", ".csv"})
VALID_SPLITS = frozenset({"train", "val"})
V2_WORKSPACE_RELATIVE_DIRS = (
    Path(WORKSPACE_META_DIRNAME) / "annotations",
    Path(WORKSPACE_META_DIRNAME) / "logs",
    Path(WORKSPACE_META_DIRNAME) / "video_annotations",
    Path(".cache"),
    Path("exports"),
    Path("video_segments"),
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def is_dataset_index_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    return suffix in IMAGE_EXTENSIONS or suffix in DATASET_META_EXTENSIONS


def list_dataset_files(dataset_root: Path) -> list[str]:
    """Return browsable dataset files relative to a YOLO dataset root."""
    root = dataset_root.expanduser().resolve()
    if not root.is_dir():
        return []

    files: list[str] = []
    for path in root.rglob("*"):
        if not is_dataset_index_file(path):
            continue
        relative_path = path.relative_to(root).as_posix()
        if "originals_before_edit" in relative_path.lower():
            continue
        try:
            if not path.is_file():
                continue
            if path.suffix.lower() in IMAGE_EXTENSIONS and path.stat().st_size <= 0:
                continue
        except OSError:
            continue
        files.append(relative_path)
    return sorted(files)


@dataclass
class WorkspacePaths:
    root: Path
    image_pool: Path
    metadata: Path
    detect_out: Path
    clf_out: Path
    label_source: Path


@dataclass
class InitStats:
    dirs_created: int = 0
    files_created: int = 0
    skipped: list[str] = field(default_factory=list)


def sanitize_class_name(class_name: str) -> str:
    value = class_name.strip()
    for char in '<>:"/\\|?*':
        value = value.replace(char, "_")
    value = value.strip(" .")
    if not value:
        raise ValueError("Class folder name is invalid after sanitization.")
    return value[:120]


def parse_class_names(raw: str) -> list[str]:
    classes = [sanitize_class_name(part) for part in raw.split(",") if part.strip()]
    if not classes:
        raise ValueError("At least one classification class is required.")
    return classes


def _has_workspace_data_dir(root: Path) -> bool:
    return (
        (root / MEDIA_DIRNAME).is_dir()
        or (root / LEGACY_IMAGE_POOL_DIRNAME).is_dir()
        or (root / "detect_labels").is_dir()
        or (root / "detect_dataset").is_dir()
        or (root / "clf_dataset").is_dir()
    )


def workspace_root_path(path: Path) -> Path:
    root = path.expanduser().resolve()
    if (
        root.name == WORKSPACE_META_DIRNAME
        and (root / WORKSPACE_CONFIG_FILENAME).is_file()
        and _has_workspace_data_dir(root.parent)
    ):
        return root.parent
    return root


def workspace_meta_dir(workspace_root: Path) -> Path:
    return workspace_root_path(workspace_root) / WORKSPACE_META_DIRNAME


def workspace_config_file(workspace_root: Path) -> Path:
    root = workspace_root_path(workspace_root)
    new_path = workspace_meta_dir(root) / WORKSPACE_CONFIG_FILENAME
    if new_path.is_file():
        return new_path
    return root / WORKSPACE_CONFIG_FILENAME


def is_workspace_root(path: Path) -> bool:
    return workspace_config_file(path).is_file()


def looks_like_workspace(root: Path) -> bool:
    """True when folder is (or should be) a YOLO hard-link workspace root."""
    root = workspace_root_path(root)
    if is_workspace_root(root):
        return True
    if (root / MEDIA_DIRNAME).is_dir() or (root / LEGACY_IMAGE_POOL_DIRNAME).is_dir():
        return True
    if (root / "detect_labels").is_dir():
        return True
    if (root / "detect_dataset").is_dir() or (root / "clf_dataset").is_dir():
        return True
    return False


def find_parent_workspace(path: Path) -> Path | None:
    """Return the nearest ancestor directory that is a YOLO workspace root."""
    current = workspace_root_path(path)
    for parent in current.parents:
        if is_workspace_root(parent):
            return parent
        if ((parent / MEDIA_DIRNAME).is_dir() or (parent / LEGACY_IMAGE_POOL_DIRNAME).is_dir()) and (
            (parent / "detect_labels").is_dir()
            or (parent / "detect_dataset").is_dir()
            or (parent / "clf_dataset").is_dir()
        ):
            return parent
    return None


def infer_dataset_task(root: Path) -> str:
    """Return ``detect`` or ``classify`` from on-disk dataset layout."""
    root = root.expanduser().resolve()
    if (root / "images").is_dir() or (root / "labels").is_dir():
        return "detect"
    for split in ("val", "train", "test"):
        split_dir = root / split
        if not split_dir.is_dir():
            continue
        if any(child.is_dir() for child in split_dir.iterdir()):
            return "classify"
    return "detect"


def looks_like_yolo_dataset(root: Path) -> bool:
    """True for classic YOLO train/val or images/labels dataset folders."""
    root = root.expanduser().resolve()
    if (root / "data.yaml").is_file():
        return True
    if (root / "images").is_dir() or (root / "labels").is_dir():
        return True
    for split in ("train", "val", "test"):
        split_dir = root / split
        if not split_dir.is_dir():
            continue
        if any(child.is_dir() for child in split_dir.iterdir()):
            return True
        if (root / "images" / split).is_dir() or (root / "labels" / split).is_dir():
            return True
    return False


def resolve_open_folder(root: Path, *, init_if_needed: bool = True) -> dict[str, Any]:
    """
    VS Code-style open folder: pick one directory, auto-detect how to use it.
    Plain folders become YOLO workspaces (scaffold created when needed).
    """
    root = workspace_root_path(root)
    if not root.is_dir():
        raise NotADirectoryError(f"Not a directory: {root}")

    snapshot_container = root if is_snapshot_versioned_workspace(root) else find_snapshot_container_for_version(root)
    if snapshot_container is not None:
        payload = snapshot_open_payload(snapshot_container)
        active_path = Path(str(payload["activeVersionPath"]))
        if init_if_needed:
            if is_workspace_root(active_path):
                ensure_workspace_v2_structure(active_path)
            else:
                create_workspace(active_path)
        return payload

    if looks_like_workspace(root):
        initialized = False
        if init_if_needed and not is_workspace_root(root):
            create_workspace(root)
            initialized = True
        elif init_if_needed:
            ensure_workspace_v2_structure(root)
        return {
            "ok": True,
            "kind": "workspace",
            "root": str(root),
            "name": root.name,
            "initialized": initialized,
        }

    if looks_like_yolo_dataset(root):
        payload: dict[str, Any] = {
            "ok": True,
            "kind": "dataset",
            "root": str(root),
            "name": root.name,
            "initialized": False,
        }
        parent_ws = find_parent_workspace(root)
        if parent_ws is not None:
            payload["parentWorkspace"] = str(parent_ws)
        return payload

    if init_if_needed:
        stats = create_workspace(root)
        payload = init_stats_payload(stats)
        payload.update(
            {
                "kind": "workspace",
                "root": str(root),
                "name": root.name,
                "initialized": True,
            }
        )
        return payload

    return {
        "ok": True,
        "kind": "unknown",
        "root": str(root),
        "name": root.name,
        "initialized": False,
    }


def load_workspace_config(workspace_root: Path) -> WorkspacePaths:
    root = workspace_root_path(workspace_root)
    config_path = workspace_config_file(root)
    if not config_path.is_file():
        raise FileNotFoundError(
            f"Workspace config not found under {root / WORKSPACE_META_DIRNAME}. Run init to create a workspace."
        )

    data = json.loads(config_path.read_text(encoding="utf-8"))
    paths = data.get("paths")
    if not isinstance(paths, dict):
        raise ValueError(f"Invalid workspace.json (missing paths): {config_path}")

    def _p(key: str) -> Path:
        value = paths.get(key)
        if not value:
            raise ValueError(f"workspace.json missing paths.{key}")
        path = Path(value)
        if not path.is_absolute():
            path = root / path
        return path.resolve()

    return WorkspacePaths(
        root=root,
        image_pool=_p("image_pool"),
        metadata=_p("metadata"),
        detect_out=_p("detect_dataset"),
        clf_out=_p("clf_dataset"),
        label_source=_p("detect_labels"),
    )


def workspace_media_relative_dir(paths: WorkspacePaths) -> str:
    try:
        relative = paths.image_pool.resolve().relative_to(paths.root.resolve()).as_posix()
    except ValueError:
        return MEDIA_DIRNAME
    return relative or MEDIA_DIRNAME


def workspace_info(workspace_root: Path) -> dict[str, Any]:
    from .image_pool import read_snapshot

    paths = load_workspace_config(workspace_root)
    snapshot = read_snapshot(paths.root)
    scan_cache = snapshot.get("scanCache") if isinstance(snapshot.get("scanCache"), dict) else None
    if scan_cache and isinstance(scan_cache.get("total"), int):
        image_count = int(scan_cache["total"])
    else:
        image_count = sum(
            1
            for path in paths.image_pool.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )
    label_count = sum(
        1 for path in paths.label_source.iterdir() if path.is_file() and path.suffix.lower() == ".txt"
    )
    return {
        "ok": True,
        "root": str(paths.root),
        "name": paths.root.name,
        "imagePool": str(paths.image_pool),
        "mediaDir": workspace_media_relative_dir(paths),
        "detectLabels": str(paths.label_source),
        "metadata": str(paths.metadata),
        "detectDataset": str(paths.detect_out),
        "clfDataset": str(paths.clf_out),
        "detectTrainData": str(paths.detect_out / "data.yaml"),
        "clfTrainData": str(paths.clf_out),
        "runsDetect": str(paths.root / "runs" / "detect"),
        "runsClassify": str(paths.root / "runs" / "classify"),
        "detectBest": str(paths.root / "runs" / "detect" / "train" / "weights" / "best.pt"),
        "clfBest": str(paths.root / "runs" / "classify" / "train" / "weights" / "best.pt"),
        "autoLabelDetectOutput": str(paths.root / "auto_label" / "detect_dataset"),
        "autoLabelClfOutput": str(paths.root / "auto_label" / "clf_dataset"),
        "imageCount": image_count,
        "labelCount": label_count,
    }


def list_workspace_files(workspace_root: Path) -> list[str]:
    """Relative paths under workspace root for Box Label / workspace annotation UI."""
    paths = load_workspace_config(workspace_root)
    root = paths.root
    files: list[str] = []
    media_dir = workspace_media_relative_dir(paths)
    if paths.image_pool.is_dir():
        for path in sorted(paths.image_pool.iterdir()):
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
                files.append(f"{media_dir}/{path.name}")
    if paths.label_source.is_dir():
        for path in sorted(paths.label_source.iterdir()):
            if path.is_file() and path.suffix.lower() == ".txt":
                files.append(f"detect_labels/{path.name}")
    for split in VALID_SPLITS:
        labels_dir = paths.detect_out / "labels" / split
        if not labels_dir.is_dir():
            continue
        for path in sorted(labels_dir.iterdir()):
            if path.is_file() and path.suffix.lower() == ".txt":
                files.append(f"detect_dataset/labels/{split}/{path.name}")
    for rel in ("data.yaml", "classes.txt", Path("detect_dataset") / "data.yaml"):
        candidate = root / rel
        if candidate.is_file():
            files.append(candidate.relative_to(root).as_posix())
    return sorted(set(files))


def _default_media_dir_for_workspace(workspace_root: Path) -> str:
    if (workspace_root / LEGACY_IMAGE_POOL_DIRNAME).exists() and not (workspace_root / MEDIA_DIRNAME).exists():
        return LEGACY_IMAGE_POOL_DIRNAME
    return MEDIA_DIRNAME


def _workspace_relative_dirs(classes: list[str], *, media_dir: str = MEDIA_DIRNAME) -> list[Path]:
    rel_paths = [
        Path(WORKSPACE_META_DIRNAME),
        Path(media_dir),
        Path("image_pool_backup"),
        Path("image_pool_backup") / "labels",
        Path("detect_labels"),
        Path("detect_dataset") / "images" / "train",
        Path("detect_dataset") / "images" / "val",
        Path("detect_dataset") / "labels" / "train",
        Path("detect_dataset") / "labels" / "val",
        Path("runs") / "detect",
        Path("runs") / "classify",
        Path("auto_label") / "detect_dataset",
        Path("auto_label") / "clf_dataset",
    ]
    for split in VALID_SPLITS:
        for class_name in classes:
            rel_paths.append(Path("clf_dataset") / split / class_name)
    return rel_paths


def _write_text_file(
    path: Path,
    content: str,
    *,
    dry_run: bool,
    force: bool,
    stats: InitStats,
) -> None:
    if path.exists() and not force:
        stats.skipped.append(str(path))
        return
    if dry_run:
        stats.files_created += 1
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    stats.files_created += 1


def ensure_workspace_v2_structure(
    workspace_root: Path,
    *,
    dry_run: bool = False,
    force: bool = False,
) -> InitStats:
    workspace_root = workspace_root_path(workspace_root)
    stats = InitStats()
    for rel in V2_WORKSPACE_RELATIVE_DIRS:
        target = workspace_root / rel
        if target.exists():
            stats.skipped.append(str(target))
            continue
        if dry_run:
            stats.dirs_created += 1
            continue
        target.mkdir(parents=True, exist_ok=True)
        stats.dirs_created += 1
    _write_text_file(
        workspace_root / "workspace" / "sources.json",
        json.dumps({"version": 1, "sources": []}, indent=2, ensure_ascii=False) + "\n",
        dry_run=dry_run,
        force=force,
        stats=stats,
    )
    return stats


def create_workspace(
    workspace_root: Path,
    *,
    classes: list[str] | None = None,
    dry_run: bool = False,
    force: bool = False,
) -> InitStats:
    workspace_root = workspace_root_path(workspace_root)
    if not dry_run:
        workspace_root.mkdir(parents=True, exist_ok=True)
    class_names = list(classes or DEFAULT_CLF_CLASSES)
    stats = InitStats()
    media_dir = _default_media_dir_for_workspace(workspace_root)

    for rel in _workspace_relative_dirs(class_names, media_dir=media_dir):
        target = workspace_root / rel
        if target.exists():
            stats.skipped.append(str(target))
            continue
        if dry_run:
            stats.dirs_created += 1
            continue
        target.mkdir(parents=True, exist_ok=True)
        stats.dirs_created += 1

    now = _utc_now_iso()
    config = {
        "version": 2,
        "type": "yolo-workbench",
        "name": workspace_root.name,
        "createdAt": now,
        "updatedAt": now,
        "paths": {
            "image_pool": media_dir,
            "detect_labels": "detect_labels",
            "metadata": "metadata.csv",
            "detect_dataset": "detect_dataset",
            "clf_dataset": "clf_dataset",
            "video_annotations": "workspace/video_annotations",
            "video_segments": "video_segments",
            "exports": "exports",
            "cache": ".cache",
            "logs": "workspace/logs",
            "sources": "workspace/sources.json",
            "classes": "workspace/classes.json",
            "annotations": "workspace/annotations",
        },
        "tools": {
            "videoLabel": {
                "enabled": True,
                "primary": True,
                "persistence": "timestamp-manifest",
                "saveExtractedFrames": False,
            },
            "imageLabel": {
                "enabled": True,
                "secondary": True,
            },
            "imagePool": {"enabled": True, "secondary": True},
            "datasetPrep": {"enabled": True},
            "autoLabel": {"enabled": True},
            "crop": {"enabled": True},
            "maskCleanup": {"enabled": True},
            "merge": {"enabled": True},
        },
        "classification_classes": class_names,
    }
    _write_text_file(
        workspace_meta_dir(workspace_root) / WORKSPACE_CONFIG_FILENAME,
        json.dumps(config, indent=2, ensure_ascii=False) + "\n",
        dry_run=dry_run,
        force=force,
        stats=stats,
    )

    v2_stats = ensure_workspace_v2_structure(workspace_root, dry_run=dry_run, force=force)
    stats.dirs_created += v2_stats.dirs_created
    stats.files_created += v2_stats.files_created
    stats.skipped.extend(v2_stats.skipped)

    metadata_path = workspace_root / "metadata.csv"
    if not metadata_path.exists() or force:
        metadata_body = METADATA_HEADER + METADATA_EXAMPLE_ROWS
        _write_text_file(
            metadata_path,
            metadata_body,
            dry_run=dry_run,
            force=force or not metadata_path.exists(),
            stats=stats,
        )
    else:
        stats.skipped.append(str(metadata_path))

    readme_text = f"""YOLO workspace: {workspace_root.name}
================================

Folders
-------
workspace/           App metadata, v2 manifests, sources, logs, and annotations.
{media_dir}/          Put all source images here (manually managed).
image_pool_backup/   Auto backup of originals before Crop / black edits (app-managed).
detect_labels/       YOLO detection .txt labels (stem = image stem).
metadata.csv         Controls train/val and detect/clf assignment.
detect_dataset/      Generated detection dataset (hard links).
clf_dataset/         Generated classification dataset (hard links).
video_segments/      Captured video segment metadata.
exports/             Generated video/image export outputs.

App workflow
------------
1. Add images to {media_dir}/
2. Annotate in YoloWorkBench (labels save to detect_labels/)
3. Edit metadata.csv
4. Build datasets:
   python build_yolo_links.py build --workspace "{workspace_root}" --rebuild

Classes: {", ".join(class_names)}
"""
    _write_text_file(
        workspace_root / "WORKSPACE_README.txt",
        readme_text,
        dry_run=dry_run,
        force=force,
        stats=stats,
    )
    return stats


def init_stats_payload(stats: InitStats) -> dict[str, Any]:
    return {
        "ok": True,
        "dirsCreated": stats.dirs_created,
        "filesCreated": stats.files_created,
        "skipped": stats.skipped,
    }


def app_settings_path(session_dir: Path) -> Path:
    return session_dir / APP_SETTINGS_FILENAME


def read_app_settings(session_dir: Path) -> dict[str, Any]:
    path = app_settings_path(session_dir)
    if not path.is_file():
        return dict(DEFAULT_APP_SETTINGS)
    try:
        raw = path.read_text(encoding="utf-8")
        data = json.loads(raw)
    except (OSError, PermissionError, json.JSONDecodeError) as error:
        print(f"[backend] readAppSettings failed: {error}", file=sys.stderr, flush=True)
        return dict(DEFAULT_APP_SETTINGS)
    if not isinstance(data, dict):
        return dict(DEFAULT_APP_SETTINGS)
    data.setdefault("version", 3)
    data["lastOpenedFolder"] = str(
        data.get("lastOpenedFolder") or data.get("lastWorkspace") or ""
    )
    data["lastOpenedWorkspace"] = str(data.get("lastOpenedWorkspace") or "")
    data["lastOpenedYoloFolder"] = str(data.get("lastOpenedYoloFolder") or "")
    mode = str(data.get("startupOverlayMode") or "overview").strip().lower()
    data["startupOverlayMode"] = "minimal" if mode == "minimal" else "overview"
    data["sidebarCollapsed"] = bool(data.get("sidebarCollapsed"))
    return data


def write_app_settings(session_dir: Path, settings: dict[str, Any]) -> str:
    session_dir.mkdir(parents=True, exist_ok=True)
    current = read_app_settings(session_dir)
    current.update(settings if isinstance(settings, dict) else {})
    mode = str(current.get("startupOverlayMode") or "overview").strip().lower()
    payload = {
        "version": 3,
        "lastOpenedFolder": str(
            current.get("lastOpenedFolder") or current.get("lastWorkspace") or ""
        ),
        "lastOpenedWorkspace": str(current.get("lastOpenedWorkspace") or ""),
        "lastOpenedYoloFolder": str(current.get("lastOpenedYoloFolder") or ""),
        "startupOverlayMode": "minimal" if mode == "minimal" else "overview",
        "sidebarCollapsed": bool(current.get("sidebarCollapsed")),
    }
    path = app_settings_path(session_dir)
    try:
        path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except (OSError, PermissionError) as error:
        print(f"[backend] writeAppSettings failed: {error}", file=sys.stderr, flush=True)
        raise
    return str(path)


def workspace_session_file(workspace_root: Path) -> Path:
    return workspace_meta_dir(workspace_root) / WORKSPACE_SESSION_FILENAME


def legacy_workspace_session_dir(workspace_root: Path) -> Path:
    return workspace_root_path(workspace_root) / LEGACY_WORKSPACE_SESSION_DIRNAME


def legacy_workspace_session_file(workspace_root: Path) -> Path:
    return legacy_workspace_session_dir(workspace_root) / WORKSPACE_SESSION_FILENAME


def legacy_workspace_session_files(workspace_root: Path) -> list[Path]:
    root = workspace_root_path(workspace_root)
    return [
        workspace_meta_dir(root) / LEGACY_APP_SESSION_FILENAME,
        legacy_workspace_session_file(root),
    ]


def default_inbox_session() -> dict[str, Any]:
    return {
        "assignBatches": [],
        "buildRuns": [],
        "ui": {
            "filter": "new",
            "split": "train",
            "detectEnabled": False,
            "clfEnabled": True,
        },
    }


def _json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def _session_version(value: Any, default: int = 2) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def normalize_inbox_session(data: dict[str, Any] | None) -> dict[str, Any]:
    base = default_inbox_session()
    if not isinstance(data, dict):
        return base
    ui = data.get("ui") if isinstance(data.get("ui"), dict) else {}
    base["ui"] = {
        **base["ui"],
        "filter": str(ui.get("filter") or base["ui"]["filter"]),
        "split": str(ui.get("split") or base["ui"]["split"]),
        "detectEnabled": bool(ui.get("detectEnabled", base["ui"]["detectEnabled"])),
        "clfEnabled": bool(ui.get("clfEnabled", base["ui"]["clfEnabled"])),
    }
    base["assignBatches"] = _json_list(data.get("assignBatches"))[-MAX_INBOX_ASSIGN_BATCHES:]
    base["buildRuns"] = _json_list(data.get("buildRuns"))[-MAX_INBOX_BUILD_RUNS:]
    return base


def _migrate_legacy_inbox_workflow(workspace_root: Path, session: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    if session.get("inbox"):
        return session, False
    legacy_path = (
        legacy_workspace_session_dir(workspace_root)
        / LEGACY_INBOX_WORKFLOW_FILENAME
    )
    if not legacy_path.is_file():
        return session, False
    try:
        legacy = json.loads(legacy_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return session, False
    session = dict(session)
    session["inbox"] = normalize_inbox_session(legacy)
    session["version"] = max(_session_version(session.get("version")), 3)
    return session, True


def read_workspace_session_dict(workspace_root: Path) -> dict[str, Any]:
    path = workspace_session_file(workspace_root)
    legacy_paths = legacy_workspace_session_files(workspace_root)
    session: dict[str, Any] = {}
    file_size = 0
    read_path = path
    if not read_path.is_file():
        read_path = next((candidate for candidate in legacy_paths if candidate.is_file()), path)
    if read_path.is_file():
        try:
            file_size = read_path.stat().st_size
            loaded = json.loads(read_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                session = loaded
        except (OSError, json.JSONDecodeError):
            session = {}
    migrated_from_legacy_session = read_path in legacy_paths and bool(session)
    session, migrated_inbox = _migrate_legacy_inbox_workflow(workspace_root, session)
    migrated = migrated_from_legacy_session or migrated_inbox
    if migrated:
        write_workspace_session_dict(workspace_root, session)
    if session.get("inbox"):
        session["inbox"] = normalize_inbox_session(session["inbox"])
        if file_size > 500_000:
            session = dict(session)
            session["inbox"] = compact_inbox_session_for_storage(session["inbox"])
            write_workspace_session_dict(workspace_root, session)
    return session


def write_workspace_session_dict(workspace_root: Path, session: dict[str, Any]) -> str:
    path = workspace_session_file(workspace_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = dict(session)
    if payload.get("inbox"):
        payload["inbox"] = compact_inbox_session_for_storage(payload["inbox"])
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path)


def compact_inbox_session_for_storage(inbox: dict[str, Any] | None) -> dict[str, Any]:
    """Keep pending assign batches plus a short history so session.json stays small."""
    normalized = normalize_inbox_session(inbox)
    batches = [batch for batch in _json_list(normalized.get("assignBatches")) if isinstance(batch, dict)]
    pending = [batch for batch in batches if not batch.get("built")]
    built = [batch for batch in batches if batch.get("built")]
    kept_built = []
    for batch in built[-40:]:
        slim = dict(batch)
        filenames = _json_list(slim.get("filenames"))
        slim["filenameCount"] = len(filenames)
        slim["filenames"] = []
        kept_built.append(slim)
    normalized["assignBatches"] = (pending + kept_built)[-MAX_INBOX_ASSIGN_BATCHES:]
    compact_runs = []
    build_runs = [run for run in _json_list(normalized.get("buildRuns")) if isinstance(run, dict)]
    for run in build_runs[-20:]:
        slim_run = dict(run)
        filenames = _json_list(slim_run.get("filenames"))
        slim_run["filenameCount"] = len(filenames)
        slim_run["filenames"] = []
        compact_runs.append(slim_run)
    normalized["buildRuns"] = compact_runs
    return normalized


def lite_workspace_session(session: dict[str, Any]) -> dict[str, Any]:
    """UI restore payload without multi-megabyte inbox history."""
    lite = dict(session)
    inbox = session.get("inbox") if isinstance(session.get("inbox"), dict) else {}
    ui = inbox.get("ui") if isinstance(inbox.get("ui"), dict) else {}
    base = default_inbox_session()
    lite["inbox"] = {
        **base,
        "ui": {
            **base["ui"],
            **ui,
        },
        "assignBatches": [],
        "buildRuns": [],
    }
    return lite


def read_workspace_session(workspace_root: Path, *, lite: bool = False) -> str:
    session = read_workspace_session_dict(workspace_root)
    if not session:
        return ""
    if lite:
        session = lite_workspace_session(session)
    return json.dumps(session, ensure_ascii=False)


def write_workspace_session(workspace_root: Path, session_json: str) -> str:
    payload = json.loads(session_json)
    if not isinstance(payload, dict):
        raise ValueError("Workspace session must be a JSON object.")
    return write_workspace_session_dict(workspace_root, payload)
