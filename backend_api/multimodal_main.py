from __future__ import annotations

from io import BytesIO

from fastapi import Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.multimodal_calibration import (
    APRILTAG_DICTIONARY_NAME,
    CALIBRATION_TAG_IDS,
    detect_apriltags_base64,
    generate_calibration_sheet_png,
)
from backend_api import training_runner
from backend_api.main import app


# ── Training runner endpoints ──────────────────────────────────────────────


class TrainStartRequest(BaseModel):
    command: str = Field(min_length=1)


@app.post("/api/train/start")
async def train_start(payload: TrainStartRequest) -> dict:
    return await training_runner.start(payload.command)


@app.post("/api/train/stop")
async def train_stop() -> dict:
    return await training_runner.stop()


@app.get("/api/train/status")
def train_status() -> dict:
    return training_runner.get_status()


@app.get("/api/train/stream")
async def train_stream() -> StreamingResponse:
    return StreamingResponse(
        training_runner.stream_output(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


class AprilTagDetectRequest(BaseModel):
    imageBase64: str = Field(min_length=16, max_length=24_000_000)


@app.get("/api/multimodal/status")
def multimodal_status() -> dict[str, object]:
    return {
        "ok": True,
        "gesture": "mediapipe-web",
        "voice": "browser-speech",
        "calibration": "apriltag-opencv",
        "dictionary": APRILTAG_DICTIONARY_NAME,
        "tagIds": list(CALIBRATION_TAG_IDS),
    }


@app.post("/api/multimodal/apriltag/detect")
def apriltag_detect(payload: AprilTagDetectRequest) -> dict[str, object]:
    return detect_apriltags_base64(payload.imageBase64)


@app.get("/api/multimodal/apriltag/sheet.png")
def apriltag_sheet(dpi: int = Query(default=150, ge=96, le=600)) -> StreamingResponse:
    data = generate_calibration_sheet_png(dpi=dpi)
    return StreamingResponse(
        BytesIO(data),
        media_type="image/png",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="yoloworkbench-apriltag-calibration.png"',
        },
    )
