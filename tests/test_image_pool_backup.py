from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.image_pool_backup import image_pool_backup_file, image_pool_label_backup_file


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


if __name__ == "__main__":
    unittest.main()
