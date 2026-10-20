from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.classes_store import add_class, detect_classes, resolve_class, slugify_class_name
from yoloworkbench_mcp.annotation import _normalize_box, _parse_boxes
from yoloworkbench_mcp.bridge import PathPolicy

DOC = {
    "version": 1,
    "classDefs": [{"key": "car", "name": "Car"}, {"key": "night", "name": "Night"}],
    "tasks": {"detect": {"classKeys": ["car"]}, "clf": {"classKeys": ["night"]}},
}


class ClassEditingTests(unittest.TestCase):
    def test_slug_matches_frontend_rules(self) -> None:
        self.assertEqual(slugify_class_name("  Big Truck! "), "big_truck")
        self.assertEqual(slugify_class_name("汽车"), "class")

    def test_add_reuses_names_and_keeps_keys_unique(self) -> None:
        doc, key, added = add_class(DOC, "car", "detect")
        self.assertEqual((key, added), ("car", False))
        doc, key, added = add_class(doc, "Night", "detect")  # a clf class name, new to detect: new key
        self.assertEqual((key, added), ("night_2", True))
        doc, key, added = add_class(doc, "Car", "clf")  # existing detect class attached to clf
        self.assertEqual((key, added), ("car", True))
        self.assertEqual(doc["tasks"]["detect"]["classKeys"], ["car", "night_2"])
        self.assertEqual(DOC["tasks"]["detect"]["classKeys"], ["car"], "input is not mutated")

    def test_resolve_by_id_key_or_name(self) -> None:
        self.assertEqual(resolve_class(DOC, 0, "detect")["key"], "car")
        self.assertEqual(resolve_class(DOC, "CAR", "detect")["id"], 0)
        self.assertEqual(resolve_class(DOC, "night", "clf")["key"], "night")
        with self.assertRaisesRegex(ValueError, "Known classes: Car"):
            resolve_class(DOC, "bus", "detect")
        self.assertEqual(len(detect_classes(DOC)), 1)


class BoxTests(unittest.TestCase):
    def test_corner_and_centre_forms_are_clamped(self) -> None:
        self.assertEqual(_normalize_box({"x1": 0.3, "y1": 0.4, "x2": 0.1, "y2": 0.1}), (0.2, 0.25, 0.19999999999999998, 0.30000000000000004))
        x, y, w, h = _normalize_box({"x": 0.95, "y": 0.5, "w": 0.2, "h": 0.2})
        self.assertAlmostEqual(x + w / 2, 1.0)
        with self.assertRaises(ValueError):
            _normalize_box({"x": 0.5})

    def test_parse_skips_bad_lines(self) -> None:
        self.assertEqual(_parse_boxes("0 0.5 0.5 0.1 0.1\nbad line\n1 a b c d\n"), [(0, 0.5, 0.5, 0.1, 0.1)])


class PathPolicyTests(unittest.TestCase):
    def test_recent_workspaces_are_allowed(self) -> None:
        base = Path(__file__).resolve().parents[1]
        recent = [str(base / "backend")]
        policy = PathPolicy([base / "tests"], base_dir=base, known_workspaces=lambda: recent)
        self.assertEqual(policy.require(base / "backend", kind="directory"), (base / "backend").resolve())
        recent.clear()
        with self.assertRaises(PermissionError):
            policy.require(base / "backend")


if __name__ == "__main__":
    unittest.main()
