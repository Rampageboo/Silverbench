from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.image_pool import read_snapshot, snapshot_path, write_snapshot


class ImagePoolSnapshotTests(unittest.TestCase):
    def test_read_snapshot_falls_back_for_missing_or_malformed_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)

            missing = read_snapshot(root)
            self.assertEqual(missing["knownFiles"], [])
            self.assertIsNone(missing["scanCache"])

            path = snapshot_path(root)
            path.parent.mkdir(parents=True)
            path.write_text("{bad json", encoding="utf-8")

            malformed = read_snapshot(root)
            self.assertEqual(malformed, missing)

    def test_write_snapshot_preserves_existing_scan_cache(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = snapshot_path(root)
            path.parent.mkdir(parents=True)
            path.write_text(
                '{"scanCache":{"fingerprint":"1:2","files":["a.jpg"]}}',
                encoding="utf-8",
            )

            write_snapshot(root, ["b.jpg", "a.jpg", "a.jpg"])
            snapshot = read_snapshot(root)

            self.assertEqual(snapshot["knownFiles"], ["a.jpg", "b.jpg"])
            self.assertEqual(snapshot["scanCache"]["fingerprint"], "1:2")


if __name__ == "__main__":
    unittest.main()
