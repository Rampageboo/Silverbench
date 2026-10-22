import contextlib
import io
import json
import math
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

from python.animocap_ml_adapters.expert_schedule import ExpertScheduler
from python.animocap_ml_adapters import mmpose_adapter as adapter


def body(offset=0.0):
    # Non-degenerate body with a 100 x 100 torso.
    return [[100.0 + (j % 2) * 100 + offset, 50.0 + (j // 2) * 30] for j in range(17)]


class ExpertScheduleTests(unittest.TestCase):
    def test_calm_intervals_and_every_frame_reference(self):
        for mode in ("1", "2", "3", "auto"):
            scheduler = ExpertScheduler(mode, "maximum", 30)
            decisions = [scheduler.observe(f, body(), [0.95] * 17) for f in range(90)]
            selected = [f for f, d in enumerate(decisions) if d.run]
            if mode == "1":
                self.assertEqual(selected, list(range(90)))
            else:
                self.assertLess(len(selected), 55)
                self.assertLessEqual(max(b - a for a, b in zip(selected, selected[1:])), 3)
                self.assertEqual(decisions[-1].interval, 3 if mode == "auto" else int(mode))

    def test_risks_force_checks_on_non_scheduled_frames_and_hold(self):
        for risk in ("confidence", "missing", "motion", "flow", "nan"):
            scheduler = ExpertScheduler("3", "maximum", 30)
            for f in range(10):
                scheduler.observe(f, body(), [0.95] * 17)
            points, scores = body(), [0.95] * 17
            if risk == "confidence": scores[10] = 0.2
            if risk == "missing": points = points[:10]
            if risk == "motion": points[10][0] += 50
            if risk == "nan": points[10][0] = math.nan
            decision = scheduler.observe(10, points, scores, risk == "flow")
            self.assertTrue(decision.run, risk)
            self.assertNotIn("interval-due", decision.reasons)
            self.assertTrue(scheduler.observe(11, body(), [0.95] * 17).run)

    def test_fast_stays_disabled_and_new_views_reset(self):
        scheduler = ExpertScheduler("1", "fast", 60)
        self.assertFalse(scheduler.observe(0, [], [], True).run)
        a, b = ExpertScheduler("3", "maximum", 30), ExpertScheduler("3", "maximum", 30)
        for f in range(20): a.observe(f, body(), [0.95] * 17)
        self.assertIn("initial-or-discontinuous-frame", b.observe(0, body(), [0.95] * 17).reasons)
        with self.assertRaises(ValueError): a.observe(0, body(), [0.95] * 17)

    def test_expert_failure_or_conflict_keeps_following_checks_dense(self):
        scheduler = ExpertScheduler("3", "maximum", 30)
        for f in range(10): scheduler.observe(f, body(), [0.95] * 17)
        scheduler.report_expert_risk(9)
        self.assertTrue(scheduler.observe(10, body(), [0.95] * 17).run)
        self.assertIn("risk-hold", scheduler.observe(11, body(), [0.95] * 17).reasons)

    def test_motion_detection_scales_with_fps(self):
        for fps in (30, 60):
            scheduler = ExpertScheduler("3", "maximum", fps)
            scheduler.observe(0, body(), [0.95] * 17)
            decision = scheduler.observe(1, body(30 * 30 / fps), [0.95] * 17)
            self.assertIn("fast-motion", decision.reasons)

    def test_invalid_parameters_fail_before_model_loading(self):
        for value in ("0", "4", "bogus"):
            with self.assertRaises(ValueError): ExpertScheduler(value, "maximum", 30)
            with mock.patch.object(adapter, "_load_inferencer") as load:
                with self.assertRaises(ValueError): adapter.MMPoseSession(expert_interval=value)
                load.assert_not_called()
        with self.assertRaises(ValueError): ExpertScheduler("2", "maximum", 0)


class AdapterScheduleIntegrationTests(unittest.TestCase):
    def test_optical_flow_failure_is_reported_without_replacing_base_points(self):
        try:
            import numpy as np
        except ImportError:
            self.skipTest("NumPy is required for optical-flow boundary test")
        measured = body()
        for valid in (False, True):
            cv2 = types.SimpleNamespace(
                COLOR_BGR2GRAY=0, TERM_CRITERIA_EPS=1, TERM_CRITERIA_COUNT=2,
                cvtColor=lambda image, mode: np.zeros(image.shape[:2], dtype=np.uint8),
                calcOpticalFlowPyrLK=lambda *a, **kw: (
                    np.array(measured, dtype=np.float32).reshape(-1, 1, 2),
                    np.full((17, 1), int(valid)), np.zeros((17, 1))),
            )
            flow = adapter._TemporalFusion(cv2, np, (0, 0, 640, 480))
            flow.previous_gray = np.zeros((480, 640), dtype=np.uint8)
            flow.previous_points = np.array(measured, dtype=np.float32)
            flow.foreground_mask = np.ones((480, 640), dtype=np.uint8)
            flow.frame_index = 1
            result = flow.fuse(np.zeros((480, 640, 3), dtype=np.uint8), measured, [0.95] * 17)
            self.assertEqual(flow.tracking_failed, not valid)
            np.testing.assert_allclose(result, measured, atol=0.0001)

    def run_adapter(self, mode, *, quality="maximum", missing_expert=False):
        frames = 40

        class Capture:
            def isOpened(self): return True
            def get(self, prop): return {1: 640, 2: 480, 3: 30, 4: frames}[prop]
            def read(self): return True, object()
            def release(self): pass

        class Inferencer:
            def __init__(self):
                self.inferencer = types.SimpleNamespace(
                    _buffer={}, pose2d_model=types.SimpleNamespace())
            def __call__(self, *args, **kwargs):
                for f in range(frames):
                    scores = [0.95] * 17
                    if f == 20: scores[10] = 0.1
                    self.inferencer._buffer["pose2d_results"] = types.SimpleNamespace(
                        pred_instances=types.SimpleNamespace(keypoints=[body()], keypoint_scores=[scores]))
                    yield {"frame": f}

        class Flow:
            tracking_failed = False
            mask_provider_error = ""
            def __init__(self, *args): pass
            def fuse(self, frame, points, scores): return points

        session = types.SimpleNamespace(
            cv2=types.SimpleNamespace(VideoCapture=lambda *args: Capture(), CAP_PROP_FRAME_WIDTH=1,
                CAP_PROP_FRAME_HEIGHT=2, CAP_PROP_FPS=3, CAP_PROP_FRAME_COUNT=4),
            np=None, quality=quality, expert_interval=mode, segmentation="grabcut",
            anime_pose_weights=None, calibration=types.SimpleNamespace(status="model-normalized"),
            base_model="hrnet", npu_observer=None, npu_error="", npu_mode="off", npu_sample_interval=15,
            upscaler=None, mask_provider=lambda _: None, sam2_error="", inferencer=Inferencer(),
            high_accuracy_refiner=None if missing_expert else object(), high_accuracy_error="",
            humanart_expert=object(), humanart_error="",
        )
        calls = []
        def refine(expert, frame, roi, index, upscaler):
            calls.append(("rtmw" if expert is session.high_accuracy_refiner else "humanart", index))
            return body(), [0.96] * 17

        with tempfile.TemporaryDirectory() as directory, contextlib.ExitStack() as stack:
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(mock.patch.object(adapter, "_enable_center_crop"))
            stack.enter_context(mock.patch.object(adapter, "_TemporalFusion", Flow))
            stack.enter_context(mock.patch.object(adapter, "_prediction", return_value={"keypoints": [[0, 0, 0]] * 17}))
            stack.enter_context(mock.patch.object(adapter, "_refine_frame_2d", side_effect=refine))
            stack.enter_context(mock.patch.object(adapter, "_fuse_coco_hypotheses", side_effect=lambda h, **kw: (*h["hrnet"], {})))
            stack.enter_context(mock.patch.object(adapter, "_coco_to_h36m", side_effect=lambda p, s: (p, s)))
            stack.enter_context(mock.patch.object(adapter, "_map_h36m", side_effect=lambda p, p2, s, w, h: ([{"x": p2[0][0]}], False)))
            output = Path(directory) / "pose_sequence.json"
            adapter._run_mmpose_with_session(session, Path("test.mp4"), output, (0, 0, 640, 480))
            return json.loads(output.read_text()), json.loads(output.with_name("expert-schedule.json").read_text()), calls

    def test_actual_adapter_skips_experts_but_keeps_base_frames_and_timestamps(self):
        full, full_report, full_calls = self.run_adapter("1")
        sparse, report, calls = self.run_adapter("2")
        self.assertEqual(full["frames"], sparse["frames"])
        self.assertEqual([f["time_s"] for f in sparse["frames"]], [f / 30 for f in range(40)])
        self.assertEqual(len(full_calls), 80)
        self.assertLess(len(calls), len(full_calls))
        self.assertIn(("rtmw", 20), calls)
        self.assertIn(("humanart", 20), calls)
        self.assertIn("low-confidence-or-missing", report["frames"][20]["reasons"])
        self.assertEqual(sum(report["attempts"].values()), len(calls))
        self.assertEqual(report["output_frames"], 40)
        self.assertEqual(len(report["frames"]), 40)
        self.assertIn("adaptive", sparse["backend"])

    def test_legacy_and_fast_and_unavailable_expert_remain_distinct(self):
        _, _, calls = self.run_adapter(None)
        self.assertEqual(len(calls), 80)
        _, fast, calls = self.run_adapter("2", quality="fast")
        self.assertFalse(calls)
        self.assertTrue(all(f["rtmw"] == "disabled" for f in fast["frames"]))
        _, report, calls = self.run_adapter("3", missing_expert=True)
        self.assertTrue(all(f["rtmw"] == "unavailable" for f in report["frames"]))
        self.assertEqual(report["attempts"]["rtmw"], 0)
        self.assertTrue(calls)


if __name__ == "__main__":
    unittest.main()
