"""Per-workspace UI state in ``.rwb/session.json`` (machine-local, safe to delete).

Holds things like the current image, filters, shortcut slots and the assign
page's batch history. It is not annotation data.
"""

from __future__ import annotations

import json
from typing import Any

from .atomic_write import write_text_atomic
from .workspace_layout import WorkspaceLayout

MAX_ASSIGN_BATCHES = 2000
MAX_BUILD_RUNS = 500
_COMPACT_THRESHOLD_BYTES = 500_000


def default_inbox_session() -> dict[str, Any]:
    return {
        "assignBatches": [],
        "buildRuns": [],
        "ui": {"filter": "new", "split": "train", "detectEnabled": False, "clfEnabled": True},
    }


def _json_list(value: Any) -> list[Any]:
    return list(value) if isinstance(value, list) else []


def normalize_inbox_session(data: dict[str, Any] | None) -> dict[str, Any]:
    base = default_inbox_session()
    if not isinstance(data, dict):
        return base
    ui = data.get("ui") if isinstance(data.get("ui"), dict) else {}
    base["ui"] = {
        "filter": str(ui.get("filter") or base["ui"]["filter"]),
        "split": str(ui.get("split") or base["ui"]["split"]),
        "detectEnabled": bool(ui.get("detectEnabled", base["ui"]["detectEnabled"])),
        "clfEnabled": bool(ui.get("clfEnabled", base["ui"]["clfEnabled"])),
    }
    base["assignBatches"] = _json_list(data.get("assignBatches"))[-MAX_ASSIGN_BATCHES:]
    base["buildRuns"] = _json_list(data.get("buildRuns"))[-MAX_BUILD_RUNS:]
    return base


def _slim(items: list[Any], keep: int) -> list[dict[str, Any]]:
    out = []
    for item in [entry for entry in items if isinstance(entry, dict)][-keep:]:
        slim = dict(item)
        slim["filenameCount"] = len(_json_list(slim.get("filenames")))
        slim["filenames"] = []
        out.append(slim)
    return out


def compact_inbox_session(inbox: dict[str, Any] | None) -> dict[str, Any]:
    """Keep pending assign batches plus a short history so the file stays small."""
    normalized = normalize_inbox_session(inbox)
    batches = [batch for batch in normalized["assignBatches"] if isinstance(batch, dict)]
    pending = [batch for batch in batches if not batch.get("built")]
    built = _slim([batch for batch in batches if batch.get("built")], 40)
    normalized["assignBatches"] = (pending + built)[-MAX_ASSIGN_BATCHES:]
    normalized["buildRuns"] = _slim(normalized["buildRuns"], 20)
    return normalized


def read_session(layout: WorkspaceLayout) -> dict[str, Any]:
    path = layout.path("session")
    try:
        raw = path.read_text(encoding="utf-8")
        session = json.loads(raw)
    except (OSError, ValueError):
        return {}
    if not isinstance(session, dict):
        return {}
    if session.get("inbox"):
        session["inbox"] = normalize_inbox_session(session["inbox"])
        if len(raw) > _COMPACT_THRESHOLD_BYTES:
            write_session(layout, session)
    return session


def write_session(layout: WorkspaceLayout, session: dict[str, Any]) -> str:
    if not isinstance(session, dict):
        raise ValueError("Workspace session must be a JSON object.")
    payload = dict(session)
    if payload.get("inbox"):
        payload["inbox"] = compact_inbox_session(payload["inbox"])
    path = layout.path("session")
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return str(path)


def lite_session(session: dict[str, Any]) -> dict[str, Any]:
    """UI restore payload without the assign page's batch history."""
    lite = dict(session)
    inbox = session.get("inbox") if isinstance(session.get("inbox"), dict) else {}
    base = default_inbox_session()
    lite["inbox"] = {**base, "ui": {**base["ui"], **(inbox.get("ui") or {})}}
    return lite
