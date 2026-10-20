"""Opening folders, workspace summaries, and standalone YOLO dataset folders."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .dataset_export import export_dirs
from .workspace_layout import (
    IMAGE_EXTENSIONS,
    WorkspaceLayout,
    create_workspace,
    find_workspace_root,
    layout_payload,
    open_workspace,
    workspace_root_path,
)

DATASET_META_EXTENSIONS = frozenset({".txt", ".yaml", ".yml", ".csv"})


# ── Standalone YOLO dataset folders (used by the dataset tools) ──────────────


def sanitize_class_name(class_name: str) -> str:
    value = class_name.strip()
    for char in '<>:"/\\|?*':
        value = value.replace(char, "_")
    value = value.strip(" .")
    if not value:
        raise ValueError("Class folder name is invalid after sanitization.")
    return value[:120]


def is_dataset_index_file(path: Path) -> bool:
    suffix = path.suffix.lower()
    return suffix in IMAGE_EXTENSIONS or suffix in DATASET_META_EXTENSIONS


def list_dataset_files(dataset_root: Path) -> list[str]:
    """Browsable files relative to a YOLO dataset root."""
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


def infer_dataset_task(root: Path) -> str:
    """``detect`` or ``classify`` from the on-disk dataset layout."""
    root = root.expanduser().resolve()
    if (root / "images").is_dir() or (root / "labels").is_dir():
        return "detect"
    for split in ("val", "train", "test"):
        split_dir = root / split
        if split_dir.is_dir() and any(child.is_dir() for child in split_dir.iterdir()):
            return "classify"
    return "detect"


def looks_like_yolo_dataset(root: Path) -> bool:
    root = root.expanduser().resolve()
    if (root / "data.yaml").is_file() or (root / "images").is_dir() or (root / "labels").is_dir():
        return True
    for split in ("train", "val", "test"):
        split_dir = root / split
        if split_dir.is_dir() and any(child.is_dir() for child in split_dir.iterdir()):
            return True
    return False


# ── Opening a folder ─────────────────────────────────────────────────────────


def open_folder(path: Path | str, *, create: bool = False) -> dict[str, Any]:
    """Decide what a folder is: a workspace, an older workspace, a dataset, or a new folder."""
    from .workspace_migration import detect_legacy_workspace, plan_migration

    folder = workspace_root_path(path)
    if not folder.is_dir():
        raise NotADirectoryError(f"Not a directory: {folder}")

    workspace_root = find_workspace_root(folder)
    if workspace_root is not None:
        return layout_payload(open_workspace(workspace_root))

    legacy = detect_legacy_workspace(folder)
    if legacy is not None:
        plan = plan_migration(folder)
        summary = plan.summary()
        return {
            "ok": True,
            "kind": "legacy",
            "root": str(legacy["root"]),
            "name": Path(legacy["root"]).name,
            "migration": {key: summary[key] for key in ("ok", "root", "sourceKind", "activeVersion", "counts", "warnings", "conflicts", "untouched")},
        }

    if looks_like_yolo_dataset(folder):
        return {"ok": True, "kind": "dataset", "root": str(folder), "name": folder.name, "task": infer_dataset_task(folder)}

    if create:
        return layout_payload(create_workspace(folder))
    empty = not any(folder.iterdir())
    return {"ok": True, "kind": "folder", "root": str(folder), "name": folder.name, "empty": empty}


# ── Summaries ────────────────────────────────────────────────────────────────


def _count(folder: Path, suffixes: frozenset[str] | set[str]) -> int:
    if not folder.is_dir():
        return 0
    return sum(1 for item in folder.iterdir() if item.is_file() and item.suffix.lower() in suffixes)


def workspace_info(layout: WorkspaceLayout) -> dict[str, Any]:
    exports = export_dirs(layout)
    runs = layout.path("runs")
    return {
        **layout_payload(layout),
        "imagePool": str(layout.media),
        "mediaDir": layout.relative(layout.media),
        "detectLabels": str(layout.image_labels),
        "metadata": str(layout.image_status),
        "exportRoot": str(exports["root"]),
        "detectDataset": str(exports["detect"]),
        "clfDataset": str(exports["classify"]),
        "detectTrainData": str(exports["detect"] / "data.yaml"),
        "clfTrainData": str(exports["classify"]),
        "runsDetect": str(runs / "detect"),
        "runsClassify": str(runs / "classify"),
        "detectBest": str(runs / "detect" / "train" / "weights" / "best.pt"),
        "clfBest": str(runs / "classify" / "train" / "weights" / "best.pt"),
        "autoLabelDetectOutput": str(layout.exports / "auto-label" / "detect"),
        "autoLabelClfOutput": str(layout.exports / "auto-label" / "classify"),
        "imageCount": _count(layout.media, IMAGE_EXTENSIONS),
        "labelCount": _count(layout.image_labels, {".txt"}),
    }


def list_workspace_files(layout: WorkspaceLayout) -> list[str]:
    """Media images and image label files, workspace-relative."""
    files: list[str] = []
    for folder, suffixes in ((layout.media, IMAGE_EXTENSIONS), (layout.image_labels, {".txt"})):
        if folder.is_dir():
            files += [layout.relative(item) for item in folder.iterdir() if item.is_file() and item.suffix.lower() in suffixes]
    return sorted(files)
