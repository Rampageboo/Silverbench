from __future__ import annotations

import json
import hashlib
import mimetypes
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Any, Iterator

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response
from PIL import Image, ImageOps
from pydantic import BaseModel, Field, field_validator

from backend.image_pool import scan_image_pool
from backend.dataset_merge import VIDEO_EXTENSIONS
from backend.metadata_assign import get_workspace_classes, upsert_metadata_rows
from backend.video_screenshot import frame_bytes
from backend.yolo_workspace import IMAGE_EXTENSIONS, load_workspace_config, workspace_meta_dir
from backend_api.dialogs import create_desktop_backend_service


APP_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = APP_DIR / "legacy" / "web"
SESSION_DIR = APP_DIR / "Sessions"
SESSION_FILE = SESSION_DIR / "yolo_label_viewer_session.json"
HEARTBEAT_METHOD = "__heartbeat"
# Bump when /health or /api/call routing changes so dev startup can restart stale backends.
API_SCHEMA_VERSION = 20

# Localhost-only desktop backend: allow any registered service method except heartbeat/private.
BLOCKED_API_METHODS = frozenset({HEARTBEAT_METHOD})


class ApiCallRequest(BaseModel):
    method: str = Field(min_length=1)
    args: list[Any] | dict[str, Any] | None = None


class LabelClass(BaseModel):
    id: int = Field(ge=0)
    name: str = Field(min_length=1)


class LabelBox(BaseModel):
    classId: int = Field(ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class SaveLabelsRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    boxes: list[LabelBox] = Field(default_factory=list, max_length=10000)

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if Path(value).name != value:
            raise ValueError("filename must be a file name inside media.")
        return value


class SaveClassesRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)
    classes: list[LabelClass] = Field(default_factory=list, max_length=10000)


class OpenWorkspaceRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)
    initIfNeeded: bool = True


class WriteAppSettingsRequest(BaseModel):
    lastOpenedWorkspace: str = ""
    lastOpenedFolder: str = ""
    lastOpenedYoloFolder: str = ""
    startupOverlayMode: str = ""


class MarkJunkRequest(BaseModel):
    workspaceRoot: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    detectJunk: bool = True

    @field_validator("filename")
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if Path(value).name != value:
            raise ValueError("filename must be a file name inside media.")
        return value


@asynccontextmanager
async def _lifespan(application: FastAPI):
    # Mount static files during startup so that API routes registered by
    # multimodal_main (which imports this module) are added first. A module-
    # level mount would be inserted before those routes and would intercept
    # all /api/multimodal/* requests before they could be matched.
    if WEB_DIR.is_dir():
        application.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
    yield


app = FastAPI(title="YoloWorkBench API", lifespan=_lifespan)
service = create_desktop_backend_service(APP_DIR, SESSION_DIR, SESSION_FILE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
        "tauri://localhost",
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
        "app": "yoloworkbench",
        "backend": "fastapi",
        "ui": "web",
        "apiSchemaVersion": API_SCHEMA_VERSION,
    }


@app.post("/api")
async def legacy_api(request: Request) -> JSONResponse:
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"ok": False, "error": "Invalid JSON payload."}, status_code=400)

    method = str(payload.get("method") or "")
    if method == HEARTBEAT_METHOD:
        return JSONResponse({"ok": True, "result": "alive"})
    if method.startswith("_"):
        return JSONResponse({"ok": False, "error": "Private/internal API methods are not callable."}, status_code=403)
    if method not in service.api_methods():
        return JSONResponse({"ok": False, "error": f"Unknown API method: {method}"}, status_code=404)

    try:
        result = service.call(method, list(payload.get("args") or []))
    except Exception as error:
        return JSONResponse({"ok": False, "error": str(error)}, status_code=500)

    # Keep legacy /api compatible with the old HTTP server and Qt bridge:
    # many web/*.js callers expect string JSON in `result` and call JSON.parse().
    if isinstance(result, (dict, list)):
        result = json.dumps(result, ensure_ascii=False)
    return JSONResponse({"ok": True, "result": result})


@app.get("/yolo_app_settings.json")
def yolo_app_settings_file() -> FileResponse:
    path = APP_DIR / "yolo_app_settings.json"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="App settings file not found.")
    return FileResponse(path, media_type="application/json")


@app.post("/api/app-settings")
def app_settings_write(payload: WriteAppSettingsRequest) -> JSONResponse:
    try:
        service.call(
            "writeAppSettings",
            [
                json.dumps(
                    {
                        key: value
                        for key, value in {
                            "lastOpenedWorkspace": payload.lastOpenedWorkspace,
                            "lastOpenedFolder": payload.lastOpenedFolder,
                            "lastOpenedYoloFolder": payload.lastOpenedYoloFolder,
                            "startupOverlayMode": payload.startupOverlayMode,
                        }.items()
                        if value
                    },
                    ensure_ascii=False,
                )
            ],
        )
    except Exception as error:
        return _error_response(500, "writeAppSettings", str(error), error_type=type(error).__name__)
    return JSONResponse({"ok": True})


@app.get("/api/app-settings")
def app_settings() -> JSONResponse:
    settings_path = APP_DIR / "yolo_app_settings.json"
    settings: dict[str, object] = {}
    if settings_path.is_file():
        try:
            loaded = json.loads(settings_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                settings = loaded
        except json.JSONDecodeError:
            settings = {}
    return JSONResponse(
        {
            "ok": True,
            "lastOpenedWorkspace": str(settings.get("lastOpenedWorkspace") or ""),
            "lastOpenedFolder": str(settings.get("lastOpenedFolder") or ""),
            "lastOpenedYoloFolder": str(settings.get("lastOpenedYoloFolder") or ""),
            "startupOverlayMode": "minimal"
            if str(settings.get("startupOverlayMode") or "").strip().lower() == "minimal"
            else "overview",
        }
    )


@app.post("/api/call")
def api_call(payload: ApiCallRequest) -> JSONResponse:
    method = payload.method.strip()
    if method.startswith("_"):
        return _error_response(403, method, "Private/internal API methods are not callable.")
    if method in BLOCKED_API_METHODS:
        return _error_response(403, method, f"API method is not callable: {method}")
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
        result = service.call("openFolder", [payload.workspaceRoot, payload.initIfNeeded])
    except Exception as error:
        return _error_response(400, "openFolder", str(error), error_type=type(error).__name__)

    normalized = _normalize_backend_result(result)
    if isinstance(normalized, dict) and not normalized.get("ok", True):
        return JSONResponse(normalized, status_code=400)
    return JSONResponse(normalized if isinstance(normalized, dict) else {"ok": True, "result": normalized})


@app.get("/api/image-pool")
def image_pool(workspaceRoot: str = Query(min_length=1), fast: bool = True) -> JSONResponse:
    try:
        paths = _workspace_paths(workspaceRoot)
        result = scan_image_pool(paths.root, fast=fast)
    except Exception as error:
        return _error_response(400, "imagePool", str(error), error_type=type(error).__name__)

    return JSONResponse(_image_pool_payload(result))


@app.get("/api/images/thumb")
def image_thumb(
    workspaceRoot: str = Query(min_length=1),
    filename: str = Query(min_length=1),
    size: int = Query(default=180, ge=32, le=512),
) -> StreamingResponse:
    paths = _workspace_paths_for_http(workspaceRoot)
    path = _image_pool_file_from_paths(paths, filename)
    cache_path = _thumb_cache_path(paths.root, path, size=size, quality=78)
    return _jpeg_response(path, max_edge=size, quality=78, cache_path=cache_path)


@app.get("/api/images/preview")
def image_preview(
    workspaceRoot: str = Query(min_length=1),
    filename: str = Query(min_length=1),
    maxEdge: int = Query(default=1600, ge=128, le=4096),
) -> StreamingResponse:
    path = _image_pool_file(workspaceRoot, filename)
    return _jpeg_response(path, max_edge=maxEdge, quality=86)


@app.get("/api/files/preview")
def file_preview(
    workspaceRoot: str = Query(min_length=1),
    relativePath: str = Query(min_length=1),
    maxEdge: int = Query(default=1280, ge=128, le=4096),
    quality: int = Query(default=60, ge=35, le=95),
) -> StreamingResponse:
    paths = _workspace_paths_for_http(workspaceRoot)
    path = (paths.root / relativePath).resolve()
    _ensure_workspace_child(paths.root, path)
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
    paths = _workspace_paths_for_http(workspaceRoot)
    video_path = Path(path).expanduser().resolve()
    try:
        _ensure_workspace_child(paths.root, video_path)
    except HTTPException:
        media_root = paths.image_pool.resolve()
        if video_path != media_root and media_root not in video_path.parents:
            raise
    try:
        payload = frame_bytes(video_path, seconds, "jpg", max_edge=maxEdge, quality=quality)
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to render video frame: {error}") from error
    return StreamingResponse(
        BytesIO(payload),
        media_type="image/jpeg",
        headers={"Cache-Control": "no-store"},
    )


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
    paths = _workspace_paths_for_http(workspaceRoot)
    video_path = Path(path).expanduser().resolve()
    try:
        _ensure_workspace_child(paths.root, video_path)
    except HTTPException:
        media_root = paths.image_pool.resolve()
        if video_path != media_root and media_root not in video_path.parents:
            raise
    if not video_path.is_file() or video_path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise HTTPException(status_code=404, detail=f"Video not found: {video_path.name}")
    media_type = mimetypes.guess_type(video_path.name)[0] or "application/octet-stream"
    stat = video_path.stat()
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
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
    paths = _workspace_paths_for_http(workspaceRoot)
    return JSONResponse({"ok": True, "workspaceRoot": str(paths.root), "classes": _workspace_label_classes(paths.root)})


@app.post("/api/labels/classes")
def label_classes_save(payload: SaveClassesRequest) -> JSONResponse:
    paths = _workspace_paths_for_http(payload.workspaceRoot)
    classes = sorted(payload.classes, key=lambda item: item.id)
    if not classes:
        raise HTTPException(status_code=400, detail="At least one class is required.")
    max_id = max(item.id for item in classes)
    by_id = {item.id: item.name.strip() for item in classes}
    names = [by_id.get(index, "") for index in range(max_id + 1)]
    classes_text = "\n".join(names) + "\n"
    data_yaml_text = _data_yaml_text(names)
    (paths.root / "classes.txt").write_text(classes_text, encoding="utf-8")
    (paths.root / "data.yaml").write_text(data_yaml_text, encoding="utf-8")
    detect_data_yaml = paths.root / "detect_dataset" / "data.yaml"
    if detect_data_yaml.parent.is_dir():
        detect_data_yaml.write_text(data_yaml_text, encoding="utf-8")
    saved = [{"id": item.id, "name": item.name.strip()} for item in classes if item.name.strip()]
    return JSONResponse({"ok": True, "workspaceRoot": str(paths.root), "classes": saved})


@app.get("/api/labels/load")
def label_load(
    workspaceRoot: str = Query(min_length=1),
    filename: str = Query(min_length=1),
) -> JSONResponse:
    paths = _workspace_paths_for_http(workspaceRoot)
    image_path = _image_pool_file_from_paths(paths, filename)
    label_path = _primary_label_path(paths, image_path.name)
    text, source_path = _read_label_text(paths, image_path.name)
    try:
        with Image.open(image_path) as image:
            image_width, image_height = image.size
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"Failed to read image metadata: {error}") from error
    return JSONResponse(
        {
            "ok": True,
            "workspaceRoot": str(paths.root),
            "filename": image_path.name,
            "labelPath": _relative_to_workspace(paths.root, label_path),
            "sourceLabelPath": _relative_to_workspace(paths.root, source_path) if source_path else "",
            "imageWidth": image_width,
            "imageHeight": image_height,
            "classes": _workspace_label_classes(paths.root),
            "boxes": _parse_yolo_label_text(text),
        }
    )


@app.post("/api/labels/save")
def label_save(payload: SaveLabelsRequest) -> JSONResponse:
    paths = _workspace_paths_for_http(payload.workspaceRoot)
    image_path = _image_pool_file_from_paths(paths, payload.filename)
    label_path = _primary_label_path(paths, image_path.name)
    label_path.parent.mkdir(parents=True, exist_ok=True)
    text = _boxes_to_yolo_text(payload.boxes)
    label_path.write_text(text, encoding="utf-8")
    return JSONResponse(
        {
            "ok": True,
            "workspaceRoot": str(paths.root),
            "filename": image_path.name,
            "labelPath": _relative_to_workspace(paths.root, label_path),
            "savedCount": len(payload.boxes),
            "boxes": [box.model_dump() for box in payload.boxes],
        }
    )


@app.post("/api/image-pool/junk")
def image_pool_junk(payload: MarkJunkRequest) -> JSONResponse:
    paths = _workspace_paths_for_http(payload.workspaceRoot)
    image_path = _image_pool_file_from_paths(paths, payload.filename)
    result = upsert_metadata_rows(paths.root, [{"filename": image_path.name, "detect_junk": payload.detectJunk}])
    return JSONResponse({"ok": True, "workspaceRoot": str(paths.root), "filename": image_path.name, "detectJunk": payload.detectJunk, "metadata": result})


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


def _workspace_paths(workspace_root: str):
    root = Path(workspace_root).expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(f"Workspace root is not a directory: {root}")
    paths = load_workspace_config(root)
    if not paths.image_pool.is_dir():
        raise NotADirectoryError(f"Workspace media directory not found: {paths.image_pool}")
    return paths


def _image_pool_file(workspace_root: str, filename: str) -> Path:
    paths = _workspace_paths_for_http(workspace_root)
    return _image_pool_file_from_paths(paths, filename)


def _workspace_paths_for_http(workspace_root: str):
    try:
        return _workspace_paths(workspace_root)
    except Exception as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


def _image_pool_file_from_paths(paths, filename: str) -> Path:
    name = Path(filename).name
    if name != filename or not name:
        raise HTTPException(status_code=400, detail="filename must be a file name inside media.")

    image_pool = paths.image_pool.resolve()
    path = (image_pool / name).resolve()
    if path.parent != image_pool:
        raise HTTPException(status_code=403, detail="Image path escapes media.")
    if path.suffix.lower() not in IMAGE_EXTENSIONS or not path.is_file():
        raise HTTPException(status_code=404, detail=f"Image not found in media: {name}")
    return path


def _thumb_cache_path(workspace_root: Path, source_path: Path, *, size: int, quality: int) -> Path:
    stat = source_path.stat()
    normalized_source = str(source_path.resolve()).replace("\\", "/")
    key = hashlib.sha1(
        f"{normalized_source}|{stat.st_mtime_ns}|{stat.st_size}|{int(size)}|{int(quality)}".encode("utf-8")
    ).hexdigest()[:24]
    safe_stem = source_path.stem[:80].replace("\\", "_").replace("/", "_")
    return workspace_meta_dir(workspace_root) / "thumb_cache" / "fastapi" / f"{safe_stem}_{key}.jpg"


def _primary_label_path(paths, filename: str) -> Path:
    stem = Path(filename).stem
    path = (paths.label_source / f"{stem}.txt").resolve()
    _ensure_workspace_child(paths.root, path)
    return path


def _label_read_paths(paths, filename: str) -> list[Path]:
    stem = Path(filename).stem
    return [
        _primary_label_path(paths, filename),
        (paths.detect_out / "labels" / "train" / f"{stem}.txt").resolve(),
        (paths.detect_out / "labels" / "val" / f"{stem}.txt").resolve(),
    ]


def _read_label_text(paths, filename: str) -> tuple[str, Path | None]:
    for path in _label_read_paths(paths, filename):
        try:
            _ensure_workspace_child(paths.root, path)
        except HTTPException:
            continue
        if path.is_file():
            text = path.read_text(encoding="utf-8", errors="replace")
            if text.strip():
                return text, path
    primary = _primary_label_path(paths, filename)
    return (primary.read_text(encoding="utf-8", errors="replace") if primary.is_file() else ""), primary


def _parse_yolo_label_text(text: str) -> list[dict[str, float | int]]:
    boxes: list[dict[str, float | int]] = []
    for line in text.splitlines():
        parts = line.strip().split()
        if len(parts) < 5:
            continue
        try:
            class_id = int(float(parts[0]))
            x, y, w, h = (float(value) for value in parts[1:5])
        except ValueError:
            continue
        if class_id < 0 or not (0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1):
            continue
        boxes.append({"classId": class_id, "x": x, "y": y, "w": w, "h": h})
    return boxes


def _boxes_to_yolo_text(boxes: list[LabelBox]) -> str:
    if not boxes:
        return ""
    lines = [
        f"{box.classId} {box.x:.6f} {box.y:.6f} {box.w:.6f} {box.h:.6f}"
        for box in boxes
    ]
    return "\n".join(lines) + "\n"


def _workspace_label_classes(workspace_root: Path) -> list[dict[str, int | str]]:
    names = _read_detect_class_names(workspace_root)
    if not names:
        names = {index: name for index, name in enumerate(get_workspace_classes(workspace_root))}
    return [{"id": class_id, "name": name} for class_id, name in sorted(names.items()) if name]


def _data_yaml_text(names: list[str]) -> str:
    lines = ["names:"]
    for index, name in enumerate(names):
        escaped = str(name).replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'  {index}: "{escaped}"')
    lines.append(f"nc: {len(names)}")
    return "\n".join(lines) + "\n"


def _read_detect_class_names(workspace_root: Path) -> dict[int, str]:
    root = workspace_root.resolve()
    for relative in (Path("classes.txt"), Path("data.yaml"), Path("detect_dataset") / "data.yaml"):
        path = (root / relative).resolve()
        try:
            _ensure_workspace_child(root, path)
        except HTTPException:
            continue
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        names = _parse_classes_txt(text) if path.name == "classes.txt" else _parse_data_yaml_names(text)
        if names:
            return names
    return {}


def _parse_classes_txt(text: str) -> dict[int, str]:
    names: dict[int, str] = {}
    for index, raw in enumerate(text.splitlines()):
        name = raw.strip()
        if name:
            names[index] = name
    return names


def _parse_data_yaml_names(text: str) -> dict[int, str]:
    names: dict[int, str] = {}
    in_names = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line == "names:":
            in_names = True
            continue
        if in_names:
            if raw[:1] not in {" ", "\t"}:
                break
            if ":" not in line:
                continue
            key, value = line.split(":", 1)
            try:
                class_id = int(key.strip())
            except ValueError:
                continue
            names[class_id] = _yaml_scalar(value.strip())
    return names


def _yaml_scalar(value: str) -> str:
    cleaned = value.split("#", 1)[0].strip()
    if len(cleaned) >= 2 and cleaned[0] == cleaned[-1] and cleaned[0] in {"'", '"'}:
        try:
            return json.loads(cleaned) if cleaned[0] == '"' else cleaned[1:-1]
        except json.JSONDecodeError:
            return cleaned[1:-1]
    return cleaned


def _relative_to_workspace(workspace_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(workspace_root.resolve()).as_posix()
    except ValueError:
        return ""


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
            image = ImageOps.exif_transpose(image)
            image.thumbnail((max_edge, max_edge))
            if image.mode != "RGB":
                image = image.convert("RGB")
            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=quality, optimize=True)
            payload = buffer.getvalue()
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


