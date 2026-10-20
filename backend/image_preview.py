from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image

from .image_safety import ensure_safe_image_size
from .yolo_workspace import IMAGE_EXTENSIONS


def image_scaled_jpeg_base64(path: Path, max_edge: int = 1280, quality: int = 70) -> str:
    """Return a JPEG preview capped to max_edge; used for UI display instead of full originals."""
    if not path.is_file():
        raise FileNotFoundError(path)
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"Not an image file: {path}")
    edge = max(256, min(int(max_edge), 4096))
    jpeg_quality = max(35, min(int(quality), 92))
    with Image.open(path) as image:
        ensure_safe_image_size(image)
        preview = image.convert("RGB")
        if max(preview.size) > edge:
            preview.thumbnail((edge, edge))
        buffer = io.BytesIO()
        preview.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
    return base64.b64encode(buffer.getvalue()).decode("ascii")
