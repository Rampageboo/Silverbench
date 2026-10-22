import unittest

import cv2
import numpy as np

from python.animocap_ml_adapters.calibrated_multiview import _triangulate, _weighted_dlt


class CalibratedMultiviewTests(unittest.TestCase):
    def test_weighted_dlt_recovers_metric_point(self) -> None:
        point = np.asarray([0.2, 0.1, 3.0])
        first = np.concatenate((np.eye(3), np.zeros((3, 1))), axis=1)
        second = np.concatenate((np.eye(3), np.asarray([[-1.0], [0.0], [0.0]])), axis=1)

        def project(matrix: np.ndarray) -> tuple[float, float]:
            homogeneous = matrix @ np.append(point, 1.0)
            return float(homogeneous[0] / homogeneous[2]), float(homogeneous[1] / homogeneous[2])

        recovered = _weighted_dlt(
            [project(first), project(second)], [first, second], [0.9, 0.8], np
        )
        self.assertIsNotNone(recovered)
        np.testing.assert_allclose(recovered, point, atol=1e-8)

    def test_robust_triangulation_rejects_one_bad_camera(self) -> None:
        point = np.asarray([0.2, 0.1, 3.0])
        intrinsic = np.asarray([[1000.0, 0.0, 640.0], [0.0, 1000.0, 360.0], [0.0, 0.0, 1.0]])

        def camera(camera_id: str, center_x: float) -> dict:
            return {
                "id": camera_id,
                "camera_matrix": intrinsic.tolist(),
                "distortion": [0.0, 0.0, 0.0, 0.0, 0.0],
                "rotation_world_to_camera": np.eye(3).tolist(),
                "translation_world_to_camera_m": [-center_x, 0.0, 0.0],
            }

        def project(center_x: float) -> list[float]:
            camera_point = point - np.asarray([center_x, 0.0, 0.0])
            return [
                640.0 + 1000.0 * camera_point[0] / camera_point[2],
                360.0 + 1000.0 * camera_point[1] / camera_point[2],
            ]

        observations = [
            (camera("a", 0.0), project(0.0), 0.9),
            (camera("b", 1.0), project(1.0), 0.9),
            (camera("bad", -1.0), [900.0, 100.0], 0.9),
        ]
        result = _triangulate(observations, 5.0, cv2, np)
        self.assertIsNotNone(result)
        assert result is not None
        recovered, _rms, support = result
        self.assertEqual(support, 2)
        np.testing.assert_allclose(recovered, point, atol=1e-6)


if __name__ == "__main__":
    unittest.main()
