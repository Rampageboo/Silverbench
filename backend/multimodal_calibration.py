from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

APRILTAG_DICTIONARY_NAME = "DICT_APRILTAG_36h11"
CALIBRATION_TAG_IDS = (0, 1, 2, 3)


def _dictionary():
    aruco = getattr(cv2, "aruco", None)
    if aruco is None:
        raise RuntimeError("OpenCV aruco module is unavailable. Install opencv-contrib-python.")
    dictionary_id = getattr(aruco, APRILTAG_DICTIONARY_NAME, None)
    if dictionary_id is None:
        raise RuntimeError(f"OpenCV does not provide {APRILTAG_DICTIONARY_NAME}.")
    return aruco.getPredefinedDictionary(dictionary_id)


def _detector_parameters():
    aruco = cv2.aruco
    if hasattr(aruco, "DetectorParameters"):
        parameters = aruco.DetectorParameters()
    elif hasattr(aruco, "DetectorParameters_create"):
        parameters = aruco.DetectorParameters_create()
    else:
        raise RuntimeError("OpenCV aruco detector parameters are unavailable.")
    if hasattr(aruco, "CORNER_REFINE_APRILTAG"):
        parameters.cornerRefinementMethod = aruco.CORNER_REFINE_APRILTAG
    elif hasattr(aruco, "CORNER_REFINE_SUBPIX"):
        parameters.cornerRefinementMethod = aruco.CORNER_REFINE_SUBPIX
    return parameters


def decode_image_base64(value: str):
    text = str(value or "").strip()
    if not text:
        raise ValueError("imageBase64 is required.")
    if text.startswith("data:"):
        _, _, text = text.partition(",")
    try:
        payload = base64.b64decode(text, validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError("imageBase64 is invalid.") from error
    data = np.frombuffer(payload, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Cannot decode camera image.")
    return image


def detect_apriltags(image) -> dict[str, Any]:
    if image is None or not getattr(image, "size", 0):
        raise ValueError("Camera image is empty.")
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    aruco = cv2.aruco
    dictionary = _dictionary()
    parameters = _detector_parameters()

    if hasattr(aruco, "ArucoDetector"):
        detector = aruco.ArucoDetector(dictionary, parameters)
        corners, ids, rejected = detector.detectMarkers(gray)
    else:
        corners, ids, rejected = aruco.detectMarkers(gray, dictionary, parameters=parameters)

    detections: list[dict[str, Any]] = []
    if ids is not None:
        for marker_id, marker_corners in zip(ids.reshape(-1).tolist(), corners):
            points = np.asarray(marker_corners, dtype=np.float64).reshape(4, 2)
            detections.append(
                {
                    "id": int(marker_id),
                    "corners": [
                        {"x": float(point[0] / width), "y": float(point[1] / height)}
                        for point in points
                    ],
                    "pixelCorners": [
                        {"x": float(point[0]), "y": float(point[1])}
                        for point in points
                    ],
                }
            )
    detections.sort(key=lambda item: item["id"])
    found_ids = {item["id"] for item in detections}
    return {
        "ok": True,
        "dictionary": APRILTAG_DICTIONARY_NAME,
        "imageWidth": int(width),
        "imageHeight": int(height),
        "detections": detections,
        "requiredIds": list(CALIBRATION_TAG_IDS),
        "missingIds": [marker_id for marker_id in CALIBRATION_TAG_IDS if marker_id not in found_ids],
        "rejectedCount": len(rejected) if rejected is not None else 0,
    }


def detect_apriltags_base64(value: str) -> dict[str, Any]:
    return detect_apriltags(decode_image_base64(value))


def _marker_image(marker_id: int, size: int) -> Image.Image:
    dictionary = _dictionary()
    aruco = cv2.aruco
    if hasattr(aruco, "generateImageMarker"):
        marker = aruco.generateImageMarker(dictionary, marker_id, size)
    else:
        marker = np.zeros((size, size), dtype=np.uint8)
        aruco.drawMarker(dictionary, marker_id, size, marker, 1)
    return Image.fromarray(marker).convert("RGB")


def generate_calibration_sheet_png(dpi: int = 150) -> bytes:
    dpi = max(96, min(600, int(dpi)))
    width = round(8.27 * dpi)
    height = round(11.69 * dpi)
    margin = round(0.45 * dpi)
    marker_size = round(1.35 * dpi)
    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()

    positions = {
        0: (margin, margin),
        1: (width - margin - marker_size, margin),
        2: (width - margin - marker_size, height - margin - marker_size),
        3: (margin, height - margin - marker_size),
    }
    for marker_id, position in positions.items():
        canvas.paste(_marker_image(marker_id, marker_size), position)
        label_y = position[1] + marker_size + 8 if marker_id in (0, 1) else position[1] - 18
        draw.text((position[0], label_y), f"AprilTag 36h11 ID {marker_id}", fill="black", font=font)

    inward = [
        (positions[0][0] + marker_size, positions[0][1] + marker_size),
        (positions[1][0], positions[1][1] + marker_size),
        (positions[2][0], positions[2][1]),
        (positions[3][0] + marker_size, positions[3][1]),
    ]
    # Keep all visual guides well inside the tag-defined rectangle. Drawing on a tag edge
    # destroys its quiet boundary and can make every marker undetectable after printing.
    guide_gap = max(18, round(0.18 * dpi))
    guides = [
        (inward[0][0] + guide_gap, inward[0][1] + guide_gap),
        (inward[1][0] - guide_gap, inward[1][1] + guide_gap),
        (inward[2][0] - guide_gap, inward[2][1] - guide_gap),
        (inward[3][0] + guide_gap, inward[3][1] - guide_gap),
    ]
    draw.line([*guides, guides[0]], fill=(30, 64, 175), width=max(2, dpi // 40))
    for index, point in enumerate(guides, start=1):
        radius = max(5, dpi // 30)
        draw.ellipse(
            (point[0] - radius, point[1] - radius, point[0] + radius, point[1] + radius),
            outline=(220, 38, 38),
            width=max(2, dpi // 60),
        )
        draw.text((point[0] + radius + 2, point[1] - radius), str(index), fill=(220, 38, 38), font=font)

    title = "YoloWorkBench AprilTag interaction-plane calibration"
    subtitle = "IDs clockwise: 0 top-left, 1 top-right, 2 bottom-right, 3 bottom-left"
    draw.text((width // 2 - len(title) * 3, height // 2 - 18), title, fill="black", font=font)
    draw.text((width // 2 - len(subtitle) * 3, height // 2 + 2), subtitle, fill="black", font=font)

    output = BytesIO()
    canvas.save(output, format="PNG", dpi=(dpi, dpi), optimize=True)
    return output.getvalue()
