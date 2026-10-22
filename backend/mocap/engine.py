"""The AniMocap engine as RWB sees it: where it is, whether it is ready, how to call it.

The engine (``engines/animocap``) owns every motion algorithm. RWB calls its CLI
(``animocap.exe``, see docs/animocap-engine.md) and its Python ML adapters, which
run in AniMocap's own environment ``.venv-mmpose``. Nothing here falls back to
another interpreter: a missing environment is reported, not worked around.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


class EngineError(RuntimeError):
    """The engine refused or failed a command; the message is the engine's own."""


def engine_root() -> Path:
    override = os.environ.get("RWB_ANIMOCAP_ROOT")
    return Path(override).expanduser().resolve() if override else REPO_ROOT / "engines" / "animocap"


def engine_exe() -> Path:
    return engine_root() / "build" / "windows-ninja" / "animocap.exe"


def adapters_dir() -> Path:
    return engine_root() / "python" / "animocap_ml_adapters"


def python_exe() -> Path:
    return engine_root() / ".venv-mmpose" / "Scripts" / "python.exe"


def setup_script(name: str) -> Path:
    """``mmpose``, ``local_vlm``, ``openvino_npu`` or ``sam2``."""
    return engine_root() / "tools" / f"setup_{name}.ps1"


SETUP_NAMES = ("mmpose", "local_vlm", "openvino_npu", "sam2")


def open_setup(name: str) -> dict[str, Any]:
    """Open an AniMocap setup script in its own console window.

    Setup downloads several GB and may install Python 3.12 with winget, so it runs
    visibly where the user can read and stop it, never hidden in the background.
    """
    if name not in SETUP_NAMES:
        raise EngineError(f"Unknown setup: {name}")
    script = setup_script(name)
    if not script.is_file():
        raise EngineError(f"Setup script not found: {script}")
    subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-NoExit", "-File", str(script)],
        cwd=engine_root(),
        creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
    )
    return {"started": name, "script": str(script)}


def run_cli(*args: str | os.PathLike[str], timeout: float = 600) -> dict[str, Any]:
    """Run one ``animocap.exe`` command and return its JSON result."""
    exe = engine_exe()
    if not exe.is_file():
        raise EngineError("The motion-capture engine is not built yet. Run update.bat (it needs the Visual Studio C++ tools).")
    result = subprocess.run(
        [str(exe), *map(str, args)],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        creationflags=CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        message = (result.stderr or result.stdout).strip() or f"animocap exited with code {result.returncode}"
        raise EngineError(message.removeprefix("contract error: ").removeprefix("error: "))
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise EngineError(f"animocap printed no JSON result: {result.stdout[:200]}") from error


def _check_adapter(script: str, timeout: float) -> dict[str, Any]:
    """Run an adapter's ``--check``; its last JSON line says what is ready."""
    try:
        result = subprocess.run(
            [str(python_exe()), str(adapters_dir() / script), "--check"],
            cwd=engine_root(),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
    except subprocess.TimeoutExpired:
        return {"ready": False, "error": f"check timed out after {int(timeout)} s"}
    report: dict[str, Any] = {}
    for line in result.stdout.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            report = value
    if result.returncode != 0 or report.get("event") == "error":
        tail = (result.stderr or result.stdout).strip().splitlines()[-3:]
        return {"ready": False, "error": report.get("message") or "\n".join(tail) or f"exit code {result.returncode}"}
    return {"ready": True, **{key: value for key, value in report.items() if key != "event"}}


def status(*, deep: bool = False) -> dict[str, Any]:
    """What is installed on this computer. ``deep`` also imports the ML stacks (slow)."""
    exe = engine_exe()
    engine: dict[str, Any] = {"built": exe.is_file(), "path": str(exe)}
    if engine["built"]:
        try:
            completed = subprocess.run(
                [str(exe), "--version"], capture_output=True, text=True, timeout=30, creationflags=CREATE_NO_WINDOW
            )
            engine["version"] = completed.stdout.strip() or None
        except (OSError, subprocess.TimeoutExpired) as error:
            engine["built"] = False
            engine["error"] = str(error)
    python = python_exe()
    environment: dict[str, Any] = {"present": python.is_file(), "path": str(python.parent.parent)}
    report: dict[str, Any] = {
        "root": str(engine_root()),
        "engine": engine,
        "environment": environment,
        "setup": {name: setup_script(name).is_file() for name in SETUP_NAMES},
    }
    if deep and environment["present"]:
        report["pose"] = _check_adapter("mmpose_adapter.py", timeout=300)
        report["vlm"] = _check_adapter("local_vlm_adapter.py", timeout=60)
    return report
