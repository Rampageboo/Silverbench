from __future__ import annotations

import base64
import binascii
import os
import tempfile
from pathlib import Path
from typing import Any, Callable, TypeVar

from backend.path_access import PathAccess
from backend.service import BackendService

DialogResult = TypeVar("DialogResult")

MAX_BASE64_IMAGE_BYTES = 20 * 1024 * 1024
_BASE64_IMAGE_PREFIX_BYTES = 64


def _run_topmost_dialog(callback: Callable[[Any], DialogResult]) -> DialogResult:
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


def _base64_payload(raw: str) -> str:
    value = str(raw or "").strip()
    if value.lower().startswith("data:"):
        header, sep, payload = value.partition(",")
        if not sep or ";base64" not in header.lower():
            raise ValueError("Image payload must be base64 encoded.")
        value = payload.strip()
    return value


def _base64_decoded_size(value: str) -> int:
    if not value:
        return 0
    padding = len(value) - len(value.rstrip("="))
    return (len(value) * 3) // 4 - padding


def _image_suffix_from_magic(payload: bytes) -> str:
    if payload.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if payload.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if payload.startswith(b"BM"):
        return ".bmp"
    if len(payload) >= 12 and payload[:4] == b"RIFF" and payload[8:12] == b"WEBP":
        return ".webp"
    raise ValueError("Image payload must be JPEG, PNG, BMP, or WebP.")


def _decode_limited_base64_image(image_base64: str) -> tuple[bytes, str]:
    payload_text = _base64_payload(image_base64)
    if not payload_text:
        raise ValueError("Image payload is empty.")
    if _base64_decoded_size(payload_text) > MAX_BASE64_IMAGE_BYTES:
        max_mb = MAX_BASE64_IMAGE_BYTES // (1024 * 1024)
        raise ValueError(f"Image payload is too large. Maximum size is {max_mb} MB.")
    try:
        prefix_len = min(len(payload_text), _BASE64_IMAGE_PREFIX_BYTES)
        prefix_len -= prefix_len % 4
        prefix = base64.b64decode(payload_text[:prefix_len] if prefix_len else payload_text, validate=True)
        suffix = _image_suffix_from_magic(prefix)
        payload = base64.b64decode(payload_text, validate=True)
    except binascii.Error as error:
        raise ValueError("Image payload must be valid base64.") from error
    if not payload:
        raise ValueError("Image payload is empty.")
    return payload, suffix


class DesktopBackendService(BackendService):
    def _temporary_base64_image(self, image_base64: str) -> Path:
        payload, suffix = _decode_limited_base64_image(image_base64)
        handle = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            handle.write(payload)
            return Path(handle.name)
        finally:
            handle.close()


def choose_directory(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        folder = filedialog.askdirectory(title=title, parent=root)
        return str(Path(folder)) if folder else ""

    return _run_topmost_dialog(choose)


def choose_video_files(title: str) -> list[Path]:
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


def choose_media_files(title: str) -> list[Path]:
    from tkinter import filedialog

    media_pattern = (
        "*.png *.jpg *.jpeg *.bmp *.webp "
        "*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg"
    )

    def choose(root: Any) -> list[Path]:
        paths = filedialog.askopenfilenames(
            title=title,
            parent=root,
            filetypes=[
                ("Media Files", media_pattern),
                ("Image Files", "*.png *.jpg *.jpeg *.bmp *.webp"),
                ("Video Files", "*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg"),
                ("All Files", "*.*"),
            ],
        )
        return [Path(path) for path in paths]

    return _run_topmost_dialog(choose)


def choose_image_file(title: str) -> str:
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


def choose_image_files(title: str) -> list[Path]:
    from tkinter import filedialog

    def choose(root: Any) -> list[Path]:
        paths = filedialog.askopenfilenames(
            title=title,
            parent=root,
            filetypes=[
                ("Image Files", "*.png *.jpg *.jpeg *.bmp *.webp"),
                ("All Files", "*.*"),
            ],
        )
        return [Path(path) for path in paths]

    return _run_topmost_dialog(choose)


def choose_onnx_file(title: str) -> str:
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


def choose_model_file(title: str) -> str:
    from tkinter import filedialog

    def choose(root: Any) -> str:
        path = filedialog.askopenfilename(
            title=title,
            parent=root,
            filetypes=[
                ("YOLO PyTorch Weights", "*.pt"),
                ("All Files", "*.*"),
            ],
        )
        return str(Path(path)) if path else ""

    return _run_topmost_dialog(choose)


def open_directory(path: Path) -> bool:
    os.startfile(str(path))
    return True


def create_desktop_backend_service(app_dir: Path, session_dir: Path, session_file: Path) -> BackendService:
    return DesktopBackendService(
        PathAccess([session_dir]),
        session_dir,
        session_file,
        app_settings_dir=app_dir,
        choose_directory=choose_directory,
        choose_image_file=choose_image_file,
        choose_image_files=choose_image_files,
        choose_media_files=choose_media_files,
        choose_classifier_model=choose_onnx_file,
        choose_train_model_file=choose_model_file,
        choose_video_files=choose_video_files,
        open_directory=open_directory,
    )