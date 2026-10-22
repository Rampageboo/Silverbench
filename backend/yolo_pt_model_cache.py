"""Loaded YOLO models: kept while in use, released when idle.

Models load on first use (nothing heavy starts with the app). A model nobody has
used for ``RWB_MODEL_IDLE_SECONDS`` (default 10 minutes) is dropped and the CUDA
cache is emptied, so a one-off auto-label run does not hold RAM/VRAM for the rest
of the session. Long jobs call :func:`touch_yolo_model` per item to stay loaded.
Other GPU-heavy work (tagging, ComfyUI control maps, motion capture) can call
:func:`release_models` first to hand the GPU over.
"""

from __future__ import annotations

import gc
import os
import sys
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .pt_safety import assert_safe_pt_file

_MAX_CACHED_MODELS = 4
_IDLE_SECONDS = float(os.environ.get("RWB_MODEL_IDLE_SECONDS", "600"))
_REAP_INTERVAL_SECONDS = 30.0


@dataclass
class _Entry:
    model: Any
    path: str
    loaded_at: float
    last_used: float


_MODEL_CACHE: OrderedDict[tuple[str, int, int], _Entry] = OrderedDict()
_MODEL_CACHE_LOCK = threading.Lock()
_reaper: threading.Thread | None = None


def _model_key(model_path: Path) -> tuple[str, int, int]:
    resolved = model_path.resolve()
    stat = resolved.stat()
    return (str(resolved), int(stat.st_mtime_ns), int(stat.st_size))


def get_yolo_model(model_path: Path) -> Any:
    key = _model_key(model_path)
    with _MODEL_CACHE_LOCK:
        entry = _MODEL_CACHE.get(key)
        if entry is not None:
            entry.last_used = time.monotonic()
            _MODEL_CACHE.move_to_end(key)
            return entry.model

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError("ultralytics is not installed. Install it with: pip install ultralytics") from error

    assert_safe_pt_file(model_path.resolve())
    model = YOLO(str(model_path.resolve()))
    now = time.monotonic()
    evicted = False
    with _MODEL_CACHE_LOCK:
        entry = _MODEL_CACHE.get(key)
        if entry is not None:
            entry.last_used = now
            _MODEL_CACHE.move_to_end(key)
            return entry.model
        _MODEL_CACHE[key] = _Entry(model, key[0], now, now)
        while len(_MODEL_CACHE) > _MAX_CACHED_MODELS:
            _MODEL_CACHE.popitem(last=False)
            evicted = True
    _ensure_reaper()
    if evicted:
        _free_gpu_memory()
    return model


def touch_yolo_model(model_path: Path) -> None:
    """Mark a model as in use (long jobs call this per item)."""
    resolved = str(model_path.resolve())
    with _MODEL_CACHE_LOCK:
        for entry in _MODEL_CACHE.values():
            if entry.path == resolved:
                entry.last_used = time.monotonic()


def _torch_cuda() -> Any | None:
    """torch.cuda only if torch is already imported: reporting must never load it."""
    torch = sys.modules.get("torch")
    try:
        return torch.cuda if torch is not None and torch.cuda.is_available() else None
    except Exception:
        return None


def _free_gpu_memory() -> None:
    gc.collect()
    cuda = _torch_cuda()
    if cuda is not None:
        try:
            cuda.empty_cache()
        except Exception:
            pass


def loaded_models() -> dict[str, Any]:
    """What is loaded now, for the status display."""
    now = time.monotonic()
    with _MODEL_CACHE_LOCK:
        models = [
            {
                "path": entry.path,
                "name": Path(entry.path).name,
                "loadedSecondsAgo": round(now - entry.loaded_at),
                "idleSeconds": round(now - entry.last_used),
            }
            for entry in reversed(_MODEL_CACHE.values())
        ]
    gpu: dict[str, Any] = {"torchLoaded": "torch" in sys.modules}
    cuda = _torch_cuda()
    if cuda is not None:
        try:
            gpu["allocatedMB"] = round(cuda.memory_allocated() / 2**20)
            gpu["reservedMB"] = round(cuda.memory_reserved() / 2**20)
        except Exception:
            pass
    return {"models": models, "idleReleaseSeconds": _IDLE_SECONDS, "gpu": gpu}


def release_models(path: str | None = None) -> dict[str, Any]:
    """Drop one model (by path) or all of them, then empty the CUDA cache."""
    with _MODEL_CACHE_LOCK:
        keys = [key for key, entry in _MODEL_CACHE.items() if path is None or entry.path == path]
        for key in keys:
            del _MODEL_CACHE[key]
    _free_gpu_memory()
    return {"released": len(keys), **loaded_models()}


def _release_idle(now: float | None = None) -> int:
    now = time.monotonic() if now is None else now
    with _MODEL_CACHE_LOCK:
        idle = [key for key, entry in _MODEL_CACHE.items() if now - entry.last_used >= _IDLE_SECONDS]
        for key in idle:
            del _MODEL_CACHE[key]
    if idle:
        _free_gpu_memory()
    return len(idle)


def _reap() -> None:
    global _reaper
    while True:
        time.sleep(_REAP_INTERVAL_SECONDS)
        _release_idle()
        with _MODEL_CACHE_LOCK:
            if not _MODEL_CACHE:
                _reaper = None  # nothing left to watch; the next load starts a new reaper
                return


def _ensure_reaper() -> None:
    global _reaper
    with _MODEL_CACHE_LOCK:
        if _reaper is None:
            _reaper = threading.Thread(target=_reap, name="model-idle-release", daemon=True)
            _reaper.start()
