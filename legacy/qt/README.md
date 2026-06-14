# Legacy Qt Shell

The original PySide6/QWebEngine desktop shell:

- `yolo_label_viewer_web_app.py` — Qt host loading `web/index.html`
- `backend/bridge.py` — QWebChannel bridge
- `../web/yolo_label_viewer_server.py` — older browser + HTTP `/api` launcher

The default desktop path is Tauri + FastAPI via `run.bat`.
Use `run_legacy_qt.bat` when you specifically need the old Qt host.

The React rewrite lives under `apps/desktop/` and starts with `npm run tauri:dev`.
