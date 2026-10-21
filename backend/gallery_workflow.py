"""Break a gallery image's generation metadata into its parts.

Works on what extraction already stored (``metadata.raw``), so existing images
need no re-scan. ComfyUI images carry two graphs: ``workflow`` (the editor graph
that dragging the PNG into ComfyUI restores) and ``prompt`` (the API graph that
was executed). The API graph is analysed when present; otherwise the editor
graph gives node types and widget values only.

ControlNet and IPAdapter reference images are *not* stored in the PNG — only
the LoadImage filename is. With the local ComfyUI folder configured they are
looked up in its ``input`` folder; otherwise they are reported as unresolved.
A1111 / Forge write ControlNet, ADetailer and hires settings into their
parameter text; those are split into fields here.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from .comfyui_paths import find_input_image


def _json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except ValueError:
            return None
    return None


def editor_workflow(metadata: dict[str, Any]) -> dict[str, Any] | None:
    """The ComfyUI editor graph, ready to save as workflow.json and drop into ComfyUI."""
    raw = metadata.get("raw") if isinstance(metadata.get("raw"), dict) else {}
    workflow = _json(raw.get("workflow"))
    return workflow if isinstance(workflow, dict) and isinstance(workflow.get("nodes"), list) else None


def api_graph(metadata: dict[str, Any]) -> dict[str, Any] | None:
    raw = metadata.get("raw") if isinstance(metadata.get("raw"), dict) else {}
    graph = _json(raw.get("prompt"))
    if isinstance(graph, dict) and graph and all(isinstance(node, dict) for node in graph.values()):
        return {str(key): node for key, node in graph.items()}
    return None


# ── ComfyUI API graph ────────────────────────────────────────────────────────


def _is_link(value: Any) -> bool:
    return isinstance(value, list) and len(value) == 2 and isinstance(value[1], int)


def _upstream(graph: dict[str, Any], start: Any, limit: int = 256) -> list[str]:
    """Node ids feeding ``start`` (a link), nearest first."""
    if not _is_link(start):
        return []
    pending, seen, found = [str(start[0])], set(), []
    while pending and len(seen) < limit:
        key = pending.pop(0)
        if key in seen or key not in graph:
            continue
        seen.add(key)
        found.append(key)
        inputs = graph[key].get("inputs") if isinstance(graph[key].get("inputs"), dict) else {}
        pending.extend(str(value[0]) for value in inputs.values() if _is_link(value))
    return found


def _scalar_inputs(node: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any]:
    inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
    return {name: inputs[name] for name in names if name in inputs and not _is_link(inputs[name])}


def _image_source(graph: dict[str, Any], link: Any, resolve: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    """Follow an image input back to its LoadImage, collecting preprocessors on the way."""
    preprocessors, source = [], None
    for key in _upstream(graph, link):
        node = graph[key]
        kind = str(node.get("class_type") or "")
        inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
        if kind.startswith("LoadImage") and isinstance(inputs.get("image"), str):
            source = {"node": key, **resolve(inputs["image"])}
            break
        if "Preprocessor" in kind or "Detector" in kind or kind in ("Canny", "ImageInvert"):
            preprocessors.append(kind)
    return {"image": source, "preprocessors": preprocessors}


def _comfyui_breakdown(graph: dict[str, Any], resolve: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    checkpoints, loras, vaes, samplers, controlnets, ipadapters, upscalers, images = [], [], [], [], [], [], [], []
    for key, node in sorted(graph.items(), key=lambda item: int(item[0]) if item[0].isdigit() else 0):
        kind = str(node.get("class_type") or "")
        counts[kind] = counts.get(kind, 0) + 1
        inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
        for name in ("ckpt_name", "unet_name"):
            if isinstance(inputs.get(name), str):
                checkpoints.append({"node": key, "name": inputs[name], "loader": kind})
        if isinstance(inputs.get("vae_name"), str):
            vaes.append({"node": key, "name": inputs["vae_name"]})
        if "Lora" in kind:
            if isinstance(inputs.get("lora_name"), str):
                loras.append({"node": key, "name": inputs["lora_name"], **_scalar_inputs(node, ("strength_model", "strength_clip"))})
            for value in inputs.values():  # stacked loaders (e.g. Power Lora Loader): {on, lora, strength}
                if isinstance(value, dict) and isinstance(value.get("lora"), str) and value.get("on", True):
                    loras.append({"node": key, "name": value["lora"], "strength_model": value.get("strength")})
        if "Sampler" in kind and any(name in inputs for name in ("seed", "noise_seed", "steps", "cfg")):
            samplers.append({"node": key, "type": kind, **_scalar_inputs(
                node, ("seed", "noise_seed", "steps", "cfg", "sampler_name", "scheduler", "denoise", "start_at_step", "end_at_step"))})
        if "ControlNet" in kind and "Apply" in kind:
            loader = next((graph[k] for k in _upstream(graph, inputs.get("control_net")) if "control_net_name" in (graph[k].get("inputs") or {})), None)
            controlnets.append({
                "node": key,
                "type": kind,
                "model": (loader or {}).get("inputs", {}).get("control_net_name", ""),
                **_scalar_inputs(node, ("strength", "start_percent", "end_percent")),
                **_image_source(graph, inputs.get("image"), resolve),
            })
        if "IPAdapter" in kind and any(_is_link(inputs.get(name)) for name in ("image", "images")):
            ipadapters.append({
                "node": key,
                "type": kind,
                **_scalar_inputs(node, ("weight", "weight_type", "start_at", "end_at", "preset")),
                **_image_source(graph, inputs.get("image") or inputs.get("images"), resolve),
            })
        if isinstance(inputs.get("model_name"), str) and "Upscale" in kind:
            upscalers.append({"node": key, "name": inputs["model_name"]})
        if kind.startswith("LoadImage") and isinstance(inputs.get("image"), str):
            images.append({"node": key, **resolve(inputs["image"])})
    return {
        "nodeCount": len(graph),
        "nodeTypes": dict(sorted(counts.items(), key=lambda item: (-item[1], item[0]))),
        "checkpoints": checkpoints,
        "vae": vaes,
        "loras": loras,
        "samplers": samplers,
        "controlnets": controlnets,
        "ipadapters": ipadapters,
        "upscalers": upscalers,
        "inputImages": images,
    }


def _editor_breakdown(workflow: dict[str, Any], resolve: Callable[[str], dict[str, Any]]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    images = []
    for node in workflow.get("nodes") or []:
        if not isinstance(node, dict):
            continue
        kind = str(node.get("type") or "")
        counts[kind] = counts.get(kind, 0) + 1
        widgets = node.get("widgets_values")
        if kind.startswith("LoadImage") and isinstance(widgets, list) and widgets and isinstance(widgets[0], str):
            images.append({"node": str(node.get("id")), **resolve(widgets[0])})
    return {
        "nodeCount": sum(counts.values()),
        "nodeTypes": dict(sorted(counts.items(), key=lambda item: (-item[1], item[0]))),
        "inputImages": images,
    }


# ── A1111 / Forge parameter text ─────────────────────────────────────────────


def _fields(text: str) -> dict[str, str]:
    """'Module: openpose, Model: control_x [hash], Weight: 1' -> dict."""
    value = text.strip().strip('"')
    parts = re.split(r",\s*(?=[A-Za-z][A-Za-z0-9 _/-]*:\s)", value)
    out = {}
    for part in parts:
        key, separator, val = part.partition(":")
        if separator:
            out[key.strip()] = val.strip()
    return out


def _a1111_breakdown(parameters: dict[str, Any]) -> dict[str, Any]:
    controlnets = []
    for key, value in parameters.items():
        match = re.fullmatch(r"ControlNet(?:\s+(\d+))?", key.strip())
        if match and isinstance(value, str):
            unit = _fields(value)
            controlnets.append({
                "unit": int(match.group(1) or 0),
                "preprocessor": unit.get("Module") or unit.get("Preprocessor", ""),
                "model": unit.get("Model", ""),
                "weight": unit.get("Weight", ""),
                "start": unit.get("Guidance Start", unit.get("Starting Control Step", "")),
                "end": unit.get("Guidance End", unit.get("Ending Control Step", "")),
                "controlMode": unit.get("Control Mode", ""),
                "settings": unit,
                # A1111 never stores the control image itself.
                "image": None,
            })
    adetailer = {key[len("ADetailer "):]: value for key, value in parameters.items() if key.startswith("ADetailer ")}
    hires = {key: value for key, value in parameters.items() if key.startswith("Hires ") or key == "Denoising strength"}
    return {"controlnets": sorted(controlnets, key=lambda unit: unit["unit"]), "adetailer": adetailer, "hires": hires}


# ── Entry point ──────────────────────────────────────────────────────────────


def analyze(metadata: dict[str, Any], comfyui: dict[str, Any] | None = None) -> dict[str, Any]:
    """Structured breakdown of one image's generation metadata."""
    comfyui = comfyui or {}

    def resolve(filename: str) -> dict[str, Any]:
        path = find_input_image(comfyui, filename)
        return {"filename": filename, "found": path is not None, "path": str(path) if path else ""}

    fmt = str(metadata.get("format") or "none")
    result: dict[str, Any] = {
        "format": fmt,
        "hasMetadata": metadata.get("source") == "metadata",
        "comfyuiConfigured": bool(comfyui.get("ok")),
        "workflowAvailable": False,
    }
    if fmt == "comfyui":
        workflow = editor_workflow(metadata)
        graph = api_graph(metadata)
        result["workflowAvailable"] = workflow is not None
        if graph is not None:
            result.update(_comfyui_breakdown(graph, resolve))
        elif workflow is not None:
            result.update(_editor_breakdown(workflow, resolve))
    elif fmt == "a1111":
        result.update(_a1111_breakdown(metadata.get("parameters") or {}))
    return result


def reference_image(metadata: dict[str, Any], comfyui: dict[str, Any], node: str) -> str | None:
    """Local path of the image a LoadImage node referenced, when it is still in ComfyUI's input folder."""
    graph = api_graph(metadata)
    if graph is not None and node in graph:
        image = (graph[node].get("inputs") or {}).get("image")
    else:
        workflow = editor_workflow(metadata) or {}
        found = next((n for n in workflow.get("nodes") or [] if isinstance(n, dict) and str(n.get("id")) == node), None)
        widgets = (found or {}).get("widgets_values") or []
        image = widgets[0] if widgets else None
    path = find_input_image(comfyui, image) if isinstance(image, str) else None
    return str(path) if path else None
