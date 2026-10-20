from __future__ import annotations

import ctypes
import json
import os
import sys
from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWebEngineWidgets import QWebEngineView

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.bridge import APP_DIR as BACKEND_APP_DIR, BackendBridge
from backend.video_screenshot import find_videos
from backend.dataset_merge import VIDEO_EXTENSIONS
from backend.yolo_workspace import read_app_settings


ICON_ICO_PATH = ROOT / "assets" / "app-icon.ico"
ICON_PNG_PATH = ROOT / "assets" / "app-icon.png"
WINDOWS_APP_ID = "RampageWorkbench.Desktop.1"
HTML_PATH = ROOT / "legacy" / "web" / "index.html"


def _configure_windows_taskbar_icon() -> None:
    """Let Windows use the window icon instead of python.exe on the taskbar."""
    if sys.platform != "win32":
        return
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(WINDOWS_APP_ID)
    except (AttributeError, OSError):
        pass


def _load_app_icon() -> QtGui.QIcon | None:
    for path in (ICON_ICO_PATH, ICON_PNG_PATH):
        if not path.is_file():
            continue
        icon = QtGui.QIcon(str(path))
        if not icon.isNull():
            return icon
    return None


def _startup_overlay_mode() -> str:
    mode = str(read_app_settings(BACKEND_APP_DIR).get("startupOverlayMode") or "overview").strip().lower()
    return "minimal" if mode == "minimal" else "overview"


def _load_startup_html() -> tuple[str, QtCore.QUrl]:
    raw = HTML_PATH.read_text(encoding="utf-8")
    mode = _startup_overlay_mode()
    injection = f'<script>window.__YWB_STARTUP_OVERLAY_MODE__={json.dumps(mode)};</script>\n'
    if "</head>" in raw:
        html = raw.replace("</head>", injection + "</head>", 1)
    else:
        html = injection + raw
    base_url = QtCore.QUrl.fromLocalFile(str(HTML_PATH.parent.resolve()) + "/")
    return html, base_url


def _apply_app_icon(app: QtWidgets.QApplication, window: QtWidgets.QMainWindow) -> None:
    icon = _load_app_icon()
    if icon is None:
        return
    app.setWindowIcon(icon)
    window.setWindowIcon(icon)


def _collect_video_paths(urls: list[QtCore.QUrl]) -> list[str]:
    paths: list[str] = []
    for url in urls:
        if not url.is_local_file():
            continue
        path = Path(url.toLocalFile())
        if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS:
            paths.append(str(path))
        elif path.is_dir():
            paths.extend(str(item) for item in find_videos(path))
    return paths


def _collect_directory_paths(urls: list[QtCore.QUrl]) -> list[str]:
    paths: list[str] = []
    for url in urls:
        if not url.is_local_file():
            continue
        path = Path(url.toLocalFile())
        if path.is_dir():
            paths.append(str(path))
    return paths


class VideoWebView(QWebEngineView):
    """Accept OS file drops and load videos via the Python/OpenCV backend."""

    def dragEnterEvent(self, event: QtGui.QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            return
        super().dragEnterEvent(event)

    def dropEvent(self, event: QtGui.QDropEvent) -> None:
        paths = _collect_video_paths(event.mimeData().urls())
        if paths:
            payload = json.dumps(paths, ensure_ascii=False)
            self.page().runJavaScript(f"window.importBackendVideoPaths({payload})")
            event.acceptProposedAction()
            return
        directories = _collect_directory_paths(event.mimeData().urls())
        if directories:
            payload = json.dumps(directories[0], ensure_ascii=False)
            self.page().runJavaScript(f"window.importBackendFolderPath({payload})")
            event.acceptProposedAction()
            return
        super().dropEvent(event)


class WebPage(QWebEnginePage):
    def javaScriptConsoleMessage(
        self,
        level: QWebEnginePage.JavaScriptConsoleMessageLevel,
        message: str,
        line_number: int,
        source_id: str,
    ) -> None:
        print(f"JS console [{level.name}] {source_id}:{line_number}: {message}")


class MainWindow(QtWidgets.QMainWindow):
    def __init__(self) -> None:
        super().__init__()
        self.setWindowTitle("RampageWorkbench")
        self.resize(1440, 900)
        self.setAcceptDrops(True)
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_OpaquePaintEvent, True)
        self.setAttribute(QtCore.Qt.WidgetAttribute.WA_NoSystemBackground, True)

        self.view = VideoWebView(self)
        self.view.setAttribute(QtCore.Qt.WidgetAttribute.WA_OpaquePaintEvent, True)
        self.view.setAttribute(QtCore.Qt.WidgetAttribute.WA_NoSystemBackground, True)
        self.view.setPage(WebPage(self.view))
        self.view.setAcceptDrops(True)
        self.setCentralWidget(self.view)
        self.channel = QWebChannel(self.view.page())
        self.backend = BackendBridge(self)
        self.channel.registerObject("backend", self.backend)
        self.view.page().setWebChannel(self.channel)

        if not HTML_PATH.exists():
            QtWidgets.QMessageBox.critical(
                self,
                "Missing HTML",
                f"Cannot find:\n{HTML_PATH}",
            )
            QtCore.QTimer.singleShot(0, self.close)
            return

        html, base_url = _load_startup_html()
        self.view.setHtml(html, base_url)

    def dragEnterEvent(self, event: QtGui.QDragEnterEvent) -> None:
        if event.mimeData().hasUrls():
            event.acceptProposedAction()
            return
        super().dragEnterEvent(event)

    def dropEvent(self, event: QtGui.QDropEvent) -> None:
        paths = _collect_video_paths(event.mimeData().urls())
        if paths:
            payload = json.dumps(paths, ensure_ascii=False)
            self.view.page().runJavaScript(f"window.importBackendVideoPaths({payload})")
            event.acceptProposedAction()
            return
        directories = _collect_directory_paths(event.mimeData().urls())
        if directories:
            payload = json.dumps(directories[0], ensure_ascii=False)
            self.view.page().runJavaScript(f"window.importBackendFolderPath({payload})")
            event.acceptProposedAction()
            return
        super().dropEvent(event)


def _configure_webengine() -> None:
    """Keep GPU compositing on, but avoid Qt WebEngine's flaky accelerated 2D canvas path."""
    flags: list[str] = []
    gpu_disabled = os.environ.get("YWB_DISABLE_GPU_COMPOSITING", "").strip().lower() in ("1", "true", "yes")
    if gpu_disabled:
        flags.append("--disable-gpu-compositing")
    else:
        angle_backend = os.environ.get("YWB_WEBENGINE_ANGLE", "d3d11").strip().lower()
        if angle_backend:
            flags.append(f"--use-angle={angle_backend}")
        if os.environ.get("YWB_ACCELERATED_2D_CANVAS", "").strip().lower() not in ("1", "true", "yes"):
            flags.append("--disable-accelerated-2d-canvas")
        if os.environ.get("YWB_WEBENGINE_ZERO_COPY", "").strip().lower() not in ("1", "true", "yes"):
            flags.append("--disable-zero-copy")
    current = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    for flag in flags:
        if flag not in current:
            current = f"{current} {flag}".strip()
    if current != os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", ""):
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = current


def main() -> None:
    _configure_webengine()
    _configure_windows_taskbar_icon()
    app = QtWidgets.QApplication(sys.argv)
    app.setApplicationName("RampageWorkbench")
    app.setApplicationDisplayName("RampageWorkbench")
    window = MainWindow()
    _apply_app_icon(app, window)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
