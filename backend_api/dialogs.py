from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Callable, TypeVar

from backend.path_access import PathAccess
from backend.service import BackendService

DialogResult = TypeVar("DialogResult")


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
    return BackendService(
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
