"""Motion capture (AniMocap engine) REST API, scoped to the open workspace."""
from __future__ import annotations

import threading
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException, Query

from backend.mocap import engine, takes
from backend.workspace_layout import WorkspaceLayout, open_workspace

router = APIRouter(prefix="/api/mocap", tags=["mocap"])
_status_cache: dict[str, Any] = {}
_status_lock = threading.Lock()


def _layout(workspace_root: str) -> WorkspaceLayout:
    try:
        return open_workspace(Path(workspace_root).expanduser().resolve())
    except Exception as error:
        raise HTTPException(400, str(error)) from error


def _call(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
    try:
        return function(*args, **kwargs)
    except (takes.MocapError, engine.EngineError) as error:
        raise HTTPException(400, str(error)) from error
    except PermissionError as error:
        raise HTTPException(403, f"Local file permission denied: {error}") from error
    except OSError as error:
        raise HTTPException(409, f"Local file operation failed: {error}") from error


@router.get("/status")
def status(deep: bool = False) -> dict[str, Any]:
    """Engine and capture environment on this computer. ``deep`` imports the ML stacks (slow, cached)."""
    if not deep:
        return engine.status()
    with _status_lock:
        if "deep" not in _status_cache:
            _status_cache["deep"] = engine.status(deep=True)
        return _status_cache["deep"]


@router.post("/status/refresh")
def refresh_status() -> dict[str, Any]:
    with _status_lock:
        _status_cache.clear()
    return status(deep=True)


@router.post("/setup/{name}")
def open_setup(name: str) -> dict[str, Any]:
    """Opens the setup script in a console window; refresh the status when it finishes."""
    with _status_lock:
        _status_cache.clear()
    return _call(engine.open_setup, name)


@router.get("/takes")
def list_takes(workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return {"takes": _call(takes.list_takes, _layout(workspaceRoot))}


@router.post("/takes")
def create_take(workspaceRoot: str = Query(min_length=1), payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _call(takes.create_take, _layout(workspaceRoot), payload)


@router.get("/takes/{take_id}")
def get_take(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return _call(takes.describe, _layout(workspaceRoot), take_id)


@router.post("/takes/{take_id}/options")
def update_options(take_id: str, workspaceRoot: str = Query(min_length=1), payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _call(takes.update_options, _layout(workspaceRoot), take_id, payload)


@router.post("/takes/{take_id}/capture")
def start_capture(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return _call(takes.start_capture, _layout(workspaceRoot), take_id)


@router.post("/takes/{take_id}/cancel")
def cancel_capture(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return _call(takes.cancel_capture, _layout(workspaceRoot), take_id)


@router.get("/takes/{take_id}/pose")
def pose(take_id: str, workspaceRoot: str = Query(min_length=1), variant: str = "current") -> dict[str, Any]:
    return _call(takes.pose_data, _layout(workspaceRoot), take_id, variant)


@router.get("/takes/{take_id}/views")
def views(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return {"views": _call(takes.views, _layout(workspaceRoot), take_id)}


@router.get("/takes/{take_id}/issues")
def issues(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return {"issues": _call(takes.issues, _layout(workspaceRoot), take_id)}


@router.get("/takes/{take_id}/edits")
def read_edits(take_id: str, workspaceRoot: str = Query(min_length=1)) -> dict[str, Any]:
    return _call(takes.read_edits, _layout(workspaceRoot), take_id)


@router.post("/takes/{take_id}/edits")
def save_edits(take_id: str, workspaceRoot: str = Query(min_length=1), payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _call(takes.save_edits, _layout(workspaceRoot), take_id, payload)


@router.post("/takes/{take_id}/export")
def export(take_id: str, workspaceRoot: str = Query(min_length=1), payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _call(takes.export, _layout(workspaceRoot), take_id, payload)
