from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.path_access import PathAccess
from backend.service import BackendService
from backend.yolo_workspace import create_workspace


class AutoLabelModelImportTests(unittest.TestCase):
    def test_detect_and_classify_best_models_do_not_overwrite_registry_entries(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            temp_root = Path(tmp)
            workspace = temp_root / "workspace"
            detect_source_dir = temp_root / "detect_source"
            classify_source_dir = temp_root / "classify_source"
            detect_source_dir.mkdir()
            classify_source_dir.mkdir()
            detect_model = detect_source_dir / "best.pt"
            classify_model = classify_source_dir / "best.pt"
            detect_model.write_bytes(b"detect model")
            classify_model.write_bytes(b"classify model")
            create_workspace(workspace)

            service = BackendService(
                PathAccess([workspace, detect_source_dir, classify_source_dir]),
                temp_root,
                temp_root / "session.json",
            )

            detect_registry = json.loads(
                service.call(
                    "importAutoLabelModel",
                    [str(detect_model), str(workspace), "detect", "2026-01-01T00:00:00.000Z"],
                )
            )
            self.assertEqual(detect_registry["detect"]["activeModel"], "models/autolabel/detect/best.pt")

            classify_registry = json.loads(
                service.call(
                    "importAutoLabelModel",
                    [str(classify_model), str(workspace), "classify", "2026-01-02T00:00:00.000Z"],
                )
            )

            self.assertEqual(classify_registry["detect"]["activeModel"], "models/autolabel/detect/best.pt")
            self.assertEqual(classify_registry["classify"]["activeModel"], "models/autolabel/classify/best.pt")
            self.assertEqual((workspace / "models" / "autolabel" / "detect" / "best.pt").read_bytes(), b"detect model")
            self.assertEqual(
                (workspace / "models" / "autolabel" / "classify" / "best.pt").read_bytes(),
                b"classify model",
            )

            saved = json.loads((workspace / "workspace" / "autolabel_models.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, classify_registry)

    def test_read_registry_recovers_existing_workspace_models(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            temp_root = Path(tmp)
            workspace = temp_root / "workspace"
            create_workspace(workspace)
            detect_model = workspace / "models" / "autolabel" / "detect" / "detect.pt"
            classify_model = workspace / "models" / "autolabel" / "classify" / "clf.pt"
            detect_model.parent.mkdir(parents=True)
            classify_model.parent.mkdir(parents=True)
            detect_model.write_bytes(b"detect")
            classify_model.write_bytes(b"classify")

            service = BackendService(PathAccess([workspace]), temp_root, temp_root / "session.json")
            registry = json.loads(service.call("readAutoLabelModelRegistry", [str(workspace)]))

            self.assertEqual(registry["detect"]["activeModel"], "models/autolabel/detect/detect.pt")
            self.assertEqual(registry["classify"]["activeModel"], "models/autolabel/classify/clf.pt")
            saved = json.loads((workspace / "workspace" / "autolabel_models.json").read_text(encoding="utf-8"))
            self.assertEqual(saved, registry)

    def test_read_registry_preserves_existing_active_model_until_changed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            temp_root = Path(tmp)
            workspace = temp_root / "workspace"
            create_workspace(workspace)
            model_dir = workspace / "models" / "autolabel" / "detect"
            model_dir.mkdir(parents=True)
            selected = model_dir / "selected.pt"
            other = model_dir / "other.pt"
            selected.write_bytes(b"selected")
            other.write_bytes(b"other")
            registry_path = workspace / "workspace" / "autolabel_models.json"
            registry_path.write_text(
                json.dumps(
                    {
                        "detect": {
                            "activeModel": "models/autolabel/detect/selected.pt",
                            "updatedAt": "2026-01-01T00:00:00.000Z",
                        }
                    }
                ),
                encoding="utf-8",
            )

            service = BackendService(PathAccess([workspace]), temp_root, temp_root / "session.json")
            registry = json.loads(service.call("readAutoLabelModelRegistry", [str(workspace)]))

            self.assertEqual(registry["detect"]["activeModel"], "models/autolabel/detect/selected.pt")
            self.assertNotIn("classify", registry)


if __name__ == "__main__":
    unittest.main()
