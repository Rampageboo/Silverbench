from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .atomic_write import write_text_atomic
from .path_access import PathAccess


SUPPORTED_SCHEMA_MAJOR = 2
REPO_ROOT = Path(__file__).resolve().parent.parent
UI_MAPS_ROOT = REPO_ROOT / "ui_maps"
_SCHEMA_VERSION_RE = re.compile(r"^(\d+)\.(\d+)$")
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


class UiMapStoreError(ValueError):
    """Base typed error for UI-map persistence failures."""

    code = "ui_map_store_error"


class UiMapEnvelopeError(UiMapStoreError):
    code = "invalid_ui_map_envelope"


class UnsupportedUiMapVersionError(UiMapStoreError):
    code = "unsupported_ui_map_version"

    def __init__(self, schema_version: str, supported_major: int = SUPPORTED_SCHEMA_MAJOR) -> None:
        self.schema_version = schema_version
        self.supported_major = supported_major
        super().__init__(
            f'UI map schemaVersion "{schema_version}" is unsupported; '
            f"maximum supported major is {supported_major}."
        )


class UnsafeUiMapNameError(UiMapStoreError):
    code = "unsafe_ui_map_name"


def sanitize_ui_map_name(name: str) -> str:
    raw = str(name or "").strip()
    if not raw:
        raise UnsafeUiMapNameError("UI map name must be non-empty.")
    if ".." in raw or "/" in raw or "\\" in raw or Path(raw).is_absolute():
        raise UnsafeUiMapNameError("UI map name may not contain path separators, '..', or an absolute path.")
    sanitized = _SAFE_NAME_RE.sub("_", raw).strip("._-")
    if not sanitized:
        raise UnsafeUiMapNameError("UI map name does not contain a usable file name.")
    return sanitized


def _ui_map_path(name: str) -> tuple[str, Path]:
    sanitized = sanitize_ui_map_name(name)
    root = UI_MAPS_ROOT.resolve()
    path_access = PathAccess([root])
    target = path_access.safe_child_path(root, f"{sanitized}.json")
    if target.parent != root:
        raise UnsafeUiMapNameError("UI map path escaped the ui_maps root.")
    return sanitized, target


def _parse_json_document(doc: Any) -> dict[str, Any]:
    try:
        if isinstance(doc, str):
            parsed = json.loads(doc)
        else:
            encoded = json.dumps(doc, ensure_ascii=False, allow_nan=False)
            parsed = json.loads(encoded)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise UiMapEnvelopeError(f"UI map must be valid JSON: {error}") from error
    if not isinstance(parsed, dict):
        raise UiMapEnvelopeError("UI map document must be a JSON object.")
    return parsed


def _validate_envelope(doc: dict[str, Any]) -> None:
    schema_version = doc.get("schemaVersion")
    if not isinstance(schema_version, str):
        raise UiMapEnvelopeError("UI map schemaVersion must be present as a MAJOR.MINOR string.")
    match = _SCHEMA_VERSION_RE.fullmatch(schema_version)
    if match is None:
        raise UiMapEnvelopeError("UI map schemaVersion must use MAJOR.MINOR format.")
    if int(match.group(1)) > SUPPORTED_SCHEMA_MAJOR:
        raise UnsupportedUiMapVersionError(schema_version)

    game = doc.get("game")
    if not isinstance(game, str) or not game.strip():
        raise UiMapEnvelopeError("UI map game must be a non-empty string.")
    pages = doc.get("pages")
    if not isinstance(pages, list) or not pages:
        raise UiMapEnvelopeError("UI map pages must be a non-empty array.")
    if not isinstance(doc.get("flows"), list):
        raise UiMapEnvelopeError("UI map flows must be an array.")


def load_ui_map(name: str) -> dict[str, Any]:
    _sanitized, path = _ui_map_path(name)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise FileNotFoundError(f"UI map not found: {name}") from error
    doc = _parse_json_document(text)
    _validate_envelope(doc)
    return doc


def save_ui_map(name: str, doc: Any) -> dict[str, str]:
    sanitized, path = _ui_map_path(name)
    parsed = _parse_json_document(doc)
    _validate_envelope(parsed)
    write_text_atomic(path, f"{json.dumps(parsed, ensure_ascii=False, indent=2)}\n")
    return {
        "name": sanitized,
        "path": f"ui_maps/{path.name}",
    }
