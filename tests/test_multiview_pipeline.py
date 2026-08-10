import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.animocap_ml_adapters import multiview_pipeline


class SharedMultiviewSessionTests(unittest.TestCase):
    def test_four_views_share_one_session_and_release_it_before_vlm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            views = []
            for index, view_id in enumerate(("front", "right", "back", "left")):
                video = root / f"{view_id}.mp4"
                video.write_bytes(b"test")
                views.append({
                    "id": view_id,
                    "video": video.name,
                    "yaw_degrees": index * 90.0,
                })
            manifest = root / "capture.json"
            manifest.write_text(json.dumps({
                "mode": "directional_repeat",
                "views": views,
            }), encoding="utf-8")

            instances = []

            class FakeSession:
                def __init__(self, **_kwargs) -> None:
                    self.runs = []
                    self.closed = False
                    instances.append(self)

                def run(self, video: Path, output: Path, roi=None) -> None:
                    self.runs.append((video, output, roi))
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text("{}", encoding="utf-8")

                def close(self) -> None:
                    self.closed = True

            args = argparse.Namespace(
                manifest=manifest,
                output=root / "output",
                roi_file=None,
                animocap=None,
                calibration=None,
                anime_pose_config=None,
                anime_pose_weights=None,
                vlm_model="unused",
                quality="maximum",
                segmentation="grabcut",
                no_vlm=False,
                skip_inference=False,
            )

            def fake_run_streaming(command, _root, _view_id, stage):
                self.assertTrue(instances[0].closed)
                if stage == "local_visual_recovery":
                    corrected = Path(command[command.index("--output-pose") + 1])
                    corrected.write_text("{}", encoding="utf-8")
                return 0

            with mock.patch.object(
                multiview_pipeline.mmpose_adapter,
                "MMPoseSession",
                FakeSession,
            ), mock.patch.object(
                multiview_pipeline,
                "find_animocap",
                return_value=root / "animocap.exe",
            ), mock.patch.object(
                multiview_pipeline,
                "run_streaming",
                side_effect=fake_run_streaming,
            ) as run_streaming, mock.patch.object(multiview_pipeline, "emit"):
                self.assertEqual(multiview_pipeline.run_pipeline(args), 0)

            self.assertEqual(len(instances), 1)
            self.assertEqual(len(instances[0].runs), 4)
            self.assertTrue(instances[0].closed)
            self.assertEqual(run_streaming.call_count, 5)


if __name__ == "__main__":
    unittest.main()
