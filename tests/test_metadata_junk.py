from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.metadata_assign import INBOX_JUNK_CLASS, read_metadata_rows, upsert_metadata_rows
from backend.yolo_workspace import create_workspace


class MetadataJunkPersistenceTests(unittest.TestCase):
    def test_upsert_junk_persists_in_metadata_csv(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            (root / "image_pool" / "sample.jpg").write_bytes(b"fake")

            result = upsert_metadata_rows(
                root,
                [
                    {
                        "filename": "sample.jpg",
                        "detect_enabled": False,
                        "clf_enabled": False,
                        "clf_class": INBOX_JUNK_CLASS,
                    }
                ],
            )
            self.assertTrue(result["ok"])

            payload = read_metadata_rows(root)
            row = next(item for item in payload["rows"] if item["filename"] == "sample.jpg")
            self.assertEqual(row["clf_class"], INBOX_JUNK_CLASS)
            self.assertEqual(row["detect_enabled"], "0")
            self.assertEqual(row["clf_enabled"], "0")
            self.assertEqual(row.get("detect_junk", "0"), "0")

            text = (root / "metadata.csv").read_text(encoding="utf-8")
            self.assertIn("__junk__", text)

    def test_upsert_detect_junk_persists(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            (root / "image_pool" / "sample.jpg").write_bytes(b"fake")

            result = upsert_metadata_rows(
                root,
                [{"filename": "sample.jpg", "detect_junk": True, "detect_enabled": False}],
            )
            self.assertTrue(result["ok"])

            payload = read_metadata_rows(root)
            row = next(item for item in payload["rows"] if item["filename"] == "sample.jpg")
            self.assertEqual(row["detect_junk"], "1")
            self.assertEqual(row["detect_enabled"], "0")


if __name__ == "__main__":
    unittest.main()
