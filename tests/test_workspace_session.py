from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.yolo_workspace import (
    LEGACY_WORKSPACE_SESSION_DIRNAME,
    WORKSPACE_SESSION_DIRNAME,
    compact_inbox_session_for_storage,
    create_workspace,
    is_workspace_root,
    load_workspace_config,
    read_workspace_session_dict,
    normalize_inbox_session,
    resolve_open_folder,
    workspace_session_file,
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
            legacy_dir = root / LEGACY_WORKSPACE_SESSION_DIRNAME
            legacy_dir.mkdir(parents=True, exist_ok=True)
            (legacy_dir / "inbox_workflow.json").write_text(
                '{"ui":{"filter":"all"},"assignBatches":[],"buildRuns":[]}',
                encoding="utf-8",
            )

            session = read_workspace_session_dict(root)

            self.assertEqual(session["version"], 3)
            self.assertEqual(session["inbox"]["ui"]["filter"], "all")

    def test_legacy_root_config_and_session_still_load(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "image_pool").mkdir()
            (root / "detect_labels").mkdir()
            (root / "detect_dataset").mkdir()
            (root / "clf_dataset").mkdir()
            (root / "workspace.json").write_text(
                (
                    '{"version":1,"paths":{"image_pool":"image_pool",'
                    '"detect_labels":"detect_labels","metadata":"metadata.csv",'
                    '"detect_dataset":"detect_dataset","clf_dataset":"clf_dataset"}}'
                ),
                encoding="utf-8",
            )
            legacy_dir = root / LEGACY_WORKSPACE_SESSION_DIRNAME
            legacy_dir.mkdir()
            (legacy_dir / "session.json").write_text('{"version":3,"activeTab":"inbox"}', encoding="utf-8")

            self.assertEqual(load_workspace_config(root).root, root.resolve())
            session = read_workspace_session_dict(root)

            self.assertEqual(session["activeTab"], "inbox")
            self.assertTrue((root / WORKSPACE_SESSION_DIRNAME / "session.json").is_file())

    def test_moved_app_session_filename_migrates_from_workspace_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)
            moved_session = root / WORKSPACE_SESSION_DIRNAME / "yolo_label_viewer_session.json"
            moved_session.write_text('{"version":3,"activeTab":"mask-noise"}', encoding="utf-8")

            session = read_workspace_session_dict(root)

            self.assertEqual(session["activeTab"], "mask-noise")
            self.assertTrue((root / WORKSPACE_SESSION_DIRNAME / "session.json").is_file())

    def test_workspace_metadata_lives_under_workspace_folder(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)

            self.assertTrue((root / WORKSPACE_SESSION_DIRNAME / "workspace.json").is_file())
            self.assertFalse((root / "workspace.json").exists())

            paths = load_workspace_config(root)
            self.assertEqual(paths.image_pool, (root / "image_pool").resolve())

            session_path = Path(write_workspace_session_dict(root, {"version": 3}))
            self.assertEqual(session_path, workspace_session_file(root))
            self.assertEqual(session_path, root / WORKSPACE_SESSION_DIRNAME / "session.json")

            inner = root / WORKSPACE_SESSION_DIRNAME
            self.assertTrue(is_workspace_root(inner))
            self.assertEqual(load_workspace_config(inner).root, root.resolve())
            self.assertEqual(workspace_session_file(inner), session_path)

    def test_create_workspace_scaffolds_v2_workspace_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            create_workspace(root)

            manifest_path = root / WORKSPACE_SESSION_DIRNAME / "workspace.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

            self.assertEqual(manifest["version"], 2)
            self.assertEqual(manifest["type"], "yolo-workbench")
            self.assertEqual(manifest["paths"]["annotations"], "workspace/annotations")
            self.assertEqual(manifest["paths"]["sources"], "workspace/sources.json")
            self.assertEqual(manifest["tools"]["videoLabel"]["persistence"], "timestamp-manifest")
            self.assertTrue((root / "workspace" / "annotations").is_dir())
            self.assertTrue((root / "workspace" / "video_annotations").is_dir())
            self.assertTrue((root / "workspace" / "logs").is_dir())
            self.assertTrue((root / "video_segments").is_dir())
            self.assertTrue((root / "exports").is_dir())
            self.assertTrue((root / ".cache").is_dir())
            self.assertEqual(
                json.loads((root / "workspace" / "sources.json").read_text(encoding="utf-8")),
                {"version": 1, "sources": []},
            )

    def test_open_existing_workspace_backfills_v2_structure(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "image_pool").mkdir()
            (root / "detect_labels").mkdir()
            (root / WORKSPACE_SESSION_DIRNAME).mkdir()
            (root / WORKSPACE_SESSION_DIRNAME / "workspace.json").write_text(
                (
                    '{"version":1,"paths":{"image_pool":"image_pool",'
                    '"detect_labels":"detect_labels","metadata":"metadata.csv",'
                    '"detect_dataset":"detect_dataset","clf_dataset":"clf_dataset"}}'
                ),
                encoding="utf-8",
            )

            result = resolve_open_folder(root)

            self.assertEqual(result["kind"], "workspace")
            self.assertFalse(result["initialized"])
            self.assertTrue((root / "workspace" / "annotations").is_dir())
            self.assertTrue((root / "workspace" / "video_annotations").is_dir())
            self.assertTrue((root / "workspace" / "sources.json").is_file())


if __name__ == "__main__":
    unittest.main()
