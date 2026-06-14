from __future__ import annotations

import os
import sys
import threading
from pathlib import Path
from typing import Iterable


def _normalize_path(path: Path | str) -> Path:
    """Normalize local and UNC paths consistently on all platforms."""
    text = os.path.expanduser(str(path).strip())
    if sys.platform == "win32":
        if text.startswith("\\") and not text.startswith("\\\\") and not text.startswith("\\?"):
            text = "\\" + text
        if text.startswith("//") and not text.startswith("//?/"):
            text = "\\\\" + text[2:].replace("/", "\\")
        normalized = os.path.normpath(text)
        if normalized.startswith("\\\\"):
            return Path(normalized)
    try:
        return Path(text).resolve()
    except (OSError, RuntimeError):
        return Path(text)


class PathAccess:
    """Tracks local filesystem paths selected during the current app session."""

    def __init__(self, initial_allowed: Iterable[Path] = ()) -> None:
        self._lock = threading.Lock()
        self._allowed: set[Path] = {_normalize_path(path) for path in initial_allowed}

    def remember_path(self, path: Path | str) -> Path:
        resolved = _normalize_path(path)
        with self._lock:
            self._allowed.add(resolved)
        return resolved

    def remember_parent(self, path: Path | str) -> Path:
        resolved = _normalize_path(path)
        self.remember_path(resolved)
        if resolved.parent != resolved:
            self.remember_path(resolved.parent)
        return resolved

    def _path_is_allowed(self, resolved: Path, allowed: Path) -> bool:
        if resolved == allowed:
            return True
        if allowed in resolved.parents:
            return True
        if sys.platform == "win32":
            resolved_text = str(resolved).casefold()
            allowed_text = str(allowed).casefold()
            if resolved_text == allowed_text:
                return True
            prefix = allowed_text.rstrip("\\/") + "\\"
            if resolved_text.startswith(prefix) or resolved_text.startswith(allowed_text.rstrip("\\/") + "/"):
                return True
        return False

    def require_path(self, path: Path | str) -> Path:
        resolved = _normalize_path(path)
        with self._lock:
            allowed_paths = tuple(self._allowed)
        if not any(self._path_is_allowed(resolved, allowed) for allowed in allowed_paths):
            raise PermissionError(f"Path was not selected through this app session: {resolved}")
        return resolved

    def safe_child_path(self, root: Path | str, relative_path: str) -> Path:
        root_path = self.require_path(root)
        target = (root_path / relative_path).resolve()
        if target != root_path and root_path not in target.parents:
            raise ValueError(f"Path escapes dataset root: {relative_path}")
        return target
