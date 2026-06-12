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

from backend.bridge import BackendBridge, SESSION_DIR
from backend.video_screenshot import find_videos
from backend.dataset_merge import VIDEO_EXTENSIONS
from backend.yolo_workspace import read_app_settings


APP_DIR = Path(__file__).resolve().parent
ICON_ICO_PATH = APP_DIR / "assets" / "app-icon.ico"
ICON_PNG_PATH = APP_DIR / "assets" / "app-icon.png"
WINDOWS_APP_ID = "YoloWorkBench.Desktop.1"
HTML_PATH = APP_DIR / "web" / "index.html"
if not HTML_PATH.exists():
    HTML_PATH = APP_DIR / "yolo_label_viewer_web.html"


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
    mode = str(read_app_settings(SESSION_DIR).get("startupOverlayMode") or "overview").strip().lower()
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
        if not url.isLocalFile():
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
        if not url.isLocalFile():
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
        self.setWindowTitle("YoloWorkBench")
        self.resize(1440, 900)
        self.setAcceptDrops(True)

        self.view = VideoWebView(self)
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
    """Keep GPU compositing on by default; isolate startup overlay in CSS instead."""
    flags: list[str] = []
    if os.environ.get("YWB_DISABLE_GPU_COMPOSITING", "").strip().lower() in ("1", "true", "yes"):
        flags.append("--disable-gpu-compositing")
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
    app.setApplicationName("YoloWorkBench")
    app.setApplicationDisplayName("YoloWorkBench")
    window = MainWindow()
    _apply_app_icon(app, window)
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
