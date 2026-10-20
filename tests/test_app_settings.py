from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.yolo_workspace import read_app_settings, write_app_settings
from backend.path_access import PathAccess
from backend.service import BackendService


class AppSettingsTests(unittest.TestCase):
    def test_read_app_settings_uses_defaults_for_missing_or_malformed_file(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session_dir = Path(tmp)

            missing = read_app_settings(session_dir)
            self.assertEqual(missing["startupOverlayMode"], "overview")
            self.assertFalse(missing["sidebarCollapsed"])

            (session_dir / "yolo_app_settings.json").write_text("{bad json", encoding="utf-8")
            with contextlib.redirect_stderr(io.StringIO()):
                malformed = read_app_settings(session_dir)
            self.assertEqual(malformed, missing)

    def test_write_app_settings_normalizes_known_values(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            session_dir = Path(tmp)

            write_app_settings(
                session_dir,
                {
                    "lastWorkspace": "legacy-root",
                    "startupOverlayMode": "minimal",
                    "sidebarCollapsed": 1,
                },
            )

            settings = read_app_settings(session_dir)
            self.assertEqual(settings["lastOpenedFolder"], "legacy-root")
            self.assertEqual(settings["startupOverlayMode"], "minimal")
            self.assertTrue(settings["sidebarCollapsed"])

    def test_backend_service_uses_app_settings_dir(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            session_dir = root / "Sessions"
            app_settings_dir = root
            service = BackendService(
                PathAccess([session_dir]),
                session_dir,
                app_settings_dir=app_settings_dir,
            )

            service.call("writeAppSettings", ['{"startupOverlayMode":"minimal"}'])

            self.assertTrue((app_settings_dir / "yolo_app_settings.json").is_file())
            self.assertFalse((session_dir / "yolo_app_settings.json").exists())
            settings = read_app_settings(app_settings_dir)
            self.assertEqual(settings["startupOverlayMode"], "minimal")


if __name__ == "__main__":
    unittest.main()
