"""Single-process YOLO training runner with SSE streaming.

One training session at a time. stdout+stderr are buffered in memory so
reconnecting clients receive the full history without a file on disk.
"""
from __future__ import annotations

import asyncio
import os
import shlex
from dataclasses import dataclass, field
from typing import AsyncGenerator, Optional


@dataclass
class _State:
    running: bool = False
    stopped: bool = False
    exit_code: Optional[int] = None
    process: Optional[asyncio.subprocess.Process] = None
    lines: list[str] = field(default_factory=list)
    command: str = ""
    error: str = ""


_state = _State()


def get_status() -> dict:
    return {
        "running": _state.running,
        "stopped": _state.stopped,
        "exitCode": _state.exit_code,
        "lineCount": len(_state.lines),
        "command": _state.command,
        "error": _state.error,
    }


async def start(command: str) -> dict:
    global _state
    if _state.running:
        return {"ok": False, "reason": "already_running", "message": "A training process is already running."}

    stripped = command.strip()
    if not stripped:
        return {"ok": False, "reason": "empty", "message": "Command is empty."}

    # shlex.split with posix=False preserves Windows-style quoted args
    try:
        args = shlex.split(stripped, posix=os.name != "nt")
    except ValueError as exc:
        return {"ok": False, "reason": "parse_error", "message": str(exc)}

    exe_name = os.path.splitext(os.path.basename(args[0]))[0].lower()
    if exe_name not in {"yolo"}:
        return {
            "ok": False,
            "reason": "disallowed",
            "message": f"Only 'yolo' commands are allowed (got '{exe_name}').",
        }

    _state = _State(running=True, command=stripped)

    async def _run() -> None:
        try:
            env = {**os.environ, "PYTHONUNBUFFERED": "1"}
            proc = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
            _state.process = proc
            assert proc.stdout is not None
            async for raw in proc.stdout:
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                _state.lines.append(line)
            _state.exit_code = await proc.wait()
        except FileNotFoundError:
            _state.lines.append(
                f"[error] '{args[0]}' not found. "
                "Is YOLO (ultralytics) installed in the active Python environment?"
            )
            _state.exit_code = 127
            _state.error = "executable_not_found"
        except Exception as exc:
            _state.lines.append(f"[error] {exc}")
            _state.exit_code = -1
            _state.error = str(exc)
        finally:
            _state.running = False

    asyncio.ensure_future(_run())
    return {"ok": True, "message": "Training started."}


async def stop() -> dict:
    if not _state.running:
        return {"ok": False, "reason": "not_running", "message": "No training is running."}
    proc = _state.process
    if proc is None:
        return {"ok": False, "reason": "no_process"}
    try:
        proc.terminate()
        _state.stopped = True
        _state.lines.append("[stopped by user]")
        return {"ok": True, "message": "Training terminated."}
    except Exception as exc:
        return {"ok": False, "reason": "error", "message": str(exc)}


async def stream_output() -> AsyncGenerator[str, None]:
    """SSE generator: replay the full buffer then follow live output."""
    sent = 0
    while True:
        chunk = _state.lines[sent:]
        for line in chunk:
            safe = line.replace("\r", "").replace("\n", " ")
            yield f"data: {safe}\n\n"
            sent += 1

        if not _state.running and sent >= len(_state.lines):
            code = _state.exit_code if _state.exit_code is not None else -1
            yield f"event: done\ndata: {code}\n\n"
            return

        await asyncio.sleep(0.1)
