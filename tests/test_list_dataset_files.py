from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.path_access import PathAccess
from backend.service import BackendService


class ListDatasetFilesTests(unittest.TestCase):
    def test_includes_labels_and_yaml_not_only_images(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "images" / "train").mkdir(parents=True)
            (root / "labels" / "train").mkdir(parents=True)
            (root / "images" / "train" / "a.jpg").write_bytes(b"\xff\xd8\xff")
            (root / "labels" / "train" / "a.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
            (root / "labels" / "train" / "empty.txt").write_text("", encoding="utf-8")
            (root / "data.yaml").write_text("names:\n  0: cat\n", encoding="utf-8")

            service = BackendService(PathAccess([root]), Path(tmp), Path(tmp) / "session.json")
            raw = service.call("listDatasetFiles", [str(root)])
            paths = json.loads(raw)

            self.assertIn("images/train/a.jpg", paths)
            self.assertIn("labels/train/a.txt", paths)
            self.assertIn("labels/train/empty.txt", paths)
            self.assertIn("data.yaml", paths)


if __name__ == "__main__":
    unittest.main()
