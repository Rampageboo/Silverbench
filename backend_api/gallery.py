"""Local gallery REST API, independent of the active annotation workspace."""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse

from backend.gallery_library import GalleryError, GalleryLibrary

router = APIRouter(prefix="/api/gallery", tags=["gallery"])
_library: GalleryLibrary | None = None
_guard = threading.Lock()


def get_library() -> GalleryLibrary:
    global _library
    with _guard:
        if _library is None:
            _library = GalleryLibrary()
        return _library


def close_library() -> None:
    """API lifespan shutdown hook; subsequent startup can create a fresh singleton."""
    global _library
    with _guard:
        if _library is not None:
            _library.close()
            _library = None


def _call(function: Callable, *args: Any, **kwargs: Any) -> Any:
    try:
        return function(*args, **kwargs)
    except KeyError as error:
        raise HTTPException(404, "Gallery asset or job was not found.") from error
    except (GalleryError, ValueError, TypeError) as error:
        raise HTTPException(400, str(error)) from error
    except PermissionError as error:
        raise HTTPException(403, f"Local file permission denied: {error}") from error
    except OSError as error:
        raise HTTPException(409, f"Local file operation failed: {error}") from error


def _capabilities(library: GalleryLibrary) -> dict:
    capabilities = library.status()["capabilities"]
    try:
        from backend.gallery_inference import get_capabilities
        capabilities.update(get_capabilities(config=library.get_settings()))
    except ImportError:
        capabilities.update(available=False, adapters={}, blockers=["Local inference adapter is not installed."])
    capabilities["unimplemented"] = ["watch/poll ingestion", "semantic search", "near-duplicate search",
                                      "artist references", "two-machine workers", "GPU scheduling", "ComfyUI roundtrip"]
    return capabilities


def _rules(library: GalleryLibrary) -> dict:
    from backend.gallery_prompts import load_rules
    settings = library.get_settings()
    return settings["rules"] if isinstance(settings.get("rules"), dict) else load_rules()


def _with_prompts(library: GalleryLibrary, asset: dict, options: dict | None = None) -> dict:
    from backend.gallery_prompts import assemble_prompts
    return {**asset, "prompts": assemble_prompts(asset, options=options, rules=_rules(library))}


@router.get("/status")
def status() -> dict:
    library = get_library()
    value = _call(library.status)
    value["capabilities"] = _call(_capabilities, library)
    return value


@router.get("/capabilities")
def capabilities() -> dict:
    return _call(_capabilities, get_library())


@router.get("/comfyui")
def comfyui(path: str | None = None) -> dict:
    """Check a ComfyUI folder (or the configured one when no path is given)."""
    from backend.comfyui_paths import locate_comfyui
    return locate_comfyui(path if path is not None else get_library().get_settings().get("comfyuiPath"))


@router.get("/comfyui/server")
def comfyui_server(url: str | None = None) -> dict:
    """Reach the ComfyUI server (this computer or the other one) and list its preprocessors."""
    from backend.comfyui_client import ComfyUiClient, ComfyUiError
    try:
        return ComfyUiClient(url if url is not None else get_library().control_settings()["url"] or None, timeout=3).check()
    except ComfyUiError as error:
        return {"ok": False, "error": str(error), "preprocessors": {}}


@router.post("/controls")
def queue_controls(payload: dict = Body(...)) -> dict:
    """Make control maps (pose, depth, lineart, canny) for the given images on ComfyUI."""
    return _call(get_library().queue_controls, payload.get("ids", []), payload.get("kinds"))


@router.get("/assets/{asset_id}/controls")
def asset_controls(asset_id: str) -> list[dict]:
    return _call(get_library().controls, asset_id)


@router.get("/assets/{asset_id}/controls/{kind}")
def control_image(asset_id: str, kind: str) -> FileResponse:
    return FileResponse(_call(get_library().control_file, asset_id, kind), media_type="image/png")


@router.post("/assets/{asset_id}/controls/{kind}/to-comfyui")
def control_to_comfyui(asset_id: str, kind: str) -> dict:
    """Upload a control map into ComfyUI's input folder so a LoadImage node can pick it."""
    from backend.comfyui_client import ComfyUiClient, ComfyUiError
    library = get_library()
    path = _call(library.control_file, asset_id, kind)
    try:
        return {"name": ComfyUiClient(library.control_settings()["url"] or None).upload(path)}
    except ComfyUiError as error:
        raise HTTPException(409, str(error)) from error


@router.get("/reverse")
def reverse_status() -> dict:
    return _call(get_library().reverse_status)


@router.post("/reverse")
def queue_reverse() -> dict:
    """Queue every image without generation metadata for the tagger."""
    return _call(get_library().queue_reverse)


@router.get("/settings")
def settings() -> dict:
    return _call(get_library().get_settings)


@router.post("/settings")
def save_settings(payload: dict = Body(...)) -> dict:
    return _call(get_library().save_settings, payload)


@router.post("/roots")
def add_root(payload: dict = Body(...)) -> dict:
    path, source, recursive = payload.get("path"), payload.get("source", "local"), payload.get("recursive", True)
    if not isinstance(path, str) or not isinstance(source, str) or type(recursive) is not bool:
        raise HTTPException(400, "Root requires path/source strings and a recursive boolean.")
    return _call(get_library().add_root, path, source, recursive)


@router.post("/scan")
def scan(payload: dict = Body(default={})) -> dict:
    root_id = payload.get("rootId")
    if root_id is not None and not isinstance(root_id, str):
        raise HTTPException(400, "rootId must be a registered root ID.")
    return _call(get_library().scan, root_id)


@router.get("/assets")
def assets(q: str = "", rootId: str | None = None, collection: str | None = None,
           minRating: int = Query(default=0, ge=0, le=5), hasMetadata: bool | None = None, needsReverse: bool = False,
           offset: int = Query(default=0, ge=0), limit: int = Query(default=60, ge=1, le=200)) -> dict:
    return _call(get_library().list_assets, q=q, root_id=rootId, collection=collection,
                 min_rating=minRating, has_metadata=hasMetadata, needs_reverse=needsReverse,
                 offset=offset, limit=limit)


@router.get("/assets/{asset_id}")
def asset(asset_id: str) -> dict:
    library = get_library()
    return _call(_with_prompts, library, _call(library.asset, asset_id))


@router.post("/assets/{asset_id}")
def edit_asset(asset_id: str, payload: dict = Body(...)) -> dict:
    library = get_library()
    return _call(_with_prompts, library, _call(library.edit_asset, asset_id, payload))


def _comfyui(library: GalleryLibrary) -> dict:
    from backend.comfyui_paths import locate_comfyui
    return locate_comfyui(library.get_settings().get("comfyuiPath"))


@router.get("/assets/{asset_id}/breakdown")
def breakdown(asset_id: str) -> dict:
    """Checkpoints, LoRAs, samplers, ControlNets and reference images behind one image."""
    from backend.gallery_workflow import analyze
    library = get_library()
    record = _call(library.asset, asset_id)
    return analyze(record.get("metadata") or {}, _comfyui(library))


@router.get("/assets/{asset_id}/workflow")
def workflow(asset_id: str) -> JSONResponse:
    """The ComfyUI editor graph as workflow.json: drop it into ComfyUI to get the nodes back."""
    from backend.gallery_workflow import editor_workflow
    record = _call(get_library().asset, asset_id)
    graph = editor_workflow(record.get("metadata") or {})
    if graph is None:
        raise HTTPException(404, "This image carries no ComfyUI workflow.")
    name = Path(record.get("filename") or asset_id).stem
    return JSONResponse(graph, headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}.workflow.json"})


@router.get("/assets/{asset_id}/reference/{node}")
def reference(asset_id: str, node: str) -> FileResponse:
    """A ControlNet / IPAdapter / img2img input image, when it is still in ComfyUI's input folder."""
    from backend.gallery_workflow import reference_image
    library = get_library()
    record = _call(library.asset, asset_id)
    path = reference_image(record.get("metadata") or {}, _comfyui(library), node)
    if path is None:
        raise HTTPException(404, "Reference image not found in the ComfyUI input folder.")
    return FileResponse(path)


@router.post("/assets/{asset_id}/preview")
def preview_asset(asset_id: str, options: dict = Body(default={})) -> dict:
    library = get_library()
    return _call(_with_prompts, library, _call(library.asset, asset_id), options)["prompts"]


@router.get("/assets/{asset_id}/thumbnail")
def thumbnail(asset_id: str) -> FileResponse:
    path = _call(get_library().thumbnail, asset_id)
    return FileResponse(path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=86400"})


@router.get("/assets/{asset_id}/image")
def image(asset_id: str) -> FileResponse:
    path = _call(get_library().source_path, asset_id)
    return FileResponse(path, headers={"Cache-Control": "private, no-cache"})


@router.get("/collections")
def collections() -> dict:
    return {"collections": _call(get_library().collections)}


@router.post("/collections")
def add_collection(payload: dict = Body(...)) -> dict:
    return {"collections": _call(get_library().add_collection, payload.get("name"))}


@router.get("/jobs")
def jobs() -> list[dict]:
    return _call(get_library().jobs)


@router.post("/jobs/{job_id}/{action}")
def job_action(job_id: str, action: str) -> dict:
    return _call(get_library().job_action, job_id, action)


@router.post("/preview")
def preview(payload: dict = Body(...)) -> dict:
    library = get_library()
    ids = payload.get("ids") or ([payload["id"]] if payload.get("id") else [])
    options = payload.get("options", {})
    if not isinstance(options, dict):
        raise HTTPException(400, "Preview options must be an object.")
    records = _call(library.selected, ids)
    items = [_call(_with_prompts, library, record, options) for record in records]
    return {"items": items, "count": len(items)}


@router.post("/summary")
def summary(payload: dict = Body(...)) -> dict:
    from backend.gallery_prompts import summarize_records
    library = get_library()
    options = payload.get("options", {})
    if not isinstance(options, dict):
        raise HTTPException(400, "Summary options must be an object.")
    records = _call(library.selected, payload.get("ids", []))
    return _call(summarize_records, records, options=options, rules=_call(_rules, library))


@router.post("/process")
def process(payload: dict = Body(...)) -> dict:
    return _call(get_library().process, payload.get("ids", []), payload.get("model", "wd"))


@router.post("/export")
def export(payload: dict = Body(...)) -> dict:
    return _call(get_library().export, payload)
