"""Motion-capture takes in a workspace (``mocap/<take>/``) and the capture job.

A take records which videos were captured with which options, keeps the
adapters' raw output, and derives everything else from two files:

- ``refined.json``: the refined pose, written once by the capture and never edited;
- ``edits.json``: the user's edits (docs/animocap-engine.md), small and replayable.

``motion.amotion/``, ``pose.json`` and ``motion.amotion.areview/`` are derived
from them and can always be regenerated. While a take is being edited a resident
engine (``editor``) answers each edit; ``edits.json`` is written at once and the
derived files follow shortly after (``flush``). ``edit-result.json`` records which
edits they belong to, so stale files are rebuilt instead of trusted. The capture runs
the same commands, options and order as AniMocap Studio.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.atomic_write import write_text_atomic
from backend.workspace_layout import VIDEO_EXTENSIONS, WorkspaceLayout

from . import editor, engine, progress

TAKE_FORMAT_VERSION = 1
EXPERT_INTERVALS = ("1", "2", "3", "auto")
VLM_MODEL = "qwen3-vl:4b"
EMPTY_EDITS: dict[str, Any] = {"version": 1, "corrections": [], "smoothedKeyframes": [], "review": {"marks": [], "ranges": []}}
_TAKE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


class MocapError(ValueError):
    """An actionable invalid request."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    write_text_atomic(path, json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def takes_root(layout: WorkspaceLayout) -> Path:
    return layout.path("mocap")


def take_dir(layout: WorkspaceLayout, take_id: str) -> Path:
    if not _TAKE_ID.match(take_id):
        raise MocapError(f"Invalid take id: {take_id}")
    path = takes_root(layout) / take_id
    if not (path / "take.json").is_file():
        raise MocapError(f"Take not found: {take_id}")
    return path


def _media_video(layout: WorkspaceLayout, value: str) -> str:
    """A video inside the workspace, as a workspace-relative POSIX path."""
    raw = Path(value).expanduser()
    path = (raw if raw.is_absolute() else layout.root / raw).resolve()
    root = layout.root.resolve()
    if root not in path.parents:
        raise MocapError(f"The video must be inside the workspace: {value}")
    if not path.is_file() or path.suffix.lower() not in VIDEO_EXTENSIONS:
        raise MocapError(f"Video not found: {value}")
    return path.relative_to(root).as_posix()


def _optional_file(layout: WorkspaceLayout, value: str | None, what: str) -> str | None:
    if not value:
        return None
    raw = Path(value).expanduser()
    path = (raw if raw.is_absolute() else layout.root / raw).resolve()
    if not path.is_file():
        raise MocapError(f"{what} not found: {value}")
    return str(path)


def _new_take_id(layout: WorkspaceLayout, stem: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-._")[:60] or "take"
    base = f"{datetime.now().strftime('%Y%m%d-%H%M%S')}-{safe}"
    candidate, counter = base, 2
    while (takes_root(layout) / candidate).exists():
        candidate, counter = f"{base}-{counter}", counter + 1
    return candidate


def create_take(layout: WorkspaceLayout, request: dict[str, Any]) -> dict[str, Any]:
    """Record a new take (not yet captured). ``request``: sources, options, name."""
    raw_sources = request.get("sources") or []
    if not raw_sources:
        raise MocapError("Choose at least one video.")
    if len(raw_sources) > 8:
        raise MocapError("A multiview take has at most 8 views.")
    multiview = len(raw_sources) > 1
    sources, ids = [], set()
    for index, source in enumerate(raw_sources):
        view_id = str(source.get("id") or (f"view_{index + 1}" if multiview else "main"))
        if view_id in ids or not _TAKE_ID.match(view_id):
            raise MocapError(f"Invalid or duplicate view id: {view_id}")
        ids.add(view_id)
        entry: dict[str, Any] = {"id": view_id, "video": _media_video(layout, str(source.get("video", "")))}
        if any(other["video"] == entry["video"] for other in sources):
            raise MocapError(f"The same video is chosen twice: {entry['video']}")
        if multiview:
            yaw = source.get("yaw")
            if not isinstance(yaw, (int, float)):
                raise MocapError(f"View {view_id} needs a direction (yaw in degrees).")
            entry["yaw"] = float(yaw)
            entry["timeOffset"] = float(source.get("timeOffset") or 0.0)
        sources.append(entry)

    take_options = _take_options(layout, request.get("options") or {}, multiview)
    take_id = _new_take_id(layout, Path(sources[0]["video"]).stem)
    take = {
        "version": TAKE_FORMAT_VERSION,
        "id": take_id,
        "name": str(request.get("name") or Path(sources[0]["video"]).stem),
        "createdAt": _now(),
        "mode": "multiview" if multiview else "single",
        "sources": sources,
        "options": take_options,
        "capture": {"status": "new"},
    }
    folder = takes_root(layout) / take_id
    folder.mkdir(parents=True)
    _write_json(folder / "take.json", take)
    _write_json(folder / "edits.json", EMPTY_EDITS)
    return describe(layout, take_id)


def _take_options(layout: WorkspaceLayout, options: dict[str, Any], multiview: bool) -> dict[str, Any]:
    roi = options.get("roi")
    if roi is not None:
        if multiview:
            raise MocapError("A person frame applies to single-view captures only.")
        if not (isinstance(roi, list) and len(roi) == 4 and all(isinstance(v, (int, float)) for v in roi)) or roi[2] <= 0 or roi[3] <= 0:
            raise MocapError("The person frame must be [x, y, width, height] in video pixels.")
        roi = [int(round(v)) for v in roi]
    interval = str(options.get("expertInterval", "2"))
    if interval not in EXPERT_INTERVALS:
        raise MocapError(f"Auxiliary AI interval must be one of {', '.join(EXPERT_INTERVALS)}.")
    return {
        "roi": roi,
        "vlm": bool(options.get("vlm", False)),
        "appearanceReference": _optional_file(layout, options.get("appearanceReference"), "Appearance reference"),
        "expertInterval": interval,
        "upscale": bool(options.get("upscale", True)),
        "characterProfile": _optional_file(layout, options.get("characterProfile"), "Character profile"),
        "fps": float(options.get("fps") or 30.0),
    }


def update_options(layout: WorkspaceLayout, take_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Change capture options (e.g. the person frame) of a take that is not captured yet."""
    folder = take_dir(layout, take_id)
    with _take_lock(folder):
        take = _load(folder)
        job = _JOBS.get(str(folder))
        if (job is not None and job.running) or take["capture"].get("status") == "ready":
            raise MocapError("Capture options can only change before a take is captured.")
        take["options"] = _take_options(layout, {**take["options"], **changes}, take["mode"] == "multiview")
        _save(folder, take)
    return describe(layout, take_id)


def _load(folder: Path) -> dict[str, Any]:
    return _read_json(folder / "take.json")


def _save(folder: Path, take: dict[str, Any]) -> None:
    _write_json(folder / "take.json", take)


def describe(layout: WorkspaceLayout, take_id: str) -> dict[str, Any]:
    folder = take_dir(layout, take_id)
    take = _load(folder)
    capture = dict(take.get("capture") or {})
    job = _JOBS.get(str(folder))
    if job is not None and job.running:
        capture.update(job.progress())
    elif capture.get("status") == "capturing":
        capture["status"] = "interrupted"  # the app closed during the capture
    result = {**take, "capture": capture, "hasMotion": (folder / "motion.amotion" / "manifest.json").is_file()}
    edit_result = folder / "edit-result.json"
    if edit_result.is_file():
        result["edits"] = {key: value for key, value in _read_json(edit_result).items() if key != "inferred"}
    return result


def list_takes(layout: WorkspaceLayout) -> list[dict[str, Any]]:
    root = takes_root(layout)
    if not root.is_dir():
        return []
    takes = []
    for folder in sorted(root.iterdir(), reverse=True):
        if (folder / "take.json").is_file():
            try:
                takes.append(describe(layout, folder.name))
            except (OSError, ValueError, json.JSONDecodeError):
                continue
    return takes


# ---------------------------------------------------------------- capture job


class _Cancelled(Exception):
    pass


class CaptureJob:
    def __init__(self, folder: Path, take: dict[str, Any]) -> None:
        self.folder = folder
        self.take = take
        self.started = time.monotonic()
        self.cancel_requested = False
        self.process: subprocess.Popen[bytes] | None = None
        self.phase = "starting"
        self.thread = threading.Thread(target=self._run, name=f"mocap-capture-{take['id']}", daemon=True)

    @property
    def running(self) -> bool:
        return self.thread.is_alive()

    @property
    def capture_dir(self) -> Path:
        return self.folder / "capture"

    def log(self, name: str) -> Path:
        return self.folder / "logs" / f"{name}.log"

    def progress(self) -> dict[str, Any]:
        if self.take["mode"] == "multiview":
            state = progress.multiview(progress.read_log(self.log("pose")), [s["id"] for s in self.take["sources"]])
        else:
            state = progress.single_view(
                progress.read_log(self.log("pose")),
                progress.read_log(self.log("vlm")),
                vlm_enabled=self.take["options"]["vlm"],
            )
        if self.phase in ("refining", "building"):
            state.update(stage=self.phase, fraction=max(state["fraction"], 0.97 if self.phase == "refining" else 0.99))
        elapsed = time.monotonic() - self.started
        fraction = state["fraction"]
        remaining = elapsed * (1.0 / fraction - 1.0) if 0.04 < fraction < 0.995 else None
        return {
            "status": "cancelling" if self.cancel_requested else "capturing",
            **state,
            "elapsedSeconds": round(elapsed, 1),
            "remainingSeconds": round(remaining, 1) if remaining is not None else None,
        }

    def cancel(self) -> None:
        self.cancel_requested = True
        process = self.process
        if process is not None and process.poll() is None:
            _kill_tree(process)

    def _check(self) -> None:
        if self.cancel_requested:
            raise _Cancelled

    def _python(self, script: str, args: list[str], log: str) -> int:
        """Run one adapter with Studio's settings; output goes to a JSON-line log."""
        self._check()
        log_path = self.log(log)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with log_path.open("wb") as sink:
            self.process = subprocess.Popen(
                [str(engine.python_exe()), str(engine.adapters_dir() / script), *args],
                cwd=engine.engine_root(),
                stdin=subprocess.DEVNULL,
                stdout=sink,
                stderr=subprocess.STDOUT,
                env={**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"},
                creationflags=engine.CREATE_NO_WINDOW,
            )
            code = self.process.wait()
        self.process = None
        self._check()
        return code

    def _log_tail(self, log: str, lines: int = 8) -> str:
        try:
            text = self.log(log).read_text(encoding="utf-8", errors="replace")
        except OSError:
            return ""
        return "\n".join(text.strip().splitlines()[-lines:])

    def _quality_args(self) -> list[str]:
        options = self.take["options"]
        args = ["--quality", "maximum", "--segmentation", "auto", "--npu-mode", "shadow"]
        if options["upscale"]:
            args += ["--upscale", "maxine-vsr", "--upscale-scale", "2"]
        return args + ["--expert-interval", options["expertInterval"]]

    def _run(self) -> None:
        capture: dict[str, Any] = {"status": "capturing", "startedAt": _now()}
        self.take["capture"] = capture
        _save(self.folder, self.take)
        try:
            if not engine.python_exe().is_file():
                raise MocapError("The capture environment (.venv-mmpose) is not installed. Install it from the 本机环境 panel on the Motion capture page.")
            _hand_over_gpu()
            _clear_capture_outputs(self.folder)
            self.capture_dir.mkdir(parents=True, exist_ok=True)
            warning = self._capture_multiview() if self.take["mode"] == "multiview" else self._capture_single()
            self.phase = "building"
            self._check()
            rebuild(self.folder, self.take)
            capture.update(status="ready", warning=warning)
        except _Cancelled:
            capture.update(status="cancelled")
        except (MocapError, engine.EngineError, OSError, subprocess.SubprocessError) as error:
            capture.update(status="failed", error=str(error))
        except Exception as error:  # noqa: BLE001 - a capture must end in a recorded state
            capture.update(status="failed", error=f"{type(error).__name__}: {error}")
        capture["finishedAt"] = _now()
        capture["elapsedSeconds"] = round(time.monotonic() - self.started, 1)
        self.take["capture"] = capture
        _save(self.folder, self.take)

    def _capture_single(self) -> str | None:
        options = self.take["options"]
        video = str((self.folder.parents[1] / self.take["sources"][0]["video"]).resolve())
        observations = self.capture_dir / "pose_sequence.json"
        roi = [str(v) for v in options["roi"]] if options["roi"] else []
        args = ["--input", video, "--output", str(observations), *self._quality_args()]
        if roi:
            args += ["--roi", *roi]
        code = self._python("mmpose_adapter.py", args, "pose")
        if code != 0:
            raise MocapError(f"Pose inference failed (exit code {code}).\n{self._log_tail('pose')}")
        final, warning = observations, None
        if options["vlm"]:
            corrected = self.capture_dir / "pose_sequence-vlm.json"
            vlm_args = [
                "--input-video", video, "--input-pose", str(observations), "--output-pose", str(corrected),
                "--issues-output", str(self.capture_dir / "visual-recovery-issues.json"), "--model", VLM_MODEL,
            ]
            if roi:
                vlm_args += ["--roi", *roi]
            if options["appearanceReference"]:
                vlm_args += ["--reference-image", options["appearanceReference"]]
            if self._python("local_vlm_adapter.py", vlm_args, "vlm") == 0 and corrected.is_file():
                final = corrected
            else:
                warning = "vlm_skipped"  # Studio: keep the HRNet + optical-flow result
        self.phase = "refining"
        self._check()
        args = [final, "--output", self.capture_dir / "base.amotion", "--pose-output", self.folder / "refined.json"]
        if options["characterProfile"]:
            args += ["--character-profile", options["characterProfile"]]
        engine.run_cli("reconstruct-pose", *args)
        return warning

    def _capture_multiview(self) -> str | None:
        options = self.take["options"]
        manifest_path = self.capture_dir / "capture.multiview.json"
        workspace_root = self.folder.parents[1]
        _write_json(manifest_path, {
            "version": 1,
            "mode": "directional_repeat",
            "fps": options["fps"],
            "looping": False,
            "views": [
                {
                    "id": source["id"],
                    "video": (workspace_root / source["video"]).resolve().as_posix(),
                    "yaw_degrees": source["yaw"],
                    "time_offset_s": source.get("timeOffset", 0.0),
                }
                for source in self.take["sources"]
            ],
            "subject": {"type": "anime_humanoid", "approximate_height_m": None},
            "output": {"directory": self.capture_dir.as_posix()},
            "calibration_file": None,
        })
        engine.run_cli("validate-manifest", manifest_path)
        args = ["--manifest", str(manifest_path), "--output", str(self.capture_dir), *self._quality_args()]
        if not options["vlm"]:
            args.append("--no-vlm")
        elif options["appearanceReference"]:
            args += ["--reference-image", options["appearanceReference"]]
        code = self._python("multiview_pipeline.py", args, "pose")
        if code != 0:
            raise MocapError(
                f"Multiview pipeline failed (exit code {code}); per-view poses were kept.\n{self._log_tail('pose')}"
            )
        self.phase = "refining"
        self._check()
        fused = self.capture_dir / "fused_pose_sequence.json"
        if options["characterProfile"]:
            engine.run_cli(
                "reconstruct-pose", fused, "--no-smooth", "--character-profile", options["characterProfile"],
                "--output", self.capture_dir / "profile.amotion", "--pose-output", self.folder / "refined.json",
            )
        else:
            # The pipeline already stabilized, optimized and pinned the fused pose;
            # Studio does not run a second generic pass over it.
            shutil.copyfile(fused, self.folder / "refined.json")
        return None


DERIVED_OUTPUTS = ("motion.amotion", "pose.json", "motion.amotion.areview", "edit-result.json")


def _clear_capture_outputs(folder: Path) -> None:
    """Remove what an earlier, unfinished capture left, so a retry cannot collide with it.

    Only takes that never finished get here (a ready take is not recaptured), so
    there are no user edits to lose; edits.json is reset because they would
    refer to the old refined pose.
    """
    editor.close(str(folder))
    _DIRTY.discard(str(folder))
    for name in ("capture", "logs", *DERIVED_OUTPUTS):
        path = folder / name
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()
    (folder / "refined.json").unlink(missing_ok=True)
    _write_json(folder / "edits.json", EMPTY_EDITS)


_JOBS: dict[str, CaptureJob] = {}
_JOBS_LOCK = threading.Lock()


def _hand_over_gpu() -> None:
    from backend.yolo_pt_model_cache import release_models

    release_models()


def _kill_tree(process: subprocess.Popen[bytes]) -> None:
    """Python adapters start workers (Ollama clients, OpenVINO); end all of them."""
    subprocess.run(
        ["taskkill", "/T", "/F", "/PID", str(process.pid)],
        capture_output=True,
        creationflags=engine.CREATE_NO_WINDOW,
    )
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()


def start_capture(layout: WorkspaceLayout, take_id: str) -> dict[str, Any]:
    folder = take_dir(layout, take_id)
    with _JOBS_LOCK:
        busy = [job for job in _JOBS.values() if job.running]
        if busy:
            raise MocapError(f"Another capture is running ({busy[0].take['name']}). One capture uses the whole GPU.")
        take = _load(folder)
        if take["capture"].get("status") == "ready":
            raise MocapError("This take is already captured. Start a new take to capture again.")
        job = CaptureJob(folder, take)
        _JOBS[str(folder)] = job
        job.thread.start()
    return describe(layout, take_id)


def cancel_capture(layout: WorkspaceLayout, take_id: str) -> dict[str, Any]:
    folder = take_dir(layout, take_id)
    job = _JOBS.get(str(folder))
    if job is None or not job.running:
        raise MocapError("This take is not capturing.")
    job.cancel()
    return describe(layout, take_id)


def cancel_all_captures() -> None:
    """App shutdown: do not leave adapter processes running on the GPU."""
    for job in list(_JOBS.values()):
        if job.running:
            job.cancel()


def wait_for_capture(layout: WorkspaceLayout, take_id: str, timeout: float | None = None) -> None:
    """For tests and scripts."""
    job = _JOBS.get(str(take_dir(layout, take_id)))
    if job is not None:
        job.thread.join(timeout)


# ---------------------------------------------------------------- edits and outputs

_TAKE_LOCKS: dict[str, threading.RLock] = {}
FLUSH_DELAY_SECONDS = 1.5
_DIRTY: set[str] = set()
_FLUSH_TIMERS: dict[str, threading.Timer] = {}


def _take_lock(folder: Path) -> threading.RLock:
    with _JOBS_LOCK:
        return _TAKE_LOCKS.setdefault(str(folder), threading.RLock())


def edits_hash(edits: dict[str, Any]) -> str:
    canonical = json.dumps(edits, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _summary(edits: dict[str, Any], frame_count: int, inferred: list[Any]) -> dict[str, Any]:
    review = edits.get("review") or {}
    return {
        "frameCount": frame_count,
        "corrections": len(edits.get("corrections") or []),
        "reviewMarks": len(review.get("marks") or []),
        "reviewRanges": len(review.get("ranges") or []),
        "inferred": inferred,
        "editsHash": edits_hash(edits),
        "updatedAt": _now(),
    }


def _cameras_source(folder: Path, take: dict[str, Any]) -> Path | None:
    package = folder / "capture" / "motion.amotion"
    return package if take["mode"] == "multiview" and package.is_dir() else None


def _swap_all(folder: Path, stage: Path, names: tuple[str, ...]) -> None:
    """Replace ``folder/name`` with ``stage/name`` for every name, all or nothing."""
    suffix = f".old-{uuid.uuid4().hex[:8]}"
    retired: list[str] = []
    placed: list[str] = []
    try:
        for name in names:
            if (folder / name).exists():
                (folder / name).rename(folder / (name + suffix))
                retired.append(name)
        for name in names:
            (stage / name).rename(folder / name)
            placed.append(name)
    except OSError as error:
        for name in placed:
            (folder / name).rename(stage / name)
        for name in retired:
            (folder / (name + suffix)).rename(folder / name)
        raise MocapError(f"Could not update the take's files (is one open in another program?): {error}") from error
    for name in retired:
        old = folder / (name + suffix)
        if old.is_dir():
            shutil.rmtree(old, ignore_errors=True)
        else:
            old.unlink(missing_ok=True)


def rebuild(folder: Path, take: dict[str, Any], edits: dict[str, Any] | None = None) -> dict[str, Any]:
    """Replay ``edits`` (default: the saved ones) on the refined pose and swap in the outputs.

    The engine validates the edits; on refusal nothing on disk changes.
    """
    refined = folder / "refined.json"
    if not refined.is_file():
        raise MocapError("This take has no captured pose yet.")
    with _take_lock(folder):
        stage = folder / f".staging-{uuid.uuid4().hex[:8]}"
        stage.mkdir()
        try:
            edits_path = folder / "edits.json"
            if edits is not None:
                edits_path = stage / "edits.json"
                _write_json(edits_path, edits)
            args: list[Any] = [
                refined, "--edits", edits_path,
                "--output", stage / "motion.amotion",
                "--pose-output", stage / "pose.json",
                "--review-output", stage / "motion.amotion.areview",
            ]
            profile = take["options"].get("characterProfile")
            if profile:
                args += ["--character-profile", profile]
            cameras = _cameras_source(folder, take)
            if cameras is not None:
                args += ["--cameras-from", cameras]
            result = engine.run_cli("apply-edits", *args)
            used = edits if edits is not None else _read_json(edits_path)
            summary = _summary(used, result["frame_count"], result["inferred"])
            _write_json(stage / "edit-result.json", summary)
            _swap_all(folder, stage, DERIVED_OUTPUTS + (("edits.json",) if edits is not None else ()))
            editor.close(str(folder))
            _DIRTY.discard(str(folder))
            return summary
        finally:
            shutil.rmtree(stage, ignore_errors=True)


def read_edits(layout: WorkspaceLayout, take_id: str) -> dict[str, Any]:
    path = take_dir(layout, take_id) / "edits.json"
    return _read_json(path) if path.is_file() else dict(EMPTY_EDITS)


def _session(folder: Path, take: dict[str, Any]) -> editor.EngineSession:
    """The take's resident engine, started on the saved edits (what the UI shows)."""
    session = editor.get(str(folder))
    if session is not None:
        return session
    refined = folder / "refined.json"
    if not refined.is_file():
        raise MocapError("This take has no captured pose yet.")
    saved = _read_json(folder / "edits.json") if (folder / "edits.json").is_file() else dict(EMPTY_EDITS)
    return editor.open_session(
        str(folder),
        refined=refined,
        edits=saved,
        profile=take["options"].get("characterProfile"),
        cameras_from=_cameras_source(folder, take),
    )


def save_edits(layout: WorkspaceLayout, take_id: str, edits: dict[str, Any]) -> dict[str, Any]:
    """Apply a whole edit session. Returns only the frames that changed since the last edit.

    ``edits.json`` is written once the engine accepts the edits; a refused edit
    changes nothing. The derived files are written by ``flush`` shortly after.
    """
    if not isinstance(edits, dict) or edits.get("version") != 1:
        raise MocapError("Edits must be an edit session, version 1.")
    folder = take_dir(layout, take_id)
    take = _load(folder)
    with _take_lock(folder):
        try:
            reply = _session(folder, take).request(cmd="apply", edits=edits)
        except editor.Refused as error:
            raise MocapError(f"The engine refused these edits: {error}") from error
        except engine.EngineError:
            # A crashed or stopped engine: start a fresh one once and retry.
            editor.close(str(folder))
            reply = _session(folder, take).request(cmd="apply", edits=edits)
        _write_json(folder / "edits.json", edits)
        _DIRTY.add(str(folder))
    _schedule_flush(folder)
    return {
        "inferred": reply["inferred"],
        "pose": reply["pose"],
        "baseline": reply["baseline"],
        "editsHash": edits_hash(edits),
    }


def _schedule_flush(folder: Path) -> None:
    key = str(folder)
    with _JOBS_LOCK:
        previous = _FLUSH_TIMERS.pop(key, None)
        if previous is not None:
            previous.cancel()
        timer = threading.Timer(FLUSH_DELAY_SECONDS, _flush_quietly, args=(folder,))
        timer.daemon = True
        _FLUSH_TIMERS[key] = timer
        timer.start()


def _flush_quietly(folder: Path) -> None:
    try:
        flush(folder)
    except Exception:  # noqa: BLE001 - ensure_current repairs from edits.json on the next read
        pass


def flush(folder: Path) -> None:
    """Write the derived files for the latest accepted edits (from the resident engine)."""
    key = str(folder)
    with _take_lock(folder):
        if key not in _DIRTY:
            return
        session = editor.get(key)
        edits = _read_json(folder / "edits.json")
        if session is None:
            _DIRTY.discard(key)
            rebuild(folder, _load(folder))
            return
        stage = folder / f".staging-{uuid.uuid4().hex[:8]}"
        stage.mkdir()
        try:
            reply = session.request(
                cmd="write",
                output=str(stage / "motion.amotion"),
                pose_output=str(stage / "pose.json"),
                review_output=str(stage / "motion.amotion.areview"),
            )
            _write_json(stage / "edit-result.json", _summary(edits, reply["frame_count"], reply["inferred"]))
            _swap_all(folder, stage, DERIVED_OUTPUTS)
            _DIRTY.discard(key)
        finally:
            shutil.rmtree(stage, ignore_errors=True)


def ensure_current(folder: Path) -> None:
    """Make the derived files match ``edits.json``: flush pending edits, rebuild stale ones."""
    flush(folder)
    edits_path = folder / "edits.json"
    result_path = folder / "edit-result.json"
    if not edits_path.is_file() or not (folder / "refined.json").is_file():
        return
    recorded = _read_json(result_path).get("editsHash") if result_path.is_file() else None
    if recorded != edits_hash(_read_json(edits_path)):
        rebuild(folder, _load(folder))


def flush_all() -> None:
    """App shutdown: write pending edits' outputs, then stop the resident engines."""
    with _JOBS_LOCK:
        timers = list(_FLUSH_TIMERS.values())
        _FLUSH_TIMERS.clear()
    for timer in timers:
        timer.cancel()
    for key in list(_DIRTY):
        _flush_quietly(Path(key))
    editor.close_all()


# ---------------------------------------------------------------- data for the UI


def pose_data(layout: WorkspaceLayout, take_id: str, variant: str = "current") -> dict[str, Any]:
    """A pose sequence as flat arrays the UI can draw directly.

    ``current``: after all edits. ``baseline``: before the joint review rebuild
    (Studio's "原始叠影"). ``refined``: the capture result before any edit.
    """
    folder = take_dir(layout, take_id)
    if variant != "refined":
        ensure_current(folder)
    paths = {
        "current": folder / "pose.json",
        "baseline": folder / "motion.amotion.areview" / "source.json",
        "refined": folder / "refined.json",
    }
    if variant not in paths:
        raise MocapError(f"Unknown pose variant: {variant}")
    path = paths[variant]
    if not path.is_file():
        raise MocapError("This take has no pose yet.")
    document = _read_json(path)
    frames = document["frames"]
    joints = [joint["semantic"] for joint in frames[0]["joints"]] if frames else []
    image, position, confidence, valid = [], [], [], []
    for frame in frames:
        for joint in frame["joints"]:
            image.extend(joint["image_xy"])
            position.extend(joint["position_m"])
            confidence.append(round(float(joint["confidence"]), 4))
            valid.append(1 if joint["valid"] else 0)
    parents: list[int] = []
    skeleton_path = folder / "motion.amotion" / "skeleton.json"
    if skeleton_path.is_file():
        bones = _read_json(skeleton_path)["bones"]
        index_of = {bone["semantic"]: index for index, bone in enumerate(bones)}
        parents = [index_of.get(bone["parent"], -1) if bone["parent"] else -1 for bone in bones]
    inferred: list[list[int]] = []
    edit_result = folder / "edit-result.json"
    if variant == "current" and edit_result.is_file():
        inferred = _read_json(edit_result).get("inferred", [])
    return {
        "variant": variant,
        "fps": document["fps"],
        "width": document["image_width"],
        "height": document["image_height"],
        "backend": document["backend"],
        "joints": joints,
        "parents": parents,
        "times": [frame["time_s"] for frame in frames],
        "image": [round(v, 2) for v in image],
        "position": [round(v, 5) for v in position],
        "confidence": confidence,
        "valid": valid,
        "inferred": inferred,
    }


def issues(layout: WorkspaceLayout, take_id: str) -> list[dict[str, Any]]:
    """Frames the capture flagged for review (NPU shadow comparison), per view."""
    folder = take_dir(layout, take_id)
    take = _load(folder)
    capture = folder / "capture"
    if take["mode"] == "multiview":
        files = [(source["id"], capture / "poses" / source["id"] / "npu-shadow-diagnostics.json") for source in take["sources"]]
    else:
        files = [(take["sources"][0]["id"], capture / "npu-shadow-diagnostics.json")]
    found = []
    for view, path in files:
        try:
            frames = _read_json(path).get("review_frames") or []
        except (OSError, ValueError):
            continue  # diagnostics never decide capture success (Studio rule)
        for frame in frames:
            found.append({
                "view": view,
                "frame": frame.get("frame_index", 0),
                "time": frame.get("time_s", 0.0),
                "invalidJoints": frame.get("invalid_joints", 0),
                "leftRightSwaps": frame.get("left_right_swaps", 0),
                "meanNormalizedError": frame.get("mean_normalized_error"),
                "reasons": [reason for reason in frame.get("reasons") or [] if isinstance(reason, str)],
            })
    return found


def export(layout: WorkspaceLayout, take_id: str, request: dict[str, Any]) -> dict[str, Any]:
    """BVH (cm or m) or VRMA into ``exports/mocap/``; a frame range exports only that range."""
    folder = take_dir(layout, take_id)
    ensure_current(folder)
    package = folder / "motion.amotion"
    if not (package / "manifest.json").is_file():
        raise MocapError("This take has no motion yet.")
    kind = request.get("format")
    if kind not in ("bvh", "vrma", "blender"):
        raise MocapError("Export format must be bvh, vrma or blender.")
    frames = request.get("frames")
    if kind == "blender" and not (
        isinstance(frames, list) and frames and all(isinstance(v, int) and v >= 0 for v in frames)
    ):
        raise MocapError("A Blender export needs the selected frame numbers.")
    if kind == "blender":
        frames = sorted(set(frames))
    unit = request.get("unit", "centimeters")
    if kind == "bvh" and unit not in ("centimeters", "meters"):
        raise MocapError("BVH unit must be centimeters or meters.")
    out_dir = layout.path("exports") / "mocap"
    out_dir.mkdir(parents=True, exist_ok=True)
    take = _load(folder)
    stem = re.sub(r'[<>:"/\\|?*]+', "_", take["name"]).strip(" ._") or take_id
    frame_range = request.get("range")
    if frame_range is not None and not (
        isinstance(frame_range, (list, tuple)) and len(frame_range) == 2 and all(isinstance(v, int) for v in frame_range)
    ):
        raise MocapError("The export range must be [first, last] frame numbers.")
    staging: Path | None = None
    lock = _take_lock(folder)
    lock.acquire()
    try:
        source = package
        if frame_range is not None:
            first, last = (int(v) for v in frame_range)
            staging = layout.path("cache") / "mocap" / f"clip-{uuid.uuid4().hex[:8]}.amotion"
            staging.parent.mkdir(parents=True, exist_ok=True)
            engine.run_cli("trim-motion", package, "--output", staging, "--start-frame", str(first), "--end-frame", str(last))
            source, stem = staging, f"{stem}-f{first}-{last}"
        # Selected-frame exports name the frames' count; the engine requires this suffix.
        extension = "animocap-blender.json" if kind == "blender" else kind
        if kind == "blender":
            stem = f"{stem}-{len(frames)}frames"
        target = out_dir / f"{stem}.{extension}"
        counter = 2
        while target.exists():
            target, counter = out_dir / f"{stem}-{counter}.{extension}", counter + 1
        args: list[Any] = [f"export-{kind}", source, "--output", target]
        if kind == "bvh":
            args += ["--unit", unit]
        if kind == "blender":
            args += ["--frames", ",".join(str(v) for v in frames)]
        result = engine.run_cli(*args)
    except engine.EngineError as error:
        raise MocapError(str(error)) from error
    finally:
        lock.release()
        if staging is not None:
            shutil.rmtree(staging, ignore_errors=True)
    return {"path": str(target), "relativePath": target.relative_to(layout.root).as_posix(), "engine": result}
