import sys
import time
import types

import pytest

from backend import yolo_pt_model_cache as cache


class FakeYolo:
    loads = 0

    def __init__(self, path):
        type(self).loads += 1
        self.path = path


@pytest.fixture(autouse=True)
def fake_ultralytics(monkeypatch, tmp_path):
    monkeypatch.setitem(sys.modules, "ultralytics", types.SimpleNamespace(YOLO=FakeYolo))
    monkeypatch.setattr(cache, "assert_safe_pt_file", lambda path: None)
    monkeypatch.setattr(cache, "_ensure_reaper", lambda: None)  # tests drive release directly
    FakeYolo.loads = 0
    cache.release_models()
    yield
    cache.release_models()


def model_file(tmp_path, name):
    path = tmp_path / name
    path.write_bytes(b"pt")
    return path


def test_models_load_on_first_use_and_are_reused(tmp_path):
    path = model_file(tmp_path, "a.pt")
    assert cache.loaded_models()["models"] == []
    first = cache.get_yolo_model(path)
    assert cache.get_yolo_model(path) is first and FakeYolo.loads == 1
    assert [m["name"] for m in cache.loaded_models()["models"]] == ["a.pt"]


def test_idle_models_are_released_but_touched_ones_stay(tmp_path, monkeypatch):
    monkeypatch.setattr(cache, "_IDLE_SECONDS", 100.0)
    idle, busy = model_file(tmp_path, "idle.pt"), model_file(tmp_path, "busy.pt")
    cache.get_yolo_model(idle)
    cache.get_yolo_model(busy)
    now = time.monotonic()
    with cache._MODEL_CACHE_LOCK:
        for entry in cache._MODEL_CACHE.values():
            entry.last_used = now - 200
    cache.touch_yolo_model(busy)  # a running folder job
    assert cache._release_idle(now) == 1
    assert [m["name"] for m in cache.loaded_models()["models"]] == ["busy.pt"]


def test_release_one_or_all(tmp_path):
    a, b = model_file(tmp_path, "a.pt"), model_file(tmp_path, "b.pt")
    cache.get_yolo_model(a)
    cache.get_yolo_model(b)
    result = cache.release_models(str(a.resolve()))
    assert result["released"] == 1 and [m["name"] for m in result["models"]] == ["b.pt"]
    assert cache.release_models()["released"] == 1
    cache.get_yolo_model(a)
    assert FakeYolo.loads == 3  # reloaded after release


def test_reporting_never_imports_torch(monkeypatch):
    monkeypatch.delitem(sys.modules, "torch", raising=False)
    report = cache.loaded_models()
    assert report["gpu"] == {"torchLoaded": False} and "torch" not in sys.modules
