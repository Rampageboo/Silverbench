"""Read generation metadata without changing pixels or inventing generation settings."""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from PIL import Image


def _text(value: Any) -> str:
    if isinstance(value, bytes):
        if value.startswith(b"UNICODE\x00"):
            payload = value[8:]
            # EXIF UserComment normally uses UTF-16, with endian choice often omitted.
            encoding = "utf-16" if payload[:2] in (b"\xff\xfe", b"\xfe\xff") else "utf-16-be"
            return payload.decode(encoding, errors="replace").rstrip("\x00")
        if value.startswith(b"ASCII\x00\x00\x00"):
            value = value[8:]
        return value.decode("utf-8", errors="replace").rstrip("\x00")
    return str(value) if value is not None else ""


def _json(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(_text(value))
    except (ValueError, TypeError):
        return None


def _empty() -> dict:
    return {"format": "none", "positive": "", "negative": "", "parameters": {},
            "model": "", "loras": [], "warnings": [], "source": "none", "raw": {}}


def parse_a1111(value: str) -> dict:
    result = _empty()
    result.update(format="a1111", source="metadata", raw={"parameters": value})
    lines = value.strip().splitlines()
    settings_index = next((i for i in range(len(lines) - 1, -1, -1)
                           if re.match(r"^Steps\s*:", lines[i])), len(lines))
    prompt_lines = lines[:settings_index]
    split = next((i for i, line in enumerate(prompt_lines)
                  if line.startswith("Negative prompt:")), len(prompt_lines))
    result["positive"] = "\n".join(prompt_lines[:split]).strip()
    if split < len(prompt_lines):
        result["negative"] = "\n".join([prompt_lines[split][len("Negative prompt:"):].lstrip(),
                                          *prompt_lines[split + 1:]]).strip()
    if settings_index < len(lines):
        # A comma inside quoted JSON or a quoted model name is not a field separator.
        settings = "\n".join(lines[settings_index:])
        pairs, start, depth, quoted, escaped = [], 0, 0, False, False
        for index, char in enumerate(settings):
            if escaped:
                escaped = False
                continue
            if char == "\\" and quoted:
                escaped = True
            elif char == '"':
                quoted = not quoted
            elif not quoted:
                if char in "[{(":
                    depth += 1
                elif char in "]})":
                    depth = max(0, depth - 1)
                elif char == "," and depth == 0 and re.match(r"\s*[A-Za-z][A-Za-z0-9 _/-]*:\s*", settings[index + 1:]):
                    pairs.append(settings[start:index])
                    start = index + 1
        pairs.append(settings[start:])
        for pair in pairs:
            key, separator, val = pair.partition(":")
            if separator:
                result["parameters"][key.strip()] = val.strip()
        result["model"] = result["parameters"].get("Model", "")
    else:
        result["warnings"].append("Generation parameters were not found; prompt text was preserved.")
    result["loras"] = [{"name": name, "weight": weight} for name, weight in
                         re.findall(r"<lora:([^:>]+):([^>]+)>", result["positive"])]
    return result


def parse_comfyui(value: Any, workflow: Any = None) -> dict:
    result = _empty()
    result.update(format="comfyui", source="metadata", raw={"prompt": value})
    if workflow is not None:
        result["raw"]["workflow"] = workflow
    graph = _json(value)
    if not isinstance(graph, dict) or not all(isinstance(v, dict) for v in graph.values()):
        result["warnings"].append("ComfyUI prompt is not an API graph; editable workflow was preserved.")
        return result
    graph = {str(k): v for k, v in graph.items()}

    def links(node_id: str) -> list[str]:
        values = graph.get(node_id, {}).get("inputs", {})
        if not isinstance(values, dict):
            return []
        return [str(v[0]) for v in values.values() if isinstance(v, list) and len(v) == 2
                and isinstance(v[1], int) and str(v[0]) in graph]

    def walk(start: Any) -> list[str]:
        if not isinstance(start, list) or len(start) != 2:
            return []
        pending, seen, found = [str(start[0])], set(), []
        while pending and len(seen) < 4096:
            key = pending.pop(0)
            if key in seen or key not in graph:
                continue
            seen.add(key)
            found.append(key)
            pending.extend(links(key))
        return found

    candidates = []
    outputs = [key for key, node in graph.items()
               if node.get("class_type") in ("SaveImage", "PreviewImage", "SaveAnimatedWEBP")]
    for key in outputs:
        for upstream in walk([key, 0]):
            if "KSampler" in str(graph[upstream].get("class_type", "")) and upstream not in candidates:
                candidates.append(upstream)
    if not candidates:
        candidates = [key for key, node in graph.items() if "KSampler" in str(node.get("class_type", ""))]
    if not candidates:
        result["warnings"].append("No supported KSampler node found; graph was preserved without guessed prompts.")
        return result
    if len(candidates) > 1:
        result["warnings"].append("Multiple KSamplers found; prompts follow the first sampler upstream of an image output.")
    sampler_id = candidates[0]
    inputs = graph[sampler_id].get("inputs", {})
    result["parameters"]["samplerNode"] = sampler_id
    for name in ("seed", "noise_seed", "steps", "cfg", "sampler_name", "scheduler", "denoise",
                 "add_noise", "start_at_step", "end_at_step"):
        if name in inputs and not isinstance(inputs[name], list):
            result["parameters"][name] = inputs[name]
    for side in ("positive", "negative"):
        fragments = []
        for key in walk(inputs.get(side)):
            node = graph[key]
            if "TextEncode" not in str(node.get("class_type", "")):
                continue
            for name in ("text", "text_g", "text_l"):
                text = node.get("inputs", {}).get(name)
                if isinstance(text, str) and text and text not in fragments:
                    fragments.append(text)
        result[side] = "\n".join(fragments)
        if not fragments:
            result["warnings"].append(f"No literal text conditioning traced for {side}; custom nodes remain in raw graph.")
    for key in walk(inputs.get("model")):
        node = graph[key]
        data = node.get("inputs", {})
        if "LoraLoader" in str(node.get("class_type", "")) and isinstance(data.get("lora_name"), str):
            result["loras"].append({"name": data["lora_name"],
                                     **{k: data[k] for k in ("strength_model", "strength_clip") if k in data}})
        if isinstance(data.get("ckpt_name"), str):
            result["model"] = data["ckpt_name"]
    return result


def parse_novelai(info: dict) -> dict:
    result = _empty()
    result.update(format="novelai", source="metadata")
    comment = info.get("Comment", info.get("comment", ""))
    data = _json(comment)
    result["raw"] = {str(k): _text(v) for k, v in info.items()
                     if str(k).lower() in ("comment", "description", "software", "source", "title")}
    if not isinstance(data, dict):
        data = {}
        result["warnings"].append("NovelAI Comment JSON could not be parsed; original text was preserved.")
    result["positive"] = _text(data.get("prompt", info.get("Description", "")))
    result["negative"] = _text(data.get("uc", data.get("negative_prompt", "")))
    result["parameters"] = {k: v for k, v in data.items() if k not in ("prompt", "uc", "negative_prompt")}
    result["model"] = _text(data.get("model", info.get("Source", "")))
    return result


def extract_metadata(image: Image.Image | str | Path) -> dict:
    """Extract PNG text and EXIF UserComment/ImageDescription, preserving raw payloads."""
    if not isinstance(image, Image.Image):
        with Image.open(image) as opened:
            return extract_metadata(opened)
    info = dict(image.info)
    warnings = []
    try:
        exif = image.getexif()
        for key in (37510, 270):
            value = exif.get(key)
            # EXIF UserComment may be in the nested Exif IFD.
            if value is None and key == 37510:
                try:
                    value = exif.get_ifd(34665).get(key)
                except (KeyError, TypeError, AttributeError):
                    pass
            if value:
                decoded = _text(value)
                if re.search(r"(?:^|\n)(?:Steps\s*:|Negative prompt:)", decoded):
                    info.setdefault("parameters", decoded)
    except (ValueError, TypeError, OSError) as error:
        warnings.append(f"EXIF could not be read: {error}")
    if "novelai" in _text(info.get("Software", info.get("software", ""))).lower():
        result = parse_novelai(info)
    elif "prompt" in info or "workflow" in info:
        result = parse_comfyui(info.get("prompt"), info.get("workflow"))
    elif info.get("parameters"):
        result = parse_a1111(_text(info["parameters"]))
    elif isinstance(_json(info.get("Comment")), dict) and "uc" in _json(info.get("Comment")):
        result = parse_novelai(info)
    else:
        result = _empty()
    result["warnings"].extend(warnings)
    return result
