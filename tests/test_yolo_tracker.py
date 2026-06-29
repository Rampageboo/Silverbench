from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.yolo_tracker import YoloBox, _box_to_cv_rect, _merge_box_into_label, boxes_to_text, label_path_for, parse_label_text


class YoloTrackerIoTests(unittest.TestCase):
    def test_parse_and_write_yolo_labels(self) -> None:
        boxes = parse_label_text("1 0.5 0.4 0.2 0.1\nbad line\n2 1.5 -1 0.3 0.4\n")
        self.assertEqual([box.classId for box in boxes], [1, 2])
        self.assertEqual(boxes[0].x, 0.5)
        self.assertEqual(boxes[1].x, 1.0)
        self.assertEqual(boxes[1].y, 0.0)
        self.assertEqual(boxes_to_text([]), "")
        self.assertEqual(boxes_to_text([boxes[0]]), "1 0.500000 0.400000 0.200000 0.100000\n")

    def test_label_path_workspace_and_dataset_layouts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(label_path_for(root, "image_pool/frame001.jpg"), root / "detect_labels" / "frame001.txt")
            self.assertEqual(label_path_for(root, "media/frame001.jpg"), root / "detect_labels" / "frame001.txt")
            labels_train = root / "labels" / "train"
            labels_train.mkdir(parents=True)
            existing = labels_train / "frame002.txt"
            existing.write_text("", encoding="utf-8")
            self.assertEqual(label_path_for(root, "images/train/frame002.jpg"), existing)

    def test_merge_replaces_nearest_same_class_and_appends_new_class(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_path = "media/frame003.jpg"
            label = root / "detect_labels" / "frame003.txt"
            label.parent.mkdir()
            label.write_text(
                "4 0.200000 0.200000 0.100000 0.100000\n"
                "4 0.800000 0.800000 0.100000 0.100000\n",
                encoding="utf-8",
            )
            _merge_box_into_label(root, image_path, YoloBox(4, 0.22, 0.22, 0.2, 0.2))
            boxes = parse_label_text(label.read_text(encoding="utf-8"))
            self.assertEqual(len(boxes), 2)
            self.assertEqual(boxes[0].x, 0.22)
            self.assertEqual(boxes[1].x, 0.8)

            _merge_box_into_label(root, image_path, YoloBox(5, 0.5, 0.5, 0.3, 0.3))
            boxes = parse_label_text(label.read_text(encoding="utf-8"))
            self.assertEqual([box.classId for box in boxes], [4, 4, 5])

    def test_cv_rect_uses_integer_pixel_tuple(self) -> None:
        rect = _box_to_cv_rect(YoloBox(0, 0.5, 0.5, 0.25, 0.2), 640, 480)
        self.assertEqual(rect, (240, 192, 160, 96))
        self.assertTrue(all(isinstance(value, int) for value in rect))


if __name__ == "__main__":
    unittest.main()
