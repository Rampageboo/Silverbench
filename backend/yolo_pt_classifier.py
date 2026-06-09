from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Callable

from .dataset_merge import IMAGE_EXTENSIONS, unique_path
from .torch_runtime import require_cuda_device


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

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError("ultralytics is not installed. Install it with: pip install ultralytics") from error

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

    model = YOLO(str(model_path))
    class_counts: dict[str, int] = {}
    errors: list[dict[str, str]] = []
    copied = 0

    for index, image_path in enumerate(images, start=1):
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


def _safe_class_name(name: object) -> str:
    value = str(name or "unknown").strip() or "unknown"
    for char in '<>:"/\\|?*':
        value = value.replace(char, "_")
    return value[:120]
