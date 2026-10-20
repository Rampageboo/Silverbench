"""Workspace storage layout, format v3.

A workspace is one folder with a ``rwb.json`` manifest. Files are grouped by
lifecycle (see docs/plans/storage-format-v3.md):

- source media (``media/``) is never copied or rewritten by the app;
- annotations (``labels/``, ``classes.json``) are the only source of truth;
- artifacts (``models/``, ``runs/``, ``exports/``) are produced from them;
- machine-local state and caches (``.rwb/``) can be deleted at any time.

Every path the app uses is defined here. The frontend receives ``RELATIVE_PATHS``
when a workspace opens and never hard-codes folder names itself.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic

FORMAT = "rwb-workspace"
FORMAT_VERSION = 3
MANIFEST_FILENAME = "rwb.json"

IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp"})
VIDEO_EXTENSIONS = frozenset({".mp4", ".mov", ".m4v", ".avi", ".mkv", ".webm", ".wmv", ".mpeg", ".mpg"})

# Workspace-relative paths (POSIX separators). Keys are shared with the frontend.
RELATIVE_PATHS: dict[str, str] = {
    "manifest": MANIFEST_FILENAME,
    "classes": "classes.json",
    "media": "media",
    # Annotations: the source of truth.
    "imageLabels": "labels/images",
    "imageStatus": "labels/images.csv",
    "videoLabels": "labels/videos",
    "segments": "labels/segments",
    "proposals": "labels/proposals",
    "overlays": "labels/overlays",
    "autolabelRuns": "labels/autolabel-runs.json",
    # Artifacts.
    "models": "models",
    "modelRegistry": "models/registry.json",
    "runs": "runs",
    "exports": "exports",
    "originals": "backups/originals",
    "versions": "versions",
    # Machine-local state and caches.
    "state": ".rwb",
    "session": ".rwb/session.json",
    "cache": ".rwb/cache",
    "thumbs": ".rwb/cache/thumbs",
    "videoProxy": ".rwb/cache/video-proxy",
    "frames": ".rwb/cache/frames",
    "scanCache": ".rwb/cache/scan.json",
    "logs": ".rwb/logs",
}

IMAGE_STATUS_HEADER = (
    "filename",
    "split",
    "detect_enabled",
    "clf_enabled",
    "clf_class",
    "detect_junk",
    "detect_export_enabled",
    "clf_export_enabled",
    "reviewed",
    "flagged",
)

# A detect class's YOLO id is its position in tasks.detect.classKeys.
DEFAULT_CLASSES_DOCUMENT: dict[str, Any] = {
    "version": 1,
    "classDefs": [],
    "tasks": {"detect": {"classKeys": []}, "clf": {"classKeys": []}},
}


class WorkspaceFormatError(ValueError):
    """The folder is not a v3 workspace (it may be an older format that needs migration)."""

    def __init__(self, message: str, *, legacy: bool = False):
        super().__init__(message)
        self.legacy = legacy


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@dataclass(frozen=True)
class WorkspaceLayout:
    root: Path

    def path(self, key: str) -> Path:
        return self.root / RELATIVE_PATHS[key]

    @property
    def manifest(self) -> Path:
        return self.path("manifest")

    @property
    def classes(self) -> Path:
        return self.path("classes")

    @property
    def media(self) -> Path:
        return self.path("media")

    @property
    def image_labels(self) -> Path:
        return self.path("imageLabels")

    @property
    def image_status(self) -> Path:
        return self.path("imageStatus")

    @property
    def video_labels(self) -> Path:
        return self.path("videoLabels")

    @property
    def originals(self) -> Path:
        return self.path("originals")

    @property
    def exports(self) -> Path:
        return self.path("exports")

    @property
    def state(self) -> Path:
        return self.path("state")

    @property
    def cache(self) -> Path:
        return self.path("cache")

    @property
    def logs(self) -> Path:
        return self.path("logs")

    def image_label_file(self, image_name: str) -> Path:
        """YOLO label file for a media image (same stem, ``.txt``)."""
        return self.image_labels / f"{Path(image_name).stem}.txt"

    def relative(self, path: Path) -> str:
        return path.resolve().relative_to(self.root.resolve()).as_posix()

    def read_manifest(self) -> dict[str, Any]:
        return json.loads(self.manifest.read_text(encoding="utf-8"))


def workspace_root_path(path: Path | str) -> Path:
    return Path(path).expanduser().resolve()


def is_workspace(path: Path | str) -> bool:
    manifest = workspace_root_path(path) / MANIFEST_FILENAME
    if not manifest.is_file():
        return False
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False
    return isinstance(data, dict) and data.get("format") == FORMAT


def find_workspace_root(path: Path | str) -> Path | None:
    """The v3 workspace containing ``path`` (itself or an ancestor), if any."""
    current = workspace_root_path(path)
    for candidate in (current, *current.parents):
        if is_workspace(candidate):
            return candidate
    return None


def open_workspace(path: Path | str) -> WorkspaceLayout:
    root = workspace_root_path(path)
    if not is_workspace(root):
        from .workspace_migration import detect_legacy_workspace

        if detect_legacy_workspace(root) is not None:
            raise WorkspaceFormatError(
                f"{root} uses an older workspace format. Migrate it before opening.", legacy=True
            )
        raise WorkspaceFormatError(f"Not a RampageWorkbench workspace (no {MANIFEST_FILENAME}): {root}")
    manifest = json.loads((root / MANIFEST_FILENAME).read_text(encoding="utf-8"))
    version = manifest.get("version")
    if not isinstance(version, int) or version > FORMAT_VERSION:
        raise WorkspaceFormatError(f"Unsupported workspace format version {version!r} in {root}")
    return WorkspaceLayout(root)


def manifest_document(name: str, *, workspace_id: str | None = None, created_at: str | None = None) -> dict[str, Any]:
    now = utc_now_iso()
    return {
        "format": FORMAT,
        "version": FORMAT_VERSION,
        "id": workspace_id or uuid.uuid4().hex,
        "name": name,
        "createdAt": created_at or now,
        "updatedAt": now,
    }


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def ensure_layout_dirs(layout: WorkspaceLayout) -> None:
    """Create the folders every workspace has; the rest appear on first use."""
    for key in ("media", "imageLabels"):
        layout.path(key).mkdir(parents=True, exist_ok=True)


def create_workspace(path: Path | str, *, name: str | None = None, classes: dict[str, Any] | None = None) -> WorkspaceLayout:
    """Create a new, empty v3 workspace in ``path`` (an empty or new folder)."""
    root = workspace_root_path(path)
    if is_workspace(root):
        raise WorkspaceFormatError(f"{root} is already a workspace.")
    from .workspace_migration import detect_legacy_workspace

    if detect_legacy_workspace(root) is not None:
        raise WorkspaceFormatError(f"{root} holds an older workspace. Migrate it instead.", legacy=True)
    root.mkdir(parents=True, exist_ok=True)
    layout = WorkspaceLayout(root)
    write_json(layout.manifest, manifest_document(name or root.name))
    if not layout.classes.exists():
        write_json(layout.classes, classes or dict(DEFAULT_CLASSES_DOCUMENT))
    ensure_layout_dirs(layout)
    return layout


def label_candidates(image_path: str) -> list[str]:
    """Where the label of a workspace image (or an exported dataset image) lives."""
    normalized = str(image_path).replace("\\", "/")
    path = Path(normalized)
    candidates = []
    if normalized.startswith(RELATIVE_PATHS["media"] + "/"):
        candidates.append(f"{RELATIVE_PATHS['imageLabels']}/{path.stem}.txt")
    if "/images/" in f"/{normalized}":
        candidates.append(Path(f"/{normalized}".replace("/images/", "/labels/", 1).lstrip("/")).with_suffix(".txt").as_posix())
    candidates.append(path.with_suffix(".txt").as_posix())
    return candidates


def layout_payload(layout: WorkspaceLayout) -> dict[str, Any]:
    manifest = layout.read_manifest()
    return {
        "ok": True,
        "kind": "workspace",
        "root": str(layout.root),
        "id": manifest.get("id"),
        "name": manifest.get("name") or layout.root.name,
        "formatVersion": manifest.get("version"),
        "paths": dict(RELATIVE_PATHS),
    }
