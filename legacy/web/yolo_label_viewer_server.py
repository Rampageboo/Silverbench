from __future__ import annotations

import hmac
import json
import os
import secrets
import socket
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, TypeVar
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.path_access import PathAccess
from backend.service import BackendService
from backend.torch_runtime import torch_runtime_info


WEB_DIR = ROOT / "legacy" / "web"
APP_SETTINGS_DIR = ROOT
SESSION_DIR = ROOT / "Sessions"
SESSION_FILE = SESSION_DIR / "yolo_label_viewer_session.json"
API_TOKEN = secrets.token_urlsafe(32)
API_TOKEN_HEADER = "X-Yolo-WorkBench-Token"
LEGACY_API_TOKEN_HEADER = "X-Yolo-Label-Viewer-Token"
PATH_ACCESS = PathAccess([SESSION_DIR])
HEARTBEAT_METHOD = "__heartbeat"
HEARTBEAT_TIMEOUT_SECONDS = 60 * 60 * 6
HEARTBEAT_CHECK_SECONDS = 2
_heartbeat_lock = threading.Lock()
_last_heartbeat = 0.0
_heartbeat_started = False
DialogResult = TypeVar("DialogResult")


def _run_topmost_dialog(callback: Callable[[Any], DialogResult]) -> DialogResult:
    """Run a Tk file dialog with a hidden topmost parent window."""
    import tkinter as tk

    root = tk.Tk()
    root.withdraw()
    try:
        try:
            root.attributes("-topmost", True)
        except tk.TclError:
            pass
        return callback(root)
    finally:
        try:
            root.attributes("-topmost", False)
        except tk.TclError:
            pass
        root.destroy()


def _choose_directory(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        folder = filedialog.askdirectory(title=title, parent=root)
        return str(Path(folder)) if folder else ""

    return _run_topmost_dialog(choose)


def _choose_video_files(title: str) -> list[Path]:
    from tkinter import filedialog

    def choose(root: Any) -> list[Path]:
        paths = filedialog.askopenfilenames(
            title=title,
            parent=root,
            filetypes=[
                ("Video Files", "*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg"),
                ("All Files", "*.*"),
            ],
        )
        return [Path(path) for path in paths]

    return _run_topmost_dialog(choose)


def _choose_image_file(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        path = filedialog.askopenfilename(
            title=title,
            parent=root,
            filetypes=[
                ("Image Files", "*.png *.jpg *.jpeg *.bmp *.webp"),
                ("All Files", "*.*"),
            ],
        )
        return str(Path(path)) if path else ""

    return _run_topmost_dialog(choose)


def _choose_onnx_file(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        path = filedialog.askopenfilename(
            title=title,
            parent=root,
            filetypes=[
                ("ONNX Models", "*.onnx"),
                ("All Files", "*.*"),
            ],
        )
        return str(Path(path)) if path else ""

    return _run_topmost_dialog(choose)


def _choose_model_file(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        path = filedialog.askopenfilename(
            title=title,
            parent=root,
            filetypes=[
                ("YOLO Models", "*.pt *.onnx"),
                ("PyTorch Weights", "*.pt"),
                ("ONNX Models", "*.onnx"),
                ("All Files", "*.*"),
            ],
        )
        return str(Path(path)) if path else ""

    return _run_topmost_dialog(choose)


def _open_directory(path: Path) -> bool:
    os.startfile(str(path))
    return True


SERVICE = BackendService(
    PATH_ACCESS,
    SESSION_DIR,
    SESSION_FILE,
    app_settings_dir=APP_SETTINGS_DIR,
    choose_directory=_choose_directory,
    choose_image_file=_choose_image_file,
    choose_classifier_model=_choose_onnx_file,
    choose_train_model_file=_choose_model_file,
    choose_video_files=_choose_video_files,
    open_directory=_open_directory,
)


def api_call(method: str, args: list) -> object:
    return SERVICE.call(method, args)


def mark_heartbeat() -> None:
    global _heartbeat_started, _last_heartbeat
    with _heartbeat_lock:
        _heartbeat_started = True
        _last_heartbeat = time.monotonic()


def should_shutdown_for_browser_state() -> bool:
    with _heartbeat_lock:
        if not _heartbeat_started:
            return False
        now = time.monotonic()
        return now - _last_heartbeat > HEARTBEAT_TIMEOUT_SECONDS


def start_heartbeat_watchdog(server: ThreadingHTTPServer) -> threading.Thread:
    def watch() -> None:
        while True:
            time.sleep(HEARTBEAT_CHECK_SECONDS)
            if should_shutdown_for_browser_state():
                print("Browser page closed or idle timeout reached; shutting down RampageWorkbench server.")
                server.shutdown()
                return

    thread = threading.Thread(target=watch, daemon=True)
    thread.start()
    return thread


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self) -> None:
        if urlparse(self.path).path != "/api":
            self.send_error(404)
            return
        if not self._has_valid_api_token():
            self._send_json({"ok": False, "error": "Invalid or missing API token."}, status=403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length) or b"{}")
            method = str(payload.get("method") or "")
            if method == HEARTBEAT_METHOD:
                mark_heartbeat()
                self._send_json({"ok": True, "result": "alive"})
                return
            result = api_call(method, list(payload.get("args") or []))
            self._send_json({"ok": True, "result": result})
        except Exception as error:
            self._send_json({"ok": False, "error": str(error)}, status=500)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def _send_json(self, data: dict, status: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _has_valid_api_token(self) -> bool:
        token = self.headers.get(API_TOKEN_HEADER, "") or self.headers.get(LEGACY_API_TOKEN_HEADER, "")
        return hmac.compare_digest(token, API_TOKEN)

    def log_message(self, format: str, *args) -> None:
        print(f"{self.address_string()} - {format % args}")


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> None:
    if not WEB_DIR.exists():
        raise SystemExit(f"Missing web directory: {WEB_DIR}")
    port = int(sys.argv[1]) if len(sys.argv) > 1 else free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}/?apiToken={API_TOKEN}"
    print(f"RampageWorkbench server: {url}")
    torch_info = torch_runtime_info()
    print(
        "Torch runtime: "
        f"python={torch_info['python']} "
        f"torch={torch_info['torchVersion']} "
        f"torch_cuda={torch_info['torchCudaVersion']} "
        f"cuda_available={torch_info['cudaAvailable']} "
        f"cuda_devices={torch_info['cudaDeviceCount']} "
        f"device={torch_info['cudaDeviceName'] or 'none'}"
    )
    print(
        f"Server will auto-exit after {HEARTBEAT_TIMEOUT_SECONDS // 3600}h without browser heartbeat. "
        "Press Ctrl+C to stop it sooner."
    )
    start_heartbeat_watchdog(server)
    threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
