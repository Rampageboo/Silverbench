"""Find a local ComfyUI installation from a folder the user picked.

Each computer has its own install, so the path lives in that machine's app data.
Both layouts are accepted: the ComfyUI folder itself (``main.py`` + ``comfy/``)
and the Windows portable bundle that wraps it (``ComfyUI_windows_portable/ComfyUI``).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any


def _is_comfyui(folder: Path) -> bool:
    return (folder / "main.py").is_file() and (folder / "comfy").is_dir()


def locate_comfyui(path: str | Path | None) -> dict[str, Any]:
    raw = str(path or "").strip()
    if not raw:
        return {"ok": False, "configured": False, "error": "Not set."}
    picked = Path(raw).expanduser()
    if not picked.is_absolute():
        return {"ok": False, "configured": True, "error": "Use an absolute path."}
    if not picked.is_dir():
        return {"ok": False, "configured": True, "error": f"Folder not found: {picked}"}
    for candidate, portable in ((picked, False), (picked / "ComfyUI", True)):
        if _is_comfyui(candidate):
            root = candidate.resolve()
            return {
                "ok": True,
                "configured": True,
                "root": str(root),
                "portable": portable,
                "inputDir": str(root / "input"),
                "outputDir": str(root / "output"),
                "modelsDir": str(root / "models"),
            }
    return {
        "ok": False,
        "configured": True,
        "error": "Not a ComfyUI folder: expected main.py and comfy/ here or in a ComfyUI/ subfolder.",
    }


def find_input_image(comfyui: dict[str, Any], filename: str) -> Path | None:
    """Resolve a LoadImage filename (``name.png`` or ``sub/name.png [input]``) inside ComfyUI's input folder."""
    if not comfyui.get("ok") or not filename:
        return None
    name = str(filename).strip()
    for suffix in (" [input]", " [output]", " [temp]"):
        if name.endswith(suffix):
            base = comfyui["outputDir"] if suffix == " [output]" else comfyui["inputDir"]
            name = name[: -len(suffix)]
            break
    else:
        base = comfyui["inputDir"]
    root = Path(base).resolve()
    candidate = (root / name).resolve()
    if root not in candidate.parents or not candidate.is_file():
        return None
    return candidate
