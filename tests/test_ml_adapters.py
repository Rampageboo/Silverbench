import math
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.animocap_ml_adapters.mmpose_adapter import (
    _Sam2VideoMaskProvider,
    _fuse_coco_observations,
    _mask_ratio_is_valid,
    _needs_high_accuracy_pass,
    _prepare_offline_models,
    _resolve_anime_pose_model,
)
from python.animocap_ml_adapters.export_anime_dataset import _build_annotation


class HighAccuracyPoseTests(unittest.TestCase):
    def test_quality_selection(self) -> None:
        scores = [0.95] * 17
        self.assertFalse(_needs_high_accuracy_pass(scores, 1, "fast"))
        self.assertTrue(_needs_high_accuracy_pass(scores, 1, "maximum"))
        self.assertTrue(_needs_high_accuracy_pass(scores, 15, "balanced"))
        scores[10] = 0.2
        self.assertTrue(_needs_high_accuracy_pass(scores, 1, "balanced"))

    def test_refiner_replaces_only_stronger_observations(self) -> None:
        base = [[float(index), float(index)] for index in range(17)]
        refined = [[point[0] + 2.0, point[1] + 1.0] for point in base]
        points, scores = _fuse_coco_observations(
            base, [0.4] * 17, refined, [0.9] * 17, math.hypot(1920, 1080)
        )
        self.assertEqual(points, refined)
        self.assertEqual(scores, [0.9] * 17)

    def test_large_detector_disagreement_reduces_confidence(self) -> None:
        base = [[100.0, 100.0] for _ in range(17)]
        refined = [[900.0, 900.0] for _ in range(17)]
        points, scores = _fuse_coco_observations(
            base, [0.9] * 17, refined, [0.88] * 17, 1000.0
        )
        self.assertEqual(points, base)
        self.assertTrue(all(score < 0.7 for score in scores))

    def test_foreground_mask_ratio_gate(self) -> None:
        class Mask:
            size = 100

            def __init__(self, nonzero: int) -> None:
                self.nonzero = nonzero

        class ArrayApi:
            @staticmethod
            def count_nonzero(mask: Mask) -> int:
                return mask.nonzero

        self.assertTrue(_mask_ratio_is_valid(Mask(36), ArrayApi))
        self.assertFalse(_mask_ratio_is_valid(Mask(1), ArrayApi))

    def test_corrected_pose_exports_coco_body_keypoints(self) -> None:
        semantics = [
            "head", "leftShoulder", "rightShoulder", "leftLowerArm",
            "rightLowerArm", "leftHand", "rightHand", "leftUpperLeg",
            "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftFoot",
            "rightFoot",
        ]
        frame = {"joints": [{
            "semantic": semantic,
            "image_xy": [100.0 + index * 8.0, 120.0 + index * 12.0],
            "position_m": [0.0, 0.0, 0.0],
            "confidence": 0.9,
            "valid": True,
        } for index, semantic in enumerate(semantics)]}
        annotation = _build_annotation(frame, 1, 1, 640, 720, 0.55)
        self.assertIsNotNone(annotation)
        assert annotation is not None
        self.assertEqual(len(annotation["keypoints"]), 51)
        self.assertEqual(annotation["num_keypoints"], 13)
        self.assertGreater(annotation["bbox"][2], 0.0)

    def test_offline_prepare_resolves_all_pose_models(self) -> None:
        calls = []

        def fake_inferencer(**kwargs):
            calls.append(kwargs)
            return object()

        with mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_inferencer",
            return_value=fake_inferencer,
        ), mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_high_accuracy_refiner",
            return_value=object(),
        ) as refiner:
            _prepare_offline_models("cpu")
        self.assertEqual(calls[0]["pose3d"], "human3d")
        self.assertEqual(calls[0]["device"], "cpu")
        refiner.assert_called_once_with(fake_inferencer, "cpu")

    def test_missing_sam_checkpoint_fails_before_optional_imports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.pt"
            with self.assertRaisesRegex(RuntimeError, "checkpoint is unavailable"):
                _Sam2VideoMaskProvider(Path("video.mp4"), missing, None, None, None)

    def test_anime_pose_model_requires_a_complete_pair(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.py"
            weights = Path(directory) / "checkpoint.pth"
            config.write_text("model = dict()", encoding="utf-8")
            weights.write_bytes(b"checkpoint")
            self.assertEqual(
                _resolve_anime_pose_model(config, weights), (config, weights)
            )
            with self.assertRaisesRegex(RuntimeError, "provided together"):
                _resolve_anime_pose_model(config, None)


if __name__ == "__main__":
    unittest.main()
