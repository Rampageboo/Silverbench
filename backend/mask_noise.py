from __future__ import annotations

import base64
import io
import json
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageFilter

from .dataset_merge import IMAGE_EXTENSIONS, unique_path


@dataclass(frozen=True)
class MaskNoiseSettings:
    threshold: int = 80
    noise_amount: float = 6.0
    blur_radius: float = 2.0
    effect_mix: float = 0.35
    gray_max: int = 220
    gray_mix: float = 0.75


def settings_from_json(settings_json: str | dict[str, Any] | None) -> MaskNoiseSettings:
    raw = settings_json
    if isinstance(raw, str):
        raw = json.loads(raw or "{}")
    if not isinstance(raw, dict):
        raw = {}
    return MaskNoiseSettings(
        threshold=max(0, min(255, int(round(float(raw.get("threshold", 80) or 0))))),
        noise_amount=max(0.0, min(255.0, float(raw.get("noiseAmount", 6) or 0))),
        blur_radius=max(0.0, min(40.0, float(raw.get("blurRadius", 2) or 0))),
        effect_mix=max(0.0, min(1.0, float(raw.get("effectMix", 0.35) or 0))),
        gray_max=max(0, min(255, int(round(float(raw.get("grayMax", 220) or 0))))),
        gray_mix=max(0.0, min(1.0, float(raw.get("grayMix", 0.75) or 0))),
    )


def find_images(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return sorted(
        (path for path in root.rglob("*") if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS),
        key=lambda path: path.relative_to(root).as_posix().lower(),
    )


def save_temp_image(session_dir: Path, filename: str, base64_data: str) -> str:
    suffix = Path(filename or "image.png").suffix.lower()
    if suffix not in IMAGE_EXTENSIONS:
        suffix = ".png"
    target_dir = session_dir / "mask_noise_imports"
    target_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(filename or "image").stem or "image"
    target = unique_path(target_dir / f"{_safe_name(stem)}{suffix}")
    target.write_bytes(base64.b64decode(base64_data))
    return str(target)


def preview_base64(photo_path: Path, mask_path: Path, settings: MaskNoiseSettings) -> dict[str, Any]:
    output, diff, stats = process_image(photo_path, mask_path, settings)
    return {
        "outputBase64": image_to_base64(output),
        "diffBase64": image_to_base64(diff),
        "stats": stats,
    }


def save_one(photo_path: Path, mask_path: Path, output_root: Path, settings: MaskNoiseSettings) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    output, diff, stats = process_image(photo_path, mask_path, settings)
    output_path = output_root / f"{_safe_name(photo_path.stem)}_noise.png"
    output.save(output_path, format="PNG")
    return {
        "output": str(output_path),
        "outputBase64": image_to_base64(output),
        "diffBase64": image_to_base64(diff),
        "stats": stats,
    }


def export_folder(input_root: Path, mask_path: Path, output_root: Path, settings: MaskNoiseSettings) -> dict[str, Any]:
    mask_resolved = mask_path.resolve()
    output_resolved = output_root.resolve()
    images = []
    for path in find_images(input_root):
        resolved = path.resolve()
        if resolved == mask_resolved:
            continue
        if resolved == output_resolved or output_resolved in resolved.parents:
            continue
        images.append(path)
    output_root.mkdir(parents=True, exist_ok=True)
    exported = 0
    failed = 0
    errors: list[str] = []
    first_preview: dict[str, str] | None = None
    first_stats: dict[str, Any] | None = None

    for image_path in images:
        rel = image_path.relative_to(input_root)
        out_rel = rel.with_name(f"{_safe_name(rel.stem)}_noise.png")
        out_path = output_root / out_rel
        try:
            output, diff, stats = process_image(image_path, mask_path, settings)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            output.save(out_path, format="PNG")
            exported += 1
            if first_preview is None:
                first_preview = {
                    "photoPath": str(image_path),
                    "outputBase64": image_to_base64(output),
                    "diffBase64": image_to_base64(diff),
                }
                first_stats = stats
        except Exception as error:  # noqa: BLE001 - returned to UI as batch diagnostics
            failed += 1
            if len(errors) < 20:
                errors.append(f"{rel.as_posix()}: {error}")

    return {
        "total": len(images),
        "exported": exported,
        "failed": failed,
        "output": str(output_root),
        "errors": errors,
        "firstPreview": first_preview,
        "firstStats": first_stats,
    }


def process_image(photo_path: Path, mask_path: Path, settings: MaskNoiseSettings) -> tuple[Image.Image, Image.Image, dict[str, Any]]:
    with Image.open(photo_path) as photo_img:
        photo = photo_img.convert("RGBA")
    with Image.open(mask_path) as mask_img:
        mask = mask_img.convert("L").resize(photo.size, Image.Resampling.BILINEAR)

    source = np.asarray(photo).astype(np.float32)
    output = source.copy()
    mask_arr = np.asarray(mask)
    masked = mask_arr <= settings.threshold
    gray_mask = (mask_arr > settings.threshold) & (mask_arr <= settings.gray_max)
    changed = int(masked.sum())
    gray_changed = int(gray_mask.sum())

    if changed:
        if settings.blur_radius > 0:
            blurred_img = photo.filter(ImageFilter.GaussianBlur(radius=settings.blur_radius))
            degraded = np.asarray(blurred_img).astype(np.float32)
        else:
            degraded = source.copy()

        if settings.noise_amount > 0:
            noise = np.random.default_rng(random.SystemRandom().randint(0, 2**32 - 1)).normal(
                0,
                settings.noise_amount,
                size=(*mask_arr.shape, 1),
            )
            degraded[:, :, :3] += noise

        mixed_rgb = source[:, :, :3] * (1 - settings.effect_mix) + degraded[:, :, :3] * settings.effect_mix
        output[:, :, :3][masked] = mixed_rgb[masked]
        output[:, :, :3] = np.clip(output[:, :, :3], 0, 255)

    if gray_changed and settings.gray_mix > 0:
        gray_replacement = gray_area_replacement(source, gray_mask)
        mixed_gray = source[:, :, :3] * (1 - settings.gray_mix) + gray_replacement * settings.gray_mix
        output[:, :, :3][gray_mask] = mixed_gray[gray_mask]
        output[:, :, :3] = np.clip(output[:, :, :3], 0, 255)

    before_rgb = source[:, :, :3]
    after_rgb = output[:, :, :3]
    delta = np.abs(after_rgb - before_rgb)
    affected_mask = masked | gray_mask
    affected = int(affected_mask.sum())
    if affected:
        masked_delta = delta[affected_mask]
        mean_delta = float(masked_delta.mean()) if masked_delta.size else 0.0
        max_delta = float(masked_delta.max()) if masked_delta.size else 0.0
    else:
        mean_delta = 0.0
        max_delta = 0.0

    diff_rgb = np.clip(delta.mean(axis=2) * 8, 0, 255).astype(np.uint8)
    diff = Image.fromarray(np.stack([diff_rgb, diff_rgb, diff_rgb], axis=2), "RGB")
    output_img = Image.fromarray(np.clip(output, 0, 255).astype(np.uint8), "RGBA")
    stats = {
        "changed": changed,
        "grayChanged": gray_changed,
        "affected": affected,
        "total": int(mask_arr.size),
        "meanDelta": mean_delta,
        "maxDelta": max_delta,
        "threshold": settings.threshold,
        "noiseAmount": settings.noise_amount,
        "blurRadius": settings.blur_radius,
        "effectMix": settings.effect_mix,
        "grayMax": settings.gray_max,
        "grayMix": settings.gray_mix,
    }
    return output_img, diff, stats


def gray_area_replacement(source: np.ndarray, gray_mask: np.ndarray) -> np.ndarray:
    rgb = source[:, :, :3]
    height, width = gray_mask.shape
    radius = max(2, min(24, int(round(min(width, height) * 0.012))))
    replacement = np.asarray(
        Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.BoxBlur(radius=radius))
    ).astype(np.float32)

    background = rgb[~gray_mask]
    if background.size:
        sampled = background[np.random.default_rng().integers(0, len(background), size=int(gray_mask.sum()))]
        replacement[gray_mask] = sampled

    rng = np.random.default_rng(random.SystemRandom().randint(0, 2**32 - 1))
    brightness = rng.uniform(-18, 18, size=(*gray_mask.shape, 1))
    replacement += brightness

    erase = gray_mask & (rng.random(gray_mask.shape) < 0.35)
    if erase.any():
        block = np.asarray(
            Image.fromarray(np.clip(replacement, 0, 255).astype(np.uint8), "RGB").filter(ImageFilter.GaussianBlur(radius=1.2))
        ).astype(np.float32)
        replacement[erase] = block[erase]

    return np.clip(replacement, 0, 255)


def image_to_base64(image: Image.Image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _safe_name(text: str) -> str:
    safe = "".join("_" if char in '<>:"/\\|?*\x00' or ord(char) < 32 else char for char in text)
    safe = "_".join(safe.split())
    return safe[:90] or "image"
