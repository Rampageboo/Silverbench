from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from .dataset_merge import IMAGE_EXTENSIONS, unique_path
from .torch_runtime import require_cuda_device
from .yolo_pt_model_cache import get_yolo_model, touch_yolo_model


def classify_folder_with_pt(
    model_path: Path,
    source_dir: Path,
    output_dir: Path,
    image_size: int = 224,
    device: str = "0",
    confidence_prefix: bool = True,
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
        raise ValueError("Classification model must be a .pt file.")
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
    output_dir.mkdir(parents=True, exist_ok=True)
    if not images:
        return {
            "ok": True,
            "modelPath": str(model_path),
            "sourceDir": str(source_dir),
            "outputDir": str(output_dir),
            "total": 0,
            "copied": 0,
            "classes": {},
            "errors": [],
        }

    model = get_yolo_model(model_path)
    class_counts: dict[str, int] = {}
    errors: list[dict[str, str]] = []
    copied = 0

    for index, image_path in enumerate(images, start=1):
        touch_yolo_model(model_path)  # a running job keeps its model loaded
        if cancel_event is not None and cancel_event.is_set():
            return {
                "ok": True,
                "modelPath": str(model_path),
                "sourceDir": str(source_dir),
                "outputDir": str(output_dir),
                "total": len(images),
                "copied": copied,
                "classes": dict(sorted(class_counts.items())),
                "errors": errors,
                "cancelled": True,
            }
        try:
            results = model.predict(
                source=str(image_path),
                imgsz=int(image_size),
                device=str(device or "0"),
                verbose=False,
            )
            if not results:
                raise RuntimeError("No prediction result.")
            result = results[0]
            if result.probs is None:
                raise RuntimeError("Model did not return classification probabilities. Use a *-cls.pt model.")
            class_id = int(result.probs.top1)
            confidence = float(result.probs.top1conf)
            names = result.names or {}
            if hasattr(names, "get"):
                raw_class_name = names.get(class_id, str(class_id))
            else:
                raw_class_name = names[class_id] if 0 <= class_id < len(names) else str(class_id)
            class_name = _safe_class_name(raw_class_name)
            target_dir = output_dir / class_name
            target_dir.mkdir(parents=True, exist_ok=True)
            prefix = f"{confidence:.3f}_" if confidence_prefix else ""
            target = unique_path(target_dir / f"{prefix}{image_path.name}")
            shutil.copy2(image_path, target)
            class_counts[class_name] = class_counts.get(class_name, 0) + 1
            copied += 1
        except Exception as error:
            errors.append({"path": str(image_path), "error": str(error)})
        if progress_callback:
            progress_callback(index, len(images), str(image_path))

    return {
        "ok": True,
        "modelPath": str(model_path),
        "sourceDir": str(source_dir),
        "outputDir": str(output_dir),
        "total": len(images),
        "copied": copied,
        "classes": dict(sorted(class_counts.items())),
        "errors": errors,
    }


def classify_image_with_pt(
    model_path: Path,
    image_path: Path,
    image_size: int = 0,
    device: str = "0",
    top_k: int = 5,
) -> dict[str, Any]:
    model_path = model_path.resolve()
    image_path = image_path.resolve()
    if not model_path.is_file():
        raise FileNotFoundError(f"Model not found: {model_path}")
    if model_path.suffix.lower() != ".pt":
        raise ValueError("Classification model must be a .pt file.")
    if not image_path.is_file():
        raise FileNotFoundError(f"Image not found: {image_path}")
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"Unsupported image file: {image_path.name}")
    require_cuda_device(device)

    model = get_yolo_model(model_path)
    effective_image_size = _effective_image_size(model, image_size, fallback=224)
    results = model.predict(
        source=str(image_path),
        imgsz=effective_image_size,
        device=str(device or "0"),
        verbose=False,
    )
    if not results:
        raise RuntimeError("No prediction result.")

    result = results[0]
    if result.probs is None:
        raise RuntimeError("Model did not return classification probabilities. Use a *-cls.pt model.")

    names = result.names or getattr(model, "names", {}) or {}
    predictions = _prob_predictions(result.probs, names, top_k)
    return {
        "ok": True,
        "modelPath": str(model_path),
        "imagePath": str(image_path),
        "imageSize": effective_image_size,
        "topK": int(top_k),
        "top": predictions[0] if predictions else None,
        "predictions": predictions,
    }


def _safe_class_name(name: object) -> str:
    value = str(name or "unknown").strip() or "unknown"
    for char in '<>:"/\\|?*':
        value = value.replace(char, "_")
    return value[:120]


def _prob_predictions(probs: Any, names: Any, top_k: int) -> list[dict[str, Any]]:
    limit = max(1, int(top_k or 1))
    top_indexes = _values(getattr(probs, "top5", None))
    top_confidences = _values(getattr(probs, "top5conf", None))
    if not top_indexes:
        top_indexes = _values(getattr(probs, "top1", None))
        top_confidences = _values(getattr(probs, "top1conf", None))

    predictions: list[dict[str, Any]] = []
    for offset, raw_class_id in enumerate(top_indexes[:limit]):
        class_id = int(_scalar(raw_class_id))
        confidence = _scalar(top_confidences[offset]) if offset < len(top_confidences) else 0.0
        class_name = _class_name(names, class_id)
        predictions.append(
            {
                "classId": class_id,
                "className": class_name,
                "name": class_name,
                "confidence": float(max(0.0, min(1.0, confidence))),
            }
        )
    return predictions


def _values(value: Any) -> list[Any]:
    if value is None:
        return []
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _class_name(names: Any, class_id: int) -> str:
    if hasattr(names, "get"):
        return str(names.get(class_id, str(class_id)))
    if 0 <= class_id < len(names):
        return str(names[class_id])
    return str(class_id)


def _scalar(value: Any) -> float:
    if hasattr(value, "item"):
        return float(value.item())
    return float(value)


def _effective_image_size(model: Any, requested: int, fallback: int) -> int:
    try:
        value = int(requested)
    except (TypeError, ValueError):
        value = 0
    if value > 0:
        return value

    for source in (getattr(model, "overrides", None), getattr(getattr(model, "model", None), "args", None)):
        size = _image_size_from_source(source)
        if size > 0:
            return size
    return int(fallback)


def _image_size_from_source(source: Any) -> int:
    if not source:
        return 0
    raw = source.get("imgsz") if hasattr(source, "get") else getattr(source, "imgsz", 0)
    if isinstance(raw, (list, tuple)):
        raw = raw[0] if raw else 0
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 0
