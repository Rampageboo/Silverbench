from __future__ import annotations

from pathlib import Path

from PIL import Image

# Upper bound on decoded pixel count for any image we open from a workspace or
# an untrusted base64 payload. A small compressed file can otherwise expand to
# gigabytes of RAM (a "decompression bomb"). 60 MP comfortably covers real
# photos/screenshots while blocking abusive payloads.
MAX_IMAGE_PIXELS = 60_000_000


class ImageTooLargeError(ValueError):
    """Raised when an image's decoded dimensions exceed :data:`MAX_IMAGE_PIXELS`."""


def ensure_safe_image_size(image: Image.Image) -> Image.Image:
    """Reject images whose pixel count would risk memory exhaustion.

    Uses the header-reported size, so it runs before the pixel data is decoded.
    """
    width, height = image.size
    if width <= 0 or height <= 0:
        raise ImageTooLargeError("Image has invalid dimensions.")
    if width * height > MAX_IMAGE_PIXELS:
        raise ImageTooLargeError(
            f"Image is too large to process ({width}x{height}); "
            f"limit is {MAX_IMAGE_PIXELS:,} pixels."
        )
    return image


def open_image_checked(path: Path) -> Image.Image:
    """Open an image file and validate its size before any decode work."""
    image = Image.open(path)
    try:
        ensure_safe_image_size(image)
    except BaseException:
        image.close()
        raise
    return image
