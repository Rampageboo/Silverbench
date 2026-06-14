#!/usr/bin/env python3
"""
build_yolo_links.py — Build YOLO detection & classification datasets via hard links.

README (quick start)
--------------------
Central images live in ``image_pool``. A metadata CSV decides which images go
into detection and/or classification splits. This script creates the standard
YOLO folder layouts under ``detect_dataset`` and ``clf_dataset`` without
duplicating image bytes: dataset images are Windows/NTFS hard links to
``image_pool`` (same volume required).

Example (dry run):

    python build_yolo_links.py ^
        --image-pool "Z:/Yolo/image_pool" ^
        --metadata "Z:/Yolo/metadata.csv" ^
        --detect-out "Z:/Yolo/detect_dataset" ^
        --clf-out "Z:/Yolo/clf_dataset" ^
        --detect-label-source "Z:/Yolo/detect_labels" ^
        --dry-run

Create a new workspace (folder scaffold + workspace/workspace.json):

    python build_yolo_links.py init --workspace "Z:/Yolo/my_project"

Build using workspace config (paths from workspace/workspace.json):

    python build_yolo_links.py build --workspace "Z:/Yolo/my_project" --rebuild

Example (rebuild output folders, explicit paths):

    python build_yolo_links.py build ^
        --image-pool "Z:/Yolo/image_pool" ^
        --metadata "Z:/Yolo/metadata.csv" ^
        --detect-out "Z:/Yolo/detect_dataset" ^
        --clf-out "Z:/Yolo/clf_dataset" ^
        --detect-label-source "Z:/Yolo/detect_labels" ^
        --rebuild

Legacy (no subcommand, same as ``build``):

    python build_yolo_links.py --image-pool ... --metadata ... ...

Optional flags: ``--overwrite``, ``--copy-fallback``, ``--hardlink-labels``.
Never deletes ``image_pool`` or ``detect_label_source``; ``--rebuild`` only
clears generated image/label/class output trees.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from backend.yolo_workspace import (
    DEFAULT_CLF_CLASSES,
    IMAGE_EXTENSIONS,
    VALID_SPLITS,
    InitStats,
    WorkspacePaths,
    create_workspace,
    load_workspace_config,
    parse_class_names,
    sanitize_class_name,
)

WORKSPACE_CONFIG_FILENAME = "workspace.json"
TRUTHY = frozenset({"1", "true", "yes", "y", "on"})
FALSY = frozenset({"0", "false", "no", "n", "off", ""})


@dataclass
class BuildStats:
    detect_images_linked: int = 0
    clf_images_linked: int = 0
    labels_placed: int = 0
    missing_images: list[str] = field(default_factory=list)
    missing_labels: list[str] = field(default_factory=list)
    skipped_rows: int = 0
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def read_metadata(csv_path: Path) -> list[dict[str, str]]:
    """Load metadata rows from CSV; keys are normalized to lowercase."""
    if not csv_path.is_file():
        raise FileNotFoundError(f"Metadata CSV not found: {csv_path}")

    with csv_path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames:
            raise ValueError(f"Metadata CSV has no header row: {csv_path}")

        required = {"filename", "split", "detect_enabled", "clf_enabled", "clf_class"}
        headers = {name.strip().lower() for name in reader.fieldnames}
        missing_cols = required - headers
        if missing_cols:
            raise ValueError(
                f"Metadata CSV missing columns {sorted(missing_cols)}: {csv_path}"
            )

        rows: list[dict[str, str]] = []
        for line_no, raw in enumerate(reader, start=2):
            row = {k.strip().lower(): (v or "").strip() for k, v in raw.items()}
            row["_line"] = str(line_no)
            rows.append(row)
        return rows


def _parse_bool(value: str, field_name: str, line: str) -> bool | None:
    normalized = value.strip().lower()
    if normalized in TRUTHY:
        return True
    if normalized in FALSY:
        return False
    return None


def validate_rows(
    rows: list[dict[str, str]],
    image_pool: Path,
    stats: BuildStats,
) -> list[dict[str, Any]]:
    """
    Validate CSV rows. Returns only rows that are usable; invalid rows are
    counted in stats.skipped_rows with warnings.
    """
    image_pool = image_pool.resolve()
    valid: list[dict[str, Any]] = []

    for row in rows:
        line = row.get("_line", "?")
        filename = row.get("filename", "").strip()
        split = row.get("split", "").strip().lower()
        detect_raw = row.get("detect_enabled", "")
        detect_junk_raw = row.get("detect_junk", "")
        clf_raw = row.get("clf_enabled", "")
        clf_class = row.get("clf_class", "").strip()

        if not filename:
            stats.skipped_rows += 1
            stats.warnings.append(f"Line {line}: empty filename, skipped.")
            continue

        suffix = Path(filename).suffix.lower()
        if suffix not in IMAGE_EXTENSIONS:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: unsupported extension '{suffix}' for '{filename}', skipped."
            )
            continue

        if split not in VALID_SPLITS:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: split must be 'train' or 'val', got '{split}', skipped."
            )
            continue

        detect_enabled = _parse_bool(detect_raw, "detect_enabled", line)
        if detect_enabled is None:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: invalid detect_enabled '{detect_raw}', skipped."
            )
            continue

        detect_junk = False
        if detect_junk_raw:
            parsed_junk = _parse_bool(detect_junk_raw, "detect_junk", line)
            if parsed_junk is None:
                stats.skipped_rows += 1
                stats.warnings.append(
                    f"Line {line}: invalid detect_junk '{detect_junk_raw}', skipped."
                )
                continue
            detect_junk = parsed_junk

        if detect_junk:
            detect_enabled = False

        clf_enabled = _parse_bool(clf_raw, "clf_enabled", line)
        if clf_enabled is None:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: invalid clf_enabled '{clf_raw}', skipped."
            )
            continue

        if clf_class == "__junk__":
            clf_enabled = False

        if not detect_enabled and not clf_enabled:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: both detect_enabled and clf_enabled are off, skipped."
            )
            continue

        if clf_enabled and not clf_class:
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: clf_enabled=1 but clf_class is empty, skipped."
            )
            continue

        src_image = image_pool / filename
        if not src_image.is_file():
            stats.missing_images.append(filename)
            stats.skipped_rows += 1
            stats.warnings.append(
                f"Line {line}: image not found in image_pool: {filename}, skipped."
            )
            continue

        valid.append(
            {
                "filename": filename,
                "split": split,
                "detect_enabled": detect_enabled,
                "clf_enabled": clf_enabled,
                "clf_class": sanitize_class_name(clf_class) if clf_enabled else "",
                "source_image": src_image,
                "_line": line,
            }
        )

    return valid


def ensure_dir(path: Path, dry_run: bool) -> None:
    if dry_run:
        return
    path.mkdir(parents=True, exist_ok=True)


def same_file(path_a: Path, path_b: Path) -> bool:
    """
    True when both paths refer to the same file data (e.g. hard link pair).
    Uses os.path.samefile, which compares inode/file index on NTFS.
    """
    try:
        return os.path.samefile(path_a, path_b)
    except OSError:
        return False


def create_hardlink(
    src: Path,
    dest: Path,
    *,
    dry_run: bool,
    overwrite: bool,
    copy_fallback: bool,
    stats: BuildStats,
    label: str,
) -> bool:
    """
    Create a hard link from src to dest.

    Hard-link behavior:
    - If dest is missing, os.link(src, dest) creates a second directory entry
      pointing at the same file data as src (no extra disk space for images).
    - If dest already exists and is the same file (samefile), do nothing.
    - If dest exists but differs, remove and relink only when --overwrite.
    - On failure (common on Windows: different drives), warn; optionally copy
      when --copy-fallback is set.
    """
    src = src.resolve()
    dest = dest.resolve()

    if not src.is_file():
        stats.errors.append(f"{label}: source missing: {src}")
        return False

    if dest.exists() or dest.is_symlink():
        if same_file(src, dest):
            return False
        if overwrite:
            if not dry_run:
                dest.unlink()
        else:
            stats.warnings.append(
                f"{label}: destination exists and differs, skipped (use --overwrite): {dest}"
            )
            return False

    if dry_run:
        print(f"[DRY-RUN] hardlink: {dest} <- {src}")
        return True

    ensure_dir(dest.parent, dry_run=False)
    try:
        os.link(src, dest)
        return True
    except OSError as exc:
        if copy_fallback:
            try:
                shutil.copy2(src, dest)
                stats.warnings.append(
                    f"{label}: hard link failed, used copy fallback: {dest} ({exc})"
                )
                return True
            except OSError as copy_exc:
                stats.errors.append(f"{label}: copy fallback failed: {copy_exc}")
                return False
        stats.errors.append(
            f"{label}: hard link failed for {dest} <- {src}: {exc}. "
            "On Windows, hard links require the same drive/volume as the source. "
            "Use --copy-fallback only if you explicitly want file copies."
        )
        return False


def _place_label(
    src_label: Path,
    dest_label: Path,
    *,
    dry_run: bool,
    overwrite: bool,
    hardlink_labels: bool,
    copy_fallback: bool,
    stats: BuildStats,
    stem: str,
) -> None:
    label = f"label:{stem}"
    if not src_label.is_file():
        stats.missing_labels.append(stem)
        stats.warnings.append(f"{label}: not found in detect_label_source: {src_label.name}")
        return

    if hardlink_labels:
        if create_hardlink(
            src_label,
            dest_label,
            dry_run=dry_run,
            overwrite=overwrite,
            copy_fallback=copy_fallback,
            stats=stats,
            label=label,
        ):
            stats.labels_placed += 1
        return

    if dest_label.exists() and not overwrite:
        if src_label.read_bytes() == dest_label.read_bytes():
            return
        stats.warnings.append(
            f"{label}: destination exists and differs, skipped (use --overwrite): {dest_label}"
        )
        return

    if dry_run:
        print(f"[DRY-RUN] copy label: {dest_label} <- {src_label}")
        stats.labels_placed += 1
        return

    ensure_dir(dest_label.parent, dry_run=False)
    if dest_label.exists():
        dest_label.unlink()
    shutil.copy2(src_label, dest_label)
    stats.labels_placed += 1


def build_detect_dataset(
    rows: list[dict[str, Any]],
    detect_out: Path,
    label_source: Path,
    *,
    dry_run: bool,
    overwrite: bool,
    copy_fallback: bool,
    hardlink_labels: bool,
    stats: BuildStats,
    on_row: Callable[[str], None] | None = None,
) -> None:
    """Hard-link detection images and place labels under detect_out."""
    images_root = detect_out / "images"
    labels_root = detect_out / "labels"

    for split in VALID_SPLITS:
        ensure_dir(images_root / split, dry_run)
        ensure_dir(labels_root / split, dry_run)

    for row in rows:
        if not row["detect_enabled"]:
            continue

        filename = row["filename"]
        split = row["split"]
        src = row["source_image"]
        dest = images_root / split / filename

        if create_hardlink(
            src,
            dest,
            dry_run=dry_run,
            overwrite=overwrite,
            copy_fallback=copy_fallback,
            stats=stats,
            label=f"detect:{filename}",
        ):
            stats.detect_images_linked += 1

        stem = Path(filename).stem
        src_label = label_source / f"{stem}.txt"
        dest_label = labels_root / split / f"{stem}.txt"
        _place_label(
            src_label,
            dest_label,
            dry_run=dry_run,
            overwrite=overwrite,
            hardlink_labels=hardlink_labels,
            copy_fallback=copy_fallback,
            stats=stats,
            stem=stem,
        )
        if on_row:
            on_row(f"detect: {filename}")


def build_clf_dataset(
    rows: list[dict[str, Any]],
    clf_out: Path,
    *,
    dry_run: bool,
    overwrite: bool,
    copy_fallback: bool,
    stats: BuildStats,
    on_row: Callable[[str], None] | None = None,
) -> None:
    """Hard-link classification images into split/class folders."""
    for row in rows:
        if not row["clf_enabled"]:
            continue

        filename = row["filename"]
        split = row["split"]
        class_name = row["clf_class"]
        dest_dir = clf_out / split / class_name
        ensure_dir(dest_dir, dry_run)
        dest = dest_dir / filename

        if create_hardlink(
            row["source_image"],
            dest,
            dry_run=dry_run,
            overwrite=overwrite,
            copy_fallback=copy_fallback,
            stats=stats,
            label=f"clf:{split}/{class_name}/{filename}",
        ):
            stats.clf_images_linked += 1
        if on_row:
            on_row(f"clf: {split}/{class_name}/{filename}")


def _clear_directory_contents(path: Path) -> None:
    if not path.exists():
        return
    for child in path.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def rebuild_output_dirs(detect_out: Path, clf_out: Path, dry_run: bool) -> None:
    """
    Remove generated content only inside dataset output trees.
    Never touches image_pool or detect_label_source.
    """
    detect_targets = [
        detect_out / "images" / "train",
        detect_out / "images" / "val",
        detect_out / "labels" / "train",
        detect_out / "labels" / "val",
    ]
    clf_targets = [
        clf_out / "train",
        clf_out / "val",
    ]

    if dry_run:
        for path in detect_targets + clf_targets:
            if path.exists():
                print(f"[DRY-RUN] would clear: {path}")
        return

    for path in detect_targets:
        _clear_directory_contents(path)

    for split_dir in clf_targets:
        if not split_dir.exists():
            continue
        for class_dir in split_dir.iterdir():
            if class_dir.is_dir():
                _clear_directory_contents(class_dir)


def print_summary(stats: BuildStats, dry_run: bool) -> None:
    mode = "DRY-RUN SUMMARY" if dry_run else "SUMMARY"
    print()
    print("=" * 60)
    print(mode)
    print("=" * 60)
    print(f"Detection image hard links created: {stats.detect_images_linked}")
    print(f"Classification image hard links created: {stats.clf_images_linked}")
    print(f"Labels linked/copied: {stats.labels_placed}")
    print(f"Missing source images (rows skipped): {len(stats.missing_images)}")
    if stats.missing_images:
        for name in stats.missing_images[:20]:
            print(f"  - {name}")
        if len(stats.missing_images) > 20:
            print(f"  ... and {len(stats.missing_images) - 20} more")
    print(f"Missing detection labels: {len(stats.missing_labels)}")
    if stats.missing_labels:
        for stem in stats.missing_labels[:20]:
            print(f"  - {stem}.txt")
        if len(stats.missing_labels) > 20:
            print(f"  ... and {len(stats.missing_labels) - 20} more")
    print(f"Skipped CSV rows: {stats.skipped_rows}")
    print(f"Warnings: {len(stats.warnings)}")
    for msg in stats.warnings[:30]:
        print(f"  [warn] {msg}")
    if len(stats.warnings) > 30:
        print(f"  ... and {len(stats.warnings) - 30} more warnings")
    print(f"Errors: {len(stats.errors)}")
    for msg in stats.errors:
        print(f"  [error] {msg}")
    print("=" * 60)


def _resolve_path(value: str, name: str) -> Path:
    path = Path(value).expanduser()
    if not path.exists() and name not in {"detect_out", "clf_out", "workspace_root"}:
        raise FileNotFoundError(f"{name} path does not exist: {path}")
    return path.resolve()


def print_init_summary(stats: InitStats, workspace_root: Path, dry_run: bool) -> None:
    mode = "DRY-RUN" if dry_run else "DONE"
    print()
    print("=" * 60)
    print(f"WORKSPACE INIT {mode}")
    print("=" * 60)
    print(f"Workspace root: {workspace_root}")
    print(f"Directories created: {stats.dirs_created}")
    print(f"Files written: {stats.files_created}")
    print(f"Skipped (already exist): {len(stats.skipped)}")
    for item in stats.skipped[:15]:
        print(f"  - {item}")
    if len(stats.skipped) > 15:
        print(f"  ... and {len(stats.skipped) - 15} more")
    print()
    print("Next steps:")
    print(f"  1. Add images to: {workspace_root / 'image_pool'}")
    print(f"  2. Edit: {workspace_root / 'metadata.csv'}")
    print(f"  3. Add labels to: {workspace_root / 'detect_labels'}")
    print(
        f'  4. Build: python build_yolo_links.py build --workspace "{workspace_root}" --rebuild'
    )
    print("=" * 60)


def run_build(args: argparse.Namespace) -> int:
    try:
        if getattr(args, "workspace", None):
            paths = load_workspace_config(Path(args.workspace))
            image_pool = paths.image_pool
            metadata_path = paths.metadata
            label_source = paths.label_source
            detect_out = paths.detect_out
            clf_out = paths.clf_out
            print(f"Using workspace: {paths.root}")
        else:
            if not all(
                [
                    args.image_pool,
                    args.metadata,
                    args.detect_out,
                    args.clf_out,
                    args.detect_label_source,
                ]
            ):
                raise ValueError(
                    "Provide --workspace or all of: --image-pool, --metadata, "
                    "--detect-out, --clf-out, --detect-label-source"
                )
            image_pool = _resolve_path(args.image_pool, "image_pool")
            metadata_path = _resolve_path(args.metadata, "metadata")
            label_source = _resolve_path(args.detect_label_source, "detect_label_source")
            detect_out = Path(args.detect_out).expanduser().resolve()
            clf_out = Path(args.clf_out).expanduser().resolve()

        if not image_pool.is_dir():
            raise NotADirectoryError(f"image_pool is not a directory: {image_pool}")
        if not label_source.is_dir():
            raise NotADirectoryError(
                f"detect_label_source is not a directory: {label_source}"
            )

        stats = BuildStats()
        rows = read_metadata(metadata_path)
        print(f"Loaded {len(rows)} metadata row(s) from {metadata_path}")

        if args.rebuild:
            print("Rebuild: clearing generated output folders...")
            rebuild_output_dirs(detect_out, clf_out, args.dry_run)

        valid_rows = validate_rows(rows, image_pool, stats)
        print(f"Valid rows after validation: {len(valid_rows)}")

        build_detect_dataset(
            valid_rows,
            detect_out,
            label_source,
            dry_run=args.dry_run,
            overwrite=args.overwrite,
            copy_fallback=args.copy_fallback,
            hardlink_labels=args.hardlink_labels,
            stats=stats,
        )
        build_clf_dataset(
            valid_rows,
            clf_out,
            dry_run=args.dry_run,
            overwrite=args.overwrite,
            copy_fallback=args.copy_fallback,
            stats=stats,
        )

        print_summary(stats, args.dry_run)
        return 1 if stats.errors else 0

    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"Fatal: {exc}", file=sys.stderr)
        return 2


def run_init(args: argparse.Namespace) -> int:
    try:
        workspace_root = _resolve_path(args.workspace, "workspace_root")
        classes = parse_class_names(args.classes)

        stats = create_workspace(
            workspace_root,
            classes=classes,
            dry_run=args.dry_run,
            force=args.force,
        )
        print_init_summary(stats, workspace_root, args.dry_run)
        return 0
    except (FileNotFoundError, ValueError) as exc:
        print(f"Fatal: {exc}", file=sys.stderr)
        return 2


def sync_metadata_from_clf(
    clf_out: Path,
    metadata_path: Path,
    image_pool: Path | None = None,
    label_source: Path | None = None,
    *,
    dry_run: bool = False,
    overwrite_existing: bool = False,
) -> dict[str, Any]:
    """
    Reverse-engineer metadata.csv from an existing clf_dataset tree.

    Scans  clf_out/{train|val}/<class_name>/<image>  and writes one CSV row
    per unique filename.  If the same filename appears in both train and val,
    train takes precedence (with a warning).

    Optionally cross-checks that each image exists in image_pool.
    Optionally sets detect_enabled=1 for images that have a matching .txt in
    label_source; otherwise detect_enabled=0.
    """
    if not clf_out.is_dir():
        raise NotADirectoryError(f"clf_dataset not found: {clf_out}")

    HEADER = ["filename", "split", "detect_enabled", "clf_enabled", "clf_class"]

    # Collect rows keyed by filename; train wins over val on collision.
    rows: dict[str, dict[str, str]] = {}
    warnings: list[str] = []
    scanned = 0

    for split in ("train", "val"):
        split_dir = clf_out / split
        if not split_dir.is_dir():
            continue
        for class_dir in sorted(split_dir.iterdir()):
            if not class_dir.is_dir():
                continue
            class_name = class_dir.name
            for img in sorted(class_dir.iterdir()):
                if img.suffix.lower() not in IMAGE_EXTENSIONS:
                    continue
                scanned += 1
                filename = img.name
                if filename in rows:
                    existing = rows[filename]
                    if existing["split"] != split:
                        warnings.append(
                            f"'{filename}' found in both splits; keeping split='{existing['split']}' "
                            f"(also in '{split}/{class_name}')."
                        )
                    continue
                detect_enabled = "0"
                if label_source and label_source.is_dir():
                    label_file = label_source / (Path(filename).stem + ".txt")
                    if label_file.is_file():
                        detect_enabled = "1"
                if image_pool and image_pool.is_dir():
                    if not (image_pool / filename).is_file():
                        warnings.append(
                            f"'{filename}' found in clf_dataset but NOT in image_pool — skipping."
                        )
                        continue
                rows[filename] = {
                    "filename": filename,
                    "split": split,
                    "detect_enabled": detect_enabled,
                    "clf_enabled": "1",
                    "clf_class": class_name,
                }

    if not rows:
        return {
            "ok": False,
            "scanned": scanned,
            "written": 0,
            "warnings": warnings,
            "message": "No images found in clf_dataset.",
        }

    # Merge with existing metadata if not overwriting.
    existing_rows: dict[str, dict[str, str]] = {}
    if metadata_path.is_file() and not overwrite_existing:
        with metadata_path.open(newline="", encoding="utf-8-sig") as fh:
            reader = csv.DictReader(fh)
            for row in reader:
                norm = {k.strip().lower(): (v or "").strip() for k, v in row.items()}
                fname = norm.get("filename", "")
                if fname:
                    existing_rows[fname] = norm

        merged: dict[str, dict[str, str]] = {**rows, **existing_rows}
        # existing takes precedence for already-known filenames
        for fname, row in rows.items():
            if fname not in existing_rows:
                merged[fname] = row
        final_rows = merged
    else:
        final_rows = rows

    sorted_rows = sorted(final_rows.values(), key=lambda r: (r["split"], r["clf_class"], r["filename"]))

    if dry_run:
        print(f"[DRY-RUN] Would write {len(sorted_rows)} row(s) to {metadata_path}")
        for w in warnings:
            print(f"  [warn] {w}")
        return {
            "ok": True,
            "scanned": scanned,
            "written": len(sorted_rows),
            "warnings": warnings,
            "dry_run": True,
        }

    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=HEADER, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(sorted_rows)

    return {
        "ok": True,
        "scanned": scanned,
        "written": len(sorted_rows),
        "warnings": warnings,
        "dry_run": False,
    }


def run_sync_metadata(args: argparse.Namespace) -> int:
    try:
        if getattr(args, "workspace", None):
            paths = load_workspace_config(Path(args.workspace))
            clf_out = paths.clf_out
            metadata_path = paths.metadata
            image_pool: Path | None = paths.image_pool
            label_source: Path | None = paths.label_source
            print(f"Using workspace: {paths.root}")
        else:
            if not args.clf_out or not args.metadata:
                raise ValueError("Provide --workspace or both --clf-out and --metadata.")
            clf_out = Path(args.clf_out).expanduser().resolve()
            metadata_path = Path(args.metadata).expanduser().resolve()
            image_pool = Path(args.image_pool).expanduser().resolve() if args.image_pool else None
            label_source = Path(args.detect_label_source).expanduser().resolve() if getattr(args, "detect_label_source", None) else None

        result = sync_metadata_from_clf(
            clf_out,
            metadata_path,
            image_pool=image_pool,
            label_source=label_source,
            dry_run=args.dry_run,
            overwrite_existing=args.overwrite,
        )

        print()
        print("=" * 60)
        print("SYNC-METADATA " + ("DRY-RUN" if result.get("dry_run") else "DONE"))
        print("=" * 60)
        print(f"clf_dataset images scanned: {result['scanned']}")
        print(f"metadata.csv rows written:  {result['written']}")
        if result["warnings"]:
            print(f"Warnings ({len(result['warnings'])}):")
            for w in result["warnings"][:30]:
                print(f"  [warn] {w}")
            if len(result["warnings"]) > 30:
                print(f"  ... and {len(result['warnings']) - 30} more")
        if not result["ok"]:
            print(f"Error: {result.get('message', 'unknown')}")
            return 2
        if not result.get("dry_run"):
            print(f"\nmetadata.csv updated: {metadata_path}")
        print("=" * 60)
        return 0

    except (FileNotFoundError, NotADirectoryError, ValueError) as exc:
        print(f"Fatal: {exc}", file=sys.stderr)
        return 2


def _add_build_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--workspace",
        help="Workspace root with workspace/workspace.json (fills other path arguments).",
    )
    parser.add_argument("--image-pool", help="Central source image folder.")
    parser.add_argument("--metadata", help="CSV metadata file.")
    parser.add_argument("--detect-out", help="Detection dataset output root.")
    parser.add_argument("--clf-out", help="Classification dataset output root.")
    parser.add_argument(
        "--detect-label-source",
        help="Folder with YOLO .txt label files (stem matches image stem).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print planned actions without creating links or copies.",
    )
    parser.add_argument(
        "--rebuild",
        action="store_true",
        help="Clear generated output image/label/class folders before building.",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Replace existing destination files that point to different data.",
    )
    parser.add_argument(
        "--copy-fallback",
        action="store_true",
        help="Copy files when hard link creation fails (off by default).",
    )
    parser.add_argument(
        "--hardlink-labels",
        action="store_true",
        help="Hard-link label .txt files instead of copying them.",
    )


def main() -> int:
    argv = sys.argv[1:]

    root_parser = argparse.ArgumentParser(
        description="YOLO dataset workspace tools: init scaffold, build hard-link datasets.",
    )
    subparsers = root_parser.add_subparsers(dest="command")

    init_parser = subparsers.add_parser(
        "init",
        help="Create a new YOLO workspace folder structure and workspace/workspace.json.",
    )
    init_parser.add_argument(
        "--workspace",
        required=True,
        help="Root folder to create (created if missing).",
    )
    init_parser.add_argument(
        "--classes",
        default=",".join(DEFAULT_CLF_CLASSES),
        help="Comma-separated classification class folder names.",
    )
    init_parser.add_argument("--dry-run", action="store_true")
    init_parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite workspace/workspace.json / metadata template / README if present.",
    )

    build_parser = subparsers.add_parser(
        "build",
        help="Build detection and classification datasets from metadata CSV.",
    )
    _add_build_arguments(build_parser)

    sync_parser = subparsers.add_parser(
        "sync-metadata",
        help="Reverse-engineer metadata.csv from an existing clf_dataset tree.",
    )
    sync_parser.add_argument(
        "--workspace",
        help="Workspace root (fills --clf-out, --metadata, --image-pool, --detect-label-source).",
    )
    sync_parser.add_argument("--clf-out", help="clf_dataset root to scan.")
    sync_parser.add_argument("--metadata", help="metadata.csv path to write.")
    sync_parser.add_argument("--image-pool", help="Cross-check images exist here (optional).")
    sync_parser.add_argument(
        "--detect-label-source",
        help="detect_labels folder; sets detect_enabled=1 for images with matching .txt.",
    )
    sync_parser.add_argument("--dry-run", action="store_true", help="Preview without writing.")
    sync_parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing metadata.csv entirely (default: merge, existing rows win).",
    )

    # Legacy: ``python build_yolo_links.py --image-pool ...`` (no subcommand).
    if argv and argv[0] not in {"init", "build", "sync-metadata"}:
        legacy_parser = argparse.ArgumentParser(
            description="Build YOLO datasets (legacy CLI, same as 'build').",
        )
        _add_build_arguments(legacy_parser)
        return run_build(legacy_parser.parse_args(argv))

    if not argv:
        root_parser.print_help()
        return 2

    args = root_parser.parse_args(argv)
    if args.command == "init":
        return run_init(args)
    if args.command == "build":
        return run_build(args)
    if args.command == "sync-metadata":
        return run_sync_metadata(args)

    root_parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
