from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app_settings import read_settings, remember_workspace, write_settings
from backend.dataset_export import export_dataset
from backend.image_pool import mark_image_pool_seen, scan_image_pool
from backend.image_pool_backup import ensure_image_backup, ensure_label_backup, restore_image_backup
from backend.image_pool_cleanup import clear_image_pool_duplicates, delete_pool_image_completely
from backend.image_status import JUNK_CLASS, read_status_rows, status_payload, upsert_status_rows
from backend.path_access import PathAccess
from backend.service import BackendService
from backend.workspace import list_workspace_files, open_folder, workspace_info
from backend.workspace_layout import create_workspace, write_json
from backend.workspace_session import read_session, write_session
from backend.workspace_versions import create_snapshot, delete_snapshot, read_versions, restore_snapshot

CLASSES = {
    "version": 1,
    "classDefs": [
        {"key": "car", "name": "Car"},
        {"key": "person", "name": "Person"},
        {"key": "old", "name": "Old", "archived": True},
        {"key": "day", "name": "Day"},
        {"key": "night", "name": "Night"},
    ],
    "tasks": {"detect": {"classKeys": ["car", "person", "old"]}, "clf": {"classKeys": ["day", "night", "old"]}},
}


class WorkspaceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.layout = create_workspace(self.tmp / "ws", classes=CLASSES)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def add_image(self, name: str, data: bytes = b"img", label: str | None = None) -> None:
        (self.layout.media / name).write_bytes(data)
        if label is not None:
            self.layout.image_label_file(name).write_text(label, encoding="utf-8")


class OpenFolderTests(WorkspaceTestCase):
    def test_kinds(self) -> None:
        self.assertEqual(open_folder(self.layout.root)["kind"], "workspace")
        self.assertEqual(open_folder(self.layout.media)["root"], str(self.layout.root))
        plain = self.tmp / "plain"
        plain.mkdir()
        self.assertEqual(open_folder(plain), {"ok": True, "kind": "folder", "root": str(plain.resolve()), "name": "plain", "empty": True})
        self.assertFalse((plain / "rwb.json").exists(), "opening must not scaffold a workspace")
        dataset = self.tmp / "ds"
        (dataset / "images" / "train").mkdir(parents=True)
        self.assertEqual(open_folder(dataset)["kind"], "dataset")
        self.assertEqual(open_folder(plain, create=True)["kind"], "workspace")

    def test_info_and_files(self) -> None:
        self.add_image("a.png", label="0 0.5 0.5 0.1 0.1\n")
        info = workspace_info(self.layout)
        self.assertEqual(info["imageCount"], 1)
        self.assertEqual(info["labelCount"], 1)
        self.assertTrue(info["detectTrainData"].endswith(str(Path("exports/dataset/detect/data.yaml"))))
        self.assertEqual(list_workspace_files(self.layout), ["labels/images/a.txt", "media/a.png"])


class StatusTests(WorkspaceTestCase):
    def test_upsert_read_and_junk(self) -> None:
        upsert_status_rows(self.layout, [{"filename": "media/a.png", "clf_class": "day", "split": "val"}])
        upsert_status_rows(self.layout, {"filename": "b.png", "clf_class": JUNK_CLASS, "detect_enabled": True, "detect_junk": True})
        rows = {row["filename"]: row for row in read_status_rows(self.layout)}
        self.assertEqual(rows["a.png"]["split"], "val")
        self.assertEqual(rows["b.png"]["clf_enabled"], "0")
        self.assertEqual(rows["b.png"]["detect_enabled"], "0")
        payload = status_payload(self.layout)
        self.assertEqual(payload["clfClasses"], ["day", "night"])
        self.assertEqual(payload["detectClasses"][2], {"id": 2, "name": "Old"})
        with self.assertRaises(ValueError):
            upsert_status_rows(self.layout, ["nope"])

    def test_pool_scan_uses_status(self) -> None:
        self.add_image("a.png")
        self.add_image("b.png")
        upsert_status_rows(self.layout, [{"filename": "a.png", "clf_class": "day"}])
        scan = scan_image_pool(self.layout)
        self.assertEqual((scan["total"], scan["usedCount"], scan["newCount"]), (2, 1, 2))
        mark_image_pool_seen(self.layout)
        self.assertEqual(scan_image_pool(self.layout)["newCount"], 0)
        self.assertTrue(self.layout.path("scanCache").is_file())


class ExportTests(WorkspaceTestCase):
    def test_export_detect_and_classify(self) -> None:
        self.add_image("a.png", label="1 0.5 0.5 0.2 0.2\n")
        self.add_image("b.png")
        self.add_image("c.png")
        upsert_status_rows(
            self.layout,
            [
                {"filename": "a.png", "detect_enabled": True, "clf_class": "day"},
                {"filename": "b.png", "detect_enabled": True, "clf_class": "night", "split": "val"},
                {"filename": "c.png", "clf_class": JUNK_CLASS},
            ],
        )
        result = export_dataset(self.layout)
        root = self.layout.exports / "dataset"
        self.assertTrue(result["ok"])
        self.assertEqual((result["detectImages"], result["clfImages"]), (2, 2))
        self.assertEqual((root / "detect" / "labels" / "train" / "a.txt").read_text(encoding="utf-8"), "1 0.5 0.5 0.2 0.2\n")
        self.assertEqual((root / "detect" / "labels" / "val" / "b.txt").read_text(encoding="utf-8"), "")
        self.assertTrue((root / "classify" / "val" / "night" / "b.png").is_file())
        self.assertFalse(any(root.rglob("c.png")))
        yaml = (root / "detect" / "data.yaml").read_text(encoding="utf-8")
        self.assertIn('1: "Person"', yaml)
        self.assertEqual((root / "detect" / "classes.txt").read_text(encoding="utf-8"), "Car\nPerson\nOld\n")
        self.assertEqual(json.loads((root / "rwb-export.json").read_text(encoding="utf-8"))["format"], "rwb-export")

        # A copy: editing the export never touches the workspace.
        (root / "detect" / "images" / "train" / "a.png").write_bytes(b"edited")
        self.assertEqual((self.layout.media / "a.png").read_bytes(), b"img")

        # Rebuild drops images that left the dataset.
        upsert_status_rows(self.layout, [{"filename": "b.png", "detect_enabled": False, "clf_class": ""}])
        export_dataset(self.layout)
        self.assertFalse(any(root.rglob("b.png")))

    def test_refuses_foreign_folder(self) -> None:
        foreign = self.tmp / "mine"
        foreign.mkdir()
        (foreign / "keep.txt").write_text("x", encoding="utf-8")
        with self.assertRaises(ValueError):
            export_dataset(self.layout, destination=foreign)
        self.assertTrue((foreign / "keep.txt").is_file())


class VersionTests(WorkspaceTestCase):
    def test_snapshot_restore_delete(self) -> None:
        self.add_image("a.png", label="0 0.5 0.5 0.1 0.1\n")
        first = create_snapshot(self.layout, "first")["created"]
        self.assertEqual((first["id"], first["imageLabels"]), ("V1", 1))
        self.assertFalse((self.layout.path("versions") / "V1" / "media").exists())
        self.layout.image_label_file("a.png").write_text("", encoding="utf-8")
        result = restore_snapshot(self.layout, "V1")
        self.assertEqual(result["backup"]["id"], "V2")
        self.assertEqual(self.layout.image_label_file("a.png").read_text(encoding="utf-8"), "0 0.5 0.5 0.1 0.1\n")
        self.assertTrue(self.layout.classes.is_file())
        delete_snapshot(self.layout, "V2")
        self.assertEqual([item["id"] for item in read_versions(self.layout)["snapshots"]], ["V1"])
        with self.assertRaises(ValueError):
            restore_snapshot(self.layout, "../x")


class BackupAndDeleteTests(WorkspaceTestCase):
    def test_backup_restore_and_complete_delete(self) -> None:
        self.add_image("a.png", data=b"orig", label="0 0.5 0.5 0.1 0.1\n")
        ensure_image_backup(self.layout, "media/a.png")
        ensure_label_backup(self.layout, "labels/images/a.txt")
        (self.layout.media / "a.png").write_bytes(b"cropped")
        self.layout.image_label_file("a.png").write_text("", encoding="utf-8")
        self.assertFalse(ensure_image_backup(self.layout, "media/a.png")["created"], "keeps the first original")
        restored = restore_image_backup(self.layout, "media/a.png")
        self.assertEqual(restored["labelPath"], "labels/images/a.txt")
        self.assertEqual((self.layout.media / "a.png").read_bytes(), b"orig")

        upsert_status_rows(self.layout, [{"filename": "a.png", "clf_class": "day"}])
        proposal = self.layout.path("proposals") / "a.png.json"
        proposal.parent.mkdir(parents=True, exist_ok=True)
        proposal.write_text("{}", encoding="utf-8")
        result = delete_pool_image_completely(self.layout, "a.png")
        self.assertTrue(result["ok"])
        self.assertFalse(any(self.layout.originals.rglob("*.*")))
        self.assertFalse(proposal.exists())
        self.assertEqual(read_status_rows(self.layout), [])

    def test_duplicates_keep_annotated(self) -> None:
        self.add_image("a.png", data=b"same")
        self.add_image("zz.png", data=b"same")
        upsert_status_rows(self.layout, [{"filename": "zz.png", "clf_class": "day"}])
        result = clear_image_pool_duplicates(self.layout)
        self.assertEqual(result["plan"][0]["keeper"], "zz.png")
        self.assertFalse((self.layout.media / "a.png").exists())


class SessionAndSettingsTests(WorkspaceTestCase):
    def test_session_roundtrip(self) -> None:
        self.assertEqual(read_session(self.layout), {})
        write_session(self.layout, {"inbox": {"assignBatches": [{"filenames": ["a.png"]}]}, "x": 1})
        session = read_session(self.layout)
        self.assertEqual(session["x"], 1)
        self.assertTrue(self.layout.path("session").is_file())

    def test_settings_import_and_recent(self) -> None:
        settings_dir = self.tmp / "appdata"
        legacy = self.tmp / "install"
        legacy.mkdir()
        (legacy / "yolo_app_settings.json").write_text(json.dumps({"lastOpenedWorkspace": "D:/old"}), encoding="utf-8")
        self.assertEqual(read_settings(settings_dir, legacy_dir=legacy)["workspaces"], ["D:/old"])
        remember_workspace("D:/new", settings_dir, legacy_dir=legacy)
        settings = read_settings(settings_dir)
        self.assertEqual((settings["lastWorkspace"], settings["workspaces"]), ("D:/new", ["D:/new", "D:/old"]))
        self.assertEqual(write_settings({"startupOverlayMode": "bogus"}, settings_dir)["startupOverlayMode"], "overview")

    def test_service_open_folder_remembers_workspace(self) -> None:
        settings_dir = self.tmp / "appdata"
        service = BackendService(PathAccess([]), self.tmp, app_settings_dir=settings_dir)
        payload = service.call("openFolder", [str(self.layout.root)])
        self.assertEqual((payload["kind"], payload["migrationPending"]), ("workspace", False))
        self.assertEqual(read_settings(settings_dir)["lastWorkspace"], str(self.layout.root))
        info = service.call("getWorkspaceInfo", [str(self.layout.root)])
        self.assertEqual(info["kind"], "workspace")
        write_json(self.layout.classes, CLASSES)
        self.assertEqual(service.call("getWorkspaceClasses", [str(self.layout.root)])["classes"], ["day", "night"])


if __name__ == "__main__":
    unittest.main()
