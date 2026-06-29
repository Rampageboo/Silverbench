from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.image_pool_backup import image_pool_backup_file, image_pool_label_backup_file, restore_image_pool_backup


class ImagePoolBackupPathTests(unittest.TestCase):
    def test_legacy_backup_paths_use_basename_for_slash_styles(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            image_backup = image_pool_backup_file(root, r"nested\image.jpg")
            label_backup = image_pool_label_backup_file(root, "labels/train/image.txt")

            self.assertEqual(image_backup.name, "image.jpg")
            self.assertEqual(label_backup.name, "image.txt")
            self.assertEqual(label_backup.parent.name, "labels")

    def test_legacy_backup_paths_reject_empty_basename(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            with self.assertRaises(ValueError):
                image_pool_backup_file(root, "")
            with self.assertRaises(ValueError):
                image_pool_label_backup_file(root, "")

    def test_restore_flat_backup_allows_media_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "image_pool_backup").mkdir()
            (root / "image_pool_backup" / "sample.jpg").write_bytes(b"backup")

            result = restore_image_pool_backup(root, "media/sample.jpg")

            self.assertTrue(result["ok"])
            self.assertEqual((root / "media" / "sample.jpg").read_bytes(), b"backup")

    def test_restore_flat_backup_does_not_apply_to_dataset_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "image_pool_backup").mkdir()
            (root / "image_pool_backup" / "sample.jpg").write_bytes(b"backup")

            with self.assertRaises(FileNotFoundError):
                restore_image_pool_backup(root, "detect_dataset/images/train/sample.jpg")


if __name__ == "__main__":
    unittest.main()
