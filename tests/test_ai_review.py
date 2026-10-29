from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from PIL import Image
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.ai_review import AiReviewService, ReviewError, validate_answers
from backend.ai_providers import ProviderError, request_body
from backend.workspace_layout import create_workspace
from backend_api.ai_review import create_router


CLASSES = {"version": 1, "classDefs": [{"key": "car", "name": "Car"}],
           "tasks": {"detect": {"classKeys": ["car"]}, "clf": {"classKeys": []}}}


@pytest.fixture
def workspace(tmp_path):
    layout = create_workspace(tmp_path / "workspace", classes=CLASSES)
    Image.new("RGB", (2000, 1000), "blue").save(layout.media / "test.png")
    return layout


def response(objects=None):
    return {"id": "provider-1", "model": "test-model", "status": "completed",
            "usage": {"input_tokens": 20, "output_tokens": 30},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({
                "objects": objects if objects is not None else [
                    {"class_id": 0, "box": [0.1, 0.2, 0.7, 0.8], "evidence": "Visible car"}],
                "uncertainty": "Approximate geometry"})}]}]}


@pytest.fixture
def harness(tmp_path):
    sent = []

    def sender(*args):
        sent.append(args)
        return response()

    service = AiReviewService(tmp_path / "app-data", sender=sender, key_reader=lambda provider: "test-secret")
    service.configure({"cloud_enabled": True, "prices": {
        name + ":test-model": {"input": 0.1, "output": 0.2}
        for name in ("openai", "claude", "openai_decisions")}})
    return service, sent


def review(service, workspace, **kwargs):
    return service.review(str(workspace.root), "test.png", provider="openai", model="test-model",
                          allow_cloud_upload=True, **kwargs)


def test_opt_in_and_offline_path_do_not_read_or_upload_images(harness):
    service, sent = harness
    result = service.review("does-not-exist", "private.png")
    assert result["provider"] == "local" and not result["cloud_request_sent"]
    assert not result["local_inference_executed"]
    result = service.review("does-not-exist", "private.png", provider="openai", model="test-model")
    assert not result["cloud_request_sent"]
    service.configure({"cloud_enabled": False})
    assert not service.review("missing", "private.png", provider="openai", allow_cloud_upload=True)["cloud_request_sent"]
    assert sent == []


def test_proposals_are_independent_traceable_and_never_labels(harness, workspace):
    service, sent = harness
    before = (workspace.media / "test.png").read_bytes()
    label_files = {p.relative_to(workspace.root): p.read_bytes() for p in workspace.root.rglob("*") if p.is_file()}
    result = review(service, workspace)
    assert result["objects"][0]["pixel_box"] == [200, 200, 1400, 800]
    assert result["objects"][0]["review_status"] == "pending"
    assert result["objects"][0]["geometry"] == "approximate"
    assert sent[0][2] == "https://api.openai.com/v1/responses"
    assert sent[0][3]["store"] is False
    assert (workspace.media / "test.png").read_bytes() == before
    assert {p.relative_to(workspace.root): p.read_bytes() for p in workspace.root.rglob("*") if p.is_file()} == label_files
    record = service.ledger()[0]
    assert record["status"] == "completed" and record["charged"] < record["reserved"]
    assert record["record"]["preview_size"] == [1280, 640]
    assert record["record"]["actual_model"] == "test-model"
    assert "test-secret" not in json.dumps(record)
    assert "data:image" not in json.dumps(record)


@pytest.mark.parametrize("obj", [
    {"class_id": 99, "box": [0, 0, 1, 1], "evidence": "wrong class"},
    {"class_id": 0, "box": [0, 0, float("nan"), 1], "evidence": "NaN"},
    {"class_id": 0, "box": [0.5, 0, 0.1, 1], "evidence": "inverted"},
    {"class_id": 0, "box": [0, 0, 2, 1], "evidence": "outside"},
])
def test_invalid_geometry_falls_back_without_writing_labels(harness, workspace, obj):
    service, _ = harness
    service.sender = lambda *args: response([obj])
    result = review(service, workspace)
    assert result["route"] == "local_only"
    assert service.ledger()[0]["status"] == "unknown"
    assert not workspace.image_label_file("test.png").exists()


def test_empty_cloud_result_is_pending_not_reviewed_negative(harness, workspace):
    service, _ = harness
    service.sender = lambda *args: response([])
    result = review(service, workspace)
    assert result["objects"] == [] and result["review_status"] == "pending"
    assert not workspace.image_label_file("test.png").exists()


def test_request_budget_rejects_before_network(harness, workspace):
    service, sent = harness
    service.configure({"request_limit_usd": 0.00000001})
    with pytest.raises(ReviewError, match="Request budget"):
        review(service, workspace)
    assert sent == [] and service.ledger() == []


def test_unknown_billing_reservation_survives_restart_and_blocks_batch(harness, workspace):
    service, sent = harness
    def fail(*args):
        sent.append(args)
        raise ProviderError("test-secret: do not echo raw provider error")
    service.sender = fail
    result = review(service, workspace, batch_id="batch-a")
    assert result["cloud_request_sent"] and "test-secret" not in json.dumps(result)
    row = service.ledger()[0]
    assert row["charged"] == row["reserved"] and row["status"] == "unknown"
    service.configure({"batch_limit_usd": row["reserved"] * 1.5})
    restarted = AiReviewService(service.directory, sender=fail, key_reader=lambda p: "test-secret")
    with pytest.raises(ReviewError, match="batch budget"):
        review(restarted, workspace, batch_id="batch-a")
    assert len(sent) == 1


def test_concurrent_reservations_cannot_bypass_monthly_cap(harness, workspace):
    service, _ = harness
    review(service, workspace)
    reservation = service.ledger()[0]["reserved"]
    # Retain full reservations to test contention rather than successful request refunds.
    service.sender = lambda *args: (_ for _ in ()).throw(ProviderError("timeout"))
    service.configure({"monthly_limit_usd": reservation * 1.5})
    def run(index):
        try:
            review(service, workspace, batch_id=f"batch-{index}")
            return True
        except ReviewError:
            return False
    with ThreadPoolExecutor(max_workers=4) as pool:
        outcomes = list(pool.map(run, range(4)))
    assert sum(outcomes) == 1


def test_batch_stop_prevents_new_requests(harness, workspace):
    service, sent = harness
    service.stop_batch("stop-me")
    with pytest.raises(ReviewError, match="stopped"):
        review(service, workspace, batch_id="stop-me")
    assert sent == []


def test_escape_and_unknown_model_do_not_send(harness, workspace):
    service, sent = harness
    with pytest.raises(ReviewError, match="inside workspace"):
        service.review(str(workspace.root), "../../outside.png", provider="openai", model="test-model", allow_cloud_upload=True)
    with pytest.raises(ReviewError, match="prices"):
        service.review(str(workspace.root), "test.png", provider="openai", model="unpriced-model", allow_cloud_upload=True)
    assert sent == []


def test_claude_wire_format_and_review(harness, workspace):
    service, sent = harness
    value = {"objects": [], "uncertainty": "none"}
    def sender(*args):
        sent.append(args)
        return {"stop_reason": "end_turn", "content": [{"type": "text", "text": json.dumps(value)}],
                "usage": {"input_tokens": 10, "output_tokens": 20}}
    service.sender = sender
    result = service.review(str(workspace.root), "test.png", provider="claude", model="test-model", allow_cloud_upload=True)
    assert result["objects"] == []
    assert sent[0][3]["messages"][0]["content"][0]["source"]["type"] == "base64"


def test_decisions_wire_format_and_fractional_score():
    questions = [{"type": "choice", "name": "route", "instructions": "Select a route", "choices": ["local_only", "manual_review"]},
                 {"type": "score", "name": "difficulty", "instructions": "Rate difficulty", "levels": ["easy", "medium", "hard"]}]
    url, body = request_body("openai_decisions", "test-model", "data:image/jpeg;base64,abc", "prompt",
                             detail="low", max_output_tokens=128, questions=questions)
    assert url.endswith("/decisions")
    assert body["questions"][0]["choices"][0]["value"] == "local_only"
    assert body["questions"][1]["levels"][0]["label"] == "easy"
    answers = [{"name": "route", "type": "choice", "choice": "local_only", "confidence": 0.9},
               {"name": "difficulty", "type": "score", "score": 1.1, "confidence": 0.7}]
    assert validate_answers({"answers": answers}, questions) == answers
    with pytest.raises(ReviewError):
        validate_answers({"answers": [answers[0], answers[0]]}, questions)


def test_decisions_persist_answers_separately_from_action(harness, workspace):
    service, _ = harness
    answer = {"name": "missing", "type": "predicate", "probability": 0.8}
    service.sender = lambda *args: {"answers": [answer]}
    result = service.review(str(workspace.root), "test.png", provider="openai_decisions", model="test-model",
                            allow_cloud_upload=True, questions=[{"type": "predicate", "name": "missing", "instructions": "Missing object?"}])
    assert result["answers"] == [answer]
    assert result["route"] == "manual_review"
    assert service.ledger()[0]["charged"] == service.ledger()[0]["reserved"]


def test_routes_require_selected_workspace_and_reject_external_origin(harness, workspace):
    service, sent = harness
    def authorize(root):
        if Path(root).resolve() != workspace.root:
            raise PermissionError
    app = FastAPI()
    app.include_router(create_router(service, authorize))
    with TestClient(app) as client:
        assert client.get("/api/ai/settings").status_code == 200
        assert client.post("/api/ai/settings", json={"cloud_enabled": True}, headers={"Origin": "https://evil.example"}).status_code == 403
        assert client.get("/api/ai/ledger", headers={"Origin": "null"}).status_code == 403
        body = {"workspace_root": "other", "filename": "test.png"}
        assert client.post("/api/ai/review", json=body).status_code == 403
        body["workspace_root"] = str(workspace.root)
        assert client.post("/api/ai/review", json=body).json()["provider"] == "local"
        body["unknown"] = True
        assert client.post("/api/ai/review", json=body).status_code == 422
        assert client.post("/api/ai/settings", json={"OPENAI_API_KEY": "secret"}).status_code == 400
    assert sent == []


def test_mcp_tool_forwards_consent_and_keeps_default_local(workspace):
    import asyncio
    from yoloworkbench_mcp.bridge import PathPolicy, YoloWorkBenchBridge
    from yoloworkbench_mcp.server import create_server

    class Backend:
        sent = []

        def call(self, method, args):
            assert method == "openFolder"
            return {"ok": True, "kind": "workspace", "root": args[0]}

        def post_json(self, path, body):
            self.sent.append((path, body))
            return {"provider": body["provider"], "review_status": "pending"}

    backend = Backend()
    server = create_server(YoloWorkBenchBridge(backend, PathPolicy([workspace.root])))
    asyncio.run(server.call_tool("review_image_with_api", {"workspace_root": str(workspace.root), "filename": "test.png"}))
    assert backend.sent[0][0] == "/api/ai/review"
    assert backend.sent[0][1]["allow_cloud_upload"] is False
    assert backend.sent[0][1]["provider"] == "local"


def test_main_application_mounts_api_and_preserves_health(monkeypatch, tmp_path, workspace):
    import importlib
    monkeypatch.setenv("RWB_APP_DATA", str(tmp_path / "app-data"))
    main = importlib.import_module("backend_api.main")
    with TestClient(main.app) as client:
        assert client.get("/health").json()["apiSchemaVersion"] == 26
        assert client.get("/api/ai/settings").json()["cloud_enabled"] is False
        opened = client.post("/api/workspace/open", json={"workspaceRoot": str(workspace.root)})
        assert opened.status_code == 200
        reviewed = client.post("/api/ai/review", json={"workspace_root": str(workspace.root), "filename": "test.png"})
        assert reviewed.status_code == 200
        assert reviewed.json()["cloud_request_sent"] is False


def test_human_decisions_persist_and_stale_images_are_blocked(harness, workspace):
    service, _ = harness
    result = review(service, workspace)
    service.decide(result["id"], 0, "rejected")
    assert AiReviewService(service.directory).request(result["id"])["record"]["result"]["objects"][0]["review_status"] == "rejected"
    with pytest.raises(ReviewError, match="different review"):
        service.decide(result["id"], 0, "accepted")
    assert not workspace.image_label_file("test.png").exists()
    fresh = review(service, workspace)
    Image.new("RGB", (2000, 1000), "red").save(workspace.media / "test.png")
    with pytest.raises(ReviewError, match="changed"):
        service.verify(fresh["id"])


def test_stale_taxonomy_blocks_acceptance(harness, workspace):
    service, _ = harness
    result = review(service, workspace)
    changed = json.loads(workspace.classes.read_text())
    changed["classDefs"][0]["name"] = "Renamed"
    workspace.classes.write_text(json.dumps(changed))
    with pytest.raises(ReviewError, match="changed"):
        service.decide(result["id"], 0, "accepted")


def test_gallery_caption_is_proposal_not_automatic_mutation(harness, workspace, tmp_path):
    from backend.gallery_library import GalleryLibrary
    service, sent = harness
    library = GalleryLibrary(tmp_path / "gallery", autostart=False)
    root = library.add_root(str(workspace.media))
    library.run_job(root["job"]["id"])
    asset = library.list_assets()["items"][0]
    library.edit_asset(asset["id"], {"caption": "Human caption", "personalTags": ["wrong", "favorite"]})
    expected = {"caption": "A blue image.", "tags": ["blue"], "remove_tags": ["wrong"], "uncertainty": "None"}
    def sender(*args):
        sent.append(args)
        output = response()
        output["output"][0]["content"][0]["text"] = json.dumps(expected)
        return output
    service.sender = sender
    result = service.caption(library, asset["id"], provider="openai", model="test-model", allow_cloud_upload=True)
    assert result["caption"] == expected["caption"]
    assert result["remove_tags"] == ["wrong"]
    original = library.asset(asset["id"])
    assert original["caption"] == "Human caption" and original["personalTags"] == ["wrong", "favorite"]
    assert service.ledger()[0]["record"]["original_caption"] == "Human caption"
    assert sent[0][3]["text"]["format"]["schema"]["required"] == ["caption", "tags", "remove_tags", "uncertainty"]
    # Applying a reviewed patch preserves metadata and user prompt overrides.
    updated = library.edit_asset(asset["id"], {"caption": result["caption"], "personalTags": ["favorite", "blue"]})
    assert updated["metadata"] == original["metadata"]
    assert updated["caption"] == "A blue image."
    service.decide_caption(result["id"], "accepted", library)
    saved_record = service.request(result["id"])["record"]
    assert saved_record["saved_caption"] == "A blue image."
    assert saved_record["result"]["review_status"] == "accepted"
    expected["remove_tags"] = []
    second = service.caption(library, asset["id"], provider="openai", model="test-model", allow_cloud_upload=True)
    service.decide_caption(second["id"], "rejected", library)
    assert AiReviewService(service.directory).request(second["id"])["record"]["result"]["review_status"] == "rejected"
    assert library.asset(asset["id"])["caption"] == "A blue image."
    library.close()


def test_caption_rejects_removing_unknown_tags():
    from backend.ai_review import validate_caption
    with pytest.raises(ReviewError, match="existing personal"):
        validate_caption({"caption": "Image", "tags": [], "remove_tags": ["not-present"], "uncertainty": ""}, ["favorite"])
