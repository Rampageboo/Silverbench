import json
import math
import pathlib
import re

from .constants import CANONICAL_SEMANTICS, COORDINATE_CONTRACT


class ExchangeValidationError(ValueError):
    pass


def _require_exact_keys(value, expected, label):
    if not isinstance(value, dict):
        raise ExchangeValidationError(f"{label} must be an object")
    actual = set(value)
    expected = set(expected)
    missing = sorted(expected - actual)
    unknown = sorted(actual - expected)
    if missing or unknown:
        raise ExchangeValidationError(
            f"{label} keys mismatch; missing={missing}, unknown={unknown}"
        )


def _number(value, label, minimum=None, exclusive_minimum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ExchangeValidationError(f"{label} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ExchangeValidationError(f"{label} must be finite")
    if minimum is not None and value < minimum:
        raise ExchangeValidationError(f"{label} must be at least {minimum}")
    if exclusive_minimum is not None and value <= exclusive_minimum:
        raise ExchangeValidationError(f"{label} must be greater than {exclusive_minimum}")
    return value


def _vector(value, size, label):
    if not isinstance(value, list) or len(value) != size:
        raise ExchangeValidationError(f"{label} must contain exactly {size} numbers")
    return tuple(_number(component, f"{label}[{index}]") for index, component in enumerate(value))


def _quaternion(value, label):
    result = _vector(value, 4, label)
    length = math.sqrt(sum(component * component for component in result))
    if abs(length - 1.0) > 1e-5:
        raise ExchangeValidationError(f"{label} must be a normalized quaternion")
    return result


def validate_document(document):
    _require_exact_keys(
        document,
        {
            "schema",
            "source_motion_sha256",
            "fps",
            "selected_frames",
            "skeleton_id",
            "coordinate_contract",
        },
        "document",
    )
    if document["schema"] != 1:
        raise ExchangeValidationError("only animocap-blender schema 1 is supported")
    if not isinstance(document["source_motion_sha256"], str) or not re.fullmatch(
        r"[0-9a-f]{64}", document["source_motion_sha256"]
    ):
        raise ExchangeValidationError("source_motion_sha256 must be lowercase SHA-256")
    _number(document["fps"], "fps", exclusive_minimum=0.0)
    if not isinstance(document["skeleton_id"], str) or not document["skeleton_id"]:
        raise ExchangeValidationError("skeleton_id must be a non-empty string")
    _require_exact_keys(document["coordinate_contract"], COORDINATE_CONTRACT, "coordinate_contract")
    if document["coordinate_contract"] != COORDINATE_CONTRACT:
        raise ExchangeValidationError("unsupported coordinate_contract")

    frames = document["selected_frames"]
    if not isinstance(frames, list) or not frames:
        raise ExchangeValidationError("selected_frames must contain at least one frame")
    seen = set()
    for index, frame in enumerate(frames):
        label = f"selected_frames[{index}]"
        _require_exact_keys(
            frame,
            {
                "source_frame",
                "time_s",
                "root_translation_m",
                "root_rotation",
                "hips_translation_m",
                "local_rotations",
            },
            label,
        )
        source_frame = frame["source_frame"]
        if isinstance(source_frame, bool) or not isinstance(source_frame, int) or source_frame < 0:
            raise ExchangeValidationError(f"{label}.source_frame must be a non-negative integer")
        if source_frame in seen:
            raise ExchangeValidationError(f"duplicate source_frame {source_frame}")
        seen.add(source_frame)
        _number(frame["time_s"], f"{label}.time_s", minimum=0.0)
        _vector(frame["root_translation_m"], 3, f"{label}.root_translation_m")
        _quaternion(frame["root_rotation"], f"{label}.root_rotation")
        _vector(frame["hips_translation_m"], 3, f"{label}.hips_translation_m")
        rotations = frame["local_rotations"]
        _require_exact_keys(rotations, CANONICAL_SEMANTICS, f"{label}.local_rotations")
        for semantic in CANONICAL_SEMANTICS:
            _quaternion(rotations[semantic], f"{label}.local_rotations.{semantic}")
    return document


def load_document(path):
    path = pathlib.Path(path)
    if not path.name.endswith(".animocap-blender.json"):
        raise ExchangeValidationError("file must use .animocap-blender.json")
    try:
        with path.open("r", encoding="utf-8") as stream:
            document = json.load(stream)
    except (OSError, json.JSONDecodeError) as error:
        raise ExchangeValidationError(f"cannot read exchange file: {error}") from error
    return validate_document(document)


def frame_summary(document, limit=8):
    frames = sorted(frame["source_frame"] for frame in document["selected_frames"])
    shown = "、".join(str(frame) for frame in frames[:limit])
    if len(frames) > limit:
        shown += "…"
    return f"{len(frames)} frames: {shown}"
