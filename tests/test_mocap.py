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
    yield layout
    takes.flush_all()  # stop resident engines before the temp folder goes


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
    assert pose["parents"][:3] == [-1, 0, 1] and pose["parents"][pose["joints"].index("leftHand")] == pose["joints"].index("leftLowerArm")
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
        bad = client.post(f"/api/mocap/takes/{take_id}/edits", params=root, json={"version": 2})
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


def test_chinese_workspace_and_video_names(workspace, tmp_path):
    """Owner's recordings often have Chinese names; the engine CLI must keep them intact."""
    layout = create_workspace(tmp_path / "动捕 工作区")
    (layout.media / "舞蹈 第一段.mp4").write_bytes(b"x")
    take = takes.create_take(layout, {"sources": [{"video": "media/舞蹈 第一段.mp4"}]})
    takes.start_capture(layout, take["id"])
    takes.wait_for_capture(layout, take["id"], timeout=120)
    assert takes.describe(layout, take["id"])["capture"]["status"] == "ready"
    edits = {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 5, "dragPx": [3, 1]}]}
    assert takes.save_edits(layout, take["id"], edits)["pose"]["frames"]
    exported = takes.export(layout, take["id"], {"format": "bvh", "range": [0, 9]})
    assert exported["relativePath"] == "exports/mocap/舞蹈 第一段-f0-9.bvh" and Path(exported["path"]).is_file()


def test_retry_after_late_cancel_starts_clean(workspace):
    """A cancel during refining, or closing the app, leaves packages the next run must not collide with."""
    take = takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}]})
    folder = workspace.path("mocap") / take["id"]
    (folder / "capture" / "base.amotion").mkdir(parents=True)
    (folder / "capture" / "base.amotion" / "manifest.json").write_text("{}")
    (folder / "refined.json").write_text("{}")
    record = json.loads((folder / "take.json").read_text(encoding="utf-8"))
    record["capture"] = {"status": "capturing"}  # reads back as "interrupted"
    (folder / "take.json").write_text(json.dumps(record), encoding="utf-8")
    assert takes.describe(workspace, take["id"])["capture"]["status"] == "interrupted"
    takes.start_capture(workspace, take["id"])
    takes.wait_for_capture(workspace, take["id"], timeout=120)
    assert takes.describe(workspace, take["id"])["capture"]["status"] == "ready"


def test_adapters_run_with_utf8_output(workspace, monkeypatch):
    seen = {}
    real_popen = takes.subprocess.Popen

    def spy(args, **kwargs):
        seen.update(kwargs["env"])
        return real_popen(args, **kwargs)

    monkeypatch.setattr(takes.subprocess, "Popen", spy)
    _captured(workspace)
    assert seen["PYTHONUTF8"] == "1" and seen["PYTHONIOENCODING"] == "utf-8"


def test_failed_flush_keeps_the_previous_files_and_recovers(workspace, monkeypatch):
    take_id = _captured(workspace)
    folder = workspace.path("mocap") / take_id
    before = {name: (folder / name).read_bytes() for name in ("pose.json", "edit-result.json")}
    real_rename = Path.rename

    def flaky(self, target):
        # A file held open (export, scanner) makes placing the new pose.json fail.
        if self.name == "pose.json" and ".staging-" in str(self):
            raise PermissionError(5, "Access is denied")
        return real_rename(self, target)

    monkeypatch.setattr(Path, "rename", flaky)
    edits = {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 5, "dragPx": [9, 9]}]}
    takes.save_edits(workspace, take_id, edits)
    assert takes.read_edits(workspace, take_id) == edits  # the user's work is saved at once
    with pytest.raises(takes.MocapError, match="open in another program"):
        takes.flush(folder)
    assert {name: (folder / name).read_bytes() for name in before} == before
    assert (folder / "motion.amotion" / "manifest.json").is_file()
    assert not list(folder.glob("*.old-*")) and not list(folder.glob(".staging-*"))
    monkeypatch.setattr(Path, "rename", real_rename)
    pose = takes.pose_data(workspace, take_id)  # the next read brings the files up to date
    assert json.loads((folder / "edit-result.json").read_text())["editsHash"] == takes.edits_hash(edits)
    assert pose["image"] != json.loads(before["pose.json"])["frames"]


def _apply_delta(pose, delta):
    joints = len(pose["joints"])
    for index, frame in enumerate(delta["frames"]):
        for key, width in (("image", 2), ("position", 3), ("confidence", 1), ("valid", 1)):
            size = joints * width
            pose[key][frame * size:(frame + 1) * size] = delta[key][index * size:(index + 1) * size]


def test_edit_deltas_reproduce_the_saved_result(workspace):
    take_id = _captured(workspace)
    shown = takes.pose_data(workspace, take_id)
    sequence = [
        {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [12, -8]}]},
        {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [12, -8]}, {"joint": 3, "keyframe": 20, "dragPx": [-5, 2]}]},
        dict(takes.EMPTY_EDITS),  # undo everything
        {**takes.EMPTY_EDITS, "corrections": [{"joint": 14, "keyframe": 100, "dragPx": [4, 4], "curve": "hold", "radius": 6}]},
    ]
    for edits in sequence:
        reply = takes.save_edits(workspace, take_id, edits)
        _apply_delta(shown, reply["pose"])
    saved = takes.pose_data(workspace, take_id)
    assert shown["image"] == pytest.approx(saved["image"], abs=0.01)
    assert shown["position"] == pytest.approx(saved["position"], abs=1e-5)
    assert shown["valid"] == saved["valid"]


def test_engine_crash_and_stale_files_are_recovered(workspace):
    take_id = _captured(workspace)
    folder = workspace.path("mocap") / take_id
    first = {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [12, -8]}]}
    takes.save_edits(workspace, take_id, first)
    from backend.mocap import editor

    editor.get(str(folder)).process.kill()  # engine crash between edits
    second = {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [20, -8]}]}
    assert takes.save_edits(workspace, take_id, second)["pose"]["frames"]
    takes.flush_all()
    # edits.json changed behind the app's back (another computer, a crash before flush).
    third = {**takes.EMPTY_EDITS, "corrections": [{"joint": 10, "keyframe": 60, "dragPx": [-30, 0]}]}
    (folder / "edits.json").write_text(json.dumps(third), encoding="utf-8")
    pose = takes.pose_data(workspace, take_id)
    refined = takes.pose_data(workspace, take_id, "refined")
    k = (60 * 23 + 10) * 2
    assert pose["image"][k] == pytest.approx(refined["image"][k] - 30, abs=0.02)


def test_small_request_checks(workspace):
    with pytest.raises(takes.MocapError, match="twice"):
        takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4", "yaw": 0}, {"video": "media/dance.mp4", "yaw": 90}]})
    take_id = _captured(workspace)
    with pytest.raises(takes.MocapError, match="first, last"):
        takes.export(workspace, take_id, {"format": "bvh", "range": [1, 2, 3]})


def test_progress_ignores_diagnostics_after_the_last_frame(tmp_path):
    log = tmp_path / "pose.log"
    log.write_text(
        '{"event": "progress", "frame": 100, "total": 100}\n'
        '{"event": "fusion_diagnostics", "x": 1}\n{"event": "warning", "message": "slow"}\n'
        '{"event": "expert_schedule", "interval": "2"}\n'
    )
    state = progress.single_view(progress.read_log(log), progress.LogState(), vlm_enabled=False)
    assert state["stage"] == "pose" and state["fraction"] == pytest.approx(0.86)


def test_person_frame_and_blender_frames(workspace):
    take = takes.create_take(workspace, {"sources": [{"video": "media/dance.mp4"}]})
    updated = takes.update_options(workspace, take["id"], {"roi": [100.4, 50, 300, 600]})
    assert updated["options"]["roi"] == [100, 50, 300, 600] and updated["options"]["expertInterval"] == "2"
    with pytest.raises(takes.MocapError, match="person frame"):
        takes.update_options(workspace, take["id"], {"roi": [0, 0, -1, 5]})
    takes.start_capture(workspace, take["id"])
    takes.wait_for_capture(workspace, take["id"], timeout=120)
    log = (workspace.path("mocap") / take["id"] / "logs" / "pose.log").read_text()
    assert takes.describe(workspace, take["id"])["capture"]["status"] == "ready", log
    with pytest.raises(takes.MocapError, match="before a take is captured"):
        takes.update_options(workspace, take["id"], {"roi": None})
    exported = takes.export(workspace, take["id"], {"format": "blender", "frames": [40, 3, 3, 10]})
    assert exported["relativePath"] == "exports/mocap/dance-3frames.animocap-blender.json"
    document = json.loads(Path(exported["path"]).read_text(encoding="utf-8"))
    assert len(document["selected_frames"]) == 3
    with pytest.raises(takes.MocapError, match="selected frame"):
        takes.export(workspace, take["id"], {"format": "blender", "frames": []})
