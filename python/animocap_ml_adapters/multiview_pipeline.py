#!/usr/bin/env python3
"""Local four-direction capture orchestration.

Each view is inferred independently only to produce observations. The final
motion is created by the C++ phase-aligned joint multiview solver, never by
averaging independently reconstructed motions.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


VIEW_IDS = ("front", "right", "back", "left")


def emit(event: str, **values: Any) -> None:
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)


def load_manifest(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("mode") != "directional_repeat":
        raise RuntimeError("multiview pipeline requires directional_repeat mode")
    views = document.get("views")
    if not isinstance(views, list) or not 2 <= len(views) <= 4:
        raise RuntimeError("directional_repeat requires two to four views")
    ids = [view.get("id") for view in views]
    if len(ids) != len(set(ids)) or any(not value for value in ids):
        raise RuntimeError("view ids must be present and unique")
    for view in views:
        if view.get("yaw_degrees") is None:
            raise RuntimeError(f"view {view.get('id')} requires yaw_degrees")
    return document


def resolve_video(manifest_path: Path, value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = manifest_path.parent / path
    path = path.resolve()
    if not path.is_file():
        raise RuntimeError(f"view video does not exist: {path}")
    return path


def find_animocap(root: Path, explicit: Path | None) -> Path:
    if explicit:
        if not explicit.is_file():
            raise RuntimeError(f"animocap executable does not exist: {explicit}")
        return explicit.resolve()
    candidates = [
        root / "build/windows-nmake/animocap.exe",
        root / "build/windows-ninja/animocap.exe",
    ]
    existing = [path for path in candidates if path.is_file()]
    if not existing:
        raise RuntimeError("animocap.exe is not built; run tools/build_msvc.ps1")
    return max(existing, key=lambda path: path.stat().st_mtime)


def run_streaming(command: list[str], cwd: Path, view_id: str, stage: str) -> int:
    emit("stage_started", view=view_id, stage=stage)
    creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        creationflags=creation_flags,
    )
    assert process.stdout is not None
    for line in process.stdout:
        line = line.strip()
        if line:
            emit("stage_output", view=view_id, stage=stage, message=line)
    return_code = process.wait()
    emit("stage_finished", view=view_id, stage=stage, return_code=return_code)
    return return_code


def load_rois(path: Path | None) -> dict[str, list[int]]:
    if path is None:
        return {}
    document = json.loads(path.read_text(encoding="utf-8"))
    result: dict[str, list[int]] = {}
    for view_id, roi in document.items():
        if (
            not isinstance(roi, list)
            or len(roi) != 4
            or not all(isinstance(value, int) for value in roi)
            or roi[2] < 2
            or roi[3] < 2
        ):
            raise RuntimeError(f"invalid ROI for {view_id}; expected [x,y,width,height]")
        result[view_id] = roi
    return result


def run_pipeline(args: argparse.Namespace) -> int:
    root = Path(__file__).resolve().parents[2]
    manifest_path = args.manifest.resolve()
    manifest = load_manifest(manifest_path)
    output = args.output.resolve()
    pose_directory = output / "poses"
    pose_directory.mkdir(parents=True, exist_ok=True)
    rois = load_rois(args.roi_file)
    mmpose_adapter = root / "python/animocap_ml_adapters/mmpose_adapter.py"
    vlm_adapter = root / "python/animocap_ml_adapters/local_vlm_adapter.py"

    for view_index, view in enumerate(manifest["views"]):
        view_id = str(view["id"])
        video = resolve_video(manifest_path, str(view["video"]))
        view_output = pose_directory / view_id
        view_output.mkdir(parents=True, exist_ok=True)
        pose_path = view_output / "pose_sequence.json"
        emit(
            "view_started",
            view=view_id,
            index=view_index + 1,
            total=len(manifest["views"]),
            video=str(video),
        )
        if not args.skip_inference:
            command = [
                sys.executable,
                str(mmpose_adapter),
                "--input",
                str(video),
                "--output",
                str(pose_path),
            ]
            if view_id in rois:
                command.extend(["--roi", *(str(value) for value in rois[view_id])])
            if run_streaming(command, root, view_id, "pose_2d_25d") != 0:
                raise RuntimeError(f"pose inference failed for {view_id}")
            if not args.no_vlm:
                corrected = view_output / "pose_sequence-vlm.json"
                issues = view_output / "visual-recovery-issues.json"
                command = [
                    sys.executable,
                    str(vlm_adapter),
                    "--input-video",
                    str(video),
                    "--input-pose",
                    str(pose_path),
                    "--output-pose",
                    str(corrected),
                    "--issues-output",
                    str(issues),
                    "--model",
                    args.vlm_model,
                ]
                if view_id in rois:
                    command.extend(["--roi", *(str(value) for value in rois[view_id])])
                if run_streaming(command, root, view_id, "local_visual_recovery") == 0:
                    os.replace(corrected, pose_path)
                else:
                    emit(
                        "warning",
                        view=view_id,
                        message="local VLM unavailable; retaining HRNet + flow observations",
                    )
        elif not pose_path.is_file():
            raise RuntimeError(f"missing precomputed pose for {view_id}: {pose_path}")
        emit("view_finished", view=view_id, pose=str(pose_path))

    animocap = find_animocap(root, args.animocap)
    motion_output = output / "motion.amotion"
    diagnostics = output / "multiview-diagnostics.json"
    command = [
        str(animocap),
        "fuse-multiview",
        str(manifest_path),
        "--poses",
        str(pose_directory),
        "--output",
        str(motion_output),
        "--diagnostics",
        str(diagnostics),
    ]
    if run_streaming(command, root, "all", "phase_align_and_joint_solve") != 0:
        raise RuntimeError("multiview joint solve failed")
    emit(
        "complete",
        output=str(output),
        motion=str(motion_output),
        diagnostics=str(diagnostics),
        fused_pose=str(output / "fused_pose_sequence.json"),
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--roi-file", type=Path)
    parser.add_argument("--animocap", type=Path)
    parser.add_argument("--vlm-model", default="qwen3-vl:4b")
    parser.add_argument("--no-vlm", action="store_true")
    parser.add_argument("--skip-inference", action="store_true")
    args = parser.parse_args()
    try:
        return run_pipeline(args)
    except Exception as error:  # noqa: BLE001 - CLI boundary
        emit("error", message=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
