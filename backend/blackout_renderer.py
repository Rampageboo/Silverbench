"""
Non-destructive blackout renderer for export-time frame processing.

Core principle: source video/image files are NEVER modified.
apply_blackout_rects returns a copy of the input image.
"""
from __future__ import annotations

from typing import Any

import numpy as np


def apply_blackout_rects(image: np.ndarray, rects: list[dict[str, Any]]) -> np.ndarray:
    """
    Apply normalized blackout rects to a copy of `image`.

    Args:
        image: NumPy ndarray of shape (H, W) or (H, W, C), any dtype.
        rects: List of rect dicts with keys "x", "y", "w", "h" (all normalized
               0–1, center-based, matching the TypeScript BlackoutRectShape
               convention).

    Returns:
        A new ndarray with the specified regions set to 0 (black).
        The input array is NEVER mutated.

    Raises:
        TypeError: if `image` is not a numpy ndarray.
    """
    if not isinstance(image, np.ndarray):
        raise TypeError(f"image must be a numpy ndarray, got {type(image)!r}")

    result = image.copy()
    h, w = result.shape[:2]

    for rect in rects:
        try:
            rx = float(rect.get("x", 0))
            ry = float(rect.get("y", 0))
            rw = float(rect.get("w", 0))
            rh = float(rect.get("h", 0))
        except (TypeError, ValueError):
            continue

        if rw <= 0 or rh <= 0:
            continue

        x1 = max(0, int((rx - rw / 2) * w))
        y1 = max(0, int((ry - rh / 2) * h))
        x2 = min(w, int(round((rx + rw / 2) * w)))
        y2 = min(h, int(round((ry + rh / 2) * h)))

        if x2 <= x1 or y2 <= y1:
            continue

        result[y1:y2, x1:x2] = 0

    return result
