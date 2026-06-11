from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.metadata_assign import remove_clf_dataset_links
from backend.yolo_workspace import create_workspace


class RemoveClfDatasetLinksTests(unittest.TestCase):
    def test_remove_clf_links_for_filenames(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            clf_out = root / "clf_dataset"
            keep_path = clf_out / "train" / "cat" / "keep.jpg"
            drop_train = clf_out / "train" / "dog" / "drop.jpg"
            drop_val = clf_out / "val" / "cat" / "drop.jpg"
            for path in (keep_path, drop_train, drop_val):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"linked")

            result = remove_clf_dataset_links(root, ["drop.jpg"])
            self.assertTrue(result["ok"])
            self.assertEqual(result["removedImages"], 2)
            self.assertTrue(keep_path.is_file())
            self.assertFalse(drop_train.is_file())
            self.assertFalse(drop_val.is_file())


if __name__ == "__main__":
    unittest.main()
