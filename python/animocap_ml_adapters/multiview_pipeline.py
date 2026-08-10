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

try:
    from . import mmpose_adapter
except ImportError:  # Script entry point from this directory.
    import mmpose_adapter  # type: ignore[no-redef]


VIEW_IDS = ("front", "right", "back", "left")


def emit(event: str, **values: Any) -> None:
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)


def load_manifest(path: Path) -> dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    mode = document.get("mode")
    if mode not in ("directional_repeat", "synchronized_multiview"):
        raise RuntimeError("multiview pipeline requires a supported multiview mode")
    views = document.get("views")
    if not isinstance(views, list) or not 2 <= len(views) <= 4:
        raise RuntimeError("multiview capture requires two to four views")
    ids = [view.get("id") for view in views]
    if len(ids) != len(set(ids)) or any(not value for value in ids):
        raise RuntimeError("view ids must be present and unique")
    if mode == "directional_repeat":
        for view in views:
            if view.get("yaw_degrees") is None:
                raise RuntimeError(f"view {view.get('id')} requires yaw_degrees")
    elif not document.get("calibration_file"):
        raise RuntimeError("synchronized_multiview requires calibration_file")
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
    if bool(args.anime_pose_config) != bool(args.anime_pose_weights):
        raise RuntimeError(
            "--anime-pose-config and --anime-pose-weights must be provided together"
        )
    root = Path(__file__).resolve().parents[2]
    manifest_path = args.manifest.resolve()
    manifest = load_manifest(manifest_path)
    output = args.output.resolve()
    pose_directory = output / "poses"
    pose_directory.mkdir(parents=True, exist_ok=True)
    rois = load_rois(args.roi_file)
    vlm_adapter = root / "python/animocap_ml_adapters/local_vlm_adapter.py"

    jobs: list[tuple[int, str, Path, Path, Path]] = []
    for view_index, view in enumerate(manifest["views"]):
        view_id = str(view["id"])
        video = resolve_video(manifest_path, str(view["video"]))
        view_output = pose_directory / view_id
        view_output.mkdir(parents=True, exist_ok=True)
        pose_path = view_output / "pose_sequence.json"
        jobs.append((view_index, view_id, video, view_output, pose_path))

    if args.skip_inference:
        for view_index, view_id, video, _view_output, pose_path in jobs:
            emit(
                "view_started",
                view=view_id,
                index=view_index + 1,
                total=len(jobs),
                video=str(video),
            )
            if not pose_path.is_file():
                raise RuntimeError(f"missing precomputed pose for {view_id}: {pose_path}")
            emit("view_finished", view=view_id, pose=str(pose_path))
    else:
        session: mmpose_adapter.MMPoseSession | None = None
        emit("stage_started", view="all", stage="load_shared_pose_models")
        try:
            session = mmpose_adapter.MMPoseSession(
                quality=args.quality,
                segmentation=args.segmentation,
                anime_pose_config=args.anime_pose_config,
                anime_pose_weights=args.anime_pose_weights,
                confidence_calibration=getattr(args, "confidence_calibration", None),
            )
            emit(
                "stage_finished",
                view="all",
                stage="load_shared_pose_models",
                return_code=0,
            )
            for view_index, view_id, video, _view_output, pose_path in jobs:
                emit(
                    "view_started",
                    view=view_id,
                    index=view_index + 1,
                    total=len(jobs),
                    video=str(video),
                )
                emit("stage_started", view=view_id, stage="pose_2d_25d")
                try:
                    roi = tuple(rois[view_id]) if view_id in rois else None
                    session.run(video, pose_path, roi)
                except Exception:
                    emit(
                        "stage_finished",
                        view=view_id,
                        stage="pose_2d_25d",
                        return_code=1,
                    )
                    raise
                emit(
                    "stage_finished",
                    view=view_id,
                    stage="pose_2d_25d",
                    return_code=0,
                )
        finally:
            if session is not None:
                session.close()

        # Release the shared pose models before the optional local VLM starts;
        # both stages are sized to use the same 12 GB GPU sequentially.
        if not args.no_vlm:
            for _view_index, view_id, video, view_output, pose_path in jobs:
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

        for _view_index, view_id, _video, _view_output, pose_path in jobs:
            emit("view_finished", view=view_id, pose=str(pose_path))

    animocap = find_animocap(root, args.animocap)
    motion_output = output / "motion.amotion"
    diagnostics = output / "multiview-diagnostics.json"
    fused_pose = output / "fused_pose_sequence.json"
    if manifest["mode"] == "synchronized_multiview":
        calibration = args.calibration
        if calibration is None:
            calibration = Path(str(manifest["calibration_file"]))
            if not calibration.is_absolute():
                calibration = manifest_path.parent / calibration
        solver = root / "python/animocap_ml_adapters/calibrated_multiview.py"
        command = [
            sys.executable, str(solver), "--manifest", str(manifest_path),
            "--poses", str(pose_directory), "--calibration", str(calibration),
            "--output", str(fused_pose), "--diagnostics", str(diagnostics),
        ]
        if run_streaming(command, root, "all", "calibrated_triangulation") != 0:
            raise RuntimeError("calibrated multiview triangulation failed")
        command = [
            str(animocap), "reconstruct-pose", str(fused_pose),
            "--output", str(motion_output),
        ]
        if run_streaming(command, root, "all", "kinematic_reconstruction") != 0:
            raise RuntimeError("calibrated motion reconstruction failed")
    else:
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
        fused_pose=str(fused_pose),
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--roi-file", type=Path)
    parser.add_argument("--animocap", type=Path)
    parser.add_argument("--calibration", type=Path)
    parser.add_argument("--anime-pose-config", type=Path)
    parser.add_argument("--anime-pose-weights", type=Path)
    parser.add_argument("--confidence-calibration", type=Path)
    parser.add_argument("--vlm-model", default="qwen3-vl:4b")
    parser.add_argument(
        "--quality", choices=("fast", "balanced", "maximum"), default="balanced"
    )
    parser.add_argument(
        "--segmentation", choices=("auto", "grabcut", "sam2"), default="auto"
    )
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
