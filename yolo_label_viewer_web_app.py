from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from PySide6 import QtCore, QtGui, QtWidgets
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtWebEngineWidgets import QWebEngineView

from backend.bridge import BackendBridge
from backend.video_screenshot import find_videos
from backend.dataset_merge import VIDEO_EXTENSIONS


APP_DIR = Path(__file__).resolve().parent
HTML_PATH = APP_DIR / "web" / "index.html"
if not HTML_PATH.exists():
    HTML_PATH = APP_DIR / "yolo_label_viewer_web.html"


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

        self.view.setUrl(QtCore.QUrl.fromLocalFile(str(HTML_PATH)))

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
    """Reduce Qt WebEngine compositor tearing with large fixed overlays."""
    flag = "--disable-gpu-compositing"
    current = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    if flag not in current:
        os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = f"{current} {flag}".strip()


def main() -> None:
    _configure_webengine()
    app = QtWidgets.QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
