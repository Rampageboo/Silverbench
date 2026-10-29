"""Shared AI review entrypoints for the desktop and the local MCP bridge."""
from __future__ import annotations

from typing import Callable, Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.ai_review import AiReviewService, ReviewError


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    workspace_root: str = Field(min_length=1)
    filename: str = Field(min_length=1)
    provider: Literal["local", "openai", "claude", "openai_decisions"] = "local"
    model: str = Field(default="", max_length=100)
    allow_cloud_upload: bool = False
    batch_id: str = Field(default="default", min_length=1, max_length=100)
    detail: Literal["low", "high", "auto"] = "low"
    max_output_tokens: int = Field(default=2048, ge=128, le=8192)
    questions: list[dict] | None = None


class CaptionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    asset_id: str
    provider: Literal["local", "openai", "claude"] = "local"
    model: str = Field(default="", max_length=100)
    allow_cloud_upload: bool = False
    batch_id: str = Field(default="gallery", min_length=1, max_length=100)
    detail: Literal["low", "high", "auto"] = "low"
    max_output_tokens: int = Field(default=2048, ge=128, le=8192)


class DecisionRequest(BaseModel):
    index: int = Field(ge=0)
    decision: Literal["accepted", "rejected"]


class CaptionDecisionRequest(BaseModel):
    decision: Literal["accepted", "rejected"]


TRUSTED_ORIGINS = {
    "http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8765", "http://localhost:8765",
    "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost",
}


def _trusted_client(request: Request) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin not in TRUSTED_ORIGINS:
        raise HTTPException(403, "Untrusted origin for cloud API controls.")
    if request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Cross-site cloud API controls are not allowed.")


def create_router(service: AiReviewService, authorize_workspace: Callable) -> APIRouter:
    router = APIRouter(prefix="/api/ai", tags=["ai-review"], dependencies=[Depends(_trusted_client)])

    def call(function, *args, **kwargs):
        try:
            return function(*args, **kwargs)
        except PermissionError:
            raise HTTPException(403, "Workspace was not opened in this app session.") from None
        except KeyError:
            raise HTTPException(404, "AI review asset or request was not found.") from None
        except (ReviewError, ValueError, TypeError):
            raise HTTPException(400, "Invalid AI review configuration or request; check paths, classes, prices and budgets.") from None
        except OSError:
            raise HTTPException(409, "AI review local storage is unavailable.") from None

    @router.get("/settings")
    def settings():
        return call(service.settings)

    @router.post("/settings")
    def configure(changes: dict = Body(...)):
        return call(service.configure, changes)

    @router.post("/review")
    def review(payload: ReviewRequest):
        call(authorize_workspace, payload.workspace_root)
        return call(service.review, **payload.model_dump())

    @router.get("/ledger")
    def ledger(limit: int = Query(default=50, ge=1, le=200)):
        return {"requests": call(service.ledger, limit)}

    @router.get("/requests/{request_id}")
    def request_record(request_id: str):
        row = call(service.request, request_id)
        if row["record"].get("workspace_root"):
            call(authorize_workspace, row["record"]["workspace_root"])
        return row

    @router.post("/requests/{request_id}/verify")
    def verify(request_id: str):
        request_record(request_id)
        return call(service.verify, request_id)

    @router.post("/requests/{request_id}/decision")
    def decide(request_id: str, payload: DecisionRequest):
        request_record(request_id)
        return call(service.decide, request_id, payload.index, payload.decision)

    @router.post("/caption")
    def caption(payload: CaptionRequest):
        from backend_api.gallery import get_library
        library = get_library()
        options = payload.model_dump()
        asset_id = options.pop("asset_id")
        return call(service.caption, library, asset_id, **options)

    @router.post("/requests/{request_id}/caption-decision")
    def caption_decision(request_id: str, payload: CaptionDecisionRequest):
        from backend_api.gallery import get_library
        return call(service.decide_caption, request_id, payload.decision, get_library())

    @router.post("/batches/{batch_id}/stop")
    def stop(batch_id: str):
        return call(service.stop_batch, batch_id)

    return router
