"""Map raw detector/classifier output into the UI Orchestrator schema v1.0
`Predictions` shape (schema §12).

Kept as a pure module (no torch / no model loading) so it is unit-testable with
synthetic inputs. The service handler performs the guarded model calls and hands
the raw result dicts here.

Raw shapes consumed (from `yolo_pt_detector.detect_image_with_pt` /
`yolo_pt_classifier.classify_image_with_pt`):
  det:  {"predictions": [{"className", "confidence", "x", "y", "w", "h"}]}   # normalized center xywh, [0,1]
  clf:  {"top": <pred|None>, "predictions": [{"className", "confidence"}]}

Produced (schema §12):
  {"imageSize": [w, h],
   "det": [{"class", "box": [x0, y0, x1, y1] px, "conf"}],
   "clf": {"label", "conf", "topK": [{"label", "conf"}]}}
"""

from __future__ import annotations

from typing import Any, Sequence


def _det_boxes(raw_det: dict[str, Any], width: int, height: int) -> list[dict[str, Any]]:
    boxes: list[dict[str, Any]] = []
    for pred in raw_det.get("predictions", []) or []:
        cx = float(pred.get("x", 0.0))
        cy = float(pred.get("y", 0.0))
        bw = float(pred.get("w", 0.0))
        bh = float(pred.get("h", 0.0))
        x0 = (cx - bw / 2.0) * width
        y0 = (cy - bh / 2.0) * height
        x1 = (cx + bw / 2.0) * width
        y1 = (cy + bh / 2.0) * height
        boxes.append(
            {
                "class": str(pred.get("className", "")),
                "box": [x0, y0, x1, y1],
                "conf": float(pred.get("confidence", 0.0)),
            }
        )
    return boxes


def _clf(raw_clf: dict[str, Any]) -> dict[str, Any]:
    predictions = raw_clf.get("predictions", []) or []
    top = raw_clf.get("top") or (predictions[0] if predictions else None)
    label = str(top.get("className", "")) if isinstance(top, dict) else ""
    conf = float(top.get("confidence", 0.0)) if isinstance(top, dict) else 0.0
    top_k = [
        {"label": str(pred.get("className", "")), "conf": float(pred.get("confidence", 0.0))}
        for pred in predictions
    ]
    return {"label": label, "conf": conf, "topK": top_k}


def build_predictions(
    image_wh: Sequence[int],
    raw_det: dict[str, Any] | None,
    raw_clf: dict[str, Any] | None,
) -> dict[str, Any]:
    """Assemble the schema-§12 Predictions dict.

    `clf` is always present (schema §12 requires it); when no classifier ran it
    is an empty result (`label == ""`, `conf == 0`), which the preview
    interpreter treats fail-closed as "no confident classification".
    """
    width = int(image_wh[0])
    height = int(image_wh[1])
    predictions: dict[str, Any] = {
        "imageSize": [width, height],
        "det": _det_boxes(raw_det, width, height) if raw_det else [],
        "clf": _clf(raw_clf) if raw_clf else {"label": "", "conf": 0.0, "topK": []},
    }
    return predictions
