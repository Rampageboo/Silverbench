from __future__ import annotations

import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend import video_screenshot


class VideoFrameCacheTests(unittest.TestCase):
    def test_trim_frame_disk_cache_enforces_file_count(self) -> None:
        old_dir = video_screenshot._FRAME_DISK_CACHE_DIR
        old_max_files = video_screenshot._MAX_FRAME_DISK_CACHE_FILES
        old_max_bytes = video_screenshot._MAX_FRAME_DISK_CACHE_BYTES
        try:
            with TemporaryDirectory() as tmp:
                video_screenshot._FRAME_DISK_CACHE_DIR = Path(tmp)
                video_screenshot._MAX_FRAME_DISK_CACHE_FILES = 2
                video_screenshot._MAX_FRAME_DISK_CACHE_BYTES = 10_000
                paths = []
                for index in range(3):
                    path = Path(tmp) / f"{index:02d}" / f"{index}.bin"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(bytes([index]) * 4)
                    os.utime(path, (index + 1, index + 1))
                    paths.append(path)

                video_screenshot._trim_frame_disk_cache()

                remaining = sorted(path.name for path in Path(tmp).rglob("*.bin"))
                self.assertEqual(remaining, ["1.bin", "2.bin"])
        finally:
            video_screenshot._FRAME_DISK_CACHE_DIR = old_dir
            video_screenshot._MAX_FRAME_DISK_CACHE_FILES = old_max_files
            video_screenshot._MAX_FRAME_DISK_CACHE_BYTES = old_max_bytes

    def test_trim_frame_disk_cache_enforces_byte_budget(self) -> None:
        old_dir = video_screenshot._FRAME_DISK_CACHE_DIR
        old_max_files = video_screenshot._MAX_FRAME_DISK_CACHE_FILES
        old_max_bytes = video_screenshot._MAX_FRAME_DISK_CACHE_BYTES
        try:
            with TemporaryDirectory() as tmp:
                video_screenshot._FRAME_DISK_CACHE_DIR = Path(tmp)
                video_screenshot._MAX_FRAME_DISK_CACHE_FILES = 10
                video_screenshot._MAX_FRAME_DISK_CACHE_BYTES = 8
                for index in range(3):
                    path = Path(tmp) / f"{index:02d}" / f"{index}.bin"
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(bytes([index]) * 4)
                    os.utime(path, (index + 1, index + 1))

                video_screenshot._trim_frame_disk_cache()

                remaining = sorted(path.name for path in Path(tmp).rglob("*.bin"))
                self.assertEqual(remaining, ["1.bin", "2.bin"])
        finally:
            video_screenshot._FRAME_DISK_CACHE_DIR = old_dir
            video_screenshot._MAX_FRAME_DISK_CACHE_FILES = old_max_files
            video_screenshot._MAX_FRAME_DISK_CACHE_BYTES = old_max_bytes


if __name__ == "__main__":
    unittest.main()
