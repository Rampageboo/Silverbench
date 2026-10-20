from __future__ import annotations

import random
import re
import shutil
from pathlib import Path

from .dataset_merge import IMAGE_EXTENSIONS, unique_path

TOP_LEVEL_YAML_KEY = re.compile(r"^([\w-]+)\s*:\s*(.*)$")
DEFAULT_TRAIN = "images/train"
DEFAULT_VAL = "images/val"


def prepare_classification_validation_split(root: Path, ratio: float = 0.15, seed: int = 1337) -> dict:
    root = root.resolve()
    train_dir = root / "train"
    val_dir = root / "val"
    if not train_dir.is_dir():
        return {
            "ok": False,
            "reason": "missing_train",
            "message": "Expected train/<class_name> folders for YOLO classification.",
            "moved": 0,
        }

    existing_val = [path for path in val_dir.rglob("*") if path.is_file()] if val_dir.exists() else []
    if existing_val:
        return {
            "ok": False,
            "reason": "val_exists",
            "message": "Validation folders already contain files. No files were moved.",
            "moved": 0,
        }

    class_dirs = sorted(path for path in train_dir.iterdir() if path.is_dir())
    samples_by_class: dict[str, list[Path]] = {}
    for class_dir in class_dirs:
        images = sorted(path for path in class_dir.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS)
        if images:
            samples_by_class[class_dir.name] = images

    if not samples_by_class:
        return {
            "ok": False,
            "reason": "no_samples",
            "message": "No classification images found under train/<class_name>.",
            "moved": 0,
        }

    rng = random.Random(seed)
    ratio = clamp_ratio(ratio)
    moved: list[str] = []
    per_class: dict[str, int] = {}
    val_dir.mkdir(parents=True, exist_ok=True)

    for class_name, images in samples_by_class.items():
        candidates = images[:]
        rng.shuffle(candidates)
        target_count = max(1, round(len(candidates) * ratio))
        if len(candidates) > 1:
            target_count = min(target_count, len(candidates) - 1)
        else:
            target_count = 0
        per_class[class_name] = target_count
        for source in candidates[:target_count]:
            rel = source.relative_to(train_dir / class_name)
            target = val_dir / class_name / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source), str(target))
            moved.append(target.relative_to(root).as_posix())

    cleanup_empty_dirs(train_dir)
    return {
        "ok": bool(moved),
        "reason": "created" if moved else "no_images_moved",
        "message": f"Moved {len(moved)} classification image(s) to val.",
        "moved": len(moved),
        "ratio": ratio,
        "classes": sorted(samples_by_class),
        "perClass": per_class,
        "movedImages": moved,
    }


def prepare_validation_split(root: Path, ratio: float = 0.15, seed: int = 1337) -> dict:
    root = root.resolve()
    image_train = root / "images" / "train"
    label_train = root / "labels" / "train"
    image_val = root / "images" / "val"
    label_val = root / "labels" / "val"

    if not image_train.is_dir() or not label_train.is_dir():
        return {
            "ok": False,
            "reason": "missing_train",
            "message": "Expected images/train and labels/train folders.",
            "moved": 0,
        }

    existing_val = []
    for folder in (image_val, label_val):
        if folder.exists():
            existing_val.extend(path for path in folder.rglob("*") if path.is_file())
    if existing_val:
        return {
            "ok": False,
            "reason": "val_exists",
            "message": "Validation folders already contain files. No files were moved.",
            "moved": 0,
        }

    samples = []
    for image_path in sorted(path for path in image_train.rglob("*") if path.suffix.lower() in IMAGE_EXTENSIONS):
        rel = image_path.relative_to(image_train)
        label_path = (label_train / rel).with_suffix(".txt")
        if not label_path.exists():
            continue
        classes = classes_in_label(label_path)
        samples.append({"image": image_path, "label": label_path, "rel": rel, "classes": classes})

    if not samples:
        return {
            "ok": False,
            "reason": "no_samples",
            "message": "No image/label pairs found in train.",
            "moved": 0,
        }

    class_ids = sorted({class_id for sample in samples for class_id in sample["classes"]})
    target_count = max(1, round(len(samples) * clamp_ratio(ratio)))
    target_count = min(len(samples), max(target_count, len(class_ids)))

    rng = random.Random(seed)
    chosen: list[dict] = []
    chosen_ids: set[int] = set()
    uncovered = set(class_ids)
    candidates = samples[:]
    rng.shuffle(candidates)

    while uncovered:
        best = max(candidates, key=lambda sample: len(sample["classes"] & uncovered))
        coverage = best["classes"] & uncovered
        if not coverage:
            break
        chosen.append(best)
        chosen_ids.add(id(best))
        uncovered -= coverage
        candidates = [sample for sample in candidates if id(sample) not in chosen_ids]
        if not candidates:
            break

    remaining = [sample for sample in samples if id(sample) not in chosen_ids]
    rng.shuffle(remaining)
    for sample in remaining:
        if len(chosen) >= target_count:
            break
        chosen.append(sample)
        chosen_ids.add(id(sample))

    image_val.mkdir(parents=True, exist_ok=True)
    label_val.mkdir(parents=True, exist_ok=True)
    moved = []
    for sample in chosen:
        image_target = image_val / sample["rel"]
        label_target = (label_val / sample["rel"]).with_suffix(".txt")
        image_target.parent.mkdir(parents=True, exist_ok=True)
        label_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(sample["image"]), str(image_target))
        shutil.move(str(sample["label"]), str(label_target))
        moved.append(sample["rel"].as_posix())

    cleanup_empty_dirs(image_train)
    cleanup_empty_dirs(label_train)
    result = {
        "ok": True,
        "reason": "created",
        "message": f"Moved {len(moved)} image/label pair(s) to val.",
        "moved": len(moved),
        "totalTrainPairsBefore": len(samples),
        "ratio": clamp_ratio(ratio),
        "classes": class_ids,
        "movedImages": moved,
    }
    return attach_data_yaml_update(root, result)


def move_detect_val_back_to_train(root: Path) -> dict:
    root = root.resolve()
    image_val = root / "images" / "val"
    label_val = root / "labels" / "val"
    image_train = root / "images" / "train"
    label_train = root / "labels" / "train"

    if not image_val.is_dir():
        return {
            "ok": False,
            "message": "No images/val folder found in the target. Nothing to move.",
            "scanned": 0,
            "moved": 0,
            "renamed": 0,
            "skipped": 0,
            "failed": 0,
            "labelsMoved": 0,
            "removedDirs": 0,
            "failures": [],
        }

    image_train.mkdir(parents=True, exist_ok=True)
    label_train.mkdir(parents=True, exist_ok=True)
    stats = {
        "scanned": 0,
        "moved": 0,
        "renamed": 0,
        "skipped": 0,
        "failed": 0,
        "labelsMoved": 0,
        "removedDirs": 0,
    }
    failures: list[str] = []

    images = sorted(
        path
        for path in image_val.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    if not images:
        return {
            "ok": False,
            "message": "Val → Train: images/val is empty (no images).",
            **stats,
            "failures": failures,
        }

    for source_image in images:
        stats["scanned"] += 1
        rel = source_image.relative_to(image_val)
        source_label = (label_val / rel).with_suffix(".txt")
        dest_image = image_train / rel
        renamed = dest_image.exists()
        if renamed:
            dest_image = unique_path(dest_image)
        dest_image.parent.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(source_image), str(dest_image))
            stats["moved"] += 1
            if renamed:
                stats["renamed"] += 1
            if source_label.is_file():
                dest_label = label_train / rel.parent / f"{dest_image.stem}.txt"
                if dest_label.exists():
                    dest_label = unique_path(dest_label)
                dest_label.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(source_label), str(dest_label))
                stats["labelsMoved"] += 1
        except Exception as error:
            stats["failed"] += 1
            failures.append(f"images/val/{rel.as_posix()}: {error}")

    if label_val.is_dir():
        for source_label in sorted(label_val.rglob("*.txt")):
            if not source_label.is_file():
                continue
            rel = source_label.relative_to(label_val)
            has_image = any((image_val / rel).with_suffix(ext).is_file() for ext in IMAGE_EXTENSIONS)
            if has_image:
                continue
            dest_label = label_train / rel
            renamed = dest_label.exists()
            if renamed:
                dest_label = unique_path(dest_label)
            dest_label.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.move(str(source_label), str(dest_label))
                stats["labelsMoved"] += 1
                if renamed:
                    stats["renamed"] += 1
            except Exception as error:
                stats["failed"] += 1
                failures.append(f"labels/val/{rel.as_posix()}: {error}")

    cleanup_empty_dirs(image_val)
    if label_val.exists():
        cleanup_empty_dirs(label_val)

    summary = (
        f"Val → Train done. moved {stats['moved']} image(s), "
        f"labels {stats['labelsMoved']}, renamed {stats['renamed']}, failed {stats['failed']}."
    )
    return {
        "ok": stats["failed"] == 0 and stats["moved"] > 0,
        "message": summary,
        **stats,
        "failures": failures,
    }


def attach_data_yaml_update(root: Path, result: dict) -> dict:
    yaml_result = ensure_data_yaml(root)
    result["dataYaml"] = yaml_result
    if yaml_result.get("ok") and yaml_result.get("updated"):
        result["message"] = f"{result['message']} Updated data.yaml ({', '.join(yaml_result['updated'])})."
    elif not yaml_result.get("ok"):
        result["yamlWarning"] = yaml_result.get("message", "Could not update data.yaml.")
    return result


def folder_has_images(folder: Path) -> bool:
    if not folder.is_dir():
        return False
    return any(path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS for path in folder.rglob("*"))


def parse_top_level_yaml_keys(lines: list[str]) -> dict[str, tuple[int, str]]:
    keys: dict[str, tuple[int, str]] = {}
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line[:1].isspace():
            continue
        match = TOP_LEVEL_YAML_KEY.match(line)
        if match:
            keys[match.group(1)] = (index, match.group(2).strip())
    return keys


def insert_yaml_key(lines: list[str], key: str, value: str, after: list[str]) -> None:
    keys = parse_top_level_yaml_keys(lines)
    insert_at = 0
    for name in after:
        if name in keys:
            insert_at = keys[name][0] + 1
            break
    lines.insert(insert_at, f"{key}: {value}")


def ensure_data_yaml(root: Path) -> dict:
    """Ensure Ultralytics-required train/val keys exist in data.yaml."""
    root = root.resolve()
    yaml_path = root / "data.yaml"
    train_dir = root / "images" / "train"
    val_dir = root / "images" / "val"

    if not folder_has_images(train_dir):
        return {"ok": False, "message": "images/train has no images."}

    has_val = folder_has_images(val_dir)
    lines = (
        yaml_path.read_text(encoding="utf-8", errors="replace").splitlines()
        if yaml_path.exists()
        else []
    )
    keys = parse_top_level_yaml_keys(lines)
    updated: list[str] = []

    if "train" not in keys:
        insert_yaml_key(lines, "train", DEFAULT_TRAIN, ["path"])
        updated.append("train")
    else:
        train_value = keys["train"][1].strip().strip("'\"")
        if train_value.endswith(".txt"):
            lines[keys["train"][0]] = f"train: {DEFAULT_TRAIN}"
            updated.append("train")

    keys = parse_top_level_yaml_keys(lines)
    if "val" not in keys:
        if not has_val:
            return {
                "ok": False,
                "message": "data.yaml is missing 'val:' and images/val is empty. Run Create Val Split first.",
                "needsValSplit": True,
            }
        insert_yaml_key(lines, "val", DEFAULT_VAL, ["train", "path"])
        updated.append("val")
    else:
        val_value = keys["val"][1].strip().strip("'\"")
        if val_value.endswith(".txt"):
            lines[keys["val"][0]] = f"val: {DEFAULT_VAL}"
            updated.append("val")

    keys = parse_top_level_yaml_keys(lines)
    if "path" not in keys and not lines:
        lines = [
            f"path: {root.as_posix()}",
            f"train: {DEFAULT_TRAIN}",
            f"val: {DEFAULT_VAL}",
        ]
        updated.extend(["path", "train", "val"])
    elif "path" not in keys and updated:
        insert_yaml_key(lines, "path", root.as_posix(), [])

    if updated or not yaml_path.exists():
        yaml_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")

    return {
        "ok": True,
        "message": "data.yaml is ready for YOLO training."
        if not updated
        else "data.yaml updated.",
        "updated": updated,
        "path": str(yaml_path),
    }


def classes_in_label(path: Path) -> set[int]:
    classes: set[int] = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        try:
            classes.add(int(float(parts[0])))
        except ValueError:
            continue
    return classes


def clamp_ratio(value: float) -> float:
    if not isinstance(value, (int, float)):
        return 0.15
    return max(0.05, min(0.4, float(value)))


def cleanup_empty_dirs(root: Path) -> None:
    for path in sorted((item for item in root.rglob("*") if item.is_dir()), reverse=True):
        try:
            path.rmdir()
        except OSError:
            pass
