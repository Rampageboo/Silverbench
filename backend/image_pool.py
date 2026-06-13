from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from .image_preview import image_thumbnail_jpeg_base64

from .yolo_workspace import (
    IMAGE_EXTENSIONS,
    WORKSPACE_SESSION_DIRNAME,
    load_workspace_config,
)

SNAPSHOT_FILENAME = "image_pool_snapshot.json"
DEFAULT_SNAPSHOT: dict[str, Any] = {
    "version": 1,
    "knownFiles": [],
    "updatedAt": "",
    "scanCache": None,
}


def snapshot_path(workspace_root: Path) -> Path:
    return (
        workspace_root.expanduser().resolve()
        / WORKSPACE_SESSION_DIRNAME
        / SNAPSHOT_FILENAME
    )


def read_snapshot(workspace_root: Path) -> dict[str, Any]:
    path = snapshot_path(workspace_root)
    if not path.is_file():
        return dict(DEFAULT_SNAPSHOT)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(DEFAULT_SNAPSHOT)
    if not isinstance(data, dict):
        return dict(DEFAULT_SNAPSHOT)
    known = data.get("knownFiles")
    if not isinstance(known, list):
        known = []
    scan_cache = data.get("scanCache")
    if not isinstance(scan_cache, dict):
        scan_cache = None
    return {
        "version": 1,
        "knownFiles": sorted({str(name) for name in known if name}),
        "updatedAt": str(data.get("updatedAt") or ""),
        "scanCache": scan_cache,
    }


def write_snapshot(workspace_root: Path, filenames: list[str]) -> str:
    path = snapshot_path(workspace_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = read_snapshot(workspace_root)
    payload = {
        "version": 1,
        "knownFiles": sorted({str(name) for name in filenames if name}),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
    if existing.get("scanCache"):
        payload["scanCache"] = existing["scanCache"]
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return str(path)


def _write_snapshot_scan_cache(workspace_root: Path, fingerprint: str, scan_payload: dict[str, Any]) -> None:
    path = snapshot_path(workspace_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = {}
    else:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data["scanCache"] = {
        "fingerprint": fingerprint,
        "cachedAt": datetime.now(timezone.utc).isoformat(),
        **scan_payload,
    }
    if "version" not in data:
        data["version"] = 1
    if "knownFiles" not in data:
        data["knownFiles"] = []
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _pool_fingerprint(image_pool: Path) -> str:
    if not image_pool.is_dir():
        return ""
    count = 0
    latest_mtime = 0.0
    try:
        for entry in image_pool.iterdir():
            if not entry.is_file():
                continue
            if entry.suffix.lower() not in IMAGE_EXTENSIONS:
                continue
            count += 1
            try:
                latest_mtime = max(latest_mtime, entry.stat().st_mtime)
            except OSError:
                pass
    except OSError:
        return ""
    return f"{count}:{int(latest_mtime)}"


def _list_pool_images(image_pool: Path) -> list[Path]:
    if not image_pool.is_dir():
        return []
    files = [
        path
        for path in sorted(image_pool.iterdir())
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    ]
    return files


def _file_identity(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
        return int(stat.st_dev), int(stat.st_ino)
    except OSError:
        return None


def _iter_dataset_image_files(detect_out: Path, clf_out: Path) -> Iterator[Path]:
    """Walk only known dataset image locations (skip labels/text dirs)."""
    for split in ("train", "val"):
        detect_split = detect_out / "images" / split
        if detect_split.is_dir():
            for candidate in detect_split.iterdir():
                if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
                    yield candidate
        clf_split = clf_out / split
        if clf_split.is_dir():
            for candidate in clf_split.rglob("*"):
                if candidate.is_file() and candidate.suffix.lower() in IMAGE_EXTENSIONS:
                    yield candidate


_USAGE_IDENTITY_CACHE: dict[str, tuple[tuple[float, float], frozenset[tuple[int, int]]]] = {}


def _dataset_dir_stamp(detect_out: Path, clf_out: Path) -> tuple[float, float]:
    def _mtime(path: Path) -> float:
        try:
            return path.stat().st_mtime if path.exists() else 0.0
        except OSError:
            return 0.0

    return (_mtime(detect_out), _mtime(clf_out))


def _build_usage_identities(detect_out: Path, clf_out: Path) -> frozenset[tuple[int, int]]:
    cache_key = f"{detect_out}|{clf_out}"
    stamp = _dataset_dir_stamp(detect_out, clf_out)
    cached = _USAGE_IDENTITY_CACHE.get(cache_key)
    if cached and cached[0] == stamp:
        return cached[1]

    used: set[tuple[int, int]] = set()
    for candidate in _iter_dataset_image_files(detect_out, clf_out):
        identity = _file_identity(candidate)
        if identity is not None:
            used.add(identity)
    frozen = frozenset(used)
    _USAGE_IDENTITY_CACHE[cache_key] = (stamp, frozen)
    return frozen


def _is_used_in_datasets(pool_file: Path, used_identities: frozenset[tuple[int, int]]) -> bool:
    identity = _file_identity(pool_file)
    if identity is None:
        return False
    return identity in used_identities


_HARDLINK_PATH_CACHE: dict[str, tuple[tuple[float, float], dict[tuple[int, int], list[str]]]] = {}


def _build_hardlink_index(
    workspace_root: Path,
    detect_out: Path,
    clf_out: Path,
) -> dict[tuple[int, int], list[str]]:
    """Map file identity to dataset relative paths (used by cleanup/delete)."""
    cache_key = f"{workspace_root}|{detect_out}|{clf_out}"
    stamp = _dataset_dir_stamp(detect_out, clf_out)
    cached = _HARDLINK_PATH_CACHE.get(cache_key)
    if cached and cached[0] == stamp:
        return cached[1]

    root = workspace_root.expanduser().resolve()
    index: dict[tuple[int, int], list[str]] = {}
    for candidate in _iter_dataset_image_files(detect_out, clf_out):
        identity = _file_identity(candidate)
        if identity is None:
            continue
        rel = candidate.relative_to(root).as_posix()
        index.setdefault(identity, []).append(rel)
    for rel_paths in index.values():
        rel_paths.sort()
    _HARDLINK_PATH_CACHE[cache_key] = (stamp, index)
    return index


def _build_scan_result(
    *,
    root: Path,
    files: list[str],
    new_files: list[str],
    used_files: list[str],
    snapshot_updated_at: str,
    fast: bool,
    from_cache: bool,
    usage_scanned: bool,
) -> dict[str, Any]:
    total = len(files)
    used_count = len(used_files)
    return {
        "ok": True,
        "workspaceRoot": str(root),
        "total": total,
        "newCount": len(new_files),
        "usedCount": used_count,
        "unusedCount": total - used_count,
        "snapshotUpdatedAt": snapshot_updated_at,
        "files": files,
        "newFiles": new_files,
        "usedFiles": used_files,
        "fast": fast,
        "fromCache": from_cache,
        "usageScanned": usage_scanned,
    }


def scan_image_pool(workspace_root: Path, *, fast: bool = False) -> dict[str, Any]:
    paths = load_workspace_config(workspace_root)
    root = paths.root
    snapshot = read_snapshot(root)
    known_files = set(snapshot["knownFiles"])
    fingerprint = _pool_fingerprint(paths.image_pool)

    scan_cache = snapshot.get("scanCache")
    cached_files: list[str] | None = None
    if (
        fingerprint
        and isinstance(scan_cache, dict)
        and scan_cache.get("fingerprint") == fingerprint
        and isinstance(scan_cache.get("files"), list)
    ):
        cached_files = [str(name) for name in scan_cache["files"] if name]
        usage_scanned = bool(scan_cache.get("usageScanned"))
        if fast or usage_scanned:
            used_files = [str(name) for name in (scan_cache.get("usedFiles") or []) if name]
            new_files = [name for name in cached_files if name not in known_files]
            return _build_scan_result(
                root=root,
                files=cached_files,
                new_files=new_files,
                used_files=used_files if usage_scanned else [],
                snapshot_updated_at=snapshot["updatedAt"],
                fast=not usage_scanned,
                from_cache=True,
                usage_scanned=usage_scanned,
            )

    if cached_files is not None and not fast:
        used_identities = _build_usage_identities(paths.detect_out, paths.clf_out)
        new_files = [name for name in cached_files if name not in known_files]
        used_files: list[str] = []
        for filename in cached_files:
            pool_file = paths.image_pool / filename
            if pool_file.is_file() and _is_used_in_datasets(pool_file, used_identities):
                used_files.append(filename)
        result = _build_scan_result(
            root=root,
            files=cached_files,
            new_files=new_files,
            used_files=used_files,
            snapshot_updated_at=snapshot["updatedAt"],
            fast=False,
            from_cache=True,
            usage_scanned=True,
        )
        if fingerprint:
            _write_snapshot_scan_cache(
                root,
                fingerprint,
                {
                    "files": cached_files,
                    "usedFiles": used_files,
                    "usageScanned": True,
                    "total": result["total"],
                    "newCount": result["newCount"],
                    "usedCount": result["usedCount"],
                    "unusedCount": result["unusedCount"],
                },
            )
        return result

    pool_images = _list_pool_images(paths.image_pool)
    used_identities: frozenset[tuple[int, int]] = frozenset()
    if not fast:
        used_identities = _build_usage_identities(paths.detect_out, paths.clf_out)

    files: list[str] = []
    new_files: list[str] = []
    used_files: list[str] = []

    for pool_file in pool_images:
        filename = pool_file.name
        is_new = filename not in known_files
        is_used = False if fast else _is_used_in_datasets(pool_file, used_identities)
        files.append(filename)
        if is_new:
            new_files.append(filename)
        if is_used:
            used_files.append(filename)

    result = _build_scan_result(
        root=root,
        files=files,
        new_files=new_files,
        used_files=used_files,
        snapshot_updated_at=snapshot["updatedAt"],
        fast=fast,
        from_cache=False,
        usage_scanned=not fast,
    )
    cache_payload = {
        "files": files,
        "usedFiles": used_files,
        "usageScanned": not fast,
        "total": result["total"],
        "newCount": result["newCount"],
        "usedCount": result["usedCount"],
        "unusedCount": result["unusedCount"],
    }
    if fingerprint:
        _write_snapshot_scan_cache(root, fingerprint, cache_payload)
    return result


def image_pool_thumbnail_base64(
    workspace_root: Path,
    filename: str,
    max_size: int = 128,
    *,
    quality: int = 54,
    session_dir: Path | None = None,
) -> str:
    """Return a small JPEG preview to avoid loading full images in the UI."""
    paths = load_workspace_config(workspace_root)
    path = paths.image_pool / Path(filename).name
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise FileNotFoundError(f"Image not found in image_pool: {filename}")
    return image_thumbnail_jpeg_base64(
        path,
        max_size,
        quality=quality,
        session_dir=session_dir,
        workspace_root=workspace_root,
        filename=filename,
    )


def mark_image_pool_seen(workspace_root: Path) -> dict[str, Any]:
    paths = load_workspace_config(workspace_root)
    filenames = [path.name for path in _list_pool_images(paths.image_pool)]
    snapshot_file = write_snapshot(paths.root, filenames)
    return {
        "ok": True,
        "markedCount": len(filenames),
        "snapshotFile": snapshot_file,
    }
