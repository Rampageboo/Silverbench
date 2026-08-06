"""Low-frequency local VLM recovery for ambiguous AniMocap pose frames.

The adapter talks only to a local Ollama server. It never uploads media and it
never replaces stable HRNet observations. Qwen3-VL is asked for image-space
grounding on a small set of ambiguous frames; every proposed correction is
bounded and validated before it can enter the pose sequence.
"""

from __future__ import annotations

import argparse
import base64
import copy
import json
import math
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_ENDPOINT = "http://127.0.0.1:11434"
DEFAULT_MODEL = "qwen3-vl:4b"
LIMB_JOINTS = {
    "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand",
    "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
}
GROUNDING_JOINTS = [
    "head", "neck", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand", "hips",
    "leftUpperLeg", "leftLowerLeg", "leftFoot", "rightUpperLeg",
    "rightLowerLeg", "rightFoot",
]


def _request_json(url: str, payload: dict[str, Any] | None = None,
                  timeout: float = 120.0) -> dict[str, Any]:
    body = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def check_ollama(endpoint: str, model: str) -> tuple[bool, str]:
    try:
        tags = _request_json(endpoint.rstrip("/") + "/api/tags", timeout=5.0)
    except (OSError, urllib.error.URLError, json.JSONDecodeError) as error:
        return False, f"local Ollama is unavailable: {error}"
    installed = {
        item.get("name", "").split(":latest")[0]
        for item in tags.get("models", [])
    }
    wanted = model.split(":latest")[0]
    if wanted not in installed:
        return False, f"local model {model} is not installed"
    return True, f"{model} ready"


def _joint_map(frame: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {joint["semantic"]: joint for joint in frame.get("joints", [])}


def _distance(a: list[float], b: list[float]) -> float:
    return math.hypot(float(a[0]) - float(b[0]), float(a[1]) - float(b[1]))


def _candidate_frames(document: dict[str, Any], maximum: int) -> list[int]:
    frames = document.get("frames", [])
    if not frames:
        return []
    diagonal = math.hypot(
        float(document.get("image_width", 1)),
        float(document.get("image_height", 1)),
    )
    scored: list[tuple[float, int]] = []
    for index, frame in enumerate(frames):
        joints = _joint_map(frame)
        limb = [joints[name] for name in LIMB_JOINTS if name in joints]
        low_confidence = sum(max(0.0, 0.62 - float(j.get("confidence", 0.0)))
                             for j in limb)
        spike = 0.0
        if 0 < index < len(frames) - 1:
            previous = _joint_map(frames[index - 1])
            following = _joint_map(frames[index + 1])
            for name in LIMB_JOINTS:
                if name not in joints or name not in previous or name not in following:
                    continue
                expected = [
                    (previous[name]["image_xy"][0] + following[name]["image_xy"][0]) * 0.5,
                    (previous[name]["image_xy"][1] + following[name]["image_xy"][1]) * 0.5,
                ]
                residual = _distance(joints[name]["image_xy"], expected)
                spike += max(0.0, residual / max(diagonal, 1.0) - 0.012)
        score = low_confidence + spike * 8.0
        if score > 0.08:
            scored.append((score, index))

    # Always validate the first frame as the semantic left/right reference.
    chosen = [0]
    for _, index in sorted(scored, reverse=True):
        if all(abs(index - existing) > 2 for existing in chosen):
            chosen.append(index)
        if len(chosen) >= maximum:
            break
    return sorted(chosen)


def _effective_roi(document: dict[str, Any],
                   roi: tuple[int, int, int, int] | None) -> tuple[int, int, int, int]:
    width = int(document.get("image_width", 1))
    height = int(document.get("image_height", 1))
    if roi is not None:
        x, y, w, h = roi
        left = max(0, min(width - 2, x))
        top = max(0, min(height - 2, y))
        return left, top, max(2, min(width - left, w)), max(2, min(height - top, h))

    points: list[list[float]] = []
    for frame in document.get("frames", [])[::max(1, len(document.get("frames", [])) // 12)]:
        for joint in frame.get("joints", []):
            if joint.get("semantic") in GROUNDING_JOINTS and joint.get("valid", True):
                points.append(joint["image_xy"])
    if not points:
        return 0, 0, width, height
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    body_width = max(40.0, max(xs) - min(xs))
    body_height = max(80.0, max(ys) - min(ys))
    margin_x = body_width * 0.35
    margin_y = body_height * 0.18
    left = max(0, int(min(xs) - margin_x))
    top = max(0, int(min(ys) - margin_y))
    right = min(width, int(max(xs) + margin_x))
    bottom = min(height, int(max(ys) + margin_y))
    return left, top, max(2, right - left), max(2, bottom - top)


def _ground_frame(frame: Any, roi: tuple[int, int, int, int],
                  endpoint: str, model: str) -> dict[str, list[float]]:
    import cv2

    x, y, width, height = roi
    crop = frame[y:y + height, x:x + width]
    ok, encoded = cv2.imencode(
        ".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), 88]
    )
    if not ok:
        raise RuntimeError("cannot encode VLM recovery frame")
    image = base64.b64encode(encoded.tobytes()).decode("ascii")
    prompt = (
        "Locate the visible humanoid body joints in this anime/game frame. "
        "Ignore wings, weapons, clothing tails, pets, UI and shadows. "
        "Return JSON only as {\"joints\":{\"head\":[x,y],...},"
        "\"uncertain\":[\"jointName\"]}. Coordinates are integers from 0 to "
        "1000 relative to this crop. Use anatomical left/right from the "
        "character's own perspective. Required joint names: "
        + ", ".join(GROUNDING_JOINTS)
    )
    response = _request_json(
        endpoint.rstrip("/") + "/api/chat",
        {
            "model": model,
            "stream": False,
            "format": "json",
            "messages": [{
                "role": "user",
                "content": prompt,
                "images": [image],
            }],
            "options": {"temperature": 0, "num_predict": 900},
        },
    )
    content = response.get("message", {}).get("content", "")
    parsed = json.loads(content)
    uncertain = set(parsed.get("uncertain", []))
    result: dict[str, list[float]] = {}
    for name, point in parsed.get("joints", {}).items():
        if name not in GROUNDING_JOINTS or name in uncertain:
            continue
        if not isinstance(point, list) or len(point) != 2:
            continue
        nx, ny = float(point[0]), float(point[1])
        if 0.0 <= nx <= 1000.0 and 0.0 <= ny <= 1000.0:
            result[name] = [x + nx * width / 1000.0, y + ny * height / 1000.0]
    return result


def _load_mock(path: Path | None) -> dict[int, dict[str, list[float]]]:
    if path is None:
        return {}
    document = json.loads(path.read_text(encoding="utf-8-sig"))
    return {int(index): value for index, value in document.items()}


def _is_ambiguous(frames: list[dict[str, Any]], index: int, name: str,
                  diagonal: float) -> bool:
    joint = _joint_map(frames[index]).get(name)
    if joint is None or float(joint.get("confidence", 0.0)) < 0.66:
        return True
    if 0 < index < len(frames) - 1:
        previous = _joint_map(frames[index - 1]).get(name)
        following = _joint_map(frames[index + 1]).get(name)
        if previous and following:
            expected = [
                (previous["image_xy"][0] + following["image_xy"][0]) * 0.5,
                (previous["image_xy"][1] + following["image_xy"][1]) * 0.5,
            ]
            return _distance(joint["image_xy"], expected) > diagonal * 0.035
    return index == 0


def _apply_grounding(document: dict[str, Any], frame_index: int,
                     proposals: dict[str, list[float]],
                     roi: tuple[int, int, int, int]) -> list[str]:
    frames = document["frames"]
    joints = _joint_map(frames[frame_index])
    diagonal = math.hypot(roi[2], roi[3])
    accepted: list[str] = []
    for name, proposal in proposals.items():
        if name not in joints or not _is_ambiguous(frames, frame_index, name, diagonal):
            continue
        current = joints[name]["image_xy"]
        displacement = _distance(current, proposal)
        if displacement > diagonal * 0.18:
            continue
        blend = 0.68 if float(joints[name].get("confidence", 0.0)) < 0.5 else 0.45
        delta = [
            (proposal[0] - current[0]) * blend,
            (proposal[1] - current[1]) * blend,
        ]
        for offset, weight in ((-2, 0.2), (-1, 0.5), (0, 1.0), (1, 0.5), (2, 0.2)):
            target_index = frame_index + offset
            if not 0 <= target_index < len(frames):
                continue
            target = _joint_map(frames[target_index]).get(name)
            if target is None:
                continue
            target["image_xy"][0] += delta[0] * weight
            target["image_xy"][1] += delta[1] * weight
            target["confidence"] = max(float(target.get("confidence", 0.0)), 0.58)
        accepted.append(name)
    return accepted


def _refresh_planar_positions(document: dict[str, Any]) -> None:
    for frame in document.get("frames", []):
        joints = _joint_map(frame)
        hips = joints.get("hips")
        head = joints.get("head")
        feet = [joints.get("leftFoot"), joints.get("rightFoot")]
        if not hips or not head or not all(feet):
            continue
        foot_y = max(float(foot["image_xy"][1]) for foot in feet if foot)
        body_pixels = max(80.0, foot_y - float(head["image_xy"][1]))
        meters_per_pixel = 1.68 / body_pixels
        hips_x, hips_y = map(float, hips["image_xy"])
        base_y = float(hips.get("position_m", [0.0, 0.95, 0.0])[1])
        for joint in frame.get("joints", []):
            point = joint.get("image_xy")
            position = joint.get("position_m")
            if not point or not position or len(position) != 3:
                continue
            position[0] = (float(point[0]) - hips_x) * meters_per_pixel
            position[1] = base_y + (hips_y - float(point[1])) * meters_per_pixel


def run(input_video: Path, input_pose: Path, output_pose: Path,
        endpoint: str, model: str, roi: tuple[int, int, int, int] | None,
        maximum: int, mock_response: Path | None,
        issues_output: Path | None) -> None:
    import cv2

    original = json.loads(input_pose.read_text(encoding="utf-8"))
    document = copy.deepcopy(original)
    frames = document.get("frames", [])
    if not frames:
        raise RuntimeError("pose sequence has no frames")
    candidates = _candidate_frames(document, maximum)
    effective_roi = _effective_roi(document, roi)
    mocks = _load_mock(mock_response)
    if mock_response is None:
        ready, message = check_ollama(endpoint, model)
        if not ready:
            raise RuntimeError(message)

    capture = cv2.VideoCapture(str(input_video))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open video: {input_video}")

    issues: list[dict[str, Any]] = []
    for position, frame_index in enumerate(candidates, start=1):
        if frame_index in mocks:
            proposals = mocks[frame_index]
        else:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
            ok, frame = capture.read()
            if not ok:
                continue
            proposals = _ground_frame(frame, effective_roi, endpoint, model)
        accepted = _apply_grounding(document, frame_index, proposals, effective_roi)
        issues.append({
            "frame": frame_index,
            "time_s": frames[frame_index].get("time_s", 0.0),
            "proposed": sorted(proposals),
            "accepted": sorted(accepted),
        })
        print(json.dumps({
            "event": "vlm_progress", "item": position, "total": len(candidates),
            "frame": frame_index, "accepted": len(accepted),
        }), flush=True)
    capture.release()

    if any(issue["accepted"] for issue in issues):
        _refresh_planar_positions(document)
        backend = str(document.get("backend", "pose"))
        if "+qwen3-vl-local" not in backend:
            document["backend"] = backend + "+qwen3-vl-local"
    output_pose.parent.mkdir(parents=True, exist_ok=True)
    output_pose.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    if issues_output is not None:
        issues_output.parent.mkdir(parents=True, exist_ok=True)
        issues_output.write_text(
            json.dumps({"model": model, "roi": effective_roi, "issues": issues},
                       ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-video", type=Path)
    parser.add_argument("--input-pose", type=Path)
    parser.add_argument("--output-pose", type=Path)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--roi", nargs=4, type=int, metavar=("X", "Y", "WIDTH", "HEIGHT"))
    parser.add_argument("--max-frames", type=int, default=12)
    parser.add_argument("--mock-response", type=Path)
    parser.add_argument("--issues-output", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        if args.check:
            ready, message = check_ollama(args.endpoint, args.model)
            print(json.dumps({"event": "ready" if ready else "unavailable",
                              "model": args.model, "message": message}), flush=True)
            return 0 if ready else 2
        if args.input_video is None or args.input_pose is None or args.output_pose is None:
            parser.error("--input-video, --input-pose and --output-pose are required")
        roi = tuple(args.roi) if args.roi is not None else None
        run(args.input_video, args.input_pose, args.output_pose, args.endpoint,
            args.model, roi, max(1, args.max_frames), args.mock_response,
            args.issues_output)
        print(json.dumps({"event": "complete",
                          "output": str(args.output_pose)}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}),
              file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())