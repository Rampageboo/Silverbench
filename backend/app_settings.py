"""Application-level settings: the workspaces the user works with, plus UI preferences.

They live in the user's app-data folder (``%APPDATA%\\RampageWorkbench`` on Windows),
never in the install folder and never inside a workspace. Everything about a
workspace's content lives in the workspace itself.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic

SETTINGS_FILENAME = "settings.json"
LEGACY_SETTINGS_FILENAME = "yolo_app_settings.json"
MAX_RECENT_WORKSPACES = 12

DEFAULT_SETTINGS: dict[str, Any] = {
    "version": 4,
    "lastWorkspace": "",
    "workspaces": [],
    "startupOverlayMode": "overview",
    "sidebarCollapsed": False,
}


def app_data_dir() -> Path:
    override = os.environ.get("RWB_APP_DATA")
    if override:
        return Path(override)
    if sys.platform == "win32" and os.environ.get("APPDATA"):
        return Path(os.environ["APPDATA"]) / "RampageWorkbench"
    return Path.home() / ".config" / "RampageWorkbench"


def _normalize(data: dict[str, Any]) -> dict[str, Any]:
    workspaces = []
    for item in data.get("workspaces") or []:
        text = str(item or "").strip()
        if text and text not in workspaces:
            workspaces.append(text)
    mode = str(data.get("startupOverlayMode") or "overview").strip().lower()
    return {
        "version": 4,
        "lastWorkspace": str(data.get("lastWorkspace") or ""),
        "workspaces": workspaces[:MAX_RECENT_WORKSPACES],
        "startupOverlayMode": "minimal" if mode == "minimal" else "overview",
        "sidebarCollapsed": bool(data.get("sidebarCollapsed")),
    }


def _import_legacy(legacy_dir: Path | None) -> dict[str, Any]:
    """One-time import of the old settings file from the install folder."""
    if legacy_dir is None:
        return {}
    path = legacy_dir / LEGACY_SETTINGS_FILENAME
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    last = str(data.get("lastOpenedWorkspace") or data.get("lastOpenedFolder") or "")
    return {
        "lastWorkspace": last,
        "workspaces": [last] if last else [],
        "startupOverlayMode": data.get("startupOverlayMode"),
        "sidebarCollapsed": data.get("sidebarCollapsed"),
    }


def settings_path(directory: Path | None = None) -> Path:
    return (directory or app_data_dir()) / SETTINGS_FILENAME


def read_settings(directory: Path | None = None, *, legacy_dir: Path | None = None) -> dict[str, Any]:
    path = settings_path(directory)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        data = _import_legacy(legacy_dir)
    except (OSError, ValueError) as error:
        print(f"[backend] could not read {path}: {error}", file=sys.stderr, flush=True)
        data = {}
    return _normalize({**DEFAULT_SETTINGS, **(data if isinstance(data, dict) else {})})


def write_settings(changes: dict[str, Any], directory: Path | None = None, *, legacy_dir: Path | None = None) -> dict[str, Any]:
    current = read_settings(directory, legacy_dir=legacy_dir)
    current.update(changes if isinstance(changes, dict) else {})
    normalized = _normalize(current)
    path = settings_path(directory)
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, json.dumps(normalized, indent=2, ensure_ascii=False) + "\n")
    return normalized


def remember_workspace(root: str, directory: Path | None = None, *, legacy_dir: Path | None = None) -> dict[str, Any]:
    """Make ``root`` the last workspace and move it to the front of the recent list."""
    current = read_settings(directory, legacy_dir=legacy_dir)
    workspaces = [root, *[item for item in current["workspaces"] if item != root]]
    return write_settings({"lastWorkspace": root, "workspaces": workspaces}, directory, legacy_dir=legacy_dir)
