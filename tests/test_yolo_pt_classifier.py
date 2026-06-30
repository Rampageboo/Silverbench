from __future__ import annotations

import sys
import types
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from backend.yolo_pt_classifier import classify_image_with_pt


class TensorLike:
    def __init__(self, value: object) -> None:
        self.value = value

    def detach(self) -> "TensorLike":
        return self

    def cpu(self) -> "TensorLike":
        return self

    def tolist(self) -> object:
        return self.value

    def item(self) -> object:
        return self.value

    def __bool__(self) -> bool:
        raise RuntimeError("Boolean value of Tensor with more than one value is ambiguous")


class YoloPtClassifierTests(unittest.TestCase):
    def test_classify_image_with_pt_returns_top_predictions_without_copying(self) -> None:
        captured: dict[str, object] = {}

        class FakeYOLO:
            names = {0: "background", 1: "Map"}

            def __init__(self, model_path: str) -> None:
                captured["modelPath"] = model_path

            def predict(self, **kwargs: object) -> list[object]:
                captured["predict"] = kwargs
                probs = types.SimpleNamespace(
                    top1=1,
                    top1conf=0.92,
                    top5=[1, 0],
                    top5conf=[0.92, 0.08],
                )
                return [types.SimpleNamespace(probs=probs, names=self.names)]

        previous = sys.modules.get("ultralytics")
        sys.modules["ultralytics"] = types.SimpleNamespace(YOLO=FakeYOLO)
        try:
            with TemporaryDirectory() as tmp:
                root = Path(tmp)
                model = root / "best.pt"
                image = root / "screen.png"
                model.write_bytes(b"fake model")
                image.write_bytes(b"fake image")

                result = classify_image_with_pt(model, image, image_size=224, device="cpu", top_k=2)

            self.assertTrue(result["ok"])
            self.assertEqual(result["top"]["classId"], 1)
            self.assertEqual(result["top"]["className"], "Map")
            self.assertAlmostEqual(result["top"]["confidence"], 0.92)
            self.assertEqual(len(result["predictions"]), 2)
            self.assertEqual(captured["predict"]["source"], str(image))
            self.assertEqual(captured["predict"]["device"], "cpu")
        finally:
            if previous is None:
                sys.modules.pop("ultralytics", None)
            else:
                sys.modules["ultralytics"] = previous

    def test_classify_image_with_pt_handles_tensor_like_topk_without_bool_eval(self) -> None:
        class FakeYOLO:
            names = {0: "background", 1: "Map"}

            def __init__(self, model_path: str) -> None:
                self.model_path = model_path

            def predict(self, **kwargs: object) -> list[object]:
                probs = types.SimpleNamespace(
                    top1=TensorLike(1),
                    top1conf=TensorLike(0.92),
                    top5=TensorLike([1, 0]),
                    top5conf=TensorLike([0.92, 0.08]),
                )
                return [types.SimpleNamespace(probs=probs, names=self.names)]

        previous = sys.modules.get("ultralytics")
        sys.modules["ultralytics"] = types.SimpleNamespace(YOLO=FakeYOLO)
        try:
            with TemporaryDirectory() as tmp:
                root = Path(tmp)
                model = root / "best.pt"
                image = root / "screen.png"
                model.write_bytes(b"fake model")
                image.write_bytes(b"fake image")

                result = classify_image_with_pt(model, image, image_size=224, device="cpu", top_k=2)

            self.assertEqual(result["top"]["className"], "Map")
            self.assertEqual([item["classId"] for item in result["predictions"]], [1, 0])
            self.assertAlmostEqual(result["predictions"][0]["confidence"], 0.92)
        finally:
            if previous is None:
                sys.modules.pop("ultralytics", None)
            else:
                sys.modules["ultralytics"] = previous

    def test_classify_image_with_pt_uses_model_imgsz_when_not_requested(self) -> None:
        captured: dict[str, object] = {}

        class FakeInnerModel:
            args = {"imgsz": 640}

        class FakeYOLO:
            names = {0: "background", 1: "Banner_L"}
            model = FakeInnerModel()

            def __init__(self, model_path: str) -> None:
                self.model_path = model_path

            def predict(self, **kwargs: object) -> list[object]:
                captured["predict"] = kwargs
                probs = types.SimpleNamespace(
                    top1=1,
                    top1conf=0.99,
                    top5=[1, 0],
                    top5conf=[0.99, 0.01],
                )
                return [types.SimpleNamespace(probs=probs, names=self.names)]

        previous = sys.modules.get("ultralytics")
        sys.modules["ultralytics"] = types.SimpleNamespace(YOLO=FakeYOLO)
        try:
            with TemporaryDirectory() as tmp:
                root = Path(tmp)
                model = root / "best.pt"
                image = root / "screen.png"
                model.write_bytes(b"fake model")
                image.write_bytes(b"fake image")

                result = classify_image_with_pt(model, image, image_size=0, device="cpu", top_k=2)

            self.assertEqual(captured["predict"]["imgsz"], 640)
            self.assertEqual(result["imageSize"], 640)
            self.assertEqual(result["top"]["className"], "Banner_L")
        finally:
            if previous is None:
                sys.modules.pop("ultralytics", None)
            else:
                sys.modules["ultralytics"] = previous


if __name__ == "__main__":
    unittest.main()
