from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.path_access import PathAccess
from backend.service import BackendService
from backend.yolo_workspace import list_dataset_files


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

    def test_skips_empty_images_backups_and_unknown_file_types(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "images").mkdir()
            (root / "originals_before_edit").mkdir()
            (root / "images" / "empty.jpg").write_bytes(b"")
            (root / "images" / "valid.png").write_bytes(b"png")
            (root / "images" / "notes.md").write_text("ignore me", encoding="utf-8")
            (root / "originals_before_edit" / "old.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")

            paths = list_dataset_files(root)

            self.assertEqual(paths, ["images/valid.png"])


if __name__ == "__main__":
    unittest.main()
