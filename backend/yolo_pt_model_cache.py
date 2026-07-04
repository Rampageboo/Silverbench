from __future__ import annotations

from collections import OrderedDict
from pathlib import Path
from threading import Lock
from typing import Any

from .pt_safety import assert_safe_pt_file

_MAX_CACHED_MODELS = 4
_MODEL_CACHE: OrderedDict[tuple[str, int, int], Any] = OrderedDict()
_MODEL_CACHE_LOCK = Lock()


def _model_key(model_path: Path) -> tuple[str, int, int]:
    resolved = model_path.resolve()
    stat = resolved.stat()
    return (str(resolved), int(stat.st_mtime_ns), int(stat.st_size))


def get_yolo_model(model_path: Path) -> Any:
    key = _model_key(model_path)
    with _MODEL_CACHE_LOCK:
        cached = _MODEL_CACHE.get(key)
        if cached is not None:
            _MODEL_CACHE.move_to_end(key)
            return cached

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError("ultralytics is not installed. Install it with: pip install ultralytics") from error

    assert_safe_pt_file(model_path.resolve())
    model = YOLO(str(model_path.resolve()))
    with _MODEL_CACHE_LOCK:
        cached = _MODEL_CACHE.get(key)
        if cached is not None:
            _MODEL_CACHE.move_to_end(key)
            return cached
        _MODEL_CACHE[key] = model
        while len(_MODEL_CACHE) > _MAX_CACHED_MODELS:
            _MODEL_CACHE.popitem(last=False)
    return model
