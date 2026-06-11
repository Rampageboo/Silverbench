from __future__ import annotations

import csv
import json
import re
from pathlib import Path
from typing import Any, Callable

from .path_access import _normalize_path
from .yolo_workspace import (
    DEFAULT_CLF_CLASSES,
    METADATA_HEADER,
    WORKSPACE_CONFIG_FILENAME,
    load_workspace_config,
    sanitize_class_name,
)


def _bool_to_csv(value: bool) -> str:
    return "1" if value else "0"


def _csv_to_bool(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


INBOX_JUNK_CLASS = "__junk__"


def _add_class_name(classes: list[str], seen: set[str], raw: str) -> None:
    text = str(raw or "").strip()
    if not text:
        return
    try:
        name = sanitize_class_name(text)
    except ValueError:
        return
    if name == INBOX_JUNK_CLASS or name in seen:
        return
    seen.add(name)
    classes.append(name)


def _workspace_clf_out(workspace_root: Path) -> Path:
    root = _normalize_path(workspace_root)
    try:
        return _normalize_path(load_workspace_config(root).clf_out)
    except (FileNotFoundError, ValueError, OSError):
        return _normalize_path(root / "clf_dataset")


def _workspace_detect_out(workspace_root: Path) -> Path:
    root = _normalize_path(workspace_root)
    try:
        return _normalize_path(load_workspace_config(root).detect_out)
    except (FileNotFoundError, ValueError, OSError):
        return _normalize_path(root / "detect_dataset")


def _parse_data_yaml_names(yaml_path: Path) -> list[dict[str, Any]]:
    if not yaml_path.is_file():
        return []
    lines = yaml_path.read_text(encoding="utf-8", errors="replace").splitlines()
    in_names = False
    names: list[dict[str, Any]] = []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line == "names:":
            in_names = True
            continue
        if in_names:
            match = re.match(r"^(\d+)\s*:\s*(.+)$", line)
            if match:
                names.append(
                    {
                        "id": int(match.group(1)),
                        "name": match.group(2).split("#", 1)[0].strip(),
                    }
                )
            elif not raw[:1].isspace():
                break
    return names


def list_detect_dataset_classes(workspace_root: Path) -> list[dict[str, Any]]:
    """Return YOLO detection class ids/names from detect_dataset/data.yaml."""
    detect_out = _workspace_detect_out(workspace_root)
    return _parse_data_yaml_names(detect_out / "data.yaml")


def list_clf_dataset_classes(workspace_root: Path) -> list[str]:
    """Return class folder names discovered under clf_dataset/{train,val,test}."""
    clf_out = _workspace_clf_out(workspace_root)
    classes: list[str] = []
    seen: set[str] = set()
    if not clf_out.is_dir():
        return classes
    for split in ("train", "val", "test"):
        split_dir = clf_out / split
        if not split_dir.is_dir():
            continue
        try:
            children = sorted(split_dir.iterdir(), key=lambda item: item.name.lower())
        except OSError:
            continue
        for child in children:
            if child.is_dir():
                _add_class_name(classes, seen, child.name)
    return classes


def _metadata_class_names(workspace_root: Path) -> list[str]:
    root = _normalize_path(workspace_root)
    classes: list[str] = []
    seen: set[str] = set()
    try:
        metadata_path = load_workspace_config(root).metadata
    except (FileNotFoundError, ValueError, OSError):
        metadata_path = root / "metadata.csv"
    if not metadata_path.is_file():
        return classes
    with metadata_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            _add_class_name(classes, seen, (row.get("clf_class") or "").strip())
    return classes


def get_workspace_classes(workspace_root: Path) -> list[str]:
    clf_classes = list_clf_dataset_classes(workspace_root)
    if clf_classes:
        return clf_classes

    root = _normalize_path(workspace_root)
    classes: list[str] = []
    seen: set[str] = set()

    config_path = root / WORKSPACE_CONFIG_FILENAME
    if config_path.is_file():
        data = json.loads(config_path.read_text(encoding="utf-8"))
        for name in data.get("classification_classes") or []:
            _add_class_name(classes, seen, str(name))

    for name in _metadata_class_names(root):
        _add_class_name(classes, seen, name)

    return classes if classes else list(DEFAULT_CLF_CLASSES)


def read_metadata_rows(workspace_root: Path) -> dict[str, Any]:
    root = _normalize_path(workspace_root)
    clf_classes = list_clf_dataset_classes(root)
    metadata_classes = _metadata_class_names(root)
    try:
        paths = load_workspace_config(root)
        metadata_path = paths.metadata
    except (FileNotFoundError, ValueError, OSError):
        metadata_path = root / "metadata.csv"
    rows: list[dict[str, str]] = []
    if metadata_path.is_file():
        with metadata_path.open(newline="", encoding="utf-8-sig") as handle:
            reader = csv.DictReader(handle)
            fieldnames = [name.strip() for name in (reader.fieldnames or []) if name]
            for raw in reader:
                filename = (raw.get("filename") or "").strip()
                if not filename:
                    continue
                rows.append(
                    {
                        "filename": filename,
                        "split": (raw.get("split") or "train").strip().lower() or "train",
                        "detect_enabled": _bool_to_csv(_csv_to_bool(raw.get("detect_enabled") or "")),
                        "clf_enabled": _bool_to_csv(_csv_to_bool(raw.get("clf_enabled") or "")),
                        "clf_class": (raw.get("clf_class") or "").strip(),
                        "detect_junk": _bool_to_csv(_csv_to_bool(raw.get("detect_junk") or "")),
                    }
                )
    detect_classes = list_detect_dataset_classes(root)
    classes = clf_classes or metadata_classes or get_workspace_classes(root)
    return {
        "ok": True,
        "metadataPath": str(metadata_path),
        "rows": rows,
        "clfClasses": clf_classes,
        "metadataClasses": metadata_classes,
        "detectClasses": detect_classes,
        "classes": classes,
        "clfDataset": str(_workspace_clf_out(root)),
        "detectDataset": str(_workspace_detect_out(root)),
    }


def upsert_metadata_rows(workspace_root: Path, updates: list[dict[str, Any]]) -> dict[str, Any]:
    if not updates:
        raise ValueError("No metadata updates provided.")

    paths = load_workspace_config(workspace_root)
    metadata_path = paths.metadata
    payload = read_metadata_rows(workspace_root)
    by_filename = {row["filename"]: dict(row) for row in payload["rows"]}

    changed = 0
    created = 0
    for item in updates:
        filename = Path(str(item.get("filename") or "").replace("\\", "/")).name
        if not filename:
            continue
        row = by_filename.get(filename)
        is_new = row is None
        if is_new:
            row = {
                "filename": filename,
                "split": "train",
                "detect_enabled": "0",
                "clf_enabled": "1",
                "clf_class": "",
                "detect_junk": "0",
            }
        if "split" in item and item["split"]:
            split = str(item["split"]).strip().lower()
            if split in {"train", "val"}:
                row["split"] = split
        if "detect_enabled" in item:
            row["detect_enabled"] = _bool_to_csv(bool(item["detect_enabled"]))
        if "detect_junk" in item:
            row["detect_junk"] = _bool_to_csv(bool(item["detect_junk"]))
            if item["detect_junk"]:
                row["detect_enabled"] = "0"
        if "clf_enabled" in item:
            row["clf_enabled"] = _bool_to_csv(bool(item["clf_enabled"]))
        if "clf_class" in item:
            class_name = str(item["clf_class"] or "").strip()
            if class_name == INBOX_JUNK_CLASS:
                row["clf_class"] = INBOX_JUNK_CLASS
                row["clf_enabled"] = "0"
            else:
                row["clf_class"] = sanitize_class_name(class_name) if class_name else ""
        by_filename[filename] = row
        if is_new:
            created += 1
        else:
            changed += 1

    rows = sorted(by_filename.values(), key=lambda row: row["filename"].lower())
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["filename", "split", "detect_enabled", "clf_enabled", "clf_class", "detect_junk"],
        )
        writer.writeheader()
        writer.writerows(rows)

    return {
        "ok": True,
        "metadataPath": str(metadata_path),
        "updated": changed,
        "created": created,
        "total": len(rows),
    }


def _estimate_build_total(valid_rows: list[dict[str, Any]], rebuild: bool) -> int:
    total = 0
    if rebuild:
        total += 1
    total += sum(1 for row in valid_rows if row.get("detect_enabled"))
    total += sum(1 for row in valid_rows if row.get("clf_enabled"))
    return max(total, 1)


def remove_detect_dataset_links(
    workspace_root: Path,
    filenames: list[str] | None = None,
) -> dict[str, Any]:
    """Remove detect_dataset image/label hard links for the given pool filenames."""
    paths = load_workspace_config(workspace_root)
    detect_out = paths.detect_out
    allowed = {
        Path(str(name).replace("\\", "/")).name
        for name in (filenames or [])
        if str(name or "").strip()
    }
    if not allowed:
        return {
            "ok": False,
            "removedImages": 0,
            "removedLabels": 0,
            "errors": ["No filenames provided."],
        }

    removed_images = 0
    removed_labels = 0
    errors: list[str] = []
    for split in ("train", "val"):
        images_dir = detect_out / "images" / split
        labels_dir = detect_out / "labels" / split
        if not images_dir.is_dir():
            continue
        for candidate in images_dir.iterdir():
            if not candidate.is_file() or candidate.name not in allowed:
                continue
            try:
                candidate.unlink()
                removed_images += 1
            except OSError as exc:
                errors.append(f"remove image {candidate}: {exc}")
            label_path = labels_dir / f"{candidate.stem}.txt"
            if label_path.is_file():
                try:
                    label_path.unlink()
                    removed_labels += 1
                except OSError as exc:
                    errors.append(f"remove label {label_path}: {exc}")

    return {
        "ok": not errors,
        "removedImages": removed_images,
        "removedLabels": removed_labels,
        "errors": errors,
    }


def remove_clf_dataset_links(
    workspace_root: Path,
    filenames: list[str] | None = None,
) -> dict[str, Any]:
    """Remove clf_dataset hard links for the given pool filenames."""
    paths = load_workspace_config(workspace_root)
    clf_out = paths.clf_out
    allowed = {
        Path(str(name).replace("\\", "/")).name
        for name in (filenames or [])
        if str(name or "").strip()
    }
    if not allowed:
        return {
            "ok": False,
            "removedImages": 0,
            "errors": ["No filenames provided."],
        }

    removed_images = 0
    errors: list[str] = []
    for split in ("train", "val", "test"):
        split_dir = clf_out / split
        if not split_dir.is_dir():
            continue
        for class_dir in split_dir.iterdir():
            if not class_dir.is_dir():
                continue
            for candidate in class_dir.iterdir():
                if not candidate.is_file() or candidate.name not in allowed:
                    continue
                try:
                    candidate.unlink()
                    removed_images += 1
                except OSError as exc:
                    errors.append(f"remove image {candidate}: {exc}")

    return {
        "ok": not errors,
        "removedImages": removed_images,
        "errors": errors,
    }


def build_workspace_links(
    workspace_root: Path,
    *,
    rebuild: bool = False,
    filenames: list[str] | None = None,
    progress_callback: Callable[[int, int, str], None] | None = None,
) -> dict[str, Any]:
    from build_yolo_links import (
        BuildStats,
        build_clf_dataset,
        build_detect_dataset,
        read_metadata,
        rebuild_output_dirs,
        validate_rows,
    )

    paths = load_workspace_config(workspace_root)
    stats = BuildStats()
    rows = read_metadata(paths.metadata)
    if filenames:
        allowed = {Path(str(name).replace("\\", "/")).name for name in filenames}
        rows = [row for row in rows if (row.get("filename") or "").strip() in allowed]
        if not rows:
            return {
                "ok": False,
                "detectImagesLinked": 0,
                "clfImagesLinked": 0,
                "labelsPlaced": 0,
                "skippedRows": 0,
                "warnings": [],
                "errors": ["No metadata rows matched the requested filenames."],
                "builtFilenames": [],
            }
    valid_rows = validate_rows(rows, paths.image_pool, stats)
    total = _estimate_build_total(valid_rows, rebuild)
    progress = {"done": 0}

    def tick(detail: str) -> None:
        progress["done"] += 1
        if progress_callback:
            progress_callback(progress["done"], total, detail)

    if rebuild:
        if progress_callback:
            progress_callback(0, total, "正在清空 detect/clf 输出目录...")
        rebuild_output_dirs(paths.detect_out, paths.clf_out, dry_run=False)
        tick("清空完成，开始构建 detect...")
    elif progress_callback:
        progress_callback(0, total, "开始构建 detect...")

    build_detect_dataset(
        valid_rows,
        paths.detect_out,
        paths.label_source,
        dry_run=False,
        overwrite=False,
        copy_fallback=False,
        hardlink_labels=True,
        stats=stats,
        on_row=tick,
    )
    build_clf_dataset(
        valid_rows,
        paths.clf_out,
        dry_run=False,
        overwrite=False,
        copy_fallback=False,
        stats=stats,
        on_row=tick,
    )
    if progress_callback:
        progress_callback(min(progress["done"], total), total, "构建完成")
    built_filenames = sorted(
        {
            (row.get("filename") or "").strip()
            for row in valid_rows
            if (row.get("filename") or "").strip()
        }
    )
    return {
        "ok": not stats.errors,
        "detectImagesLinked": stats.detect_images_linked,
        "clfImagesLinked": stats.clf_images_linked,
        "labelsPlaced": stats.labels_placed,
        "skippedRows": stats.skipped_rows,
        "warnings": stats.warnings[:20],
        "errors": stats.errors,
        "builtFilenames": built_filenames,
    }
