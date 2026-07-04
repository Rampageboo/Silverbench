from __future__ import annotations

import threading
import time
import uuid
from typing import Any


TERMINAL_JOB_STATUSES = {"done", "error", "cancelled"}


class JobStore:
    def __init__(
        self,
        *,
        not_found_message: str,
        ttl_seconds: float = 10 * 60,
        max_retained: int = 64,
        hidden_keys: set[str] | None = None,
    ) -> None:
        self._not_found_message = not_found_message
        self._ttl_seconds = ttl_seconds
        self._max_retained = max_retained
        self._hidden_keys = hidden_keys or {"cancelEvent", "finishedAt"}
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}

    def create(self, state: dict[str, Any], *, cancelable: bool = False) -> tuple[str, threading.Event | None]:
        job_id = uuid.uuid4().hex
        cancel_event = threading.Event() if cancelable else None
        job_state = {"id": job_id, **state}
        if cancel_event is not None:
            job_state["cancelEvent"] = cancel_event
        with self._lock:
            self._prune_locked()
            self._jobs[job_id] = job_state
        return job_id, cancel_event

    def update(self, job_id: str, patch: dict[str, Any]) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if current:
                current.update(patch)

    def finish(self, job_id: str, patch: dict[str, Any]) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if current:
                current.update(patch)
                current["finishedAt"] = time.monotonic()

    def snapshot(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            self._prune_locked()
            state = self._jobs.get(job_id)
            if not state:
                raise ValueError(self._not_found_message)
            return self._snapshot_locked(state)

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            self._prune_locked()
            state = self._jobs.get(job_id)
            if not state:
                raise ValueError(self._not_found_message)
            if state.get("status") in TERMINAL_JOB_STATUSES:
                return self._snapshot_locked(state)
            cancel_event = state.get("cancelEvent")
            if isinstance(cancel_event, threading.Event):
                cancel_event.set()
            state["detail"] = "Cancelling..."
            return self._snapshot_locked(state)

    def _snapshot_locked(self, state: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in state.items() if key not in self._hidden_keys}

    def _prune_locked(self) -> None:
        now = time.monotonic()
        expired = [
            job_id
            for job_id, state in self._jobs.items()
            if state.get("status") in TERMINAL_JOB_STATUSES
            and isinstance(state.get("finishedAt"), (int, float))
            and now - float(state["finishedAt"]) >= self._ttl_seconds
        ]
        for job_id in expired:
            self._jobs.pop(job_id, None)

        if len(self._jobs) <= self._max_retained:
            return
        terminal_jobs = sorted(
            (
                (float(state.get("finishedAt") or 0), job_id)
                for job_id, state in self._jobs.items()
                if state.get("status") in TERMINAL_JOB_STATUSES
            )
        )
        for _, job_id in terminal_jobs[: max(0, len(self._jobs) - self._max_retained)]:
            self._jobs.pop(job_id, None)
