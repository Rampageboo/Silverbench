import tempfile
import unittest
from pathlib import Path

from backend.media_import import import_media_files, list_workspace_videos
from backend.yolo_workspace import create_workspace, load_workspace_config


class MediaImportTests(unittest.TestCase):
    def test_copy_imports_images_and_keeps_sources(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            create_workspace(root)
            image = source_dir / "sample.png"
            note = source_dir / "note.txt"
            image.write_bytes(b"image")
            note.write_text("not image", encoding="utf-8")

            result = import_media_files(root, [image, note], "copy")
            paths = load_workspace_config(root)

            self.assertEqual(result["importedCount"], 1)
            self.assertEqual(result["skippedCount"], 1)
            self.assertTrue((paths.image_pool / "sample.png").is_file())
            self.assertTrue(image.is_file())
            self.assertEqual(result["imported"][0]["imagePath"], "media/sample.png")

    def test_move_imports_with_unique_name_and_removes_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            create_workspace(root)
            paths = load_workspace_config(root)
            (paths.image_pool / "sample.jpg").write_bytes(b"existing")
            image = source_dir / "sample.jpg"
            image.write_bytes(b"new")

            result = import_media_files(root, [image], "move")

            self.assertEqual(result["importedCount"], 1)
            self.assertEqual(result["imported"][0]["filename"], "sample_2.jpg")
            self.assertTrue((paths.image_pool / "sample_2.jpg").is_file())
            self.assertFalse(image.exists())

    def test_copy_imports_videos_to_media(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            create_workspace(root)
            video = source_dir / "clip.mp4"
            video.write_bytes(b"video")

            result = import_media_files(root, [video], "copy")
            paths = load_workspace_config(root)

            self.assertEqual(result["importedCount"], 1)
            self.assertTrue((paths.image_pool / "clip.mp4").is_file())
            self.assertTrue(video.is_file())
            self.assertEqual(result["imported"][0]["mediaType"], "video")
            self.assertEqual(result["imported"][0]["mediaPath"], "media/clip.mp4")

    def test_move_imports_videos_and_removes_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            create_workspace(root)
            video = source_dir / "clip.mkv"
            video.write_bytes(b"video")

            result = import_media_files(root, [video], "move")
            paths = load_workspace_config(root)

            self.assertEqual(result["importedCount"], 1)
            self.assertTrue((paths.image_pool / "clip.mkv").is_file())
            self.assertFalse(video.exists())
            self.assertEqual(result["imported"][0]["mediaType"], "video")

    def test_list_workspace_videos_scans_imported_media_videos_only(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "workspace"
            source_dir = Path(tmp) / "sources"
            source_dir.mkdir()
            create_workspace(root)
            video = source_dir / "clip.mp4"
            image = source_dir / "sample.png"
            video.write_bytes(b"video")
            image.write_bytes(b"image")

            import_media_files(root, [video, image], "copy")
            videos = list_workspace_videos(root)

            self.assertEqual(len(videos), 1)
            self.assertEqual(videos[0]["name"], "clip.mp4")
            self.assertTrue(str(videos[0]["path"]).endswith("clip.mp4"))


if __name__ == "__main__":
    unittest.main()
