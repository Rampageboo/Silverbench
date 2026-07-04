from __future__ import annotations

import base64
import hashlib
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


def thumb_cache_path(session_dir: Path, workspace_root: Path, filename: str, max_size: int, quality: int) -> Path:
    key = hashlib.sha1(str(workspace_root.expanduser().resolve()).encode("utf-8")).hexdigest()[:16]
    safe_name = Path(filename).name.replace("\\", "_").replace("/", "_")
    return session_dir / "thumb_cache" / key / f"{safe_name}_{max_size}_q{quality}.jpg"


def image_thumbnail_jpeg_base64(
    path: Path,
    max_size: int = 128,
    *,
    quality: int = 54,
    session_dir: Path | None = None,
    workspace_root: Path | None = None,
    filename: str = "",
) -> str:
    """Return a small JPEG preview; optionally persist to session_dir/thumb_cache."""
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError(path)
    size = max(32, min(int(max_size), 512))
    jpeg_quality = max(30, min(int(quality), 85))
    cache_path = None
    if session_dir and workspace_root and filename:
        cache_path = thumb_cache_path(session_dir, workspace_root, filename, size, jpeg_quality)
        try:
            if cache_path.is_file() and cache_path.stat().st_mtime >= path.stat().st_mtime:
                return base64.b64encode(cache_path.read_bytes()).decode("ascii")
        except OSError:
            cache_path = None

    with Image.open(path) as image:
        ensure_safe_image_size(image)
        preview = image.convert("RGB")
        preview.thumbnail((size, size))
        buffer = io.BytesIO()
        preview.save(buffer, format="JPEG", quality=jpeg_quality, optimize=True)
        payload = buffer.getvalue()

    if cache_path is not None:
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(payload)
        except OSError:
            pass

    return base64.b64encode(payload).decode("ascii")
