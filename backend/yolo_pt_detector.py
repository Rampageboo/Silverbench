from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from .dataset_merge import IMAGE_EXTENSIONS, unique_path
from .yolo_pt_model_cache import get_yolo_model, touch_yolo_model
from .torch_runtime import require_cuda_device


def detect_folder_with_pt(
    model_path: Path,
    source_dir: Path,
    output_dir: Path,
    image_size: int = 640,
    confidence: float = 0.25,
    device: str = "0",
    include_filenames: list[str] | None = None,
    progress_callback: Callable[[int, int, str], None] | None = None,
    cancel_event: Any | None = None,
) -> dict[str, Any]:
    model_path = model_path.resolve()
    source_dir = source_dir.resolve()
    output_dir = output_dir.resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if model_path.suffix.lower() != ".pt":
        raise ValueError("Detection model must be a .pt file.")
    if not source_dir.is_dir():
        raise NotADirectoryError(f"Source folder not found: {source_dir}")
    require_cuda_device(device)

    include_names = {Path(name).name for name in (include_filenames or []) if str(name).strip()}
    images = sorted(
        path
        for path in source_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        and (not include_names or path.name in include_names)
    )
    image_output = output_dir / "images"
    label_output = output_dir / "labels"
    image_output.mkdir(parents=True, exist_ok=True)
    label_output.mkdir(parents=True, exist_ok=True)
    if not images:
        return _result(model_path, source_dir, output_dir, 0, 0, 0, {}, [])

    model = get_yolo_model(model_path)
    class_counts: dict[str, int] = {}
    errors: list[dict[str, str]] = []
    copied = 0
    labels = 0

    for index, image_path in enumerate(images, start=1):
        touch_yolo_model(model_path)  # a running job keeps its model loaded
        if cancel_event is not None and cancel_event.is_set():
            _write_data_yaml(output_dir, model)
            result = _result(model_path, source_dir, output_dir, len(images), copied, labels, class_counts, errors)
            result["cancelled"] = True
            return result
        try:
            rel = image_path.relative_to(source_dir)
            target_image = unique_path(image_output / rel)
            target_label = (label_output / target_image.relative_to(image_output)).with_suffix(".txt")
            target_image.parent.mkdir(parents=True, exist_ok=True)
            target_label.parent.mkdir(parents=True, exist_ok=True)

            results = model.predict(
                source=str(image_path),
                imgsz=int(image_size),
                conf=float(confidence),
                device=str(device or "0"),
                verbose=False,
            )
            if not results:
                raise RuntimeError("No prediction result.")

            shutil.copy2(image_path, target_image)
            copied += 1

            result = results[0]
            rows: list[str] = []
            if result.boxes is not None:
                names = result.names or {}
                for box in result.boxes:
                    class_id = int(box.cls.item())
                    x, y, w, h = [float(value) for value in box.xywhn[0].tolist()]
                    rows.append(f"{class_id} {_fmt(x)} {_fmt(y)} {_fmt(w)} {_fmt(h)}")
                    class_name = _class_name(names, class_id)
                    class_counts[class_name] = class_counts.get(class_name, 0) + 1
            target_label.write_text(("\n".join(rows) + ("\n" if rows else "")), encoding="utf-8")
            labels += 1
        except Exception as error:
            errors.append({"path": str(image_path), "error": str(error)})
        if progress_callback:
            progress_callback(index, len(images), str(image_path))

    _write_data_yaml(output_dir, model)
    return _result(model_path, source_dir, output_dir, len(images), copied, labels, class_counts, errors)


def detect_image_with_pt(
    model_path: Path,
    image_path: Path,
    image_size: int = 640,
    confidence: float = 0.25,
    device: str = "0",
) -> dict[str, Any]:
    model_path = model_path.resolve()
    image_path = image_path.resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if model_path.suffix.lower() != ".pt":
        raise ValueError("Detection model must be a .pt file.")
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"Unsupported image file: {image_path.name}")
    require_cuda_device(device)

    model = get_yolo_model(model_path)
    results = model.predict(
        source=str(image_path),
        imgsz=int(image_size),
        conf=float(confidence),
        device=str(device or "0"),
        verbose=False,
    )
    if not results:
        raise RuntimeError("No prediction result.")

    result = results[0]
    names = result.names or getattr(model, "names", {}) or {}
    predictions: list[dict[str, Any]] = []
    if result.boxes is not None:
        for box in result.boxes:
            class_id = int(box.cls.item())
            x, y, w, h = [float(value) for value in box.xywhn[0].tolist()]
            predictions.append(
                {
                    "classId": class_id,
                    "className": _class_name(names, class_id),
                    "confidence": float(box.conf.item()),
                    "x": _clamp01(x),
                    "y": _clamp01(y),
                    "w": _clamp01(w),
                    "h": _clamp01(h),
                }
            )
    return {
        "ok": True,
        "modelPath": str(model_path),
        "imagePath": str(image_path),
        "imageSize": int(image_size),
        "confidence": float(confidence),
        "predictions": predictions,
    }


def _result(
    model_path: Path,
    source_dir: Path,
    output_dir: Path,
    total: int,
    copied: int,
    labels: int,
    class_counts: dict[str, int],
    errors: list[dict[str, str]],
) -> dict[str, Any]:
    return {
        "ok": True,
        "modelPath": str(model_path),
        "sourceDir": str(source_dir),
        "outputDir": str(output_dir),
        "total": total,
        "copied": copied,
        "labels": labels,
        "classes": dict(sorted(class_counts.items())),
        "errors": errors,
    }


def _write_data_yaml(output_dir: Path, model: Any) -> None:
    names = getattr(model, "names", None) or {}
    if not names:
        return
    if hasattr(names, "items"):
        items = sorted((int(index), str(name)) for index, name in names.items())
    else:
        items = list(enumerate(str(name) for name in names))
    lines = ["path: .", "train: images", "val: images", "names:"]
    for index, name in items:
        safe_name = str(name).replace('"', '\\"')
        lines.append(f'  {index}: "{safe_name}"')
    (output_dir / "data.yaml").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _class_name(names: Any, class_id: int) -> str:
    if hasattr(names, "get"):
        return str(names.get(class_id, str(class_id)))
    if 0 <= class_id < len(names):
        return str(names[class_id])
    return str(class_id)


def _fmt(value: float) -> str:
    return f"{max(0.0, min(1.0, value)):.6f}".rstrip("0").rstrip(".")


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
