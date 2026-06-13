from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.yolo_workspace import (
    WORKSPACE_SESSION_DIRNAME,
    compact_inbox_session_for_storage,
    read_workspace_session_dict,
    normalize_inbox_session,
    write_workspace_session_dict,
)


class WorkspaceSessionTests(unittest.TestCase):
    def test_normalize_inbox_session_ignores_non_list_history(self) -> None:
        session = normalize_inbox_session(
            {
                "assignBatches": "not-a-list",
                "buildRuns": {"also": "not-a-list"},
                "ui": {"filter": "all", "detectEnabled": True},
            }
        )

        self.assertEqual(session["assignBatches"], [])
        self.assertEqual(session["buildRuns"], [])
        self.assertEqual(session["ui"]["filter"], "all")
        self.assertTrue(session["ui"]["detectEnabled"])

    def test_compact_inbox_session_skips_malformed_history_items(self) -> None:
        compacted = compact_inbox_session_for_storage(
            {
                "assignBatches": [
                    "bad",
                    {"built": False, "filenames": ["pending.jpg"]},
                    {"built": True, "filenames": "not-a-list"},
                ],
                "buildRuns": [
                    "bad",
                    {"filenames": ["a.jpg", "b.jpg"]},
                ],
            }
        )

        self.assertEqual(len(compacted["assignBatches"]), 2)
        self.assertEqual(compacted["assignBatches"][0]["filenames"], ["pending.jpg"])
        self.assertEqual(compacted["assignBatches"][1]["filenameCount"], 0)
        self.assertEqual(compacted["buildRuns"][0]["filenameCount"], 2)
        self.assertEqual(compacted["buildRuns"][0]["filenames"], [])

    def test_legacy_inbox_migration_tolerates_non_numeric_session_version(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            write_workspace_session_dict(root, {"version": "old"})
            legacy_dir = root / WORKSPACE_SESSION_DIRNAME
            legacy_dir.mkdir(parents=True, exist_ok=True)
            (legacy_dir / "inbox_workflow.json").write_text(
                '{"ui":{"filter":"all"},"assignBatches":[],"buildRuns":[]}',
                encoding="utf-8",
            )

            session = read_workspace_session_dict(root)

            self.assertEqual(session["version"], 3)
            self.assertEqual(session["inbox"]["ui"]["filter"], "all")


if __name__ == "__main__":
    unittest.main()
