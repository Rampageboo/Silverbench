from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.metadata_assign import remove_detect_dataset_links, upsert_metadata_rows
from backend.yolo_workspace import create_workspace


class RemoveDetectDatasetLinksTests(unittest.TestCase):
    def test_remove_detect_links_for_filenames(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            (root / "image_pool" / "keep.jpg").write_bytes(b"keep")
            (root / "image_pool" / "drop.jpg").write_bytes(b"drop")

            detect_out = root / "detect_dataset"
            for split, name in (("train", "keep.jpg"), ("train", "drop.jpg"), ("val", "drop.jpg")):
                images_dir = detect_out / "images" / split
                labels_dir = detect_out / "labels" / split
                images_dir.mkdir(parents=True, exist_ok=True)
                labels_dir.mkdir(parents=True, exist_ok=True)
                (images_dir / name).write_bytes(b"linked")
                (labels_dir / f"{Path(name).stem}.txt").write_text("0 0.5 0.5 0.1 0.1\n", encoding="utf-8")

            upsert_metadata_rows(root, [
                {"filename": "keep.jpg", "detect_enabled": True},
                {"filename": "drop.jpg", "detect_enabled": True},
            ])

            result = remove_detect_dataset_links(root, ["drop.jpg"])
            self.assertTrue(result["ok"])
            self.assertEqual(result["removedImages"], 2)
            self.assertEqual(result["removedLabels"], 2)
            self.assertTrue((detect_out / "images" / "train" / "keep.jpg").is_file())
            self.assertFalse((detect_out / "images" / "train" / "drop.jpg").is_file())
            self.assertFalse((detect_out / "images" / "val" / "drop.jpg").is_file())


if __name__ == "__main__":
    unittest.main()
