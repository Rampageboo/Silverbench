"""Export corrected AniMocap observations as a private COCO keypoint dataset."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

COCO_KEYPOINTS = [
    "nose", "left_eye", "right_eye", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
]
CANONICAL_TO_COCO = {
    0: "head",
    5: "leftShoulder", 6: "rightShoulder",
    7: "leftLowerArm", 8: "rightLowerArm",
    9: "leftHand", 10: "rightHand",
    11: "leftUpperLeg", 12: "rightUpperLeg",
    13: "leftLowerLeg", 14: "rightLowerLeg",
    15: "leftFoot", 16: "rightFoot",
}
SKELETON = [
    [16, 14], [14, 12], [17, 15], [15, 13], [12, 13],
    [6, 12], [7, 13], [6, 7], [6, 8], [7, 9], [8, 10], [9, 11],
]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_motion(path: Path) -> str:
    if not path.is_dir() or not (path / "manifest.json").is_file():
        raise RuntimeError(f"source motion is not an .amotion package: {path}")
    digest = hashlib.sha256()
    for file_path in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(file_path.relative_to(path).as_posix().encode("utf-8"))
        digest.update(bytes.fromhex(_sha256_file(file_path)))
    return digest.hexdigest()


def _joint_lookup(frame: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {joint["semantic"]: joint for joint in frame["joints"]}


def _build_annotation(
    frame: dict[str, Any],
    annotation_id: int,
    image_id: int,
    image_width: int,
    image_height: int,
    minimum_confidence: float,
) -> dict[str, Any] | None:
    joints = _joint_lookup(frame)
    head = joints.get("head", {"image_xy": [0.0, 0.0]})
    keypoints: list[float | int] = []
    visible_points: list[tuple[float, float]] = []
    for coco_index in range(len(COCO_KEYPOINTS)):
        semantic = CANONICAL_TO_COCO.get(coco_index)
        joint = joints.get(semantic) if semantic is not None else None
        if coco_index in (1, 2, 3, 4):
            point = head.get("image_xy", [0.0, 0.0])
            keypoints.extend([float(point[0]), float(point[1]), 0])
            continue
        if joint is None:
            keypoints.extend([0.0, 0.0, 0])
            continue
        point = joint["image_xy"]
        visible = bool(joint["valid"]) and float(joint["confidence"]) >= minimum_confidence
        keypoints.extend([float(point[0]), float(point[1]), 2 if visible else 0])
        if visible:
            visible_points.append((float(point[0]), float(point[1])))
    if len(visible_points) < 8:
        return None
    xs = [point[0] for point in visible_points]
    ys = [point[1] for point in visible_points]
    margin_x = max(16.0, (max(xs) - min(xs)) * 0.12)
    margin_y = max(16.0, (max(ys) - min(ys)) * 0.10)
    left = max(0.0, min(xs) - margin_x)
    top = max(0.0, min(ys) - margin_y)
    right = min(float(image_width), max(xs) + margin_x)
    bottom = min(float(image_height), max(ys) + margin_y)
    width = max(1.0, right - left)
    height = max(1.0, bottom - top)
    return {
        "id": annotation_id,
        "image_id": image_id,
        "category_id": 1,
        "iscrowd": 0,
        "area": width * height,
        "bbox": [left, top, width, height],
        "num_keypoints": len(visible_points),
        "keypoints": keypoints,
    }


def _document(images: list[dict[str, Any]], annotations: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "info": {
            "description": "AniMocap private corrected anime keypoints",
            "version": "1.0.0",
        },
        "licenses": [],
        "images": images,
        "annotations": annotations,
        "categories": [{
            "id": 1,
            "name": "person",
            "supercategory": "person",
            "keypoints": COCO_KEYPOINTS,
            "skeleton": SKELETON,
        }],
    }


def export_dataset(
    video: Path,
    pose_path: Path,
    output: Path,
    stride: int,
    minimum_confidence: float,
    jpeg_quality: int,
    source_motion: Path | None = None,
    source_motion_id: str | None = None,
) -> tuple[int, int]:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError("OpenCV is required; run tools/setup_mmpose.ps1") from error
    pose = json.loads(pose_path.read_text(encoding="utf-8"))
    if pose.get("schema_version") != "1.0.0" or not pose.get("frames"):
        raise RuntimeError("input pose is not a supported AniMocap pose sequence")
    if not 0.0 <= minimum_confidence <= 1.0 or stride < 1:
        raise RuntimeError("confidence must be in [0,1] and stride must be positive")

    output = output.resolve()
    image_directory = output / "images"
    annotation_directory = output / "annotations"
    image_directory.mkdir(parents=True, exist_ok=True)
    annotation_directory.mkdir(parents=True, exist_ok=True)
    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"cannot open video: {video}")
    width = int(pose["image_width"])
    height = int(pose["image_height"])
    candidates: list[tuple[dict[str, Any], dict[str, Any]]] = []
    pose_frames = pose["frames"]
    frame_index = 0
    image_id = 1
    try:
        while frame_index < len(pose_frames):
            ok, image = capture.read()
            if not ok:
                break
            if frame_index % stride == 0:
                annotation = _build_annotation(
                    pose_frames[frame_index], image_id, image_id,
                    width, height, minimum_confidence,
                )
                if annotation is not None:
                    filename = f"frame_{frame_index:08d}.jpg"
                    path = image_directory / filename
                    if not cv2.imwrite(
                        str(path), image, [cv2.IMWRITE_JPEG_QUALITY, jpeg_quality]
                    ):
                        raise RuntimeError(f"could not write training frame: {path}")
                    candidates.append(({
                        "id": image_id,
                        "file_name": filename,
                        "width": width,
                        "height": height,
                        "source_frame": frame_index,
                        "time_s": float(pose_frames[frame_index]["time_s"]),
                    }, annotation))
                    image_id += 1
            frame_index += 1
    finally:
        capture.release()
    if not candidates:
        raise RuntimeError("no frames had at least eight confident body keypoints")

    train_images: list[dict[str, Any]] = []
    train_annotations: list[dict[str, Any]] = []
    val_images: list[dict[str, Any]] = []
    val_annotations: list[dict[str, Any]] = []
    for index, (image, annotation) in enumerate(candidates):
        is_validation = len(candidates) >= 10 and index % 10 == 0
        (val_images if is_validation else train_images).append(image)
        (val_annotations if is_validation else train_annotations).append(annotation)
    if not val_images:
        val_images = list(train_images)
        val_annotations = list(train_annotations)
    (annotation_directory / "train.json").write_text(
        json.dumps(_document(train_images, train_annotations), ensure_ascii=False),
        encoding="utf-8",
    )
    (annotation_directory / "val.json").write_text(
        json.dumps(_document(val_images, val_annotations), ensure_ascii=False),
        encoding="utf-8",
    )
    (output / "dataset.json").write_text(json.dumps({
        "schema_version": "1.0.0",
        "source_video": str(video.resolve()),
        "source_video_sha256": _sha256_file(video.resolve()),
        "source_pose": str(pose_path.resolve()),
        "source_pose_sha256": _sha256_file(pose_path.resolve()),
        "source_motion": str(source_motion.resolve()) if source_motion else None,
        "source_motion_sha256": _sha256_motion(source_motion.resolve())
            if source_motion else None,
        "source_motion_id": source_motion_id or None,
        "backend": pose.get("backend", "unknown"),
        "train_images": len(train_images),
        "validation_images": len(val_images),
        "minimum_confidence": minimum_confidence,
        "stride": stride,
        "privacy": "private-local-only",
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(train_images), len(val_images)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--pose", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stride", type=int, default=3)
    parser.add_argument("--minimum-confidence", type=float, default=0.55)
    parser.add_argument("--jpeg-quality", type=int, default=94)
    parser.add_argument("--source-motion", type=Path)
    parser.add_argument("--source-motion-id")
    args = parser.parse_args()
    try:
        train_count, validation_count = export_dataset(
            args.video, args.pose, args.output, args.stride,
            args.minimum_confidence, max(70, min(100, args.jpeg_quality)),
            args.source_motion,
            args.source_motion_id,
        )
        print(json.dumps({
            "event": "complete",
            "train_images": train_count,
            "validation_images": validation_count,
            "output": str(args.output.resolve()),
        }, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"event": "error", "message": str(error)}), file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
