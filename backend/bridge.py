from __future__ import annotations

import json
import sys
from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets

from .path_access import PathAccess
from .service import BackendService

APP_DIR = Path(__file__).resolve().parent.parent
BROWSER_HTML = APP_DIR / "legacy" / "web" / "index.html"
SESSION_DIR = APP_DIR / "Sessions"
SESSION_FILE = SESSION_DIR / "yolo_label_viewer_session.json"


class BackendBridge(QtCore.QObject):
    """QWebChannel bridge exposed to the HTML frontend as `backend`."""

    def __init__(self, parent: QtCore.QObject | None = None) -> None:
        super().__init__(parent)
        self.path_access = PathAccess([SESSION_DIR])
        self.service = BackendService(
            self.path_access,
            SESSION_DIR,
            SESSION_FILE,
            app_settings_dir=APP_DIR,
            choose_directory=self._choose_directory_dialog,
            choose_image_file=self._choose_image_file_dialog,
            choose_image_files=self._choose_image_files_dialog,
            choose_media_files=self._choose_media_files_dialog,
            choose_classifier_model=self._choose_classifier_model_dialog,
            choose_train_model_file=self._choose_train_model_file_dialog,
            choose_video_files=self._choose_video_files_dialog,
            open_directory=self._open_directory,
        )

    @QtCore.Slot(result=str)
    def ping(self) -> str:
        return "python-backend-ready"

    @QtCore.Slot(str, str, result=str)
    def apiCall(self, method: str, args_json: str = "[]") -> str:
        """Dispatch any BackendService API call; returns JSON {ok, result|error}."""
        try:
            raw_args = json.loads(args_json or "[]")
            if not isinstance(raw_args, list):
                raise ValueError("Args must be a JSON array.")
            result = self.service.call(method, raw_args)
            payload: dict[str, object] = {"ok": True, "result": result}
        except Exception as error:
            print(f"[backend] {method} failed: {error}", file=sys.stderr, flush=True)
            payload = {"ok": False, "error": str(error)}
        return json.dumps(payload, ensure_ascii=False)

    @QtCore.Slot(str, result=str)
    def chooseVideoFile(self, title: str = "Choose Video") -> str:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            None,
            title,
            "",
            "Video Files (*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg);;All Files (*)",
        )
        return str(self.path_access.remember_parent(path)) if path else ""

    @QtCore.Slot(result=bool)
    def openBrowserWebUI(self) -> bool:
        """Open the web UI in the system browser (Chrome/Edge)."""
        if not BROWSER_HTML.exists():
            return False
        return QtGui.QDesktopServices.openUrl(QtCore.QUrl.fromLocalFile(str(BROWSER_HTML.resolve())))

    def _choose_directory_dialog(self, title: str) -> str:
        return QtWidgets.QFileDialog.getExistingDirectory(None, title)

    def _choose_image_file_dialog(self, title: str) -> str:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            None,
            title,
            "",
            "Image Files (*.png *.jpg *.jpeg *.bmp *.webp);;All Files (*)",
        )
        return path

    def _choose_image_files_dialog(self, title: str) -> list[Path]:
        paths, _ = QtWidgets.QFileDialog.getOpenFileNames(
            None,
            title,
            "",
            "Image Files (*.png *.jpg *.jpeg *.bmp *.webp);;All Files (*)",
        )
        return [Path(path) for path in paths]

    def _choose_media_files_dialog(self, title: str) -> list[Path]:
        paths, _ = QtWidgets.QFileDialog.getOpenFileNames(
            None,
            title,
            "",
            (
                "Media Files (*.png *.jpg *.jpeg *.bmp *.webp *.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg);;"
                "Image Files (*.png *.jpg *.jpeg *.bmp *.webp);;"
                "Video Files (*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg);;"
                "All Files (*)"
            ),
        )
        return [Path(path) for path in paths]

    def _choose_classifier_model_dialog(self, title: str) -> str:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            None,
            title,
            "",
            "ONNX Models (*.onnx);;All Files (*)",
        )
        return path

    def _choose_train_model_file_dialog(self, title: str) -> str:
        path, _ = QtWidgets.QFileDialog.getOpenFileName(
            None,
            title,
            "",
            "YOLO Models (*.pt *.onnx);;PyTorch Weights (*.pt);;ONNX Models (*.onnx);;All Files (*)",
        )
        return path

    def _choose_video_files_dialog(self, title: str) -> list[Path]:
        paths, _ = QtWidgets.QFileDialog.getOpenFileNames(
            None,
            title,
            "",
            "Video Files (*.mp4 *.mov *.m4v *.avi *.mkv *.webm *.wmv *.mpeg *.mpg);;All Files (*)",
        )
        return [Path(path) for path in paths]

    def _open_directory(self, path: Path) -> bool:
        return QtGui.QDesktopServices.openUrl(QtCore.QUrl.fromLocalFile(str(path)))
