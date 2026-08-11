import argparse
import math
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from python.animocap_ml_adapters.mmpose_adapter import (
    MMPoseSession,
    _ConfidenceCalibration,
    _Sam2VideoMaskProvider,
    _base_model_name,
    _fuse_coco_hypotheses,
    _fuse_coco_observations,
    _load_confidence_calibration,
    _mask_ratio_is_valid,
    _needs_high_accuracy_pass,
    _needs_humanart_pass,
    _needs_npu_shadow_pass,
    _compare_npu_shadow,
    _npu_review_reasons,
    _humanart_runtime_config,
    _prepare_offline_models,
    _resolve_anime_pose_model,
)
from python.animocap_ml_adapters import multiview_pipeline
from python.animocap_ml_adapters.export_anime_dataset import _build_annotation
from python.animocap_ml_adapters.assemble_character_dataset import assemble_dataset
from python.animocap_ml_adapters.character_synthetic_dataset import (
    _project_normalized_to_pixel,
    _select_frames,
)
from python.animocap_ml_adapters.evaluate_character_capture import evaluate, pose_metrics


class HighAccuracyPoseTests(unittest.TestCase):
    def test_character_export_config_v11_validation(self) -> None:
        script = Path(__file__).parents[1] / "tools" / "codex-skills" / \
            "blender-character-mocap-export" / "scripts" / "export_character_layers.py"
        spec = importlib.util.spec_from_file_location("character_exporter", script)
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "profile.json"
            config.write_text(json.dumps({
                "profile_id": "test", "armature": "Armature",
                "meshes": ["Body", "Clothes"],
            }), encoding="utf-8")
            loaded = module._load_config(config)
            self.assertEqual(loaded["meshes"], ["Body", "Clothes"])
            self.assertEqual(loaded["proportion_policy"], "similar_reference")
            config.write_text(json.dumps({
                "profile_id": "test", "armature": "Armature", "mesh": "Body",
                "low_confidence_threshold": 0.0,
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, r"\(0, 1\]"):
                module._load_config(config)

        class Bones:
            def __init__(self, names: list[str]) -> None:
                self.names = names

            def keys(self) -> list[str]:
                return self.names

        class Armature:
            pass

        armature = Armature()
        armature.data = type("ArmatureData", (), {})()
        aliases = [module.MMD_ALIASES[semantic][0]
                   for semantic, _parent, _offset in module.CANONICAL_BONES]
        armature.data.bones = Bones(aliases)
        mapping, evidence = module._resolve_bones(armature, {})
        self.assertEqual(len(mapping), 23)
        self.assertTrue(all(item["resolution"] == "alias" for item in evidence.values()))
        armature.data.bones = Bones(aliases[:-1])
        with self.assertRaisesRegex(RuntimeError, "could not map canonical bone"):
            module._resolve_bones(armature, {})

        vector = type("Vector", (), {"x": 1.0, "y": 2.0, "z": 3.0})()
        self.assertEqual(module._animocap_position(vector, 2.0), (2.0, 6.0, -4.0))

    def test_synthetic_projection_and_frame_selection_are_deterministic(self) -> None:
        self.assertEqual(
            _project_normalized_to_pixel((0.25, 0.75, 1.0), 800, 600),
            (200.0, 150.0, True),
        )
        self.assertEqual(_select_frames(100, 12, 9), _select_frames(100, 12, 9))
        self.assertEqual(len(_select_frames(100, 12, 9)), 12)

    def test_dataset_assembly_caps_synthetic_and_separates_holdout(self) -> None:
        def coco(count: int) -> dict:
            return {
                "images": [{"id": i + 1, "file_name": f"{i}.png", "width": 64, "height": 64}
                           for i in range(count)],
                "annotations": [{"id": i + 1, "image_id": i + 1, "category_id": 1,
                                 "bbox": [0, 0, 10, 10], "area": 100,
                                 "iscrowd": 0, "num_keypoints": 1,
                                 "keypoints": [1, 1, 2] * 17}
                                for i in range(count)],
            }

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            real, synthetic, holdout = root / "real", root / "synthetic", root / "holdout"
            for dataset, count, sequence in ((real, 2, "train"), (holdout, 1, "holdout")):
                (dataset / "images").mkdir(parents=True)
                (dataset / "annotations").mkdir()
                for i in range(count):
                    (dataset / "images" / f"{i}.png").write_bytes(b"image")
                (dataset / "annotations" / "train.json").write_text(
                    json.dumps(coco(count)), encoding="utf-8")
                (dataset / "dataset.json").write_text(json.dumps({
                    "source_video_sha256": sequence,
                    "source_pose_sha256": sequence + "-pose",
                    "source_motion_sha256": sequence + "-motion",
                    "source_motion_id": sequence,
                }), encoding="utf-8")
            (synthetic / "images").mkdir(parents=True)
            for i in range(6):
                (synthetic / "images" / f"{i}.png").write_bytes(b"image")
            (synthetic / "annotations.json").write_text(
                json.dumps(coco(6)), encoding="utf-8")
            (synthetic / "dataset.json").write_text(json.dumps({
                "kind": "animocap.character_synthetic_dataset",
                "motion_sha256": ["synthetic-motion"],
                "motion_ids": ["synthetic-motion"],
                "motion_identity_declared": True,
            }), encoding="utf-8")
            manifest = assemble_dataset(
                [real], [synthetic], [holdout], root / "assembled", 7, False)
            self.assertEqual(manifest["real_train_images"], 2)
            self.assertEqual(manifest["synthetic_train_images"], 4)
            self.assertEqual(manifest["held_out_images"], 1)
            self.assertTrue(manifest["activation_eligible"])
            holdout_metadata = json.loads((holdout / "dataset.json").read_text(
                encoding="utf-8"))
            holdout_metadata["source_motion_id"] = "train"
            (holdout / "dataset.json").write_text(
                json.dumps(holdout_metadata), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "held-out sequence"):
                assemble_dataset(
                    [real], [synthetic], [holdout], root / "overlap", 7, False)

    def test_capture_metrics_detect_improvement_and_swaps(self) -> None:
        semantics = list({"head", *[name for pair in (
            ("leftShoulder", "rightShoulder"), ("leftLowerArm", "rightLowerArm"),
            ("leftHand", "rightHand"), ("leftUpperLeg", "rightUpperLeg"),
            ("leftLowerLeg", "rightLowerLeg"), ("leftFoot", "rightFoot"),
        ) for name in pair]})
        def pose(offset: float) -> dict:
            return {"schema_version": "1.0.0", "frames": [{"joints": [{
                "semantic": name, "image_xy": [50.0 + index * 8.0 + offset, 80.0 + index * 5.0],
                "position_m": [0.0, 0.0, 0.0], "confidence": 0.9, "valid": True,
            } for index, name in enumerate(semantics)]}]}
        truth = pose(0.0)
        baseline = pose(8.0)
        candidate = pose(2.0)
        self.assertLess(
            pose_metrics(truth, candidate)["median_normalized_joint_error"],
            pose_metrics(truth, baseline)["median_normalized_joint_error"],
        )

    def test_evaluation_report_binds_split_and_activation_evidence(self) -> None:
        semantics = [
            "head", "leftShoulder", "rightShoulder", "leftLowerArm",
            "rightLowerArm", "leftHand", "rightHand", "leftUpperLeg",
            "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftFoot",
            "rightFoot",
        ]

        def pose(offset: float) -> dict:
            return {"schema_version": "1.0.0", "frames": [{"joints": [{
                "semantic": name,
                "image_xy": [80.0 + index * 11.0 + offset, 90.0 + index * 7.0],
                "position_m": [0.0, 0.0, 0.0], "confidence": 0.9, "valid": True,
            } for index, name in enumerate(semantics)]}]}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = {name: root / f"{name}.json" for name in
                     ("truth", "baseline", "candidate", "profile", "dataset")}
            paths["truth"].write_text(json.dumps(pose(0.0)), encoding="utf-8")
            paths["baseline"].write_text(json.dumps(pose(10.0)), encoding="utf-8")
            paths["candidate"].write_text(json.dumps(pose(2.0)), encoding="utf-8")
            paths["profile"].write_text("{}", encoding="utf-8")
            paths["dataset"].write_text(json.dumps({
                "activation_eligible": True, "real_train_images": 4,
                "motion_identity_complete": True,
                "synthetic_train_images": 8, "held_out_images": 2,
                "train_sequence_ids": ["train"],
                "held_out_sequence_ids": ["holdout"],
            }), encoding="utf-8")
            checkpoint, config = root / "candidate.pth", root / "config.py"
            checkpoint.write_bytes(b"checkpoint")
            config.write_text("model = dict()", encoding="utf-8")
            report = evaluate(
                paths["truth"], paths["baseline"], paths["candidate"],
                checkpoint, config, paths["profile"], paths["dataset"],
                root / "report.json", True, 0,
            )
            self.assertEqual(report["status"], "pass")
            self.assertTrue(report["dataset_split"]["activation_eligible"])
            self.assertEqual(report["dataset_split"]["held_out_sequence_ids"], ["holdout"])

            paths["dataset"].write_text(json.dumps({
                "activation_eligible": False, "synthetic_train_images": 8,
            }), encoding="utf-8")
            refused = evaluate(
                paths["truth"], paths["baseline"], paths["candidate"],
                checkpoint, config, paths["profile"], paths["dataset"],
                root / "refused.json", True, 0,
            )
            self.assertEqual(refused["status"], "fail")
            self.assertIn("independent corrected-real", " ".join(refused["reasons"]))

    def test_quality_selection(self) -> None:
        scores = [0.95] * 17
        self.assertFalse(_needs_high_accuracy_pass(scores, 1, "fast"))
        self.assertTrue(_needs_high_accuracy_pass(scores, 1, "maximum"))
        self.assertTrue(_needs_high_accuracy_pass(scores, 15, "balanced"))
        scores[10] = 0.2
        self.assertTrue(_needs_high_accuracy_pass(scores, 1, "balanced"))

    @staticmethod
    def _coco_points(value: float) -> list[list[float]]:
        return [[value + index, value + index] for index in range(17)]

    def test_three_expert_agreement_fuses_only_compatible_hypotheses(self) -> None:
        points, scores, diagnostics = _fuse_coco_hypotheses(
            {
                "hrnet": (self._coco_points(100.0), [0.80] * 17),
                "vitpose-humanart": (self._coco_points(102.0), [0.78] * 17),
                "rtmw": (self._coco_points(98.0), [0.82] * 17),
            },
            roi=(0, 0, 1000, 1000),
        )
        self.assertAlmostEqual(points[0][0], 99.99, places=1)
        self.assertGreater(scores[0], 0.82)
        self.assertEqual(diagnostics["agreement_joints"], 17)
        self.assertEqual(diagnostics["conflict_joints"], 0)

    def test_clear_supported_winner_can_replace_base(self) -> None:
        points, scores, _diagnostics = _fuse_coco_hypotheses(
            {
                "hrnet": (self._coco_points(100.0), [0.45] * 17),
                "vitpose-humanart": (self._coco_points(300.0), [0.95] * 17),
                "rtmw": None,
            },
            roi=(0, 0, 1000, 1000),
        )
        self.assertEqual(points[0], [300.0, 300.0])
        self.assertAlmostEqual(scores[0], 0.95)

    def test_incompatible_conflict_keeps_observed_base_with_downgrade(self) -> None:
        points, scores, diagnostics = _fuse_coco_hypotheses(
            {
                "hrnet": (self._coco_points(100.0), [0.90] * 17),
                "vitpose-humanart": (self._coco_points(300.0), [0.88] * 17),
                "rtmw": (self._coco_points(500.0), [0.87] * 17),
            },
            roi=(0, 0, 1000, 1000),
        )
        self.assertEqual(points[0], [100.0, 100.0])
        self.assertAlmostEqual(scores[0], 0.90 * 0.55)
        self.assertEqual(diagnostics["conflict_joints"], 17)

    def test_missing_predictions_never_become_valid(self) -> None:
        points, scores, diagnostics = _fuse_coco_hypotheses(
            {"hrnet": None, "vitpose-humanart": None, "rtmw": None},
            roi=(0, 0, 800, 800),
        )
        self.assertEqual(points[0], [0.0, 0.0])
        self.assertEqual(scores[0], 0.0)
        self.assertEqual(diagnostics["missing_joints"], 17)

    def test_calibration_can_change_winner(self) -> None:
        calibration = _ConfidenceCalibration({
            "hrnet": {"nose": [(0.0, 0.0), (0.8, 0.30), (1.0, 1.0)]},
            "vitpose-humanart": {"nose": [(0.0, 0.0), (0.75, 0.95), (1.0, 1.0)]},
        }, "profile")
        self.assertAlmostEqual(calibration.calibrate("hrnet", 0, 0.4), 0.15)
        self.assertAlmostEqual(calibration.calibrate("rtmw", 0, 0.42), 0.42)
        points, scores, _diagnostics = _fuse_coco_hypotheses(
            {
                "hrnet": (self._coco_points(100.0), [0.80] * 17),
                "vitpose-humanart": (self._coco_points(300.0), [0.75] * 17),
            },
            roi=(0, 0, 1000, 1000),
            calibration=calibration,
        )
        self.assertEqual(points[0], [300.0, 300.0])
        self.assertAlmostEqual(scores[0], 0.95)

    def test_malformed_calibration_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps({
                "schema_version": "1.0.0",
                "models": {"hrnet": {"joints": {
                    "nose": [[0.0, 0.0], [0.8, 0.7], [0.7, 0.9]],
                }}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "strictly increasing"):
                _load_confidence_calibration(path)
            path.write_text(json.dumps({
                "schema_version": "1.0.0",
                "models": {"hrnet": {"joints": {
                    "nose": [[0.0, 0.0], [0.7, 0.9], [0.8, 0.8]],
                }}},
            }), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "monotonic"):
                _load_confidence_calibration(path)

    def test_roi_normalization_uses_person_roi_not_full_image(self) -> None:
        hypotheses = {
            "hrnet": (self._coco_points(100.0), [0.80] * 17),
            "vitpose-humanart": (self._coco_points(110.0), [0.75] * 17),
        }
        small_points, small_scores, small_diagnostics = _fuse_coco_hypotheses(
            hypotheses, roi=(0, 0, 100, 100)
        )
        large_points, large_scores, large_diagnostics = _fuse_coco_hypotheses(
            hypotheses, roi=(0, 0, 1000, 1000)
        )
        self.assertEqual(small_points[0], [100.0, 100.0])
        self.assertLess(small_scores[0], 0.80)
        self.assertEqual(small_diagnostics["conflict_joints"], 17)
        self.assertNotEqual(large_points[0], [100.0, 100.0])
        self.assertGreater(large_scores[0], 0.75)
        self.assertEqual(large_diagnostics["agreement_joints"], 17)

    def test_humanart_quality_scheduling_and_fallback(self) -> None:
        scores = [0.95] * 17
        self.assertFalse(_needs_humanart_pass(scores, 1, "fast"))
        self.assertFalse(_needs_humanart_pass(scores, 1, "balanced"))
        self.assertTrue(_needs_humanart_pass(scores, 15, "balanced"))
        self.assertTrue(_needs_humanart_pass(scores, 1, "maximum"))
        scores[10] = 0.2
        self.assertTrue(_needs_humanart_pass(scores, 1, "balanced"))

    def test_humanart_config_is_migrated_without_legacy_mmcls_arguments(self) -> None:
        config = _humanart_runtime_config()
        self.assertEqual(
            config.model.backbone.type, "mmpretrain.VisionTransformer"
        )
        self.assertEqual(config.model.backbone.out_type, "featmap")
        self.assertNotIn("output_cls_token", config.model.backbone)
        self.assertIsNone(config.model.backbone.init_cfg)

    def test_npu_shadow_scheduling_never_changes_off_mode(self) -> None:
        scores = [0.95] * 17
        self.assertFalse(_needs_npu_shadow_pass(scores, 0, "off", 15))
        self.assertTrue(_needs_npu_shadow_pass(scores, 0, "shadow", 15))
        self.assertFalse(_needs_npu_shadow_pass(scores, 1, "shadow", 15))
        scores[10] = 0.2
        self.assertTrue(_needs_npu_shadow_pass(scores, 5, "shadow", 15))

    def test_npu_shadow_reports_missing_and_left_right_swaps(self) -> None:
        reference = [[float(index * 10), float(index)] for index in range(17)]
        npu = [point[:] for point in reference]
        npu[5], npu[6] = npu[6], npu[5]
        npu_scores = [0.9] * 17
        npu_scores[10] = 0.0
        diagnostics = _compare_npu_shadow(
            npu, npu_scores, reference, [0.95] * 17, (0, 0, 100, 100)
        )
        self.assertEqual(diagnostics["invalid_joints"], 1)
        self.assertEqual(diagnostics["compared_joints"], 16)
        self.assertGreaterEqual(diagnostics["left_right_swaps"], 1)

    def test_npu_shadow_builds_actionable_review_reasons(self) -> None:
        self.assertEqual(_npu_review_reasons({
            "compared_joints": 17,
            "invalid_joints": 0,
            "normalized_error_sum": 0.17,
            "left_right_swaps": 0,
        }), [])
        reasons = _npu_review_reasons({
            "compared_joints": 10,
            "invalid_joints": 6,
            "normalized_error_sum": 0.6,
            "left_right_swaps": 1,
        })
        self.assertEqual(reasons, [
            "left_right_swap", "missing_joints", "gpu_npu_disagreement"
        ])

    def test_active_character_model_identity_is_preserved(self) -> None:
        self.assertEqual(_base_model_name(None), "hrnet")
        self.assertEqual(
            _base_model_name(Path("private/models/anime-pose/checkpoint.pth")),
            "character-hrnet",
        )

    def test_multiview_forwards_confidence_calibration(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ("front.mp4", "right.mp4"):
                (root / name).write_bytes(b"video")
            manifest = root / "capture.json"
            manifest.write_text(json.dumps({
                "mode": "directional_repeat",
                "views": [
                    {"id": "front", "video": "front.mp4", "yaw_degrees": 0},
                    {"id": "right", "video": "right.mp4", "yaw_degrees": 90},
                ],
            }), encoding="utf-8")
            calibration = root / "calibration.json"
            calibration.write_text("{}", encoding="utf-8")
            output = root / "output"
            commands: list[list[str]] = []
            session_arguments: list[dict[str, object]] = []

            class FakeSession:
                def __init__(self, **kwargs: object) -> None:
                    session_arguments.append(kwargs)

                def run(
                    self,
                    _video: Path,
                    pose_path: Path,
                    _roi: tuple[int, int, int, int] | None = None,
                ) -> None:
                    pose_path.write_text("{}", encoding="utf-8")

                def close(self) -> None:
                    return None

            def fake_run(command: list[str], _cwd: Path, _view: str, _stage: str) -> int:
                commands.append(command)
                return 0

            args = argparse.Namespace(
                manifest=manifest,
                output=output,
                roi_file=None,
                animocap=None,
                calibration=None,
                anime_pose_config=None,
                anime_pose_weights=None,
                confidence_calibration=calibration,
                vlm_model="qwen3-vl:4b",
                quality="balanced",
                segmentation="auto",
                no_vlm=True,
                skip_inference=False,
            )
            with mock.patch.object(
                    multiview_pipeline.mmpose_adapter,
                    "MMPoseSession",
                    FakeSession,
                ), mock.patch.object(
                    multiview_pipeline,
                    "run_streaming",
                    side_effect=fake_run,
                ), \
                    mock.patch.object(
                        multiview_pipeline,
                        "find_animocap",
                        return_value=root / "animocap.exe",
                    ):
                self.assertEqual(multiview_pipeline.run_pipeline(args), 0)
            self.assertEqual(len(session_arguments), 1)
            self.assertEqual(
                session_arguments[0]["confidence_calibration"], calibration
            )

    def test_refiner_replaces_only_stronger_observations(self) -> None:
        base = [[float(index), float(index)] for index in range(17)]
        refined = [[point[0] + 2.0, point[1] + 1.0] for point in base]
        points, scores = _fuse_coco_observations(
            base, [0.4] * 17, refined, [0.9] * 17, math.hypot(1920, 1080)
        )
        self.assertEqual(points, refined)
        self.assertEqual(scores, [0.9] * 17)

    def test_large_detector_disagreement_reduces_confidence(self) -> None:
        base = [[100.0, 100.0] for _ in range(17)]
        refined = [[900.0, 900.0] for _ in range(17)]
        points, scores = _fuse_coco_observations(
            base, [0.9] * 17, refined, [0.88] * 17, 1000.0
        )
        self.assertEqual(points, base)
        self.assertTrue(all(score < 0.7 for score in scores))

    def test_foreground_mask_ratio_gate(self) -> None:
        class Mask:
            size = 100

            def __init__(self, nonzero: int) -> None:
                self.nonzero = nonzero

        class ArrayApi:
            @staticmethod
            def count_nonzero(mask: Mask) -> int:
                return mask.nonzero

        self.assertTrue(_mask_ratio_is_valid(Mask(36), ArrayApi))
        self.assertFalse(_mask_ratio_is_valid(Mask(1), ArrayApi))

    def test_corrected_pose_exports_coco_body_keypoints(self) -> None:
        semantics = [
            "head", "leftShoulder", "rightShoulder", "leftLowerArm",
            "rightLowerArm", "leftHand", "rightHand", "leftUpperLeg",
            "rightUpperLeg", "leftLowerLeg", "rightLowerLeg", "leftFoot",
            "rightFoot",
        ]
        frame = {"joints": [{
            "semantic": semantic,
            "image_xy": [100.0 + index * 8.0, 120.0 + index * 12.0],
            "position_m": [0.0, 0.0, 0.0],
            "confidence": 0.9,
            "valid": True,
        } for index, semantic in enumerate(semantics)]}
        annotation = _build_annotation(frame, 1, 1, 640, 720, 0.55)
        self.assertIsNotNone(annotation)
        assert annotation is not None
        self.assertEqual(len(annotation["keypoints"]), 51)
        self.assertEqual(annotation["num_keypoints"], 13)
        self.assertGreater(annotation["bbox"][2], 0.0)

    def test_offline_prepare_resolves_all_pose_models(self) -> None:
        calls = []

        def fake_inferencer(**kwargs):
            calls.append(kwargs)
            return object()

        with mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_inferencer",
            return_value=fake_inferencer,
        ), mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_high_accuracy_refiner",
            return_value=object(),
        ) as refiner, mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_humanart_expert",
            return_value=object(),
        ) as humanart:
            _prepare_offline_models("cpu")
        self.assertEqual(calls[0]["pose3d"], "human3d")
        self.assertEqual(calls[0]["device"], "cpu")
        refiner.assert_called_once_with(fake_inferencer, "cpu")
        humanart.assert_called_once_with(fake_inferencer, "cpu")

    def test_shared_session_builds_models_once_and_resets_video_state(self) -> None:
        calls = []

        class Inner:
            def __init__(self) -> None:
                self._buffer = {"carry": object()}

        class Wrapper:
            def __init__(self) -> None:
                self.inferencer = Inner()

        base = Wrapper()
        refiner = Wrapper()
        humanart = Wrapper()
        fake_cv2 = types.ModuleType("cv2")
        fake_numpy = types.ModuleType("numpy")

        def fake_inferencer(**kwargs):
            calls.append(kwargs)
            return base

        with mock.patch.dict(
            sys.modules, {"cv2": fake_cv2, "numpy": fake_numpy}
        ), mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_inferencer",
            return_value=fake_inferencer,
        ), mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_high_accuracy_refiner",
            return_value=refiner,
        ) as load_refiner, mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._load_humanart_expert",
            return_value=humanart,
        ) as load_humanart, mock.patch(
            "python.animocap_ml_adapters.mmpose_adapter._resolve_anime_pose_model",
            return_value=(None, None),
        ):
            session = MMPoseSession(
                device="cpu", quality="maximum", segmentation="grabcut"
            )
            self.assertEqual(len(calls), 1)
            load_refiner.assert_called_once_with(fake_inferencer, "cpu")
            load_humanart.assert_called_once_with(fake_inferencer, "cpu")
            session.reset_video_state()
            self.assertEqual(base.inferencer._buffer, {})
            self.assertEqual(refiner.inferencer._buffer, {})
            self.assertEqual(humanart.inferencer._buffer, {})
            session.close()

    def test_missing_sam_checkpoint_fails_before_optional_imports(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            missing = Path(directory) / "missing.pt"
            with self.assertRaisesRegex(RuntimeError, "checkpoint is unavailable"):
                _Sam2VideoMaskProvider(Path("video.mp4"), missing, None, None, None)

    def test_anime_pose_model_requires_a_complete_pair(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.py"
            weights = Path(directory) / "checkpoint.pth"
            config.write_text("model = dict()", encoding="utf-8")
            weights.write_bytes(b"checkpoint")
            self.assertEqual(
                _resolve_anime_pose_model(config, weights), (config, weights)
            )
            with self.assertRaisesRegex(RuntimeError, "provided together"):
                _resolve_anime_pose_model(config, None)


if __name__ == "__main__":
    unittest.main()
