from __future__ import annotations

import ast
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp"}


@dataclass
class Classifier:
    model_path: Path
    session: Any
    input_name: str
    input_size: int
    class_names: dict[int, str]


_CACHE: dict[Path, Classifier] = {}


def load_classifier(model_path: Path) -> Classifier:
    path = model_path.resolve()
    if path in _CACHE:
        return _CACHE[path]
    if not path.is_file():
        raise FileNotFoundError(f"Classifier model not found: {path}")
    if path.suffix.lower() != ".onnx":
        raise ValueError("Classifier model must be an .onnx file.")

    try:
        import onnxruntime as ort
    except ImportError as error:
        raise RuntimeError(
            "onnxruntime is not installed. Install it with: pip install onnxruntime"
        ) from error

    providers = ["CPUExecutionProvider"]
    session = ort.InferenceSession(str(path), providers=providers)
    input_info = session.get_inputs()[0]
    input_size = _input_size(input_info.shape)
    classifier = Classifier(
        model_path=path,
        session=session,
        input_name=input_info.name,
        input_size=input_size,
        class_names=_class_names_from_metadata(session),
    )
    _CACHE[path] = classifier
    return classifier


def model_info(model_path: Path) -> dict[str, Any]:
    classifier = load_classifier(model_path)
    return {
        "modelPath": str(classifier.model_path),
        "inputSize": classifier.input_size,
        "classes": [
            {"id": index, "name": classifier.class_names.get(index, str(index))}
            for index in sorted(classifier.class_names)
        ],
        "providers": classifier.session.get_providers(),
    }


def classify_image(model_path: Path, image_path: Path, top_k: int = 5) -> dict[str, Any]:
    classifier = load_classifier(model_path)
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"Unsupported image type: {image_path.suffix}")
    import numpy as np

    tensor = _preprocess_image(image_path, classifier.input_size)
    outputs = classifier.session.run(None, {classifier.input_name: tensor})
    scores = np.asarray(outputs[0]).reshape(-1).astype(np.float32)
    probs = _probabilities(scores)
    limit = max(1, min(int(top_k), len(probs)))
    indexes = np.argsort(probs)[::-1][:limit]
    predictions = [
        {
            "classId": int(index),
            "name": classifier.class_names.get(int(index), str(int(index))),
            "confidence": float(probs[index]),
        }
        for index in indexes
    ]
    return {
        "imagePath": str(image_path),
        "top": predictions[0],
        "predictions": predictions,
    }


def classify_dataset_images(
    root: Path,
    model_path: Path,
    relative_paths: list[str],
    top_k: int = 5,
) -> dict[str, Any]:
    root_path = root.resolve()
    results = []
    errors = []
    for relative_path in relative_paths:
        try:
            image_path = _safe_child_path(root_path, relative_path)
            result = classify_image(model_path, image_path, top_k)
            result["relativePath"] = relative_path
            results.append(result)
        except Exception as error:
            errors.append({"relativePath": relative_path, "error": str(error)})
    return {
        "model": model_info(model_path),
        "results": results,
        "errors": errors,
    }


def _input_size(shape: list[Any]) -> int:
    dims = [dim for dim in shape if isinstance(dim, int) and dim > 0]
    if len(dims) >= 2:
        return int(dims[-1])
    return 224


def _class_names_from_metadata(session: Any) -> dict[int, str]:
    metadata = session.get_modelmeta().custom_metadata_map or {}
    raw = metadata.get("names") or metadata.get("classes") or ""
    names: Any = None
    if raw:
        for parser in (json.loads, ast.literal_eval):
            try:
                names = parser(raw)
                break
            except (ValueError, SyntaxError, TypeError):
                continue
    if isinstance(names, dict):
        return {int(key): str(value) for key, value in names.items()}
    if isinstance(names, list):
        return {index: str(name) for index, name in enumerate(names)}
    return {}


def _preprocess_image(path: Path, input_size: int) -> np.ndarray:
    import numpy as np
    from PIL import Image

    with Image.open(path) as image:
        image = image.convert("RGB")
        image = _resize_center_crop(image, input_size)
        array = np.asarray(image, dtype=np.float32) / 255.0
    return np.transpose(array, (2, 0, 1))[None, ...]


def _resize_center_crop(image: Image.Image, size: int) -> Image.Image:
    from PIL import Image

    width, height = image.size
    scale = size / min(width, height)
    resized = image.resize((round(width * scale), round(height * scale)), Image.Resampling.BILINEAR)
    left = max(0, (resized.width - size) // 2)
    top = max(0, (resized.height - size) // 2)
    return resized.crop((left, top, left + size, top + size))


def _probabilities(scores: np.ndarray) -> np.ndarray:
    import numpy as np

    if scores.size == 0:
        raise ValueError("Model returned an empty output.")
    if np.all(scores >= 0) and np.isclose(float(scores.sum()), 1.0, rtol=1e-3, atol=1e-3):
        return scores
    shifted = scores - np.max(scores)
    exp = np.exp(shifted)
    return exp / np.sum(exp)


def _safe_child_path(root: Path, relative_path: str) -> Path:
    target = (root / relative_path).resolve()
    if target != root and root not in target.parents:
        raise ValueError(f"Path escapes dataset root: {relative_path}")
    return target
