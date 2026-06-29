import json
import tempfile
import unittest
from pathlib import Path

import backend.workspace_snapshot_versions as snapshot_versions
from backend.workspace_snapshot_versions import (
    create_snapshot_version,
    initialize_snapshot_versioning,
    read_snapshot_versions,
    resolve_active_version_path,
    set_active_snapshot_version,
)
from backend.yolo_workspace import resolve_open_folder


class WorkspaceSnapshotVersionsTests(unittest.TestCase):
    def test_initialize_snapshot_versioning_creates_active_v1_copy(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for dirname in (
                ".yolo_label_viewer",
                "clf_dataset",
                "detect_dataset",
                "detect_labels",
                "image_pool",
                "image_pool_backup",
                "runs",
                "workspace",
            ):
                (root / dirname).mkdir()
            (root / "metadata.csv").write_text("filename,split\n", encoding="utf-8")
            (root / "WORKSPACE_README.txt").write_text("readme\n", encoding="utf-8")
            (root / "image_pool" / "sample.png").write_bytes(b"image")

            manifest = initialize_snapshot_versioning(root)

            self.assertEqual(manifest["activeVersion"], "V1")
            self.assertEqual(resolve_active_version_path(root), root / "V1")
            self.assertTrue((root / "workspace_versions.json").is_file())
            self.assertTrue((root / "V1" / "image_pool" / "sample.png").is_file())
            self.assertTrue((root / "V1" / "metadata.csv").is_file())
            self.assertTrue((root / "V1" / "WORKSPACE_README.txt").is_file())
            self.assertFalse((root / "V1" / "workspace_versions.json").exists())
            for dirname in (
                ".yolo_label_viewer",
                "clf_dataset",
                "detect_dataset",
                "detect_labels",
                "image_pool",
                "image_pool_backup",
                "runs",
                "workspace",
            ):
                self.assertTrue((root / "V1" / dirname).is_dir(), dirname)

    def test_create_snapshot_version_copies_from_source_without_recursive_versions(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace").mkdir()
            (root / "image_pool").mkdir()
            (root / "image_pool" / "sample.png").write_bytes(b"image")
            (root / "V9").mkdir()
            (root / "V9" / "should_skip.txt").write_text("skip\n", encoding="utf-8")

            initialize_snapshot_versioning(root)
            (root / "V1" / "V8").mkdir()
            (root / "V1" / "workspace_versions.json").write_text("skip\n", encoding="utf-8")

            manifest = create_snapshot_version(root, "V1")

            self.assertEqual([entry["id"] for entry in manifest["versions"]], ["V1", "V2"])
            self.assertEqual(manifest["versions"][1]["source"], "copied-from:V1")
            self.assertTrue((root / "V2" / "image_pool" / "sample.png").is_file())
            self.assertFalse((root / "V2" / "V8").exists())
            self.assertFalse((root / "V2" / "V1").exists())
            self.assertFalse((root / "V2" / "workspace_versions.json").exists())
            self.assertTrue((root / "V1" / "image_pool" / "sample.png").is_file())

    def test_create_snapshot_version_cleans_partial_copy_on_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace").mkdir()
            initialize_snapshot_versioning(root)

            original_copy = snapshot_versions._copy_workspace_snapshot_contents

            def failing_copy(_source: Path, destination: Path) -> None:
                destination.mkdir(parents=True)
                (destination / "partial.txt").write_text("partial\n", encoding="utf-8")
                raise OSError("copy failed")

            snapshot_versions._copy_workspace_snapshot_contents = failing_copy
            try:
                with self.assertRaises(OSError):
                    create_snapshot_version(root, "V1")
            finally:
                snapshot_versions._copy_workspace_snapshot_contents = original_copy

            self.assertFalse((root / "V2").exists())
            self.assertEqual(read_snapshot_versions(root)["activeVersion"], "V1")

    def test_switch_active_snapshot_version_updates_manifest(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace").mkdir()
            initialize_snapshot_versioning(root)
            create_snapshot_version(root, "V1")

            updated = set_active_snapshot_version(root, "V2")
            reread = read_snapshot_versions(root)

            self.assertEqual(updated["activeVersion"], "V2")
            self.assertEqual(reread["activeVersion"], "V2")
            self.assertEqual(resolve_active_version_path(root), root / "V2")

    def test_open_folder_resolves_snapshot_root_to_active_version_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace").mkdir()
            initialize_snapshot_versioning(root)
            create_snapshot_version(root, "V1")
            set_active_snapshot_version(root, "V2")

            payload = resolve_open_folder(root)

            self.assertTrue(payload["snapshotVersioned"])
            self.assertEqual(payload["workspaceRootPath"], str(root.resolve()))
            self.assertEqual(payload["activeVersionId"], "V2")
            self.assertEqual(payload["root"], str((root / "V2").resolve()))

    def test_manifest_json_is_valid_after_initialization(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "workspace").mkdir()
            initialize_snapshot_versioning(root)

            raw = json.loads((root / "workspace_versions.json").read_text(encoding="utf-8"))

            self.assertEqual(raw["version"], 1)
            self.assertEqual(raw["type"], "yolo-workbench-snapshot-versions")
            self.assertEqual(raw["activeVersion"], "V1")


if __name__ == "__main__":
    unittest.main()
