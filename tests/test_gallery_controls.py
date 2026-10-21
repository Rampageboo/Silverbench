"""Control maps through a fake ComfyUI that speaks the real HTTP API."""

import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from PIL import Image

from backend.comfyui_client import ComfyUiClient, ComfyUiError
from backend.gallery_library import GalleryLibrary

OBJECT_INFO = {
    "LoadImage": {"input": {"required": {"image": [["x.png"], {}]}}},
    "SaveImage": {"input": {"required": {"images": ["IMAGE"], "filename_prefix": ["STRING", {"default": "ComfyUI"}]}}},
    "DWPreprocessor": {"input": {"required": {
        "image": ["IMAGE"],
        "detect_hand": [["enable", "disable"], {"default": "enable"}],
        "resolution": ["INT", {"default": 512, "min": 64}],
        "bbox_detector": [["yolox_l.onnx", "None"]],
    }}},
    "Canny": {"input": {"required": {"image": ["IMAGE"], "low_threshold": ["FLOAT", {"default": 0.4}], "high_threshold": ["FLOAT", {"default": 0.8}]}}},
}


class FakeComfy(BaseHTTPRequestHandler):
    prompts: dict = {}
    uploads: list = []
    running: list = []

    def log_message(self, *args):
        pass

    def _send(self, payload, content_type="application/json"):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/system_stats":
            return self._send({"system": {"comfyui_version": "0.3.test"}})
        if self.path == "/object_info":
            return self._send(OBJECT_INFO)
        if self.path == "/queue":
            return self._send({"queue_running": self.running, "queue_pending": []})
        if self.path.startswith("/history/"):
            prompt_id = self.path.rsplit("/", 1)[1]
            graph = self.prompts.get(prompt_id)
            if graph is None:
                return self._send({})
            return self._send({prompt_id: {"status": {"completed": True, "status_str": "success"},
                                           "outputs": {"3": {"images": [{"filename": f"{prompt_id}.png", "subfolder": "rwb_control", "type": "output"}]}}}})
        if self.path.startswith("/view?"):
            buffer = io.BytesIO()
            Image.new("RGB", (8, 8), "black").save(buffer, format="PNG")
            return self._send(buffer.getvalue(), "image/png")
        self.send_error(404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        if self.path == "/upload/image":
            assert b'name="image"' in body and b'name="subfolder"' in body
            type(self).uploads.append(body)
            return self._send({"name": f"up{len(self.uploads)}.png", "subfolder": "rwb", "type": "input"})
        if self.path == "/prompt":
            graph = json.loads(body)["prompt"]
            prompt_id = f"p{len(self.prompts) + 1}"
            type(self).prompts[prompt_id] = graph
            return self._send({"prompt_id": prompt_id, "node_errors": {}})
        if self.path in ("/queue", "/interrupt"):
            return self._send({})
        self.send_error(404)


@pytest.fixture
def comfy():
    FakeComfy.prompts, FakeComfy.uploads, FakeComfy.running = {}, [], []
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def test_check_reports_available_preprocessors(comfy):
    result = ComfyUiClient(comfy).check()
    assert result["ok"] and result["version"] == "0.3.test"
    assert result["preprocessors"] == {"pose": "DWPreprocessor", "depth": None, "lineart": None, "canny": "Canny"}
    assert "comfyui_controlnet_aux" in result["warning"]
    assert ComfyUiClient("http://127.0.0.1:9", timeout=1).check()["ok"] is False
    with pytest.raises(ComfyUiError):
        ComfyUiClient("ftp://example")


def test_preprocessor_graph_uses_comfyui_defaults(comfy, tmp_path):
    image = tmp_path / "in.png"
    Image.new("RGB", (16, 16), "white").save(image)
    png, node = ComfyUiClient(comfy).run_preprocessor(image, "pose", resolution=768)
    assert node == "DWPreprocessor" and png.startswith(b"\x89PNG")
    graph = FakeComfy.prompts["p1"]
    assert graph["1"]["inputs"]["image"] == "rwb/up1.png"
    assert graph["2"]["inputs"] == {"image": ["1", 0], "detect_hand": "enable", "resolution": 768, "bbox_detector": "yolox_l.onnx"}
    with pytest.raises(ComfyUiError, match="comfyui_controlnet_aux"):
        ComfyUiClient(comfy).run_preprocessor(image, "depth")


def test_reverse_queue_makes_control_maps_for_images_without_metadata(comfy, tmp_path):
    library = GalleryLibrary(tmp_path / "store", autostart=False)
    try:
        library.save_settings({"comfyuiUrl": comfy, "controlKinds": ["pose", "canny"], "autoReverse": False})
        folder = tmp_path / "images"
        folder.mkdir()
        Image.new("RGB", (16, 16), "red").save(folder / "plain.png")
        library.run_job(library.add_root(str(folder))["job"]["id"])
        asset = library.list_assets()["items"][0]["id"]

        status = library.reverse_status()
        assert status["controls"]["ready"] and status["controls"]["pending"] == 1 and status["ready"] is False
        result = library.queue_reverse()  # tagger not ready, ComfyUI is: only the control stage runs
        assert [job["type"] for job in result["jobs"]] == ["control"] and result["blocked"]

        job = result["jobs"][0]
        with library.connection() as db:
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (job["id"],))
        library._run_control_job(job["id"])
        assert library.jobs()[0]["status"] == "completed"
        assert [c["kind"] for c in library.controls(asset)] == ["canny", "pose"]
        assert library.control_file(asset, "pose").read_bytes().startswith(b"\x89PNG")
        assert library.reverse_status()["controls"]["pending"] == 0
    finally:
        library.close()
