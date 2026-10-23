"""Resident engine processes for editing (``animocap serve``), one per open take.

A one-shot ``apply-edits`` re-reads and re-writes the whole take on every edit
(about 1.5 s for a 3000-frame take). The resident engine keeps the refined pose
in memory and answers an edit in tens of milliseconds with only the frames that
changed. Processes close after ``RWB_MOCAP_EDITOR_IDLE_SECONDS`` without use.
Nothing is lost when one closes or crashes: the edits are saved by the caller on
every change and the derived files can always be rebuilt from them.
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from . import engine

IDLE_SECONDS = float(os.environ.get("RWB_MOCAP_EDITOR_IDLE_SECONDS", "600"))
_REAP_INTERVAL_SECONDS = 30.0


class Refused(engine.EngineError):
    """The engine rejected the request as invalid input (nothing changed)."""


class EngineSession:
    def __init__(self, key: str) -> None:
        exe = engine.engine_exe()
        if not exe.is_file():
            raise engine.EngineError("The motion-capture engine is not built yet. Run update.bat.")
        self.key = key
        self.lock = threading.Lock()
        self.last_used = time.monotonic()
        self._counter = 0
        self.process = subprocess.Popen(
            [str(exe), "serve"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            creationflags=engine.CREATE_NO_WINDOW,
        )

    @property
    def alive(self) -> bool:
        return self.process.poll() is None

    def request(self, **body: Any) -> dict[str, Any]:
        with self.lock:
            self.last_used = time.monotonic()
            self._counter += 1
            body["id"] = self._counter
            try:
                assert self.process.stdin is not None and self.process.stdout is not None
                self.process.stdin.write(json.dumps(body, ensure_ascii=False) + "\n")
                self.process.stdin.flush()
                line = self.process.stdout.readline()
            except OSError as error:
                raise engine.EngineError(f"The editing engine stopped: {error}") from error
            if not line:
                raise engine.EngineError("The editing engine stopped unexpectedly.")
            reply = json.loads(line)
            if reply.get("id") != body["id"]:
                raise engine.EngineError("The editing engine answered out of order.")
            if not reply.get("ok"):
                error_type = Refused if reply.get("contract") else engine.EngineError
                raise error_type(str(reply.get("error") or "unknown engine error"))
            return reply

    def close(self) -> None:
        if self.alive:
            try:
                with self.lock:
                    assert self.process.stdin is not None
                    self.process.stdin.write('{"cmd": "close"}\n')
                    self.process.stdin.flush()
                self.process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired, ValueError):
                self.process.kill()
        # Close the pipes now; a dead process's pipe would otherwise fail on garbage collection.
        for stream in (self.process.stdin, self.process.stdout):
            try:
                if stream is not None:
                    stream.close()
            except (OSError, ValueError):
                pass


_SESSIONS: dict[str, EngineSession] = {}
_GUARD = threading.Lock()
_reaper: threading.Thread | None = None


def get(key: str) -> EngineSession | None:
    with _GUARD:
        session = _SESSIONS.get(key)
        return session if session is not None and session.alive else None


def open_session(key: str, *, refined: Path, edits: dict[str, Any], profile: str | None, cameras_from: Path | None) -> EngineSession:
    """Start (or restart) the engine for a take, with ``edits`` as its current state."""
    close(key)
    session = EngineSession(key)
    try:
        session.request(
            cmd="open",
            refined=str(refined),
            edits=edits,
            profile=profile,
            cameras_from=str(cameras_from) if cameras_from else None,
        )
    except Exception:
        session.close()
        raise
    with _GUARD:
        _SESSIONS[key] = session
    _ensure_reaper()
    return session


def close(key: str) -> None:
    with _GUARD:
        session = _SESSIONS.pop(key, None)
    if session is not None:
        session.close()


def close_all() -> None:
    with _GUARD:
        sessions = list(_SESSIONS.values())
        _SESSIONS.clear()
    for session in sessions:
        session.close()


def open_keys() -> list[str]:
    with _GUARD:
        return [key for key, session in _SESSIONS.items() if session.alive]


def _reap() -> None:
    global _reaper
    while True:
        time.sleep(_REAP_INTERVAL_SECONDS)
        now = time.monotonic()
        with _GUARD:
            idle = [key for key, session in _SESSIONS.items() if not session.alive or now - session.last_used >= IDLE_SECONDS]
        for key in idle:
            close(key)
        with _GUARD:
            if not _SESSIONS:
                _reaper = None
                return


def _ensure_reaper() -> None:
    global _reaper
    with _GUARD:
        if _reaper is None:
            _reaper = threading.Thread(target=_reap, name="mocap-editor-idle", daemon=True)
            _reaper.start()
