from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_text_atomic(path: Path | str, text: str, *, encoding: str = "utf-8", newline: str = "") -> Path:
    """Write text to ``path`` atomically.

    The content is written to a temporary file in the same directory and then
    ``os.replace``d onto the target, so a crash or disk-full part way through
    can never truncate or corrupt the existing file.
    """
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding, newline=newline) as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        _silent_unlink(tmp_name)
        raise
    return target


def write_bytes_atomic(path: Path | str, data: bytes) -> Path:
    """Write bytes to ``path`` atomically (see :func:`write_text_atomic`)."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, target)
    except BaseException:
        _silent_unlink(tmp_name)
        raise
    return target


def _silent_unlink(name: str) -> None:
    try:
        os.unlink(name)
    except OSError:
        pass
