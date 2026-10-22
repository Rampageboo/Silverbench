"""Capture progress from the adapters' JSON-line logs.

A port of Studio's ``read_analysis_log`` / ``update_analysis_progress``: the same
events, stage weights and fractions, so both front ends report the same numbers.
Stage codes are returned as-is; the UI turns them into words.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


PROGRESS_EVENTS = frozenset({
    "progress", "vlm_progress", "view_started", "view_finished",
    "stage_started", "stage_output", "stage_finished", "complete", "error",
})


@dataclass
class LogState:
    found: bool = False
    event: str = ""
    view: str = ""
    stage: str = ""
    item: int = 0
    total: int = 0
    view_index: int = 0
    view_total: int = 0
    last_error: str = ""


def read_log(path: Path) -> LogState:
    state = LogState()
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return state
    for line in text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        event = value.get("event") if isinstance(value, dict) else None
        if event not in PROGRESS_EVENTS:
            continue  # warnings and diagnostics say nothing about progress
        state.found = True
        state.event = event
        if event == "view_started":
            state.view = str(value.get("view", ""))
            state.stage = "pose_2d_25d"
            state.view_index = int(value.get("index", 0) or 0)
            state.view_total = int(value.get("total", 0) or 0)
            state.item = state.total = 0
        elif event in ("progress", "vlm_progress"):
            for key in ("frame", "item"):
                if isinstance(value.get(key), int):
                    state.item = value[key]
            if isinstance(value.get("total"), int):
                state.total = value["total"]
        elif event in ("stage_started", "stage_output", "stage_finished"):
            state.view = str(value.get("view", state.view))
            state.stage = str(value.get("stage", state.stage))
        elif event == "view_finished":
            state.view = str(value.get("view", state.view))
        elif event == "complete":
            state.view, state.stage = "all", "complete"
        elif event == "error":
            state.last_error = str(value.get("message") or value.get("error") or "")
    return state


def _ratio(item: int, total: int) -> float:
    return min(max(item / total, 0.0), 1.0) if total else 0.0


def single_view(pose: LogState, vlm: LogState, *, vlm_enabled: bool) -> dict[str, Any]:
    fraction, stage, item, total = 0.0, "loading_models", 0, 0
    if vlm.event == "vlm_progress":
        stage, item, total = "visual_recovery", vlm.item, vlm.total
        fraction = 0.86 + 0.10 * _ratio(item, total)
    elif vlm.event in ("complete", "error"):
        stage, fraction = "visual_recovery_finishing", 0.96
    elif pose.event == "progress":
        stage, item, total = "pose", pose.item, pose.total
        fraction = 0.04 + 0.82 * _ratio(item, total)
    elif pose.event == "complete":
        stage = "visual_recovery_starting" if vlm_enabled else "finishing"
        fraction = 0.86 if vlm_enabled else 0.94
    elif pose.event == "error":
        stage, fraction = "failing", 0.12
    return {"fraction": fraction, "stage": stage, "item": item, "total": total, "view": None, "viewIndex": 0, "viewCount": 1}


def multiview(log: LogState, view_ids: list[str]) -> dict[str, Any]:
    view_count = len(view_ids) or log.view_total
    view_position = view_ids.index(log.view) + 1 if log.view in view_ids else log.view_index
    fraction, stage, show_frames = 0.01, "loading_models", False
    if log.stage == "pose_2d_25d" or log.event == "progress":
        completed = max(view_position - 1, 0)
        fraction = 0.02 + 0.78 * min(max((completed + _ratio(log.item, log.total)) / max(view_count, 1), 0.0), 1.0)
        stage, show_frames = "pose_per_view", log.total > 0
    elif log.stage == "local_visual_recovery":
        finished = log.event in ("stage_finished", "view_finished")
        completed = (view_position - 1 + (1.0 if finished else 0.08)) if view_position > 0 else 0.0
        fraction = 0.80 + 0.14 * min(max(completed / max(view_count, 1), 0.0), 1.0)
        stage = "visual_recovery_per_view"
    elif log.stage == "phase_align_and_joint_solve":
        fraction, stage = 0.96, "multiview_solve"
    elif log.stage == "calibrated_triangulation":
        fraction, stage = 0.96, "triangulation"
    elif log.stage == "kinematic_reconstruction":
        fraction, stage = 0.985, "kinematic_reconstruction"
    elif log.event == "complete":
        fraction, stage = 0.995, "finishing"
    elif log.event == "error":
        fraction, stage = 0.02, "failing"
    return {
        "fraction": fraction,
        "stage": stage,
        "item": log.item if show_frames else 0,
        "total": log.total if show_frames else 0,
        "view": log.view if log.view and log.view != "all" else None,
        "viewIndex": view_position,
        "viewCount": view_count,
    }
