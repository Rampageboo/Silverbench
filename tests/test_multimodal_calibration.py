from __future__ import annotations

import base64
import unittest

import cv2
import numpy as np

from backend.multimodal_calibration import (
    CALIBRATION_TAG_IDS,
    decode_image_base64,
    detect_apriltags,
    detect_apriltags_base64,
    generate_calibration_sheet_png,
)


class MultimodalCalibrationTests(unittest.TestCase):
    def test_printable_sheet_round_trips_through_detector(self) -> None:
        png = generate_calibration_sheet_png(dpi=150)
        self.assertTrue(png.startswith(b"\x89PNG\r\n\x1a\n"))
        image = cv2.imdecode(np.frombuffer(png, dtype=np.uint8), cv2.IMREAD_COLOR)
        result = detect_apriltags(image)
        self.assertEqual(set(CALIBRATION_TAG_IDS), {item["id"] for item in result["detections"]})
        self.assertEqual([], result["missingIds"])

    def test_base64_camera_payload_round_trip(self) -> None:
        png = generate_calibration_sheet_png(dpi=96)
        encoded = base64.b64encode(png).decode("ascii")
        decoded = decode_image_base64(f"data:image/png;base64,{encoded}")
        self.assertGreater(decoded.shape[0], 0)
        result = detect_apriltags_base64(encoded)
        self.assertEqual([], result["missingIds"])

    def test_invalid_base64_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            decode_image_base64("not base64 !!!")


if __name__ == "__main__":
    unittest.main()
