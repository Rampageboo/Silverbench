import json

import pytest
from PIL import Image, PngImagePlugin

from backend.comfyui_paths import find_input_image, locate_comfyui
from backend.gallery_library import GalleryError, GalleryLibrary
from backend.gallery_metadata import extract_metadata
from backend.gallery_workflow import analyze, editor_workflow, reference_image

API_GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "noobai.safetensors"}},
    "2": {"class_type": "LoraLoader", "inputs": {"lora_name": "style.safetensors", "strength_model": 0.8, "strength_clip": 1.0, "model": ["1", 0], "clip": ["1", 1]}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "1girl, dancing", "clip": ["2", 1]}},
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "lowres", "clip": ["2", 1]}},
    "5": {"class_type": "LoadImage", "inputs": {"image": "pose ref.png"}},
    "6": {"class_type": "DWPreprocessor", "inputs": {"image": ["5", 0]}},
    "7": {"class_type": "ControlNetLoader", "inputs": {"control_net_name": "openpose.safetensors"}},
    "8": {"class_type": "ControlNetApplyAdvanced", "inputs": {"positive": ["3", 0], "negative": ["4", 0], "control_net": ["7", 0], "image": ["6", 0], "strength": 0.7, "start_percent": 0.0, "end_percent": 0.6}},
    "9": {"class_type": "KSampler", "inputs": {"model": ["2", 0], "positive": ["8", 0], "negative": ["8", 1], "seed": 42, "steps": 28, "cfg": 5.5, "sampler_name": "euler_ancestral", "scheduler": "normal", "denoise": 1.0}},
    "10": {"class_type": "SaveImage", "inputs": {"images": ["9", 0]}},
}
EDITOR = {"nodes": [{"id": 5, "type": "LoadImage", "widgets_values": ["pose ref.png", "image"]}, {"id": 9, "type": "KSampler"}], "links": []}


def comfy_png(path, *, prompt=True, workflow=True):
    info = PngImagePlugin.PngInfo()
    if prompt:
        info.add_text("prompt", json.dumps(API_GRAPH))
    if workflow:
        info.add_text("workflow", json.dumps(EDITOR))
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (16, 16), "blue").save(path, pnginfo=info)
    return path


@pytest.fixture
def comfyui(tmp_path):
    portable = tmp_path / "ComfyUI_windows_portable"
    root = portable / "ComfyUI"
    (root / "comfy").mkdir(parents=True)
    (root / "main.py").write_text("", encoding="utf-8")
    (root / "input").mkdir()
    Image.new("RGB", (8, 8), "white").save(root / "input" / "pose ref.png")
    return portable


def test_locate_accepts_portable_bundle_and_rejects_other_folders(comfyui, tmp_path):
    found = locate_comfyui(comfyui)
    assert found["ok"] and found["portable"] and found["inputDir"].endswith("input")
    assert locate_comfyui(comfyui / "ComfyUI")["portable"] is False
    assert not locate_comfyui(tmp_path)["ok"]
    assert not locate_comfyui("")["configured"]
    assert find_input_image(found, "../../escape.png") is None


def test_comfyui_breakdown_traces_controlnet_to_its_reference_image(comfyui, tmp_path):
    metadata = extract_metadata(comfy_png(tmp_path / "out.png"))
    result = analyze(metadata, locate_comfyui(comfyui))
    assert result["workflowAvailable"] is True
    assert result["checkpoints"][0]["name"] == "noobai.safetensors"
    assert result["loras"][0] == {"node": "2", "name": "style.safetensors", "strength_model": 0.8, "strength_clip": 1.0}
    assert result["samplers"][0]["seed"] == 42
    unit = result["controlnets"][0]
    assert (unit["model"], unit["strength"], unit["end_percent"]) == ("openpose.safetensors", 0.7, 0.6)
    assert unit["preprocessors"] == ["DWPreprocessor"]
    assert unit["image"]["found"] is True and unit["image"]["node"] == "5"
    assert reference_image(metadata, locate_comfyui(comfyui), "5").endswith("pose ref.png")
    assert editor_workflow(metadata) == EDITOR

    unresolved = analyze(metadata, locate_comfyui(""))
    assert unresolved["controlnets"][0]["image"] == {"node": "5", "filename": "pose ref.png", "found": False, "path": ""}


def test_editor_graph_only_still_lists_nodes(tmp_path):
    metadata = extract_metadata(comfy_png(tmp_path / "out.png", prompt=False))
    result = analyze(metadata)
    assert result["workflowAvailable"] and result["nodeTypes"] == {"KSampler": 1, "LoadImage": 1}
    assert result["inputImages"][0]["filename"] == "pose ref.png"


def test_a1111_controlnet_adetailer_and_hires_fields():
    parameters = (
        'fox\nNegative prompt: blur\nSteps: 20, Seed: 4, Denoising strength: 0.4, Hires upscale: 2, '
        'ControlNet 0: "Module: openpose_full, Model: control_v11p_sd15_openpose [cab727d4], Weight: 0.8, '
        'Guidance Start: 0, Guidance End: 0.7, Control Mode: Balanced", ADetailer model: face_yolov8n.pt'
    )
    from backend.gallery_metadata import parse_a1111

    result = analyze(parse_a1111(parameters))
    unit = result["controlnets"][0]
    assert (unit["preprocessor"], unit["weight"], unit["end"]) == ("openpose_full", "0.8", "0.7")
    assert unit["model"] == "control_v11p_sd15_openpose [cab727d4]"
    assert result["adetailer"] == {"model": "face_yolov8n.pt"}
    assert result["hires"] == {"Denoising strength": "0.4", "Hires upscale": "2"}


def test_reverse_queue_waits_for_a_ready_tagger(tmp_path):
    library = GalleryLibrary(tmp_path / "store", autostart=False)
    try:
        folder = tmp_path / "images"
        comfy_png(folder / "has-metadata.png")
        Image.new("RGB", (16, 16), "red").save(folder / "plain.png")
        root = library.add_root(str(folder))
        library.run_job(root["job"]["id"])  # the auto follow-up must not fail the scan
        assert library.jobs()[-1]["status"] == "completed"
        assert library.list_assets(needs_reverse=True)["total"] == 1
        status = library.reverse_status()
        assert status["pending"] == 1 and status["ready"] is False and status["blockers"]
        result = library.queue_reverse(quiet=True)
        assert result["jobs"] == [] and result["blocked"]
        with pytest.raises(GalleryError):
            library.queue_reverse()
    finally:
        library.close()
