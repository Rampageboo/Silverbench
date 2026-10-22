from __future__ import annotations

import json
import hashlib
import mimetypes
import shutil
import subprocess
import threading
import uuid
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field

from backend.app_settings import app_data_dir
from backend.classes_store import detect_classes, read_classes
from backend.image_safety import ImageTooLargeError, ensure_safe_image_size
from backend.image_pool import scan_image_pool
from backend.video_screenshot import frame_bytes
from backend.workspace_layout import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, WorkspaceLayout, open_workspace
from backend_api.dialogs import create_desktop_backend_service


APP_DIR = Path(__file__).resolve().parent.parent
# Scratch space for files picked outside any workspace; app settings sit next to it.
SESSION_DIR = app_data_dir() / "scratch"
# Bump when /health or /api/call routing changes so dev startup can restart stale backends.
API_SCHEMA_VERSION = 26

# Guards concurrent proxy transcodes for the same output file.
_VIDEO_PROXY_LOCKS_GUARD = threading.Lock()
_VIDEO_PROXY_LOCKS: dict[str, threading.Lock] = {}


class ApiCallRequest(BaseModel):
    method: str = Field(min_length=1)
    args: list[Any] | dict[str, Any] | None = None


class OpenWorkspaceRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)


class VideoProxyRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)
    path: str = Field(min_length=1)


class WriteAppSettingsRequest(BaseModel):
    lastWorkspace: str | None = None
    workspaces: list[str] | None = None
    startupOverlayMode: str | None = None
    sidebarCollapsed: bool | None = None


@asynccontextmanager
async def _lifespan(application: FastAPI):
    try:
        yield
    finally:
        from backend_api.gallery import close_library
        close_library()


app = FastAPI(title="RampageWorkbench API", lifespan=_lifespan)
from backend_api.gallery import router as gallery_router

app.include_router(gallery_router)
service = create_desktop_backend_service(APP_DIR, SESSION_DIR, app_data_dir())

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
        "tauri://localhost",
        # Release builds on Windows serve the window from this origin (WebView2).
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class NoStoreWebAssetsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next) -> Response:
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.endswith((".html", ".js", ".css")):
            response.headers["Cache-Control"] = "no-store"
        return response


app.add_middleware(NoStoreWebAssetsMiddleware)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "ok": True,
        "app": "rampageworkbench",
        "backend": "fastapi",
        "ui": "web",
        "apiSchemaVersion": API_SCHEMA_VERSION,
    }


@app.post("/api/app-settings")
def app_settings_write(payload: WriteAppSettingsRequest) -> JSONResponse:
    changes = {key: value for key, value in payload.model_dump().items() if value is not None}
    try:
        settings = service.call("writeAppSettings", [changes])
    except Exception as error:
        return _error_response(500, "writeAppSettings", str(error), error_type=type(error).__name__)
    return JSONResponse({"ok": True, **settings})


@app.get("/api/app-settings")
def app_settings() -> JSONResponse:
    return JSONResponse({"ok": True, **service.call("readAppSettings", [])})


@app.post("/api/call")
def api_call(payload: ApiCallRequest) -> JSONResponse:
    method = payload.method.strip()
    if method.startswith("_"):
        return _error_response(403, method, "Private/internal API methods are not callable.")
    if method not in service.api_methods():
        return _error_response(404, method, f"Unknown API method: {method}")

    try:
        result = service.call(method, _args_for_backend_call(payload.args))
        normalized = result if method == "readTextFile" else _normalize_backend_result(result)
        return JSONResponse(
            {
                "ok": True,
                "method": method,
                "result": normalized,
            }
        )
    except Exception as error:
        return _error_response(500, method, str(error), error_type=type(error).__name__)


@app.post("/api/workspace/open")
def workspace_open(payload: OpenWorkspaceRequest) -> JSONResponse:
    try:
        result = service.call("openFolder", [payload.workspaceRoot])
    except Exception as error:
        return _error_response(400, "openFolder", str(error), error_type=type(error).__name__)

    normalized = _normalize_backend_result(result)
    if isinstance(normalized, dict) and not normalized.get("ok", True):
        return JSONResponse(normalized, status_code=400)
    return JSONResponse(normalized if isinstance(normalized, dict) else {"ok": True, "result": normalized})


@app.get("/api/image-pool")
def image_pool(workspaceRoot: str = Query(min_length=1), fast: bool = True) -> JSONResponse:
    try:
        result = scan_image_pool(_workspace_layout(workspaceRoot), fast=fast)
    except Exception as error:
        return _error_response(400, "imagePool", str(error), error_type=type(error).__name__)

    return JSONResponse(_image_pool_payload(result))


@app.get("/api/images/thumb")
def image_thumb(
    workspaceRoot: str = Query(min_length=1),
    filename: str = Query(min_length=1),
    size: int = Query(default=180, ge=32, le=512),
) -> StreamingResponse:
    layout = _workspace_layout_for_http(workspaceRoot)
    path = _media_image(layout, filename)
    cache_path = _thumb_cache_path(layout, path, size=size, quality=78)
    return _jpeg_response(path, max_edge=size, quality=78, cache_path=cache_path)


@app.get("/api/images/preview")
def image_preview(
    workspaceRoot: str = Query(min_length=1),
    filename: str = Query(min_length=1),
    maxEdge: int = Query(default=1600, ge=128, le=4096),
) -> StreamingResponse:
    path = _media_image(_workspace_layout_for_http(workspaceRoot), filename)
    return _jpeg_response(path, max_edge=maxEdge, quality=86)


@app.get("/api/files/preview")
def file_preview(
    workspaceRoot: str = Query(min_length=1),
    relativePath: str = Query(min_length=1),
    maxEdge: int = Query(default=1280, ge=128, le=4096),
    quality: int = Query(default=60, ge=35, le=95),
) -> StreamingResponse:
    layout = _workspace_layout_for_http(workspaceRoot)
    path = (layout.root / relativePath).resolve()
    _ensure_workspace_child(layout.root, path)
    if not path.is_file() or path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=404, detail=f"Image not found: {relativePath}")
    return _jpeg_response(path, max_edge=maxEdge, quality=quality)


@app.get("/api/video/frame")
def video_frame_preview(
    workspaceRoot: str = Query(min_length=1),
    path: str = Query(min_length=1),
    seconds: float = Query(default=0, ge=0),
    maxEdge: int = Query(default=1280, ge=128, le=4096),
    quality: int = Query(default=60, ge=35, le=95),
) -> StreamingResponse:
    _, video_path = _workspace_video_path_for_http(workspaceRoot, path)
    try:
        payload = frame_bytes(video_path, seconds, "jpg", max_edge=maxEdge, quality=quality)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to render video frame: {error}") from error
    return StreamingResponse(
        BytesIO(payload),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


def _video_proxy_lock(proxy_path: Path) -> threading.Lock:
    key = str(proxy_path)
    with _VIDEO_PROXY_LOCKS_GUARD:
        lock = _VIDEO_PROXY_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _VIDEO_PROXY_LOCKS[key] = lock
        return lock


@app.post("/api/video/proxy")
def video_proxy(payload: VideoProxyRequest) -> JSONResponse:
    layout, video_path = _workspace_video_path_for_http(payload.workspaceRoot, payload.path)
    proxy_path = _video_proxy_path(layout, video_path)
    if proxy_path.is_file() and proxy_path.stat().st_size > 0:
        return JSONResponse({
            "ok": True,
            "path": str(proxy_path),
            "sourcePath": str(video_path),
            "cached": True,
        })

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(
            status_code=500,
            detail="ffmpeg is not available. Install ffmpeg to generate browser-compatible video proxies.",
        )

    # Serialize concurrent requests for the same proxy so two transcodes don't
    # race on the output; the second caller then sees the finished file.
    with _video_proxy_lock(proxy_path):
        if proxy_path.is_file() and proxy_path.stat().st_size > 0:
            return JSONResponse({
                "ok": True,
                "path": str(proxy_path),
                "sourcePath": str(video_path),
                "cached": True,
            })
        return _transcode_video_proxy(ffmpeg, video_path, proxy_path)


def _transcode_video_proxy(ffmpeg: str, video_path: Path, proxy_path: Path) -> JSONResponse:
    proxy_path.parent.mkdir(parents=True, exist_ok=True)
    # Per-call unique temp name so distinct sources / retries never collide.
    tmp_path = proxy_path.with_name(f"{proxy_path.stem}.{uuid.uuid4().hex}.tmp.mp4")
    try:
        command = [
            ffmpeg,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(video_path),
            "-map",
            "0:v:0",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-movflags",
            "+faststart",
            "-an",
            str(tmp_path),
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=600, check=False)
        except OSError as error:
            raise HTTPException(status_code=500, detail=f"Unable to run ffmpeg: {error}") from error
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "ffmpeg failed.").strip()
            raise HTTPException(status_code=500, detail=f"Video proxy generation failed: {detail[-1200:]}")
        if not tmp_path.is_file() or tmp_path.stat().st_size <= 0:
            raise HTTPException(status_code=500, detail="Video proxy generation produced an empty file.")
        tmp_path.replace(proxy_path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass

    return JSONResponse({
        "ok": True,
        "path": str(proxy_path),
        "sourcePath": str(video_path),
        "cached": False,
    })


def _file_byte_range(path: Path, start: int, end: int, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
    with path.open("rb") as handle:
        handle.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = handle.read(min(chunk_size, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def _parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(
            status_code=416,
            detail="Only byte ranges are supported.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    spec = range_header[len("bytes="):].split(",", 1)[0].strip()
    if "-" not in spec:
        raise HTTPException(
            status_code=416,
            detail="Invalid byte range.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    start_text, end_text = spec.split("-", 1)
    try:
        if start_text:
            start = int(start_text)
            end = int(end_text) if end_text else file_size - 1
        else:
            suffix = int(end_text)
            if suffix <= 0:
                raise ValueError
            start = max(0, file_size - suffix)
            end = file_size - 1
    except ValueError as error:
        raise HTTPException(
            status_code=416,
            detail="Invalid byte range.",
            headers={"Content-Range": f"bytes */{file_size}"},
        ) from error
    if start < 0 or end < start or start >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Requested range is not satisfiable.",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    return start, min(end, file_size - 1)


@app.get("/api/video/source")
def video_source(
    request: Request,
    workspaceRoot: str = Query(min_length=1),
    path: str = Query(min_length=1),
) -> Response:
    _, video_path = _workspace_video_path_for_http(workspaceRoot, path)
    media_type = mimetypes.guess_type(video_path.name)[0] or "application/octet-stream"
    stat = video_path.stat()
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
    }
    range_header = request.headers.get("range")
    if not range_header:
        return FileResponse(video_path, media_type=media_type, headers=headers)
    start, end = _parse_range_header(range_header, stat.st_size)
    headers.update({
        "Content-Range": f"bytes {start}-{end}/{stat.st_size}",
        "Content-Length": str(end - start + 1),
    })
    return StreamingResponse(
        _file_byte_range(video_path, start, end),
        status_code=206,
        media_type=media_type,
        headers=headers,
    )


@app.get("/api/labels/classes")
def label_classes(workspaceRoot: str = Query(min_length=1)) -> JSONResponse:
    layout = _workspace_layout_for_http(workspaceRoot)
    classes = [{"id": item["id"], "name": item["name"]} for item in detect_classes(read_classes(layout))]
    return JSONResponse({"ok": True, "workspaceRoot": str(layout.root), "classes": classes})


def _args_for_backend_call(args: list[Any] | dict[str, Any] | None) -> list[Any]:
    if args is None:
        return []
    if isinstance(args, list):
        return args
    if isinstance(args, dict):
        if not args:
            return []
        positional = args.get("args")
        if isinstance(positional, list) and len(args) == 1:
            return positional
    raise ValueError("args must be an array, {}, or {\"args\": [...]}.")


def _normalize_backend_result(result: object) -> object:
    if isinstance(result, str):
        try:
            return json.loads(result)
        except json.JSONDecodeError:
            return result
    return result


def _workspace_layout(workspace_root: str) -> WorkspaceLayout:
    return open_workspace(Path(workspace_root).expanduser().resolve())


def _workspace_layout_for_http(workspace_root: str) -> WorkspaceLayout:
    try:
        return _workspace_layout(workspace_root)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _workspace_video_path_for_http(workspace_root: str, path: str) -> tuple[WorkspaceLayout, Path]:
    """Videos may be given workspace-relative (``media/clip.mp4``) or absolute inside the workspace."""
    layout = _workspace_layout_for_http(workspace_root)
    raw = Path(path).expanduser()
    video_path = (raw if raw.is_absolute() else layout.root / raw).resolve()
    _ensure_workspace_child(layout.root, video_path)
    if not video_path.is_file() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_path.name}")
    return layout, video_path


def _cache_name(source_path: Path, extra: str) -> str:
    stat = source_path.stat()
    key = f"{str(source_path.resolve()).replace(chr(92), '/')}|{stat.st_mtime_ns}|{stat.st_size}|{extra}"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:24]
    safe_stem = "".join("_" if char in '<>:"/\\|?*' else char for char in source_path.stem).strip(" ._")
    return f"{(safe_stem or 'file')[:80]}_{digest}"


def _video_proxy_path(layout: WorkspaceLayout, video_path: Path) -> Path:
    return layout.path("videoProxy") / f"{_cache_name(video_path, 'proxy')}.mp4"


def _media_image(layout: WorkspaceLayout, filename: str) -> Path:
    name = Path(filename).name
    if name != filename or not name:
        raise HTTPException(status_code=400, detail="filename must be a file name inside media.")
    media = layout.media.resolve()
    path = (media / name).resolve()
    if path.parent != media:
        raise HTTPException(status_code=403, detail="Image path escapes media.")
    if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Image not found in media: {name}")
    return path


def _thumb_cache_path(layout: WorkspaceLayout, source_path: Path, *, size: int, quality: int) -> Path:
    return layout.path("thumbs") / f"{_cache_name(source_path, f'{int(size)}|{int(quality)}')}.jpg"


def _ensure_workspace_child(workspace_root: Path, path: Path) -> None:
    root = workspace_root.resolve()
    resolved = path.resolve()
    if resolved != root and root not in resolved.parents:
        raise HTTPException(status_code=403, detail="Path escapes workspace.")


def _jpeg_response(path: Path, *, max_edge: int, quality: int, cache_path: Path | None = None) -> StreamingResponse:
    if cache_path is not None:
        try:
            if cache_path.is_file():
                return StreamingResponse(
                    BytesIO(cache_path.read_bytes()),
                    media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=3600"},
                )
        except OSError:
            cache_path = None

    try:
        with Image.open(path) as image:
            ensure_safe_image_size(image)
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_edge, max_edge))
            if image.mode != "RGB":
                image = image.convert("RGB")
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=quality, optimize=True)
            payload = buffer.getvalue()
    except ImageTooLargeError as error:
        raise HTTPException(status_code=413, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to render image: {error}") from error

    if cache_path is not None:
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_bytes(payload)
        except OSError:
            pass

    return StreamingResponse(
        BytesIO(payload),
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=3600"},
    )


def _image_pool_payload(result: dict[str, Any]) -> dict[str, Any]:
    files = [str(name) for name in result.get("files", []) if name]
    new_files = {str(name) for name in result.get("newFiles", []) if name}
    used_files = {str(name) for name in result.get("usedFiles", []) if name}
    media_dir = str(result.get("mediaDir") or "media").strip().strip("/\\") or "media"
    return {
        "ok": True,
        "workspaceRoot": result.get("workspaceRoot", ""),
        "mediaDir": media_dir,
        "total": int(result.get("total", len(files)) or 0),
        "newCount": int(result.get("newCount", 0) or 0),
        "usedCount": int(result.get("usedCount", 0) or 0),
        "unusedCount": int(result.get("unusedCount", 0) or 0),
        "snapshotUpdatedAt": result.get("snapshotUpdatedAt", ""),
        "fast": bool(result.get("fast", False)),
        "fromCache": bool(result.get("fromCache", False)),
        "usageScanned": bool(result.get("usageScanned", False)),
        "files": [
            {
                "filename": name,
                "imagePath": f"{media_dir}/{name}",
                "isNew": name in new_files,
                "isUsed": name in used_files,
            }
            for name in files
        ],
    }


def _error_response(status_code: int, method: str, message: str, *, error_type: str = "ApiError") -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "ok": False,
            "method": method,
            "error": {
                "type": error_type,
                "message": message,
            },
        },
    )


