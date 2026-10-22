"""Assemble leakage-safe corrected-real and character-synthetic COCO data."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import random
import shutil
from typing import Any


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _load_real(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    metadata = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    annotation_path = root / "annotations" / "train.json"
    if not annotation_path.is_file():
        raise RuntimeError(f"real dataset is missing annotations/train.json: {root}")
    return metadata, json.loads(annotation_path.read_text(encoding="utf-8"))


def _load_synthetic(root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    metadata = json.loads((root / "dataset.json").read_text(encoding="utf-8"))
    if metadata.get("kind") != "animocap.character_synthetic_dataset":
        raise RuntimeError(f"not an AniMocap synthetic character dataset: {root}")
    return metadata, json.loads((root / "annotations.json").read_text(encoding="utf-8"))


def _sequence_ids(metadata: dict[str, Any]) -> set[str]:
    result = {"sha256:" + str(value) for value in metadata.get("motion_sha256", [])}
    result |= {"id:" + str(value) for value in metadata.get("motion_ids", [])}
    if metadata.get("source_motion_sha256"):
        result.add("sha256:" + str(metadata["source_motion_sha256"]))
    if metadata.get("source_motion_id"):
        result.add("id:" + str(metadata["source_motion_id"]))
    return result


def _records(
    root: Path, document: dict[str, Any], kind: str
) -> list[tuple[Path, dict[str, Any], dict[str, Any]]]:
    annotations = {item["image_id"]: item for item in document["annotations"]}
    records = []
    for image in document["images"]:
        annotation = annotations.get(image["id"])
        if annotation is None:
            raise RuntimeError(f"image {image['id']} has no annotation in {root}")
        records.append((root / "images" / image["file_name"], image, annotation))
    if not records:
        raise RuntimeError(f"dataset contains no annotated images: {root}")
    return records


def _coco_document(
    records: list[tuple[Path, dict[str, Any], dict[str, Any]]],
    output_images: Path,
    prefix: str,
) -> dict[str, Any]:
    images: list[dict[str, Any]] = []
    annotations: list[dict[str, Any]] = []
    for index, (source_path, source_image, source_annotation) in enumerate(records, 1):
        if not source_path.is_file():
            raise RuntimeError(f"dataset image is missing: {source_path}")
        suffix = source_path.suffix.lower() or ".png"
        filename = f"{prefix}_{index:08d}{suffix}"
        shutil.copy2(source_path, output_images / filename)
        image = dict(source_image)
        image.update({"id": index, "file_name": filename})
        annotation = dict(source_annotation)
        annotation.update({"id": index, "image_id": index})
        images.append(image)
        annotations.append(annotation)
    return {
        "info": {"description": "AniMocap animation-first character dataset", "version": "1.0.0"},
        "licenses": [], "images": images, "annotations": annotations,
        "categories": [{
            "id": 1, "name": "person", "supercategory": "person",
            "keypoints": [
                "nose", "left_eye", "right_eye", "left_ear", "right_ear",
                "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
                "left_wrist", "right_wrist", "left_hip", "right_hip",
                "left_knee", "right_knee", "left_ankle", "right_ankle",
            ],
            "skeleton": [
                [16, 14], [14, 12], [17, 15], [15, 13], [12, 13],
                [6, 12], [7, 13], [6, 7], [6, 8], [7, 9], [8, 10], [9, 11],
            ],
        }],
    }


def assemble_dataset(
    real_train: list[Path],
    synthetic: list[Path],
    held_out: list[Path],
    output: Path,
    seed: int,
    force: bool,
) -> dict[str, Any]:
    train_ids: set[str] = set()
    held_out_ids: set[str] = set()
    real_records: list[tuple[Path, dict[str, Any], dict[str, Any]]] = []
    synthetic_records: list[tuple[Path, dict[str, Any], dict[str, Any]]] = []
    held_out_records: list[tuple[Path, dict[str, Any], dict[str, Any]]] = []
    source_manifests: list[str] = []
    real_motion_identity_complete = True
    held_out_motion_identity_complete = True
    synthetic_motion_identity_complete = True
    for root in real_train:
        metadata, document = _load_real(root)
        real_motion_identity_complete &= bool(
            metadata.get("source_motion_sha256") and metadata.get("source_motion_id")
        )
        train_ids |= _sequence_ids(metadata)
        real_records.extend(_records(root, document, "real"))
        source_manifests.append(_sha256_file(root / "dataset.json"))
    for root in synthetic:
        metadata, document = _load_synthetic(root)
        synthetic_motion_identity_complete &= bool(
            metadata.get("motion_identity_declared", False)
        )
        train_ids |= _sequence_ids(metadata)
        synthetic_records.extend(_records(root, document, "synthetic"))
        source_manifests.append(_sha256_file(root / "dataset.json"))
    for root in held_out:
        metadata, document = _load_real(root)
        held_out_motion_identity_complete &= bool(
            metadata.get("source_motion_sha256") and metadata.get("source_motion_id")
        )
        held_out_ids |= _sequence_ids(metadata)
        held_out_records.extend(_records(root, document, "held_out"))
        source_manifests.append(_sha256_file(root / "dataset.json"))
    overlap = train_ids & held_out_ids
    if overlap:
        raise RuntimeError("held-out sequence content appears in the training inputs")
    if not real_records and not synthetic_records:
        raise RuntimeError("at least one real or synthetic training dataset is required")

    rng = random.Random(seed)
    rng.shuffle(synthetic_records)
    if real_records:
        synthetic_records = synthetic_records[: 2 * len(real_records)]
    train_records = real_records + synthetic_records
    rng.shuffle(train_records)
    activation_eligible = bool(
        real_records and held_out_records and real_motion_identity_complete and
        held_out_motion_identity_complete and synthetic_motion_identity_complete
    )
    validation_records = held_out_records or list(train_records)

    if output.exists():
        if not force:
            raise RuntimeError(f"refusing to overwrite assembled dataset: {output}")
        shutil.rmtree(output)
    image_directory = output / "images"
    annotation_directory = output / "annotations"
    image_directory.mkdir(parents=True)
    annotation_directory.mkdir(parents=True)
    train_document = _coco_document(train_records, image_directory, "train")
    validation_document = _coco_document(validation_records, image_directory, "val")
    (annotation_directory / "train.json").write_text(
        json.dumps(train_document, ensure_ascii=False), encoding="utf-8"
    )
    (annotation_directory / "val.json").write_text(
        json.dumps(validation_document, ensure_ascii=False), encoding="utf-8"
    )
    manifest = {
        "schema_version": "1.0.0", "kind": "animocap.animation_character_dataset",
        "privacy": "private-local-only", "seed": seed,
        "real_train_images": len(real_records),
        "synthetic_train_images": len(synthetic_records),
        "held_out_images": len(held_out_records),
        "activation_eligible": activation_eligible,
        "motion_identity_complete": bool(
            real_motion_identity_complete and held_out_motion_identity_complete
            and synthetic_motion_identity_complete
        ),
        "train_sequence_ids": sorted(train_ids),
        "held_out_sequence_ids": sorted(held_out_ids),
        "source_manifest_sha256": source_manifests,
    }
    (output / "dataset.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--real-train", type=Path, action="append", default=[])
    parser.add_argument("--synthetic", type=Path, action="append", default=[])
    parser.add_argument("--held-out", type=Path, action="append", default=[])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seed", type=int, default=20260810)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    manifest = assemble_dataset(
        args.real_train, args.synthetic, args.held_out,
        args.output.resolve(), args.seed, args.force,
    )
    print(json.dumps({"event": "complete", **manifest}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
