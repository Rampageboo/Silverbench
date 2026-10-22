import unittest

import numpy as np

from python.animocap_ml_adapters.openvino_npu_pose import (
    HEATMAP_SIZE,
    JOINT_COUNT,
    _decode_heatmaps,
)


class OpenVinoNpuPoseTests(unittest.TestCase):
    def test_decodes_coco_peaks_back_to_source_roi(self) -> None:
        heatmaps = np.full(
            (JOINT_COUNT, HEATMAP_SIZE, HEATMAP_SIZE), -1.0, dtype=np.float32
        )
        heatmaps[:, 20, 10] = 0.8
        points, scores = _decode_heatmaps(
            heatmaps, (100, 200, 288, 288), (1.0, 0.0, 0.0)
        )
        self.assertEqual(len(points), JOINT_COUNT)
        self.assertAlmostEqual(points[0][0], 121.0)
        self.assertAlmostEqual(points[0][1], 241.0)
        self.assertAlmostEqual(scores[0], 0.8, places=6)

    def test_low_confidence_peaks_remain_missing(self) -> None:
        heatmaps = np.full(
            (JOINT_COUNT, HEATMAP_SIZE, HEATMAP_SIZE), -0.2, dtype=np.float32
        )
        heatmaps[:, 12, 16] = 0.05
        points, scores = _decode_heatmaps(
            heatmaps, (0, 0, 288, 288), (1.0, 0.0, 0.0), minimum_score=0.1
        )
        self.assertEqual(points, [[0.0, 0.0]] * JOINT_COUNT)
        self.assertEqual(scores, [0.0] * JOINT_COUNT)

    def test_letterbox_padding_cannot_create_valid_outside_joint(self) -> None:
        heatmaps = np.full(
            (JOINT_COUNT, HEATMAP_SIZE, HEATMAP_SIZE), -1.0, dtype=np.float32
        )
        heatmaps[:, 72, 2] = 0.9
        points, scores = _decode_heatmaps(
            heatmaps, (50, 80, 100, 200), (1.44, 72.0, 0.0)
        )
        self.assertEqual(points, [[0.0, 0.0]] * JOINT_COUNT)
        self.assertEqual(scores, [0.0] * JOINT_COUNT)


if __name__ == "__main__":
    unittest.main()
