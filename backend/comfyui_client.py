"""Run ControlNet preprocessors on a running ComfyUI and fetch the resulting maps.

RampageWorkbench does not bundle pose/depth/lineart models: the user's ComfyUI
(with comfyui_controlnet_aux) already has them. Each map is one tiny graph:
LoadImage -> preprocessor -> SaveImage. Required preprocessor inputs are read
from ``/object_info`` and filled with ComfyUI's own defaults, so this keeps
working across controlnet_aux versions. The server may be this computer or the
other one on the LAN; only the address the user configured is contacted.
"""

from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

DEFAULT_URL = "http://127.0.0.1:8188"

# Preferred node first; the first one the server has is used.
CONTROL_KINDS: dict[str, tuple[str, ...]] = {
    "pose": ("DWPreprocessor", "OpenposePreprocessor"),
    "depth": ("DepthAnythingV2Preprocessor", "DepthAnythingPreprocessor", "MiDaS-DepthMapPreprocessor", "Zoe-DepthMapPreprocessor"),
    "lineart": ("AnimeLineArtPreprocessor", "LineArtPreprocessor", "Manga2Anime_LineArt_Preprocessor"),
    "canny": ("CannyEdgePreprocessor", "Canny"),
}
KIND_LABELS = {"pose": "姿势", "depth": "深度", "lineart": "线稿", "canny": "Canny 边缘"}


class ComfyUiError(RuntimeError):
    pass


def normalize_url(url: str | None) -> str:
    value = str(url or DEFAULT_URL).strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path not in ("", "/") or parsed.query:
        raise ComfyUiError("ComfyUI address must look like http://127.0.0.1:8188 (or the other computer's LAN address).")
    return value


class ComfyUiClient:
    def __init__(self, url: str | None, timeout: float = 30) -> None:
        self.url = normalize_url(url)
        self.timeout = timeout
        self._object_info: dict[str, Any] | None = None

    # ── HTTP ────────────────────────────────────────────────────────────────

    def _open(self, path: str, data: bytes | None = None, headers: dict[str, str] | None = None, timeout: float | None = None) -> bytes:
        request = Request(f"{self.url}{path}", data=data, headers=headers or {}, method="POST" if data is not None else "GET")
        try:
            with urlopen(request, timeout=timeout or self.timeout) as response:
                return response.read()
        except HTTPError as error:
            detail = error.read()[:800].decode("utf-8", "replace")
            raise ComfyUiError(f"ComfyUI {path} returned {error.code}: {detail}") from error
        except (URLError, TimeoutError, OSError) as error:
            raise ComfyUiError(f"ComfyUI is not reachable at {self.url}: {error}") from error

    def _json(self, path: str, body: Any = None) -> Any:
        data = None if body is None else json.dumps(body).encode("utf-8")
        raw = self._open(path, data, {"Content-Type": "application/json"} if data is not None else None)
        return json.loads(raw.decode("utf-8"))

    # ── capabilities ────────────────────────────────────────────────────────

    def object_info(self) -> dict[str, Any]:
        if self._object_info is None:
            self._object_info = self._json("/object_info")
        return self._object_info

    def check(self) -> dict[str, Any]:
        """Reachability plus which preprocessor node each map kind would use."""
        try:
            stats = self._json("/system_stats")
            info = self.object_info()
        except (ComfyUiError, ValueError) as error:
            return {"ok": False, "url": self.url, "error": str(error), "preprocessors": {}}
        preprocessors = {kind: next((node for node in nodes if node in info), None) for kind, nodes in CONTROL_KINDS.items()}
        missing = [KIND_LABELS[kind] for kind, node in preprocessors.items() if node is None]
        return {
            "ok": True,
            "url": self.url,
            "version": (stats.get("system") or {}).get("comfyui_version", ""),
            "preprocessors": preprocessors,
            "warning": (f"Missing preprocessors for {', '.join(missing)}: install comfyui_controlnet_aux." if missing else ""),
        }

    def _default_inputs(self, node: str, resolution: int) -> dict[str, Any]:
        spec = (self.object_info().get(node) or {}).get("input", {}).get("required", {})
        values: dict[str, Any] = {}
        for name, definition in spec.items():
            if name == "image":
                continue
            kind = definition[0] if definition else None
            options = definition[1] if len(definition) > 1 and isinstance(definition[1], dict) else {}
            if name == "resolution":
                values[name] = resolution
            elif isinstance(kind, list):  # combo: ComfyUI's default, else the first choice
                values[name] = options.get("default", kind[0] if kind else "")
            elif "default" in options:
                values[name] = options["default"]
            else:
                raise ComfyUiError(f"{node} needs input '{name}' without a default; this node is not supported automatically.")
        return values

    # ── running ─────────────────────────────────────────────────────────────

    def upload(self, path: Path) -> str:
        boundary = uuid.uuid4().hex
        name = f"{uuid.uuid4().hex[:8]}_{path.name}"
        parts = [
            f'--{boundary}\r\nContent-Disposition: form-data; name="subfolder"\r\n\r\nrwb\r\n'.encode(),
            f'--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n'.encode(),
            (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
             "Content-Type: application/octet-stream\r\n\r\n").encode(),
            path.read_bytes(),
            f"\r\n--{boundary}--\r\n".encode(),
        ]
        result = json.loads(self._open("/upload/image", b"".join(parts), {"Content-Type": f"multipart/form-data; boundary={boundary}"}))
        subfolder = result.get("subfolder") or ""
        return f"{subfolder}/{result['name']}" if subfolder else result["name"]

    def run_preprocessor(
        self,
        image: Path,
        kind: str,
        *,
        resolution: int = 1024,
        timeout: float = 600,
        cancelled: Callable[[], bool] = lambda: False,
    ) -> tuple[bytes, str]:
        """Return (PNG bytes, node used) for one control map of ``image``."""
        node = next((n for n in CONTROL_KINDS.get(kind, ()) if n in self.object_info()), None)
        if node is None:
            raise ComfyUiError(f"No {KIND_LABELS.get(kind, kind)} preprocessor on this ComfyUI (install comfyui_controlnet_aux).")
        uploaded = self.upload(image)
        graph = {
            "1": {"class_type": "LoadImage", "inputs": {"image": uploaded}},
            "2": {"class_type": node, "inputs": {"image": ["1", 0], **self._default_inputs(node, resolution)}},
            "3": {"class_type": "SaveImage", "inputs": {"images": ["2", 0], "filename_prefix": f"rwb_control/{kind}"}},
        }
        queued = self._json("/prompt", {"prompt": graph, "client_id": f"rwb-{uuid.uuid4().hex}"})
        if queued.get("node_errors"):
            raise ComfyUiError(f"ComfyUI rejected the {node} graph: {json.dumps(queued['node_errors'])[:600]}")
        prompt_id = queued["prompt_id"]
        deadline = time.monotonic() + timeout
        while True:
            if cancelled():
                self._interrupt(prompt_id)
                raise ComfyUiError("Cancelled.")
            history = self._json(f"/history/{prompt_id}").get(prompt_id)
            if history:
                status = history.get("status") or {}
                if status.get("status_str") == "error":
                    messages = [m for m in status.get("messages", []) if m and m[0] == "execution_error"]
                    raise ComfyUiError(f"{node} failed in ComfyUI: {json.dumps(messages)[:600]}")
                images = (history.get("outputs", {}).get("3") or {}).get("images") or []
                if images:
                    first = images[0]
                    query = urlencode({"filename": first["filename"], "subfolder": first.get("subfolder", ""), "type": first.get("type", "output")})
                    return self._open(f"/view?{query}"), node
                if status.get("completed"):
                    raise ComfyUiError(f"{node} finished without an image.")
            if time.monotonic() > deadline:
                self._interrupt(prompt_id)
                raise ComfyUiError(f"{node} took longer than {int(timeout)} s.")
            time.sleep(0.5)

    def _interrupt(self, prompt_id: str) -> None:
        """Drop our prompt; interrupt only if it is the one running, never the user's own work."""
        try:
            self._json("/queue", {"delete": [prompt_id]})
            running = self._json("/queue").get("queue_running") or []
            if any(len(item) > 1 and item[1] == prompt_id for item in running):
                self._json("/interrupt", {"prompt_id": prompt_id})
        except (ComfyUiError, ValueError):
            pass
