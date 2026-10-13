from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.path_access import PathAccess
from backend.service import BackendService


class OpenDirectoryTests(unittest.TestCase):
    def _service(self, root: Path, opened: list[Path]) -> BackendService:
        def open_directory(path: Path) -> bool:
            opened.append(path)
            return True

        return BackendService(
            PathAccess([root]),
            root,
            root / "session.json",
            open_directory=open_directory,
        )

    def test_opens_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            opened: list[Path] = []
            self.assertTrue(self._service(root, opened).call("openDirectory", [str(root)]))
            self.assertEqual([path.resolve() for path in opened], [root.resolve()])

    def test_refuses_file_so_it_is_never_executed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            script = root / "run.bat"
            script.write_text("echo hi", encoding="utf-8")
            opened: list[Path] = []
            self.assertFalse(self._service(root, opened).call("openDirectory", [str(script)]))
            self.assertEqual(opened, [])


if __name__ == "__main__":
    unittest.main()
