import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import cv2
import numpy as np

from backend.video_screenshot import capture_video_screenshots, frame_similarity


class FakeCapture:
    def __init__(self, frames):
        self.frames = frames
        self.index = 0

    def isOpened(self):
        return True

    def get(self, key):
        if key == cv2.CAP_PROP_FPS:
            return 1
        if key == cv2.CAP_PROP_FRAME_COUNT:
            return len(self.frames)
        return 0

    def set(self, key, value):
        if key == cv2.CAP_PROP_POS_FRAMES:
            self.index = int(value)
        return True

    def read(self):
        if self.index >= len(self.frames):
            return False, None
        frame = self.frames[self.index]
        self.index += 1
        return True, frame.copy()

    def release(self):
        return None


class VideoFrameSimilarityTests(unittest.TestCase):
    def test_identical_frames_are_fully_similar(self):
        frame = np.full((120, 160, 3), 80, dtype=np.uint8)

        self.assertEqual(frame_similarity(frame, frame.copy()), 1.0)

    def test_visibly_different_frames_are_not_similar(self):
        dark = np.zeros((120, 160, 3), dtype=np.uint8)
        light = np.full((120, 160, 3), 255, dtype=np.uint8)

        self.assertLess(frame_similarity(dark, light), 0.05)

    def test_small_encoding_noise_remains_highly_similar(self):
        base = np.full((120, 160, 3), 100, dtype=np.uint8)
        noisy = base.copy()
        noisy[::8, ::8] = 104

        self.assertGreater(frame_similarity(base, noisy), 0.99)

    def test_color_change_reduces_similarity_even_at_similar_brightness(self):
        red = np.zeros((120, 160, 3), dtype=np.uint8)
        red[:, :] = (0, 0, 200)
        green = np.zeros((120, 160, 3), dtype=np.uint8)
        green[:, :] = (0, 102, 0)

        self.assertLess(frame_similarity(red, green), 0.98)

    def test_batch_capture_keeps_one_frame_per_similar_run(self):
        first = np.full((48, 64, 3), 80, dtype=np.uint8)
        duplicate = first.copy()
        changed = np.full((48, 64, 3), 180, dtype=np.uint8)
        capture = FakeCapture([first, duplicate, changed])
        written = []

        def fake_write(_frame, output_dir, filename, _image_format):
            target = output_dir / filename
            written.append(target)
            return target

        with TemporaryDirectory() as temp_dir:
            with patch("backend.video_screenshot.cv2.VideoCapture", return_value=capture):
                with patch("backend.video_screenshot.write_frame", side_effect=fake_write):
                    result = capture_video_screenshots(
                        Path("sample.mp4"),
                        Path(temp_dir),
                        [{"start": 0, "end": 2, "interval": 1}],
                        1,
                        image_format="png",
                        similarity_threshold=0.98,
                    )

        self.assertEqual(result["processed"], 3)
        self.assertEqual(result["saved"], 2)
        self.assertEqual(result["skipped"], 1)
        self.assertEqual(len(written), 2)

    def test_batch_capture_without_threshold_keeps_duplicate_frames(self):
        frame = np.full((48, 64, 3), 80, dtype=np.uint8)
        capture = FakeCapture([frame, frame])
        written = []

        def fake_write(_frame, output_dir, filename, _image_format):
            target = output_dir / filename
            written.append(target)
            return target

        with TemporaryDirectory() as temp_dir:
            with patch("backend.video_screenshot.cv2.VideoCapture", return_value=capture):
                with patch("backend.video_screenshot.write_frame", side_effect=fake_write):
                    result = capture_video_screenshots(
                        Path("sample.mp4"),
                        Path(temp_dir),
                        [{"start": 0, "end": 1, "interval": 1}],
                        1,
                        image_format="png",
                    )

        self.assertEqual(result["saved"], 2)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(len(written), 2)

    def test_interval_selects_candidates_before_similarity_filtering(self):
        frame = np.full((48, 64, 3), 80, dtype=np.uint8)
        capture = FakeCapture([frame, frame, frame, frame, frame])
        written = []

        def fake_write(_frame, output_dir, filename, _image_format):
            target = output_dir / filename
            written.append(target)
            return target

        with TemporaryDirectory() as temp_dir:
            with patch("backend.video_screenshot.cv2.VideoCapture", return_value=capture):
                with patch("backend.video_screenshot.write_frame", side_effect=fake_write):
                    result = capture_video_screenshots(
                        Path("sample.mp4"),
                        Path(temp_dir),
                        [{"start": 0, "end": 4, "interval": 2}],
                        1,
                        image_format="png",
                        similarity_threshold=0.98,
                    )

        self.assertEqual(result["processed"], 3)
        self.assertEqual(result["saved"], 1)
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(len(written), 1)


if __name__ == "__main__":
    unittest.main()
