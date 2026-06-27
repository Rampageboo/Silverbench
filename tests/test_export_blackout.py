"""
Tests for backend.blackout_renderer.apply_blackout_rects.

Core invariant under test: source images are NEVER mutated.
"""
from __future__ import annotations

import unittest

import numpy as np

from backend.blackout_renderer import apply_blackout_rects


def white_image(h: int, w: int, channels: int = 3) -> np.ndarray:
    """Create a white (all-255) uint8 image."""
    return np.full((h, w, channels), 255, dtype=np.uint8)


class TestApplyBlackoutRects(unittest.TestCase):
    # ------------------------------------------------------------------
    # Source immutability
    # ------------------------------------------------------------------

    def test_returns_copy_does_not_mutate_source(self):
        """The most important invariant: source is never modified."""
        source = white_image(10, 10)
        original_data = source.copy()
        rect = {"x": 0.5, "y": 0.5, "w": 1.0, "h": 1.0}
        result = apply_blackout_rects(source, [rect])
        np.testing.assert_array_equal(source, original_data, err_msg="Source was mutated!")
        self.assertIsNot(result, source)

    # ------------------------------------------------------------------
    # Basic correctness
    # ------------------------------------------------------------------

    def test_full_image_rect_blacks_out_all_pixels(self):
        img = white_image(4, 4)
        rect = {"x": 0.5, "y": 0.5, "w": 1.0, "h": 1.0}
        result = apply_blackout_rects(img, [rect])
        self.assertTrue(np.all(result == 0), "All pixels should be black")

    def test_empty_rect_list_returns_identical_copy(self):
        img = white_image(8, 8)
        result = apply_blackout_rects(img, [])
        np.testing.assert_array_equal(result, img)
        self.assertIsNot(result, img)

    def test_top_left_quadrant_only(self):
        # 8×8 image; top-left 4×4 = center (0.25, 0.25) size (0.5, 0.5)
        img = white_image(8, 8)
        rect = {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5}
        result = apply_blackout_rects(img, [rect])
        # Top-left 4×4 must be black
        self.assertTrue(np.all(result[:4, :4] == 0), "Top-left quadrant should be black")
        # Bottom-right 4×4 must stay white
        self.assertTrue(np.all(result[4:, 4:] == 255), "Bottom-right should remain white")

    def test_multiple_rects(self):
        img = white_image(8, 8)
        rects = [
            {"x": 0.25, "y": 0.25, "w": 0.5, "h": 0.5},  # top-left quad
            {"x": 0.75, "y": 0.75, "w": 0.5, "h": 0.5},  # bottom-right quad
        ]
        result = apply_blackout_rects(img, rects)
        self.assertTrue(np.all(result[:4, :4] == 0))
        self.assertTrue(np.all(result[4:, 4:] == 0))
        # Top-right and bottom-left should remain white
        self.assertTrue(np.all(result[:4, 4:] == 255))
        self.assertTrue(np.all(result[4:, :4] == 255))

    # ------------------------------------------------------------------
    # Edge / boundary handling
    # ------------------------------------------------------------------

    def test_zero_width_rect_is_skipped(self):
        img = white_image(4, 4)
        rect = {"x": 0.5, "y": 0.5, "w": 0.0, "h": 0.5}
        result = apply_blackout_rects(img, [rect])
        np.testing.assert_array_equal(result, img)

    def test_zero_height_rect_is_skipped(self):
        img = white_image(4, 4)
        rect = {"x": 0.5, "y": 0.5, "w": 0.5, "h": 0.0}
        result = apply_blackout_rects(img, [rect])
        np.testing.assert_array_equal(result, img)

    def test_rect_clamped_to_image_bounds(self):
        img = white_image(4, 4)
        # Center near bottom-right; half extends beyond edge
        rect = {"x": 0.9, "y": 0.9, "w": 0.4, "h": 0.4}
        # Must not raise; bottom-right pixel should be black
        result = apply_blackout_rects(img, [rect])
        self.assertEqual(int(result[3, 3, 0]), 0, "Bottom-right pixel should be black")
        # Top-left should still be white
        self.assertEqual(int(result[0, 0, 0]), 255)

    def test_1x1_image(self):
        img = white_image(1, 1)
        rect = {"x": 0.5, "y": 0.5, "w": 1.0, "h": 1.0}
        result = apply_blackout_rects(img, [rect])
        self.assertTrue(np.all(result == 0))

    def test_grayscale_image(self):
        img = np.full((4, 4), 255, dtype=np.uint8)  # 2-D (H, W) grayscale
        rect = {"x": 0.5, "y": 0.5, "w": 1.0, "h": 1.0}
        result = apply_blackout_rects(img, [rect])
        self.assertTrue(np.all(result == 0))

    def test_rgba_image(self):
        img = white_image(4, 4, channels=4)  # 4-channel RGBA
        rect = {"x": 0.5, "y": 0.5, "w": 1.0, "h": 1.0}
        result = apply_blackout_rects(img, [rect])
        # RGB channels zeroed; alpha also zeroed (numpy slice sets all channels)
        self.assertTrue(np.all(result[:, :, :3] == 0))

    # ------------------------------------------------------------------
    # Input validation
    # ------------------------------------------------------------------

    def test_raises_for_non_ndarray(self):
        with self.assertRaises(TypeError):
            apply_blackout_rects([[255, 255], [255, 255]], [])  # type: ignore[arg-type]

    def test_malformed_rect_values_are_skipped_gracefully(self):
        img = white_image(4, 4)
        bad_rect = {"x": "not-a-number", "y": 0.5, "w": 0.5, "h": 0.5}
        # Should not raise; bad rect is skipped
        result = apply_blackout_rects(img, [bad_rect])
        np.testing.assert_array_equal(result, img)

    def test_missing_rect_keys_default_to_zero(self):
        img = white_image(4, 4)
        # w and h default to 0 → rect is skipped (zero-size)
        result = apply_blackout_rects(img, [{"x": 0.5, "y": 0.5}])
        np.testing.assert_array_equal(result, img)


if __name__ == "__main__":
    unittest.main()
