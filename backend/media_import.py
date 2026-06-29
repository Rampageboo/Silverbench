from __future__ import annotations

import shutil
from pathlib import Path
from typing import Any, Iterable

from .dataset_merge import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS
from .video_screenshot import find_videos, video_info
from .yolo_workspace import load_workspace_config, workspace_media_relative_dir

SUPPORTED_MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def _unique_media_path(media_dir: Path, filename: str) -> Path:
    target = media_dir / Path(filename).name
    if not target.exists():
        return target
    for index in range(2, 10000):
        candidate = target.with_name(f"{target.stem}_{index}{target.suffix}")
        if not candidate.exists():
            return candidate
    raise FileExistsError(f"Cannot create a unique media path for {target}")


def import_media_files(workspace_root: Path, source_paths: Iterable[Path], mode: str = "copy") -> dict[str, Any]:
    action = "move" if str(mode).strip().lower() == "move" else "copy"
    paths = load_workspace_config(workspace_root)
    media_dir = paths.image_pool
    media_dir.mkdir(parents=True, exist_ok=True)
    media_rel = workspace_media_relative_dir(paths)

    imported: list[dict[str, str]] = []
    skipped: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []

    for raw_source in source_paths:
        source = Path(raw_source).expanduser().resolve()
        try:
            if not source.is_file():
                skipped.append({"source": str(source), "reason": "not a file"})
                continue
            suffix = source.suffix.lower()
            if suffix not in SUPPORTED_MEDIA_EXTENSIONS:
                skipped.append({"source": str(source), "reason": "unsupported media type"})
                continue
            if source.parent.resolve() == media_dir.resolve():
                skipped.append({"source": str(source), "reason": "already in media"})
                continue

            target = _unique_media_path(media_dir, source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            if action == "move":
                shutil.move(str(source), str(target))
            else:
                shutil.copy2(source, target)
            media_path = f"{media_rel}/{target.name}"
            imported.append(
                {
                    "source": str(source),
                    "filename": target.name,
                    "imagePath": media_path,
                    "mediaPath": media_path,
                    "mediaType": "video" if suffix in VIDEO_EXTENSIONS else "image",
                    "action": action,
                }
            )
        except Exception as error:
            failed.append({"source": str(source), "error": str(error)})

    return {
        "ok": True,
        "workspaceRoot": str(paths.root),
        "mediaDir": media_rel,
        "mode": action,
        "importedCount": len(imported),
        "skippedCount": len(skipped),
        "failedCount": len(failed),
        "imported": imported,
        "skipped": skipped,
        "failed": failed,
    }


def list_workspace_videos(workspace_root: Path) -> list[dict[str, Any]]:
    paths = load_workspace_config(workspace_root)
    return [video_info(path) for path in find_videos(paths.image_pool)]
