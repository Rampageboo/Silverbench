"""Local GPU inference readiness and an explicit WD ONNX subprocess adapter.

Nothing is downloaded or uploaded. Importing this module never loads weights.
The worker accepts local files only and returns every model score, unfiltered.
WD preprocessing reference: https://huggingface.co/spaces/SmilingWolf/wd-tagger/blob/main/app.py
Only the documented WD NHWC float32/BGR profile is supported; PixAI architecture
and caption adapters must be supplied/validated before they can be enabled.
"""
from __future__ import annotations

import csv
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import subprocess
import sys

_PATH_KEYS = ("wdModelPath", "wdTagsPath", "pixaiModelPath", "captionModelPath")
_CONFIG_KEYS = _PATH_KEYS + ("wdModelId", "wdProfile", "wdModelSha256", "wdTagsSha256", "deviceId")
_CATEGORIES = {0: "general", 1: "artist", 3: "copyright", 4: "character", 9: "rating"}


def _config(config):
    if config is None:
        return {}
    if not isinstance(config, dict):
        raise ValueError("Inference configuration must be an object")
    result = {key: config[key] for key in _CONFIG_KEYS if key in config}
    for key, value in result.items():
        if key == "deviceId":
            if type(value) is not int or value < 0:
                raise ValueError("deviceId must be a nonnegative integer")
        elif not isinstance(value, str):
            raise ValueError(f"{key} must be a string")
        elif key.endswith("Sha256") and value and (len(value) != 64 or any(c not in "0123456789abcdefABCDEF" for c in value)):
            raise ValueError(f"{key} must be a SHA256 hexadecimal digest")
    return result


def _package_available(name):
    try:
        return importlib.util.find_spec(name) is not None
    except (ValueError, ModuleNotFoundError):
        return False


def _file_state(value):
    if not value:
        return {"configured": False, "exists": False}
    path = Path(value).expanduser()
    try:
        exists = path.is_absolute() and path.is_file()
    except OSError:
        exists = False
    return {"path": str(path), "configured": True, "exists": exists}


def get_capabilities(config=None):
    """Report prerequisites, never conflate configured paths with proven inference.

    ``ready`` means the WD worker can be attempted. ``runtimeVerified`` remains
    false until a successful worker result. No model is selected by filename.
    """
    config = _config(config)
    packages = {name: _package_available(name) for name in ("onnxruntime", "numpy", "PIL")}
    files = {key: _file_state(config.get(key)) for key in _PATH_KEYS}
    blockers = []
    for key in ("wdModelPath", "wdTagsPath"):
        if not files[key]["exists"]:
            blockers.append(f"{key}: configure an existing absolute local file path")
    for name, installed in packages.items():
        if not installed:
            blockers.append(f"missing_package: {name}")
    if not config.get("wdModelId", "").strip():
        blockers.append("wdModelId: supply the actual model identifier; filenames do not establish identity")
    if config.get("wdProfile") != "wd-v3":
        blockers.append("wdProfile: explicitly select wd-v3 only for a matching WD ONNX model and labels")
    providers = []
    runtime_error = None
    if packages["onnxruntime"]:
        try:
            import onnxruntime
            providers = onnxruntime.get_available_providers()
        except Exception as exc:
            runtime_error = f"{type(exc).__name__}: {exc}"
            blockers.append(f"onnxruntime_import_failed: {runtime_error}")
    if "CUDAExecutionProvider" not in providers:
        blockers.append("CUDAExecutionProvider unavailable: install/configure a compatible GPU runtime; CPU fallback is disabled")
    wd = {"implemented": True, "ready": not blockers, "runtimeVerified": False, "modelIdentityVerified": False,
          "modelId": config.get("wdModelId", ""), "profile": config.get("wdProfile", ""),
          "blockers": blockers, "providers": providers, "fullProbabilities": True,
          "execution": "explicit-background-subprocess", "license": "Owner must obtain weights and accept any applicable license", "files": {key: files[key] for key in ("wdModelPath", "wdTagsPath")}}
    pixai = {"implemented": False, "ready": False, "runtimeVerified": False,
             "files": {"pixaiModelPath": files["pixaiModelPath"]},
             "blockers": ["PixAI model architecture/preprocessing/label contract is unspecified; a path alone cannot enable inference", "Owner must supply licensed model files and validation fixtures"]}
    caption = {"implemented": False, "ready": False, "runtimeVerified": False,
               "files": {"captionModelPath": files["captionModelPath"]},
               "blockers": ["Local caption model and validated GPU adapter are not supplied", "Owner must supply licensed model files and caption validation fixtures"]}
    return {"available": wd["ready"], "runtimeVerified": False, "networkTransfers": False,
            "cpuFallback": False, "packages": packages, "config": config,
            "adapters": {"wd_onnx": wd, "pixai": pixai, "captioner": caption},
            "selectionValidated": False,
            "selectionBlockers": ["Remielle ground-truth fixtures have not been supplied", "Generation-metadata validation fixtures have not been supplied", "Dual-tagger and caption benchmark acceptance is pending"],
            "runtimeError": runtime_error}


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_wd_onnx(image_path, config):
    """Worker-only synchronous GPU call. Server callers use start_wd_worker.

    Output is directly usable as ``record.modelTags[result['modelId']]``.
    Model/label digests are evidence of the actual local inputs, not proof of
    upstream identity unless the Owner supplies and verifies expected digests.
    """
    config = _config(config)
    capabilities = get_capabilities(config)
    adapter = capabilities["adapters"]["wd_onnx"]
    if not adapter["ready"]:
        raise RuntimeError("; ".join(adapter["blockers"]))
    image_path = Path(image_path).expanduser()
    if not image_path.is_absolute() or not image_path.is_file():
        raise ValueError("image_path must be an existing absolute local image path")
    import numpy as np
    import onnxruntime as ort
    from PIL import Image, ImageOps

    model_digest, tags_digest = _sha256(config["wdModelPath"]), _sha256(config["wdTagsPath"])
    for key, actual in (("wdModelSha256", model_digest), ("wdTagsSha256", tags_digest)):
        if config.get(key) and config[key].lower() != actual:
            raise ValueError(f"{key} does not match the configured local file")
    with Path(config["wdTagsPath"]).open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not {"name", "category"}.issubset(reader.fieldnames or []):
            raise ValueError("WD labels CSV requires name and category columns")
        labels = list(reader)
    if not labels or len({row["name"] for row in labels}) != len(labels):
        raise ValueError("WD labels must be nonempty and unique")
    for row in labels:
        if not row["name"] or int(row["category"]) not in _CATEGORIES:
            raise ValueError("WD labels contain an empty name or unsupported category")
    session_options = ort.SessionOptions()
    session_options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
    session = ort.InferenceSession(config["wdModelPath"], sess_options=session_options,
                                   providers=[("CUDAExecutionProvider", {"device_id": config.get("deviceId", 0)})])
    session.disable_fallback()
    if "CUDAExecutionProvider" not in session.get_providers():
        raise RuntimeError("ONNX Runtime did not initialize CUDA; CPU inference is prohibited")
    inputs, outputs = session.get_inputs(), session.get_outputs()
    if len(inputs) != 1 or len(outputs) != 1:
        raise ValueError("WD adapter requires one image input and one score output")
    shape = inputs[0].shape
    if inputs[0].type != "tensor(float)" or len(shape) != 4 or shape[-1] != 3 or not isinstance(shape[1], int) or shape[1] != shape[2] or not 64 <= shape[1] <= 4096 or (isinstance(shape[0], int) and shape[0] != 1):
        raise ValueError("WD adapter requires NHWC float32 square RGB input, batch 1 or dynamic")
    size = shape[1]
    with Image.open(image_path) as original:
        rgba = ImageOps.exif_transpose(original).convert("RGBA")
        rgb = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        rgb.alpha_composite(rgba)
        rgb = rgb.convert("RGB")
    side = max(rgb.size)
    square = Image.new("RGB", (side, side), "white")
    square.paste(rgb, ((side - rgb.width) // 2, (side - rgb.height) // 2))
    square = square.resize((size, size), Image.Resampling.BICUBIC)
    data = np.asarray(square, dtype=np.float32)[:, :, ::-1][None, ...].copy()
    values = np.asarray(session.run([outputs[0].name], {inputs[0].name: data})[0])
    if values.shape != (1, len(labels)):
        raise ValueError(f"Model output {values.shape} does not match {len(labels)} label rows")
    scores = [float(value) for value in values[0]]
    if any(not math.isfinite(score) or not 0 <= score <= 1 for score in scores):
        raise ValueError("WD model output must contain probabilities between 0 and 1; logits are not silently transformed")
    return {"modelId": config["wdModelId"], "adapter": "wd_onnx", "profile": "wd-v3", "provider": "CUDAExecutionProvider",
            "runtimeVerified": True, "modelIdentityVerified": bool(config.get("wdModelSha256") and config.get("wdTagsSha256")),
            "modelSha256": model_digest, "tagsSha256": tags_digest,
            "tags": [{"name": row["name"], "category": _CATEGORIES[int(row["category"])], "probability": score} for row, score in zip(labels, scores)]}


def start_wd_worker(image_path, config):
    """Start a background process; caller owns collection, timeout and cancellation.

    Returns Popen with text stdout/stderr. A successful stdout JSON has ``ok``
    and ``result``. Failure has ``ok:false,error`` and exit code 1. No files are
    written. JSON travels on stdin rather than an executable shell command.
    """
    request = {"imagePath": str(image_path), "config": _config(config)}
    options = {"stdin": subprocess.PIPE, "stdout": subprocess.PIPE, "stderr": subprocess.PIPE,
               "text": True, "encoding": "utf-8", "shell": False}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--wd-worker"], **options)
    try:
        process.stdin.write(json.dumps(request, ensure_ascii=True))
        process.stdin.close()
        process.stdin = None
    except Exception:
        process.kill()
        process.wait()
        raise
    return process


def _main():
    if sys.argv[1:] != ["--wd-worker"]:
        raise SystemExit("Use --wd-worker with a local JSON request on stdin")
    try:
        request = json.load(sys.stdin)
        result = run_wd_onnx(request["imagePath"], request.get("config"))
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=True, allow_nan=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=True))
        raise SystemExit(1)


if __name__ == "__main__":
    _main()
