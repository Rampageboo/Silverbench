from __future__ import annotations

from pathlib import Path
from typing import Any

from .pt_safety import assert_safe_pt_file


def pt_model_info(model_path: Path) -> dict[str, Any]:
    path = model_path.expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Model not found: {path}")
    if path.suffix.lower() != ".pt":
        raise ValueError("YOLO model must be a .pt file.")

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError("ultralytics is not installed. Install it with: pip install ultralytics") from error

    assert_safe_pt_file(path)
    model = YOLO(str(path))
    names = _normalize_names(getattr(model, "names", None) or {})
    task = str(getattr(model, "task", "") or "")
    return {
        "ok": True,
        "modelPath": str(path),
        "task": task,
        "classes": [{"id": class_id, "name": name} for class_id, name in names],
        "classNames": [name for _, name in names],
    }


def _normalize_names(names: Any) -> list[tuple[int, str]]:
    if hasattr(names, "items"):
        result: list[tuple[int, str]] = []
        for raw_id, raw_name in names.items():
            try:
                class_id = int(raw_id)
            except (TypeError, ValueError):
                continue
            name = str(raw_name).strip()
            if name:
                result.append((class_id, name))
        return sorted(result)

    if isinstance(names, (list, tuple)):
        return [(index, str(name).strip()) for index, name in enumerate(names) if str(name).strip()]

    return []
