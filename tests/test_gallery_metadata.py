import json

from PIL import Image, PngImagePlugin

from backend.gallery_metadata import extract_metadata, parse_a1111, parse_comfyui


def test_a1111_multiline_and_literal_settings():
    text = ('a fox, <lora:fur:0.7>\nunder moonlight\nNegative prompt: blur, text\nwatermark\n'
            'Steps: 24, Sampler: Euler a, CFG scale: 6.5, Seed: 123, Size: 64x48, Model: fox-v2, '
            'Lora hashes: "fur: abcd, nested: value"')
    data = parse_a1111(text)
    assert data["positive"] == "a fox, <lora:fur:0.7>\nunder moonlight"
    assert data["negative"] == "blur, text\nwatermark"
    assert data["parameters"]["Seed"] == "123"
    assert data["parameters"]["Lora hashes"] == '"fur: abcd, nested: value"'
    assert data["model"] == "fox-v2"
    assert data["loras"] == [{"name": "fur", "weight": "0.7"}]
    assert data["raw"]["parameters"] == text


def test_comfyui_traces_sampler_conditioning_and_model_not_unused_text():
    graph = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "fox.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "unused text", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "correct fox", "clip": ["1", 1]}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "correct negative", "clip": ["1", 1]}},
        "5": {"class_type": "LoraLoader", "inputs": {"model": ["1", 0], "clip": ["1", 1],
              "lora_name": "fur.safetensors", "strength_model": 0.6, "strength_clip": 0.8}},
        "6": {"class_type": "KSampler", "inputs": {"positive": ["3", 0], "negative": ["4", 0],
              "model": ["5", 0], "seed": 72, "steps": 20, "cfg": 5.0, "sampler_name": "euler"}},
        "7": {"class_type": "VAEDecode", "inputs": {"samples": ["6", 0], "vae": ["1", 2]}},
        "8": {"class_type": "SaveImage", "inputs": {"images": ["7", 0]}},
    }
    data = parse_comfyui(json.dumps(graph), '{"nodes": []}')
    assert data["positive"] == "correct fox"
    assert data["negative"] == "correct negative"
    assert data["model"] == "fox.safetensors"
    assert data["parameters"]["seed"] == 72
    assert data["loras"][0]["strength_model"] == 0.6
    assert data["raw"]["workflow"] == '{"nodes": []}'


def test_comfyui_cycles_and_unknown_nodes_preserve_without_guessing():
    graph = {"1": {"class_type": "KSampler", "inputs": {"positive": ["2", 0]}},
             "2": {"class_type": "CustomCaption", "inputs": {"conditioning": ["2", 0], "text": "not a known encoder"}}}
    data = parse_comfyui(graph)
    assert data["positive"] == ""
    assert data["negative"] == ""
    assert data["warnings"]
    assert data["raw"]["prompt"] == graph


def test_png_novelai_preserves_parameters_and_original(tmp_path):
    path = tmp_path / "nai.png"
    info = PngImagePlugin.PngInfo()
    info.add_text("Software", "NovelAI")
    info.add_text("Description", "fallback prompt")
    comment = json.dumps({"prompt": "snow fox", "uc": "text", "seed": 19, "scale": 5.5,
                          "sampler": "k_euler", "model": "nai-diffusion"})
    info.add_text("Comment", comment)
    Image.new("RGB", (12, 8)).save(path, pnginfo=info)
    data = extract_metadata(path)
    assert data["format"] == "novelai"
    assert data["source"] == "metadata"
    assert data["positive"] == "snow fox"
    assert data["negative"] == "text"
    assert data["parameters"]["seed"] == 19
    assert data["raw"]["Comment"] == comment


def test_a1111_exif_usercomment(tmp_path):
    path = tmp_path / "exif.jpg"
    text = "fox\nNegative prompt: blur\nSteps: 12, Seed: 11, Model: exif-model"
    exif = Image.Exif()
    exif[37510] = b"ASCII\x00\x00\x00" + text.encode("utf-8")
    Image.new("RGB", (10, 10)).save(path, exif=exif)
    data = extract_metadata(path)
    assert data["format"] == "a1111"
    assert data["positive"] == "fox"
    assert data["model"] == "exif-model"


def test_plain_image_has_no_invented_metadata(tmp_path):
    path = tmp_path / "plain.png"
    Image.new("RGB", (7, 9)).save(path)
    data = extract_metadata(path)
    assert data["format"] == "none"
    assert data["source"] == "none"
    assert data["positive"] == ""
    assert data["parameters"] == {}


def test_broken_comfy_workflow_is_retained():
    data = parse_comfyui("broken JSON", '{"nodes":[{"id":1}]}')
    assert data["format"] == "comfyui"
    assert data["positive"] == ""
    assert data["raw"]["prompt"] == "broken JSON"
    assert data["warnings"]
