from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.yolo_workspace import create_workspace, list_workspace_files


class ListWorkspaceFilesTests(unittest.TestCase):
    def test_includes_detect_labels_and_detect_dataset_labels(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            (root / "image_pool" / "a.jpg").write_bytes(b"\xff\xd8\xff")
            (root / "detect_labels" / "a.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
            (root / "detect_dataset" / "labels" / "train" / "b.txt").write_text(
                "1 0.4 0.4 0.3 0.3\n", encoding="utf-8"
            )
            (root / "detect_dataset" / "data.yaml").write_text("names:\n  0: cat\n", encoding="utf-8")

            paths = list_workspace_files(root)

            self.assertIn("image_pool/a.jpg", paths)
            self.assertIn("detect_labels/a.txt", paths)
            self.assertIn("detect_dataset/labels/train/b.txt", paths)
            self.assertIn("detect_dataset/data.yaml", paths)

            inner_paths = list_workspace_files(root / "workspace")
            self.assertEqual(paths, inner_paths)


if __name__ == "__main__":
    unittest.main()
