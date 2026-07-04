"""Best-effort screening of PyTorch ``.pt`` checkpoints for malicious pickles.

Loading a ``.pt`` file (via ``torch.load`` / ``ultralytics.YOLO``) deserializes a
Python pickle, which can execute arbitrary code through ``GLOBAL`` references to
dangerous callables (``os.system``, ``builtins.eval``, ...). Legitimate YOLO
weights never reference these modules, so scanning the pickle opcode stream for
a small denylist catches obviously weaponized checkpoints with virtually no risk
of false positives.

This is defense in depth, not a guarantee: only import ``.pt`` files you trust.
"""
from __future__ import annotations

import pickletools
import zipfile
from pathlib import Path
from typing import Iterable

# Whole modules that a weights file has no legitimate reason to reference.
_DENYLISTED_MODULES = frozenset(
    {
        "os",
        "nt",
        "posix",
        "subprocess",
        "sys",
        "socket",
        "shutil",
        "pty",
        "ctypes",
        "importlib",
        "runpy",
        "webbrowser",
        "multiprocessing",
        "commands",
        "popen2",
        "platform",
        "pathlib",
    }
)

# Specific builtins that enable code execution / process control.
_DENYLISTED_BUILTINS = frozenset(
    {
        "eval",
        "exec",
        "execfile",
        "compile",
        "__import__",
        "open",
        "input",
        "breakpoint",
        "getattr",
        "setattr",
    }
)

_BUILTIN_MODULES = frozenset({"builtins", "__builtin__"})


class UnsafeModelError(ValueError):
    """Raised when a ``.pt`` file references disallowed globals in its pickle."""


def assert_safe_pt_file(model_path: Path) -> None:
    """Raise :class:`UnsafeModelError` if the checkpoint pickle looks malicious.

    Best-effort: unparseable/unknown containers are allowed through (the loader
    downstream will reject genuinely broken files), but any denylisted global we
    can see is rejected.
    """
    path = Path(model_path)
    for pickle_bytes in _iter_pickle_streams(path):
        _scan_pickle_stream(pickle_bytes, source=path)


def _iter_pickle_streams(path: Path) -> Iterable[bytes]:
    # torch>=1.6 saves a zip archive containing one or more ``*.pkl`` members.
    if zipfile.is_zipfile(path):
        try:
            with zipfile.ZipFile(path) as archive:
                members = [name for name in archive.namelist() if name.endswith(".pkl")]
                for name in members:
                    try:
                        yield archive.read(name)
                    except (KeyError, OSError, zipfile.BadZipFile):
                        continue
        except (OSError, zipfile.BadZipFile):
            return
        return

    # Legacy (non-zip) format: the whole file is a single pickle stream.
    try:
        yield path.read_bytes()
    except OSError:
        return


def _scan_pickle_stream(data: bytes, *, source: Path) -> None:
    try:
        ops = pickletools.genops(data)
        # Track the two most recently pushed string constants so we can resolve
        # STACK_GLOBAL (protocol >=4), which pops "module" and "name" from the
        # stack instead of carrying them inline like the older GLOBAL opcode.
        recent_strings: list[str] = []
        for opcode, arg, _pos in ops:
            name = opcode.name
            if name == "GLOBAL":
                module, target = _split_inline_global(arg)
                _check_global(module, target, source)
            elif name == "STACK_GLOBAL":
                if len(recent_strings) >= 2:
                    _check_global(recent_strings[-2], recent_strings[-1], source)
            elif isinstance(arg, str):
                recent_strings.append(arg)
                if len(recent_strings) > 2:
                    del recent_strings[0]
    except UnsafeModelError:
        raise
    except Exception:
        # Malformed/opaque stream: don't block on parse errors, but nothing
        # dangerous was positively identified either.
        return


def _check_global(module: str | None, name: str, source: Path) -> None:
    if not module:
        return
    base_module = module.split(".", 1)[0].lower()
    if base_module in _DENYLISTED_MODULES:
        raise UnsafeModelError(
            f"Refusing to load model with unsafe reference '{module}.{name}' in {source.name}."
        )
    if module in _BUILTIN_MODULES and name in _DENYLISTED_BUILTINS:
        raise UnsafeModelError(
            f"Refusing to load model with unsafe reference '{module}.{name}' in {source.name}."
        )


def _split_inline_global(arg: object) -> tuple[str | None, str]:
    # GLOBAL passes "module name" as one newline- or space-separated string.
    if isinstance(arg, str):
        parts = arg.split()
        if len(parts) >= 2:
            return parts[0], parts[1]
    return None, ""
