from __future__ import annotations

from backend.ui_orchestrator_predictions import build_predictions


def _approx_box(actual: list[float], expected: list[float], tol: float = 1e-6) -> None:
    assert len(actual) == len(expected)
    for got, want in zip(actual, expected):
        assert abs(got - want) <= tol, f"{got} != {want}"


def _raw_det() -> dict:
    return {
        "predictions": [
            # normalized center xywh (as detect_image_with_pt returns)
            {"className": "go_button", "confidence": 0.9, "x": 0.5, "y": 0.5, "w": 0.2, "h": 0.1},
        ]
    }


def _raw_clf() -> dict:
    return {
        "top": {"className": "Schedule_Errands", "confidence": 0.95},
        "predictions": [
            {"className": "Schedule_Errands", "confidence": 0.95},
            {"className": "Other", "confidence": 0.03},
        ],
    }


def test_det_boxes_convert_normalized_xywh_to_pixel_xyxy() -> None:
    result = build_predictions((1000, 800), _raw_det(), None)

    assert result["imageSize"] == [1000, 800]
    assert len(result["det"]) == 1
    box = result["det"][0]
    assert box["class"] == "go_button"
    assert box["conf"] == 0.9
    # x: (0.5 -/+ 0.1) * 1000 -> [400, 600]; y: (0.5 -/+ 0.05) * 800 -> [360, 440]
    _approx_box(box["box"], [400.0, 360.0, 600.0, 440.0])
    # clf required by schema §12; empty when no classifier ran
    assert result["clf"] == {"label": "", "conf": 0.0, "topK": []}


def test_clf_maps_top_and_topk() -> None:
    result = build_predictions((640, 640), None, _raw_clf())

    assert result["det"] == []
    assert result["clf"]["label"] == "Schedule_Errands"
    assert result["clf"]["conf"] == 0.95
    assert result["clf"]["topK"] == [
        {"label": "Schedule_Errands", "conf": 0.95},
        {"label": "Other", "conf": 0.03},
    ]


def test_empty_inputs_are_fail_closed() -> None:
    result = build_predictions((10, 20), None, None)
    assert result == {"imageSize": [10, 20], "det": [], "clf": {"label": "", "conf": 0.0, "topK": []}}


if __name__ == "__main__":  # allow direct execution when pytest is unavailable
    test_det_boxes_convert_normalized_xywh_to_pixel_xyxy()
    test_clf_maps_top_and_topk()
    test_empty_inputs_are_fail_closed()
    print("ui_orchestrator_predictions: ALL_OK")
