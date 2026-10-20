import tempfile
import unittest
from pathlib import Path

from backend.media_import import import_media_files, list_workspace_videos
from backend.workspace_layout import create_workspace


class MediaImportTests(unittest.TestCase):
    def test_empty_import_returns_clean_zero_counts(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            layout = create_workspace(root)

            result = import_media_files(layout, [], "copy")

            self.assertTrue(result["ok"])
            self.assertEqual(result["importedCount"], 0)
            self.assertEqual(result["skippedCount"], 0)
            self.assertEqual(result["failedCount"], 0)
            self.assertEqual(result["imported"], [])

    def test_invalid_source_path_is_skipped_without_corrupting_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            layout = create_workspace(root)
            paths = layout

            result = import_media_files(layout, [Path(tmp) / "missing.png"], "copy")

            self.assertEqual(result["importedCount"], 0)
            self.assertEqual(result["skippedCount"], 1)
            self.assertEqual(result["skipped"][0]["reason"], "not a file")
            self.assertEqual(list(paths.media.iterdir()), [])

    def test_copy_imports_images_and_keeps_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            layout = create_workspace(root)
            image = source_dir / "sample.png"
            note = source_dir / "note.txt"
            image.write_bytes(b"image")
            note.write_text("not image", encoding="utf-8")

            result = import_media_files(layout, [image, note], "copy")
            paths = layout

            self.assertEqual(result["importedCount"], 1)
            self.assertEqual(result["skippedCount"], 1)
            self.assertTrue((paths.media / "sample.png").is_file())
            self.assertTrue(image.is_file())
            self.assertEqual(result["imported"][0]["imagePath"], "media/sample.png")

    def test_move_imports_with_unique_name_and_removes_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            layout = create_workspace(root)
            paths = layout
            (paths.media / "sample.jpg").write_bytes(b"existing")
            image = source_dir / "sample.jpg"
            image.write_bytes(b"new")

            result = import_media_files(layout, [image], "move")

            self.assertEqual(result["importedCount"], 1)
            self.assertEqual(result["imported"][0]["filename"], "sample_2.jpg")
            self.assertTrue((paths.media / "sample_2.jpg").is_file())
            self.assertFalse(image.exists())

    def test_copy_imports_videos_to_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            layout = create_workspace(root)
            video = source_dir / "clip.mp4"
            video.write_bytes(b"video")

            result = import_media_files(layout, [video], "copy")
            paths = layout

            self.assertEqual(result["importedCount"], 1)
            self.assertTrue((paths.media / "clip.mp4").is_file())
            self.assertTrue(video.is_file())
            self.assertEqual(result["imported"][0]["mediaType"], "video")
            self.assertEqual(result["imported"][0]["mediaPath"], "media/clip.mp4")

    def test_move_imports_videos_and_removes_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            layout = create_workspace(root)
            video = source_dir / "clip.mkv"
            video.write_bytes(b"video")

            result = import_media_files(layout, [video], "move")
            paths = layout

            self.assertEqual(result["importedCount"], 1)
            self.assertTrue((paths.media / "clip.mkv").is_file())
            self.assertFalse(video.exists())
            self.assertEqual(result["imported"][0]["mediaType"], "video")

    def test_list_workspace_videos_scans_imported_media_videos_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            layout = create_workspace(root)
            video = source_dir / "clip.mp4"
            image = source_dir / "sample.png"
            video.write_bytes(b"video")
            image.write_bytes(b"image")

            import_media_files(layout, [video, image], "copy")
            videos = list_workspace_videos(layout)

            self.assertEqual(len(videos), 1)
            self.assertEqual(videos[0]["name"], "clip.mp4")
            self.assertTrue(str(videos[0]["path"]).endswith("clip.mp4"))


if __name__ == "__main__":
    unittest.main()
