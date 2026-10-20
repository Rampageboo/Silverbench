from __future__ import annotations

import base64
from io import BytesIO
from typing import Any

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

APRILTAG_DICTIONARY_NAME = "DICT_APRILTAG_36h11"
CALIBRATION_TAG_IDS = (0, 1, 2, 3)
# Reject decoded frames whose pixel count would risk memory exhaustion.
_MAX_CALIBRATION_IMAGE_PIXELS = 60_000_000


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
    height, width = image.shape[:2]
    if width * height > _MAX_CALIBRATION_IMAGE_PIXELS:
        raise ValueError(
            f"Camera image is too large ({width}x{height}); "
            f"limit is {_MAX_CALIBRATION_IMAGE_PIXELS:,} pixels."
        )
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


def _pil_font(size: int):
    """Load a Pillow default bitmap font at the requested point size (Pillow 10+).
    Falls back to the unsized default so the call never raises."""
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def generate_calibration_sheet_png(dpi: int = 150) -> bytes:
    dpi = max(96, min(600, int(dpi)))

    # A4 canvas in pixels
    width = round(8.27 * dpi)
    height = round(11.69 * dpi)

    # Markers: 2 inches each, 0.4-inch margin from paper edge
    margin = round(0.4 * dpi)
    marker_size = round(2.0 * dpi)

    # Fonts scaled to DPI so they look the same at every resolution
    font_label = _pil_font(max(14, dpi // 10))      # tag ID labels
    font_title = _pil_font(max(18, dpi // 7))        # center heading
    font_sub   = _pil_font(max(13, dpi // 11))       # center sub-text
    font_dot   = _pil_font(max(14, dpi // 10))       # numbers inside red dots

    canvas = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(canvas)

    # ── four AprilTag markers, one per corner ──────────────────────────────
    positions = {
        0: (margin, margin),                                                # top-left
        1: (width - margin - marker_size, margin),                          # top-right
        2: (width - margin - marker_size, height - margin - marker_size),   # bottom-right
        3: (margin, height - margin - marker_size),                         # bottom-left
    }
    corner_names = {0: "左上 TL", 1: "右上 TR", 2: "右下 BR", 3: "左下 BL"}

    for marker_id, (mx, my) in positions.items():
        canvas.paste(_marker_image(marker_id, marker_size), (mx, my))

        # Draw a solid label band so text is always readable on white
        label = f"ID {marker_id}  {corner_names[marker_id]}"
        lw = max(2, dpi // 60)
        # Label below top markers, above bottom markers
        if marker_id in (0, 1):
            label_y = my + marker_size + lw + 4
        else:
            label_y = my - round(dpi // 9) - lw - 4
        draw.text((mx, label_y), label, fill=(30, 64, 175), font=font_label)

    # ── guide rectangle (well inside the quiet zones) ─────────────────────
    # Inner corners of the marker footprints
    inward = [
        (positions[0][0] + marker_size, positions[0][1] + marker_size),
        (positions[1][0],               positions[1][1] + marker_size),
        (positions[2][0],               positions[2][1]),
        (positions[3][0] + marker_size, positions[3][1]),
    ]
    # Pull guides further inward so they never touch the quiet zone
    guide_gap = max(20, round(0.20 * dpi))
    guides = [
        (inward[0][0] + guide_gap, inward[0][1] + guide_gap),
        (inward[1][0] - guide_gap, inward[1][1] + guide_gap),
        (inward[2][0] - guide_gap, inward[2][1] - guide_gap),
        (inward[3][0] + guide_gap, inward[3][1] - guide_gap),
    ]

    line_w = max(3, dpi // 25)
    draw.line([*guides, guides[0]], fill=(30, 64, 175), width=line_w)

    # Red filled circles with white numerals at each guide corner
    dot_r = max(10, dpi // 16)
    for index, (px, py) in enumerate(guides, start=1):
        draw.ellipse(
            (px - dot_r, py - dot_r, px + dot_r, py + dot_r),
            fill=(220, 38, 38),
        )
        draw.text((px, py), str(index), fill="white", font=font_dot, anchor="mm")

    # ── center annotation ──────────────────────────────────────────────────
    cx = width // 2
    cy = height // 2
    line_h = round(dpi // 6)

    draw.text((cx, cy - line_h), "RampageWorkbench 标定板", fill=(15, 23, 42),
              font=font_title, anchor="mm")
    draw.text((cx, cy), "AprilTag 36h11  ·  ID 0左上 / 1右上 / 2右下 / 3左下",
              fill=(51, 65, 85), font=font_sub, anchor="mm")
    draw.text((cx, cy + line_h), "打印后平放，确保四个标签完整可见",
              fill=(100, 116, 139), font=font_sub, anchor="mm")

    # ── border ────────────────────────────────────────────────────────────
    border_inset = round(0.15 * dpi)
    border_w = max(2, dpi // 50)
    draw.rectangle(
        [border_inset, border_inset, width - border_inset, height - border_inset],
        outline=(203, 213, 225),
        width=border_w,
    )

    output = BytesIO()
    canvas.save(output, format="PNG", dpi=(dpi, dpi), optimize=True)
    return output.getvalue()
