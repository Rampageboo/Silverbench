import csv
import hashlib
import json
import shutil
import subprocess

import pytest
from PIL import Image, PngImagePlugin

from backend.gallery_library import GalleryError, GalleryLibrary


def make_image(path, color="red", parameters=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    info = PngImagePlugin.PngInfo()
    if parameters is not None:
        info.add_text("parameters", parameters)
    Image.new("RGB", (32, 24), color).save(path, pnginfo=info)
    return path


@pytest.fixture
def library(tmp_path):
    store = GalleryLibrary(tmp_path / "store", autostart=False)
    yield store
    store.close()


def scan(library, folder):
    root = library.add_root(str(folder))
    library.run_job(root["job"]["id"])
    return root


def test_scan_skips_damaged_files_and_pages_sql_results(library, tmp_path):
    root = tmp_path / "images"
    make_image(root / "red.png", parameters="fox\nNegative prompt: blur\nSteps: 20, Seed: 4")
    make_image(root / "green.png", "green")
    (root / "broken.png").write_bytes(b"not a png")
    registered = scan(library, root)
    page = library.list_assets(limit=1)
    assert page["total"] == 2 and len(page["items"]) == 1
    assert library.list_assets(limit=1, offset=1)["items"][0]["id"] != page["items"][0]["id"]
    assert library.list_assets(q="fox", has_metadata=True)["total"] == 1
    assert library.list_assets(has_metadata=False)["total"] == 1
    job = library.jobs()[0]
    assert job["status"] == "completed"
    assert job["processed"] == 3
    assert job["progress"]["skipped"] == 1
    assert job["progress"]["errors"]
    assert library.list_assets(root_id=registered["id"])["total"] == 2


def test_hash_relink_retains_edits_and_deduplicates(library, tmp_path):
    folder = tmp_path / "images"
    original = make_image(folder / "original.png")
    registered = scan(library, folder)
    asset = library.list_assets()["items"][0]
    expected_id = hashlib.sha256(original.read_bytes()).hexdigest()
    assert asset["id"] == expected_id
    library.edit_asset(expected_id, {"rating": 4, "personalTags": ["favorite fox"], "notes": "keep me",
                                     "collection": "reference", "userEdits": {"positive": "hand edited"}})
    moved = folder / "renamed.png"
    original.rename(moved)
    shutil.copyfile(moved, folder / "duplicate.png")
    library.run_job(library.scan(registered["id"])["id"])
    record = library.asset(expected_id)
    assert library.list_assets()["total"] == 1
    assert record["rating"] == 4 and record["notes"] == "keep me"
    assert record["userEdits"]["positive"] == "hand edited"
    assert not record["missing"]
    assert library.list_assets(q="favorite", min_rating=4, collection="reference")["total"] == 1
    assert library.source_path(expected_id).name in {"renamed.png", "duplicate.png"}


def test_changed_path_creates_new_content_record_without_transferring_edits(library, tmp_path):
    folder = tmp_path / "images"
    path = make_image(folder / "image.png")
    registered = scan(library, folder)
    old_id = library.list_assets()["items"][0]["id"]
    library.edit_asset(old_id, {"rating": 5})
    make_image(path, "blue")
    library.run_job(library.scan(registered["id"])["id"])
    assert library.asset(old_id)["missing"]
    records = library.list_assets()["items"]
    new = next(item for item in records if item["id"] != old_id)
    assert new["rating"] == 0 and not new["missing"]


def test_incremental_scan_does_not_rehash_unchanged_files(library, tmp_path, monkeypatch):
    folder = tmp_path / "images"
    make_image(folder / "same.png")
    registered = scan(library, folder)
    def no_hash(*args):
        raise AssertionError("unchanged image was hashed again")
    monkeypatch.setattr("backend.gallery_library._digest", no_hash)
    library.run_job(library.scan(registered["id"])["id"])
    assert library.jobs()[0]["progress"]["unchanged"] == 1
    assert library.jobs()[0]["status"] == "completed"


def test_pause_resume_restart_and_cancel_are_durable(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "first.png")
    make_image(folder / "second.png", "blue")
    root = library.add_root(str(folder))
    job_id = root["job"]["id"]
    library.job_action(job_id, "pause")
    library.run_job(job_id)
    assert library.list_assets()["total"] == 0
    recovered = GalleryLibrary(library.directory, autostart=False)
    try:
        assert recovered.jobs()[0]["status"] == "paused"
        recovered.job_action(job_id, "resume")
        recovered.run_job(job_id)
        assert recovered.jobs()[0]["status"] == "completed"
        assert recovered.list_assets()["total"] == 2
        again = recovered.scan(root["id"])
        recovered.job_action(again["id"], "cancel")
        recovered.run_job(again["id"])
        assert next(j for j in recovered.jobs() if j["id"] == again["id"])["status"] == "cancelled"
    finally:
        recovered.close()


def test_interrupted_scan_reuses_path_markers_without_double_count(library, tmp_path):
    folder = tmp_path / "images"
    path = make_image(folder / "first.png")
    make_image(folder / "second.png", "blue")
    root = library.add_root(str(folder))
    job_id = root["job"]["id"]
    assert library._index(path, root["id"], job_id) == "imported"
    with library.connection() as db:
        row = db.execute("SELECT progress FROM jobs WHERE id=?", (job_id,)).fetchone()
        progress = json.loads(row[0])
        progress.update(scanned=1, imported=1)
        db.execute("UPDATE jobs SET status='running',progress=? WHERE id=?", (json.dumps(progress), job_id))
    recovered = GalleryLibrary(library.directory, autostart=False)
    try:
        assert recovered.jobs()[0]["status"] == "queued"
        recovered.run_job(job_id)
        job = recovered.jobs()[0]
        assert job["status"] == "completed"
        assert job["progress"]["scanned"] == 2
        assert recovered.list_assets()["total"] == 2
    finally:
        recovered.close()


def test_missing_marking_only_after_successful_scan(library, tmp_path):
    folder = tmp_path / "images"
    path = make_image(folder / "gone.png")
    root = scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    path.unlink()
    library.run_job(library.scan(root["id"])["id"])
    assert library.asset(asset_id)["missing"]
    assert library.jobs()[0]["progress"]["missing"] == 1
    folder.rmdir()
    library.run_job(library.scan(root["id"])["id"])
    assert library.jobs()[0]["status"] == "failed"
    assert library.list_assets()["total"] == 1


def test_thumbnail_and_original_access_never_mutate_original(library, tmp_path):
    folder = tmp_path / "images"
    path = make_image(folder / "image.png")
    before = path.read_bytes()
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    thumbnail = library.thumbnail(asset_id)
    with Image.open(thumbnail) as image:
        assert max(image.size) <= 384
        assert image.format == "JPEG"
    assert library.source_path(asset_id) == path
    assert path.read_bytes() == before
    with pytest.raises(KeyError):
        library.thumbnail("../../secret")
    make_image(path, "green")
    with pytest.raises(GalleryError, match="missing or changed"):
        library.source_path(asset_id)


def test_export_selected_only_both_prompt_versions_and_no_overwrite(library, tmp_path):
    folder = tmp_path / "images"
    original = make_image(folder / "fox.png", parameters="fox\nNegative prompt: blur\nSteps: 20, Seed: 1")
    make_image(folder / "other.png", "blue")
    scan(library, folder)
    asset_id = next(r["id"] for r in library.list_assets()["items"] if r["filename"] == "fox.png")
    library.edit_asset(asset_id, {"notes": "manual note", "personalTags": ["favorite"], "rating": 4})
    destination = tmp_path / "export"
    destination.mkdir()
    before = original.read_bytes()
    request = {"ids": [asset_id], "destination": str(destination), "mode": "train", "copyImages": True}
    response = library.export(request)
    assert response["count"] == 1
    assert {p.name for p in destination.iterdir()} == {"fox.png", "fox.txt", "results.json", "results.csv", "dataset.toml"}
    results = json.loads((destination / "results.json").read_text(encoding="utf-8"))
    assert len(results) == 1 and results[0]["asset"]["id"] == asset_id
    assert results[0]["asset"]["notes"] == "manual note"
    assert {"noobai", "anima"} <= results[0]["prompt"].keys()
    with (destination / "results.csv").open(encoding="utf-8-sig", newline="") as stream:
        rows = list(csv.DictReader(stream))
    assert len(rows) == 1 and rows[0]["id"] == asset_id
    assert json.loads(rows[0]["noobai"])["positive"]
    assert json.loads(rows[0]["anima"])["positive"]
    assert json.loads(rows[0]["personalTags"]) == ["favorite"]
    assert "Negative prompt:" not in (destination / "fox.txt").read_text(encoding="utf-8")
    assert original.read_bytes() == before
    with pytest.raises(GalleryError):
        library.export(request)
    assert original.read_bytes() == before


def test_export_same_stem_collision_appends_hash_to_both_images_and_captions(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "first" / "same.png")
    make_image(folder / "second" / "same.png", "blue")
    scan(library, folder)
    ids = [row["id"] for row in library.list_assets()["items"]]
    destination = tmp_path / "export"
    destination.mkdir()
    library.export({"ids": ids, "destination": str(destination), "artifact": "captions", "copyImages": True})
    images = list(destination.glob("*.png"))
    captions = list(destination.glob("*.txt"))
    assert len(images) == len(captions) == 2
    assert {p.stem for p in images} == {p.stem for p in captions}
    assert all(p.stem.startswith("same_") for p in images)


def test_export_preflights_all_collisions_before_any_writes(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    destination = tmp_path / "export"
    destination.mkdir()
    (destination / "results.csv").write_text("existing", encoding="utf-8")
    with pytest.raises(GalleryError, match="overwrite"):
        library.export({"ids": [asset_id], "destination": str(destination)})
    assert [p.name for p in destination.iterdir()] == ["results.csv"]
    assert (destination / "results.csv").read_text() == "existing"
    with pytest.raises(GalleryError, match="outside imported roots"):
        library.export({"ids": [asset_id], "destination": str(folder)})


def test_dataset_refuses_mixed_destination_and_missing_images(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    destination = tmp_path / "export"
    destination.mkdir()
    with pytest.raises(GalleryError, match="copyImages"):
        library.export({"ids": [asset_id], "destination": str(destination), "artifact": "dataset"})
    (destination / "other.png").write_bytes(b"unrelated")
    with pytest.raises(GalleryError, match="empty destination"):
        library.export({"ids": [asset_id], "destination": str(destination), "artifact": "dataset", "copyImages": True})
    assert [p.name for p in destination.iterdir()] == ["other.png"]


def test_rejects_bad_edit_types_paths_and_page_bounds(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    for edit in ({"rating": True}, {"rating": 6}, {"path": "elsewhere"}, {"personalTags": [4]}, {"userEdits": []}):
        with pytest.raises(GalleryError):
            library.edit_asset(asset_id, edit)
    with pytest.raises(GalleryError):
        library.list_assets(limit=201)
    with pytest.raises(GalleryError):
        library.add_root("relative")
    nested = folder / "nested"
    nested.mkdir()
    with pytest.raises(GalleryError, match="overlaps"):
        library.add_root(str(nested))


def test_settings_and_collections_persist(library):
    assert library.get_settings() == {}
    settings = {"wdModelPath": "D:/models/local.onnx", "rules": {"removeTags": ["text"]}}
    library.save_settings(settings)
    library.add_collection("empty collection")
    recovered = GalleryLibrary(library.directory, autostart=False)
    try:
        assert recovered.get_settings() == settings
        assert recovered.collections() == ["empty collection"]
        assert recovered.status()["capabilities"]["gpuScheduling"] is False
    finally:
        recovered.close()


def test_inference_results_retain_full_scores_and_user_edits(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    library.edit_asset(asset_id, {"userEdits": {"positive": "manual"}, "rating": 5})
    result = {"modelId": "actual-wd-model", "runtimeVerified": True,
              "tags": [{"name": "fox", "category": "general", "probability": 0.99},
                       {"name": "low_score", "category": "general", "probability": 0.01}]}
    library._store_inference(asset_id, result)
    record = library.asset(asset_id)
    assert record["modelTags"]["actual-wd-model"] == result
    assert record["userEdits"] == {"positive": "manual"}
    assert record["rating"] == 5


def test_api_pagination_preview_edit_and_errors(library, tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend_api import gallery

    folder = tmp_path / "images"
    make_image(folder / "fox.png", parameters="fox\nSteps: 5, Seed: 1")
    scan(library, folder)
    monkeypatch.setattr(gallery, "get_library", lambda: library)
    app = FastAPI()
    app.include_router(gallery.router)
    with TestClient(app) as client:
        response = client.get("/api/gallery/assets?limit=1")
        assert response.status_code == 200
        asset_id = response.json()["items"][0]["id"]
        assert "prompts" in client.get(f"/api/gallery/assets/{asset_id}").json()
        assert "noobai" in client.post(f"/api/gallery/assets/{asset_id}/preview", json={"mode": "train"}).json()
        assert client.post(f"/api/gallery/assets/{asset_id}", json={"rating": 4}).json()["rating"] == 4
        assert client.post(f"/api/gallery/assets/{asset_id}", json={"rating": 9}).status_code == 400
        assert client.get("/api/gallery/assets/missing").status_code == 404
        assert client.get("/api/gallery/assets?limit=99999").status_code == 422
        assert client.get(f"/api/gallery/assets/{asset_id}/thumbnail").headers["content-type"].startswith("image/jpeg")
        assert client.post("/api/gallery/settings", json={"wdModelPath": "local"}).json() == {"wdModelPath": "local"}
        assert client.get("/api/gallery/settings").json() == {"wdModelPath": "local"}


def test_process_prerequisites_block_without_creating_a_fake_job(library, tmp_path, monkeypatch):
    from backend import gallery_inference
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    monkeypatch.setattr(gallery_inference, "get_capabilities", lambda config=None:
                        {"adapters": {"wd_onnx": {"ready": False, "blockers": ["missing local weights"]}}})
    before = len(library.jobs())
    with pytest.raises(GalleryError, match="missing local weights"):
        library.process([asset_id])
    assert len(library.jobs()) == before


def test_process_job_persists_real_worker_output_and_full_scores(library, tmp_path, monkeypatch):
    from backend import gallery_inference
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    library.edit_asset(asset_id, {"userEdits": {"positive": "hand edit"}})
    monkeypatch.setattr(gallery_inference, "get_capabilities", lambda config=None:
                        {"adapters": {"wd_onnx": {"ready": True, "blockers": []}}})
    result = {"modelId": "wd-actual", "runtimeVerified": True, "tags": [
        {"name": "fox", "category": "general", "probability": 0.01},
        {"name": "sensitive", "category": "rating", "probability": 0.9}]}
    class Worker:
        returncode = None
        def communicate(self, timeout=None):
            self.returncode = 0
            return json.dumps({"ok": True, "result": result}), ""
        def poll(self):
            return self.returncode
    monkeypatch.setattr(gallery_inference, "start_wd_worker", lambda path, config: Worker())
    job = library.process([asset_id])
    with library.connection() as db:
        db.execute("UPDATE jobs SET status='running' WHERE id=?", (job["id"],))
    library._run_process_job(job["id"])
    record = library.asset(asset_id)
    assert record["modelTags"]["wd-actual"] == result
    assert record["contentRating"] == "sensitive"
    assert record["userEdits"] == {"positive": "hand edit"}
    assert next(j for j in library.jobs() if j["id"] == job["id"])["status"] == "completed"


def test_process_pause_terminates_worker_and_retries_same_index_on_resume(library, tmp_path, monkeypatch):
    from backend import gallery_inference
    folder = tmp_path / "images"
    make_image(folder / "fox.png")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    monkeypatch.setattr(gallery_inference, "get_capabilities", lambda config=None:
                        {"adapters": {"wd_onnx": {"ready": True, "blockers": []}}})
    job = library.process([asset_id])
    class Worker:
        returncode = None
        terminated = False
        def communicate(self, timeout=None):
            if not self.terminated:
                library.job_action(job["id"], "pause")
                raise subprocess.TimeoutExpired("wd-worker", timeout)
            return "", ""
        def poll(self):
            return self.returncode
        def terminate(self):
            self.terminated = True
            self.returncode = -15
    worker = Worker()
    monkeypatch.setattr(gallery_inference, "start_wd_worker", lambda path, config: worker)
    with library.connection() as db:
        db.execute("UPDATE jobs SET status='running' WHERE id=?", (job["id"],))
    library._run_process_job(job["id"])
    assert worker.terminated
    paused = next(j for j in library.jobs() if j["id"] == job["id"])
    assert paused["status"] == "paused" and paused["progress"]["nextIndex"] == 0
    assert library.asset(asset_id)["modelTags"] == {}
    assert library.job_action(job["id"], "resume")["status"] == "queued"


def test_list_reads_a_bounded_page_in_a_fifty_thousand_asset_library(library, monkeypatch):
    # Populate SQL directly: this checks list behavior, not filesystem throughput or GPU acceptance.
    stamp = "2026-10-20T00:00:00+00:00"
    metadata = json.dumps({"format": "none", "source": "none", "model": ""})
    with library.connection() as db:
        db.executemany("INSERT INTO assets(id,filename,width,height,format,metadata,metadata_brief,created_at,modified_at) VALUES (?,?,?,?,?,?,?,?,?)",
                       ((f"{number:064x}", f"image-{number}.png", 16, 16, "PNG", metadata, metadata, stamp, stamp)
                        for number in range(50001)))
    calls = []
    original = library._record
    def bounded(db, row, *, brief=False):
        calls.append(row["id"])
        assert len(calls) <= 30
        return original(db, row, brief=brief)
    monkeypatch.setattr(library, "_record", bounded)
    result = library.list_assets(limit=30, offset=49000)
    assert result["total"] == 50001 and len(result["items"]) == 30 and len(calls) == 30


def test_brief_page_omits_large_graphs_full_scores_and_edits(library, tmp_path):
    folder = tmp_path / "images"
    make_image(folder / "fox.png", parameters="fox\nSteps: 10")
    scan(library, folder)
    asset_id = library.list_assets()["items"][0]["id"]
    library.edit_asset(asset_id, {"notes": "detail", "caption": "caption detail", "userEdits": {"positive": "manual"}})
    page_item = library.list_assets()["items"][0]
    assert {"notes", "caption", "userEdits", "modelTags"}.isdisjoint(page_item)
    assert set(page_item["metadata"]) == {"format", "source", "model"}
    assert "raw" in library.asset(asset_id)["metadata"]


def test_settings_validation_preserves_last_valid_config(library):
    library.save_settings({"wdModelId": "actual-model"})
    for invalid in ({"deviceId": -1}, {"wdModelPath": 42}, {"rules": {"categoryOrder": ["oops"]}}, {"rules": []}):
        with pytest.raises((GalleryError, ValueError)):
            library.save_settings(invalid)
    assert library.get_settings() == {"wdModelId": "actual-model"}
