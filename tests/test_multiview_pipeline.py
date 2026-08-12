import argparse
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from python.animocap_ml_adapters import multiview_pipeline


class SharedMultiviewSessionTests(unittest.TestCase):
    def test_three_view_fan_shares_one_session_and_releases_it_before_vlm(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            views = []
            for view_id, yaw in (
                ("front_left", -45.0),
                ("front", 0.0),
                ("front_right", 45.0),
            ):
                video = root / f"{view_id}.mp4"
                video.write_bytes(b"test")
                views.append({
                    "id": view_id,
                    "video": video.name,
                    "yaw_degrees": yaw,
                })
            manifest = root / "capture.json"
            manifest.write_text(json.dumps({
                "mode": "directional_repeat",
                "views": views,
            }), encoding="utf-8")

            instances = []

            class FakeSession:
                def __init__(self, **kwargs) -> None:
                    self.kwargs = kwargs
                    self.runs = []
                    self.closed = False
                    instances.append(self)

                def run(self, video: Path, output: Path, roi=None) -> None:
                    self.runs.append((video, output, roi))
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_text("{}", encoding="utf-8")
                    (output.parent / "npu-shadow-diagnostics.json").write_text(
                        json.dumps({"review_frames": [{
                            "frame_index": 5,
                            "reasons": ["gpu_npu_disagreement"],
                        }]}),
                        encoding="utf-8",
                    )

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
                npu_mode="shadow",
                npu_model=root / "observer.xml",
                npu_sample_interval=15,
                no_vlm=False,
                skip_inference=False,
            )

            def fake_run_streaming(command, _root, _view_id, stage):
                self.assertTrue(instances[0].closed)
                if stage == "local_visual_recovery":
                    corrected = Path(command[command.index("--output-pose") + 1])
                    corrected.write_text("{}", encoding="utf-8")
                    self.assertIn("--priority-frames", command)
                    issues = Path(command[command.index("--issues-output") + 1])
                    issues.write_text(json.dumps({
                        "npu_priority_processed": 1,
                        "issues": [{"frame": 5, "accepted": ["left_wrist"]}],
                    }), encoding="utf-8")
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
            self.assertEqual(len(instances[0].runs), 3)
            self.assertTrue(instances[0].closed)
            self.assertEqual(instances[0].kwargs["npu_mode"], "shadow")
            self.assertEqual(instances[0].kwargs["npu_sample_interval"], 15)
            self.assertEqual(run_streaming.call_count, 4)
            for view in views:
                diagnostics = json.loads((
                    root / "output" / "poses" / view["id"] /
                    "npu-shadow-diagnostics.json"
                ).read_text(encoding="utf-8"))
                self.assertEqual(diagnostics["gpu_reprocess"], {
                    "status": "completed",
                    "requested_frames": 1,
                    "processed_frames": 1,
                    "accepted_joint_corrections": 1,
                })


class ManifestValidationTests(unittest.TestCase):
    def test_directional_manifest_accepts_two_to_eight_finite_yaws(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            views = [
                {"id": f"view_{index}", "video": f"view_{index}.mp4", "yaw_degrees": index * 15.0}
                for index in range(8)
            ]
            manifest = root / "capture.json"
            manifest.write_text(json.dumps({
                "mode": "directional_repeat",
                "views": views,
            }), encoding="utf-8")
            self.assertEqual(len(multiview_pipeline.load_manifest(manifest)["views"]), 8)

            views[3]["yaw_degrees"] = float("nan")
            manifest.write_text(json.dumps({
                "mode": "directional_repeat",
                "views": views,
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "requires yaw_degrees"):
                multiview_pipeline.load_manifest(manifest)

    def test_synchronized_manifest_accepts_eight_calibrated_views_without_yaws(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "capture.json"
            manifest.write_text(json.dumps({
                "mode": "synchronized_multiview",
                "calibration_file": "calibration.json",
                "views": [
                    {"id": f"camera_{index}", "video": f"camera_{index}.mp4"}
                    for index in range(8)
                ],
            }), encoding="utf-8")
            self.assertEqual(len(multiview_pipeline.load_manifest(manifest)["views"]), 8)


if __name__ == "__main__":
    unittest.main()
