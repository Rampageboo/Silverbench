from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from backend.workspace_layout import (
    RELATIVE_PATHS,
    WorkspaceFormatError,
    create_workspace,
    is_workspace,
    open_workspace,
)
from backend.workspace_migration import (
    detect_legacy_workspace,
    execute_migration,
    legacy_proposal_key,
    plan_migration,
    rollback_migration,
)


def _write(path: Path, text: str = "x") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def _tree(root: Path) -> dict[str, str]:
    """Every file and directory under root with a content hash (directories map to '')."""
    out: dict[str, str] = {}
    for path in sorted(root.rglob("*")):
        rel = path.relative_to(root).as_posix()
        out[rel] = hashlib.sha1(path.read_bytes()).hexdigest() if path.is_file() else ""
    return out


def _legacy_version(folder: Path, video_root: Path) -> None:
    config = {
        "version": 2,
        "type": "yolo-workbench",
        "createdAt": "2026-06-29T06:59:18.355Z",
        "paths": {
            "image_pool": "media",
            "detect_labels": "detect_labels",
            "metadata": "metadata.csv",
            "detect_dataset": "detect_dataset",
            "clf_dataset": "clf_dataset",
            "video_annotations": "workspace/video_annotations",
            "video_segments": "video_segments",
            "exports": "exports",
            "cache": ".cache",
            "logs": "workspace/logs",
            "sources": "workspace/sources.json",
            "classes": "workspace/classes.json",
            "annotations": "workspace/annotations",
        },
        "classification_classes": ["class_A"],
    }
    _write(folder / "workspace" / "workspace.json", json.dumps(config))
    _write(folder / "media" / "shot one.png", "png-1")
    _write(folder / "media" / "clip.mp4", "mp4")
    _write(folder / "detect_labels" / "shot one.txt", "0 0.5 0.5 0.1 0.1\n")
    _write(folder / "metadata.csv", "filename,split\nshot one.png,train\n")
    _write(folder / "classes.txt", "background\n")
    _write(folder / "data.yaml", "names: [background]\n")
    _write(folder / "detect_dataset" / "data.yaml", "train: images/train\n")
    _write(folder / "clf_dataset" / "train" / "class_a" / "shot one.png", "link")
    (folder / "auto_label" / "detect_dataset").mkdir(parents=True)
    _write(folder / "models" / "autolabel" / "detect" / "best.pt", "pt")
    (folder / "runs" / "detect").mkdir(parents=True)
    (folder / "exports").mkdir()
    (folder / "video_segments").mkdir()
    (folder / ".cache").mkdir()
    _write(folder / ".tmp-autolabel-frames" / "f.jpg", "frame")
    _write(folder / "image_pool_backup" / "files" / "media" / "shot one.png", "orig")
    _write(folder / "WORKSPACE_README.txt", "old layout")
    meta = folder / "workspace"
    _write(meta / "classes.json", json.dumps({"version": 1, "classDefs": [{"key": "background", "name": "background"}], "tasks": {"detect": {"classKeys": ["background"]}, "clf": {"classKeys": []}}}))
    _write(meta / "classes.before-clf-import-20260629.json", "{}")
    _write(meta / "sources.json", json.dumps({"version": 1, "sources": []}))
    (meta / "annotations").mkdir()
    _write(meta / "session.json", json.dumps({"activeTab": "label"}))
    _write(meta / "autolabel_models.json", json.dumps({"detect": {"activeModel": "models/autolabel/detect/best.pt"}}))
    _write(meta / "auto_label_runs.json", json.dumps({"version": 1, "keys": []}))
    _write(meta / "image_pool_snapshot.json", "{}")
    _write(meta / "thumb_cache" / "abc" / "t.jpg", "thumb")
    _write(meta / "video_proxy" / "p.mp4", "proxy")
    _write(meta / "logs" / "events" / "e.jsonl", "event")
    video = {"version": 2, "video": {"path": str(video_root / "media" / "clip.mp4"), "name": "clip.mp4"}, "frames": {}}
    _write(meta / "video_annotations" / "clip-1234abcd.json", json.dumps(video))
    key = legacy_proposal_key("media/shot one.png")
    _write(meta / "proposals" / "detect" / f"{key}.json", json.dumps({"version": 1, "imageKey": key, "proposals": [{"id": "p1"}]}))
    _write(meta / "proposals" / "detect" / "gone-00000000.json", json.dumps({"version": 1, "imageKey": "gone", "proposals": [{"id": "p2"}]}))


@pytest.fixture()
def container(tmp_path: Path) -> Path:
    root = tmp_path / "ZZZ"
    _legacy_version(root / "V1", root / "V1")
    _legacy_version(root / "V2", root / "V2")
    _write(root / "workspace" / "logs" / "events" / "root.jsonl", "root-event")
    versions = {
        "version": 1,
        "type": "yolo-workbench-snapshot-versions",
        "activeVersion": "V1",
        "versions": [{"id": "V1", "path": "V1"}, {"id": "V2", "path": "V2"}],
    }
    _write(root / "workspace_versions.json", json.dumps(versions))
    return root


def test_detects_container_from_root_and_from_version_folder(container: Path) -> None:
    for path in (container, container / "V1"):
        source = detect_legacy_workspace(path)
        assert source is not None
        assert source["kind"] == "snapshot"
        assert source["root"] == container
        assert source["activeVersion"] == "V1"


def test_legacy_workspace_cannot_be_opened_or_recreated(container: Path) -> None:
    with pytest.raises(WorkspaceFormatError) as info:
        open_workspace(container)
    assert info.value.legacy
    with pytest.raises(WorkspaceFormatError):
        create_workspace(container)


def test_migrates_snapshot_container_to_v3(container: Path) -> None:
    plan = plan_migration(container)
    assert plan.conflicts == []
    execute_migration(plan)

    layout = open_workspace(container)
    root = layout.root
    assert is_workspace(root)
    assert (root / "media" / "shot one.png").read_text() == "png-1"
    assert (root / RELATIVE_PATHS["imageLabels"] / "shot one.txt").exists()
    assert (root / RELATIVE_PATHS["imageStatus"]).read_text().startswith("filename,split")
    assert json.loads((root / "classes.json").read_text())["tasks"]["detect"]["classKeys"] == ["background"]

    video = json.loads((root / RELATIVE_PATHS["videoLabels"] / "clip.mp4.json").read_text())
    assert video["video"]["path"] == "media/clip.mp4"

    proposal = json.loads((root / RELATIVE_PATHS["proposals"] / "shot one.png.json").read_text())
    assert proposal["imageKey"] == "shot one.png"
    assert (root / ".rwb/migrated" / "V1/workspace/proposals/detect/gone-00000000.json").exists()

    assert (root / RELATIVE_PATHS["modelRegistry"]).exists()
    assert (root / "models/autolabel/detect/best.pt").exists()
    assert (root / RELATIVE_PATHS["originals"] / "files/media/shot one.png").read_text() == "orig"
    assert (root / RELATIVE_PATHS["session"]).exists()
    assert (root / RELATIVE_PATHS["thumbs"] / "abc/t.jpg").exists()
    assert (root / RELATIVE_PATHS["logs"] / "events/e.jsonl").exists()
    assert (root / RELATIVE_PATHS["logs"] / "container/events/root.jsonl").exists()

    legacy_exports = [p for p in (root / "exports").iterdir() if p.name.startswith("legacy-")]
    assert len(legacy_exports) == 1
    assert (legacy_exports[0] / "detect_dataset" / "data.yaml").exists()
    assert (legacy_exports[0] / "data.yaml").exists()

    # The active version folder is gone; the other version kept its full copy plus a label snapshot.
    assert not (root / "V1").exists()
    assert (root / "V2" / "media" / "clip.mp4").exists()
    assert (root / "versions" / "V2" / "labels/images" / "shot one.txt").exists()
    snapshot_video = json.loads((root / "versions" / "V2" / "labels/videos" / "clip.mp4.json").read_text())
    assert snapshot_video["video"]["path"] == "media/clip.mp4"
    entry = json.loads((root / "versions" / "versions.json").read_text())["snapshots"][0]
    assert (entry["id"], entry["imageLabels"], entry["videoLabels"]) == ("V2", 1, 1)
    assert entry["createdAt"]
    assert not (root / "workspace").exists()
    assert any("V2" in warning for warning in plan.warnings)


def test_rollback_restores_every_file(container: Path) -> None:
    before = _tree(container)
    execute_migration(plan_migration(container))
    assert is_workspace(container)
    rollback_migration(container)
    assert _tree(container) == before


def test_plain_v2_workspace_migrates_in_place(tmp_path: Path) -> None:
    root = tmp_path / "proj"
    _legacy_version(root, root)
    before = _tree(root)
    plan = plan_migration(root)
    assert plan.conflicts == []
    execute_migration(plan)
    assert is_workspace(root)
    assert (root / "media" / "clip.mp4").exists()
    assert not (root / "workspace").exists()
    rollback_migration(root)
    assert _tree(root) == before


def test_failure_mid_migration_rolls_back(container: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import backend.workspace_migration as migration

    before = _tree(container)
    plan = plan_migration(container)
    original = migration._move
    calls = {"n": 0}

    def flaky(src: Path, dst: Path) -> None:
        calls["n"] += 1
        if calls["n"] == 6:
            raise OSError("disk hiccup")
        original(src, dst)

    monkeypatch.setattr(migration, "_move", flaky)
    with pytest.raises(RuntimeError):
        execute_migration(plan)
    monkeypatch.setattr(migration, "_move", original)
    assert _tree(container) == before


def test_create_workspace_is_minimal(tmp_path: Path) -> None:
    layout = create_workspace(tmp_path / "new")
    names = sorted(p.relative_to(layout.root).as_posix() for p in layout.root.rglob("*"))
    assert names == ["classes.json", "labels", "labels/images", "media", "rwb.json"]
    assert open_workspace(layout.root).root == layout.root
