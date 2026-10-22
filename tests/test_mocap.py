"""Motion-capture takes: the capture job, edits and exports against the real engine.

The ML adapter is replaced by a fake that writes the same JSON-line log and pose
file; everything after it (reconstruct-pose, apply-edits, export) is the built
engine. Skipped when the engine is not built on this computer.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

from backend.mocap import engine, progress, takes
from backend.workspace_layout import create_workspace

pytestmark = pytest.mark.skipif(not engine.engine_exe().is_file(), reason="AniMocap engine is not built")

FAKE_ADAPTER = textwrap.dedent(
    '''
    import argparse, json, os, shutil, sys, time
    parser = argparse.ArgumentParser()
    parser.add_argument("--input"); parser.add_argument("--output")
    parser.add_argument("--roi", nargs=4)
    args, _ = parser.parse_known_args()
    template = json.load(open(os.environ["FAKE_POSE_TEMPLATE"], encoding="utf-8"))
    delay = float(os.environ.get("FAKE_DELAY", "0"))
    total = len(template["frames"])
    for frame in range(1, total + 1, 50):
        print(json.dumps({"event": "progress", "frame": frame, "total": total}), flush=True)
        time.sleep(delay)
    if os.environ.get("FAKE_FAIL"):
        print(json.dumps({"event": "error", "message": "model exploded"}), flush=True)
        sys.exit(3)
    template["source_video"] = args.input
    json.dump(template, open(args.output, "w", encoding="utf-8"))
    print(json.dumps({"event": "complete"}), flush=True)
    '''
)


def _pose_template(path: Path, frames: int = 120) -> None:
    fixture = path.parent / "fixture"
    subprocess.run([str(engine.engine_exe()), "generate-fixture", "--output", str(fixture), "--frames", "8"], check=True, capture_output=True)
    bones = json.loads((fixture / "motion.amotion" / "skeleton.json").read_text())["bones"]
    index_of = {bone["semantic"]: i for i, bone in enumerate(bones)}
    rest: list[list[float]] = []
    for bone in bones:
        base = rest[index_of[bone["parent"]]] if bone["parent"] else [0.0, 0.9, 0.0]
        rest.append([base[i] + bone["rest_offset_m"][i] for i in range(3)])
    document = {"schema_version": json.loads((fixture / "motion.amotion" / "skeleton.json").read_text())["schema_version"],
                "source_video": "", "backend": "fake", "image_width": 1280, "image_height": 720, "fps": 30.0, "frames": []}
    for f in range(frames):
        joints = []
        for i, bone in enumerate(bones):
            x, y, z = rest[i]
            x += 0.05 * math.sin(2 * math.pi * f / 30 + i * 0.3) + 0.004 * math.sin(f * 1.7 + i)
            joints.append({"semantic": bone["semantic"], "image_xy": [640 + x * 300, 700 - y * 300],
                           "position_m": [x, y, z], "confidence": 0.9, "valid": True})
        document["frames"].append({"time_s": f / 30.0, "joints": joints})
    path.write_text(json.dumps(document))


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    adapters = tmp_path / "adapters"
    adapters.mkdir()
    (adapters / "mmpose_adapter.py").write_text(FAKE_ADAPTER)
    (adapters / "local_vlm_adapter.py").write_text("import sys; sys.exit(1)\n")  # VLM not configured
    template = tmp_path / "template.json"
    _pose_template(template)
    monkeypatch.setattr(engine, "adapters_dir", lambda: adapters)
    monkeypatch.setattr(engine, "python_exe", lambda: Path(sys.executable))
    monkeypatch.setenv("FAKE_POSE_TEMPLATE", str(template))
    monkeypatch.setattr(takes, "_hand_over_gpu", lambda: None)
    layout = create_workspace(tmp_path / "ws")
    (layout.media / "dance.mp4").write_bytes(b"not decoded by the fake adapter")
    return layout


def _captured(layout, **options) -> str:
    take = takes.create_take(layout, {"sources": [{"video": "media/dance.mp4"}], "options": options})
    takes.start_capture(layout, take["id"])
    takes.wait_for_capture(layout, take["id"], timeout=120)
    return take["id"]


def test_create_take_validates_inputs(workspace, tmp_path):
    outside = tmp_path / "outside.mp4"
    outside.write_bytes(b"x")
    with pytest.raises(takes.MocapError, match="inside the workspace"):
        takes.create_take(workspace, {"sources": [{"video": str(outside)}]})
    with pytest.raises(takes.MocapError, match="direction"):
        takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}, {"video": "media/dance.mp4"}]})
    with pytest.raises(takes.MocapError, match="person frame"):
        takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}], "options": {"roi": [1, 2, 0, 4]}})
    take = takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}]})
    assert take["capture"]["status"] == "new" and take["mode"] == "single"
    assert takes.read_edits(workspace, take["id"]) == takes.EMPTY_EDITS


def test_capture_builds_refined_pose_and_motion(workspace):
    take_id = _captured(workspace, vlm=True)
    take = takes.describe(workspace, take_id)
    assert take["capture"]["status"] == "ready", take["capture"]
    assert take["capture"]["warning"] == "vlm_skipped"  # Studio keeps the base result
    assert take["hasMotion"] and take["edits"]["frameCount"] == 120
    folder = workspace.path("mocap") / take_id
    refined = json.loads((folder / "refined.json").read_text())
    assert refined["backend"] == "fake+temporal-smooth5+kinematic-opt-v2"
    pose = takes.pose_data(workspace, take_id)
    assert len(pose["times"]) == 120 and len(pose["joints"]) == 23
    assert len(pose["image"]) == 120 * 23 * 2 and len(pose["position"]) == 120 * 23 * 3
    # With no edits the current pose is the refined pose.
    assert takes.pose_data(workspace, take_id, "refined")["image"] == pose["image"]
    log = (folder / "logs" / "pose.log").read_text()
    assert '"event": "complete"' in log


def test_edits_replay_and_refusals_leave_files_alone(workspace):
    take_id = _captured(workspace)
    folder = workspace.path("mocap") / take_id
    edits = {
        "version": 1,
        "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [12, -8], "curve": "smooth"}],
        "smoothedKeyframes": [],
        "review": {
            "marks": [
                {"frame": 60, "joint": 10, "trust": "locked"},
                {"frame": 80, "joint": 10, "trust": "locked"},
                {"frame": 70, "joint": 10, "trust": "excluded"},
            ],
            "ranges": [[60, 80, 10]],
        },
    }
    result = takes.save_edits(workspace, take_id, edits)
    assert result["inferred"] == [[70, 10]]
    assert takes.read_edits(workspace, take_id) == edits
    pose = takes.pose_data(workspace, take_id)
    refined = takes.pose_data(workspace, take_id, "refined")
    k = (60 * 23 + 10) * 2
    assert pose["image"][k] == pytest.approx(refined["image"][k] + 12, abs=0.02)
    assert pose["inferred"] == [[70, 10]]
    assert (folder / "motion.amotion.areview" / "review.json").is_file()

    before = (folder / "pose.json").read_bytes()
    broken = {**edits, "review": {"marks": [{"frame": 70, "joint": 10, "trust": "excluded"}], "ranges": [[60, 80, 10]]}}
    with pytest.raises(takes.MocapError, match="refused"):
        takes.save_edits(workspace, take_id, broken)
    assert takes.read_edits(workspace, take_id) == edits
    assert (folder / "pose.json").read_bytes() == before
    assert not list(folder.glob(".staging-*")) and not list(folder.glob("*.old-*"))


def test_export_whole_take_and_range(workspace):
    take_id = _captured(workspace)
    whole = takes.export(workspace, take_id, {"format": "bvh"})
    clip = takes.export(workspace, take_id, {"format": "bvh", "unit": "meters", "range": [10, 39]})
    vrma = takes.export(workspace, take_id, {"format": "vrma"})
    assert whole["relativePath"] == "exports/mocap/dance.bvh"
    assert clip["relativePath"] == "exports/mocap/dance-f10-39.bvh"
    assert Path(vrma["path"]).stat().st_size > 0
    frames = [line for line in Path(clip["path"]).read_text().splitlines() if line.startswith("Frames:")]
    assert frames == ["Frames: 30"]
    again = takes.export(workspace, take_id, {"format": "bvh"})
    assert again["relativePath"] == "exports/mocap/dance-2.bvh"  # never overwrites


def test_failed_and_cancelled_captures_are_recorded(workspace, monkeypatch):
    monkeypatch.setenv("FAKE_FAIL", "1")
    failed = takes.describe(workspace, _captured(workspace))
    assert failed["capture"]["status"] == "failed" and "model exploded" in failed["capture"]["error"]
    monkeypatch.delenv("FAKE_FAIL")

    monkeypatch.setenv("FAKE_DELAY", "2")
    take = takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}]})
    takes.start_capture(workspace, take["id"])
    deadline = time.monotonic() + 30
    while takes.describe(workspace, take["id"])["capture"].get("stage") != "pose" and time.monotonic() < deadline:
        time.sleep(0.2)
    running = takes.describe(workspace, take["id"])["capture"]
    assert running["status"] == "capturing" and running["total"] == 120
    with pytest.raises(takes.MocapError, match="Another capture"):
        other = takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}]})
        takes.start_capture(workspace, other["id"])
    takes.cancel_capture(workspace, take["id"])
    takes.wait_for_capture(workspace, take["id"], timeout=30)
    cancelled = takes.describe(workspace, take["id"])
    assert cancelled["capture"]["status"] == "cancelled" and not cancelled["hasMotion"]
    assert (workspace.path("mocap") / take["id"] / "logs" / "pose.log").is_file()  # intermediate output kept


def test_missing_environment_is_reported_not_worked_around(workspace, monkeypatch, tmp_path):
    monkeypatch.setattr(engine, "python_exe", lambda: tmp_path / "missing" / "python.exe")
    take = takes.describe(workspace, _captured(workspace))
    assert take["capture"]["status"] == "failed" and ".venv-mmpose" in take["capture"]["error"]


def test_progress_matches_studio_weights(tmp_path):
    log = tmp_path / "pose.log"
    log.write_text('not json\n{"event": "progress", "frame": 50, "total": 100}\n')
    state = progress.single_view(progress.read_log(log), progress.LogState(), vlm_enabled=False)
    assert state["stage"] == "pose" and state["fraction"] == pytest.approx(0.04 + 0.82 * 0.5)
    log.write_text('{"event": "view_started", "view": "right", "index": 2, "total": 3}\n{"event": "progress", "frame": 25, "total": 100}\n')
    state = progress.multiview(progress.read_log(log), ["front", "right", "left"])
    assert state["viewIndex"] == 2 and state["fraction"] == pytest.approx(0.02 + 0.78 * (1.25 / 3))


def test_api_round_trip(workspace):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend_api import mocap

    app = FastAPI()
    app.include_router(mocap.router)
    root = {"workspaceRoot": str(workspace.root)}
    with TestClient(app) as client:
        status = client.get("/api/mocap/status").json()
        assert status["engine"]["built"] and status["environment"]["present"] is not None
        created = client.post("/api/mocap/takes", params=root, json={"sources": [{"video": "media/dance.mp4"}]})
        assert created.status_code == 200
        take_id = created.json()["id"]
        assert client.post(f"/api/mocap/takes/{take_id}/capture", params=root).status_code == 200
        takes.wait_for_capture(workspace, take_id, timeout=120)
        listed = client.get("/api/mocap/takes", params=root).json()["takes"]
        assert [t["id"] for t in listed] == [take_id] and listed[0]["capture"]["status"] == "ready"
        assert len(client.get(f"/api/mocap/takes/{take_id}/pose", params=root).json()["times"]) == 120
        assert client.get(f"/api/mocap/takes/{take_id}/issues", params=root).json() == {"issues": []}
        bad = client.put(f"/api/mocap/takes/{take_id}/edits", params=root, json={"version": 2})
        assert bad.status_code == 400 and "version 1" in bad.json()["detail"]
        assert client.get("/api/mocap/takes/../etc", params=root).status_code in (400, 404)
        assert client.get("/api/mocap/takes/nope", params=root).status_code == 400
        exported = client.post(f"/api/mocap/takes/{take_id}/export", params=root, json={"format": "vrma"})
        assert exported.json()["relativePath"] == "exports/mocap/dance.vrma"


def test_setup_opens_a_visible_console(monkeypatch):
    opened = []
    monkeypatch.setattr(engine.subprocess, "Popen", lambda args, **kwargs: opened.append((args, kwargs)))
    assert engine.open_setup("mmpose")["started"] == "mmpose"
    args, kwargs = opened[0]
    assert args[-1].endswith("setup_mmpose.ps1") and "-NoExit" in args
    assert kwargs["creationflags"] == getattr(subprocess, "CREATE_NEW_CONSOLE", 0)
    with pytest.raises(engine.EngineError):
        engine.open_setup("../evil")
