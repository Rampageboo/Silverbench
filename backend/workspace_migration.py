"""Migrate older workspaces to the v3 layout (see workspace_layout.py).

Handled sources:

- ``snapshot``: a folder with ``workspace_versions.json`` whose versions (V1, V2...)
  are complete workspace copies. The active version becomes the workspace root;
  other versions keep only their annotations, as snapshots under ``versions/``.
- ``v2``: ``workspace/workspace.json`` inside the folder.
- ``v1``: ``workspace.json`` at the folder root.

Rules: everything is moved within the same folder tree (media is never copied);
nothing is deleted except directories the migration emptied; superseded files go
to ``.rwb/migrated/``. Each executed step is journaled in
``.rwb/migration-journal.json`` so a migration can be rolled back.
"""

from __future__ import annotations

import json
import os
import re
import shutil
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from .workspace_layout import (
    FORMAT_VERSION,
    IMAGE_EXTENSIONS,
    MANIFEST_FILENAME,
    RELATIVE_PATHS,
    VIDEO_EXTENSIONS,
    is_workspace,
    manifest_document,
    workspace_root_path,
)

SNAPSHOT_MANIFEST = "workspace_versions.json"
JOURNAL = ".rwb/migration-journal.json"
MIGRATED = ".rwb/migrated"


# ── Detection ────────────────────────────────────────────────────────────────


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _legacy_config(folder: Path) -> tuple[Path, dict[str, Any]] | None:
    for candidate in (folder / "workspace" / "workspace.json", folder / "workspace.json"):
        data = _read_json(candidate)
        if isinstance(data, dict) and data.get("type") == "yolo-workbench":
            return candidate, data
    return None


def detect_legacy_workspace(path: Path | str) -> dict[str, Any] | None:
    """Describe an older workspace at ``path`` (or the container it belongs to)."""
    folder = workspace_root_path(path)
    if is_workspace(folder):
        return None
    for root in (folder, folder.parent):
        snapshot = _read_json(root / SNAPSHOT_MANIFEST)
        if isinstance(snapshot, dict) and snapshot.get("type") == "yolo-workbench-snapshot-versions":
            versions = [v for v in snapshot.get("versions") or [] if isinstance(v, dict) and v.get("id")]
            active_id = snapshot.get("activeVersion") or (versions[0]["id"] if versions else None)
            active = next((v for v in versions if v["id"] == active_id), None)
            if active is None:
                continue
            base = (root / str(active.get("path") or active_id)).resolve()
            config = _legacy_config(base)
            return {
                "kind": "snapshot",
                "root": root,
                "base": base,
                "config": config[1] if config else {},
                "configFile": config[0] if config else None,
                "activeVersion": active_id,
                "otherVersions": [
                    {"id": v["id"], "path": (root / str(v.get("path") or v["id"])).resolve()}
                    for v in versions
                    if v["id"] != active_id
                ],
            }
    config = _legacy_config(folder)
    if config is None:
        return None
    return {
        "kind": "v2" if config[0].parent.name == "workspace" else "v1",
        "root": folder,
        "base": folder,
        "config": config[1],
        "configFile": config[0],
        "activeVersion": None,
        "otherVersions": [],
    }


# ── Planning ─────────────────────────────────────────────────────────────────


@dataclass
class Step:
    kind: str  # "move" | "rewrite" | "write" | "prune"
    src: str | None = None  # root-relative
    dst: str | None = None  # root-relative
    note: str = ""
    payload: Any = None  # rewrite: new JSON document; write: document

    def describe(self) -> dict[str, Any]:
        return {"kind": self.kind, "src": self.src, "dst": self.dst, "note": self.note}


@dataclass
class MigrationPlan:
    root: Path
    source: dict[str, Any]
    steps: list[Step] = field(default_factory=list)
    untouched: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    conflicts: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        counts: dict[str, int] = {}
        for step in self.steps:
            counts[step.kind] = counts.get(step.kind, 0) + 1
        return {
            "ok": not self.conflicts,
            "root": str(self.root),
            "sourceKind": self.source["kind"],
            "activeVersion": self.source.get("activeVersion"),
            "counts": counts,
            "steps": [step.describe() for step in self.steps],
            "untouched": self.untouched,
            "warnings": self.warnings,
            "conflicts": self.conflicts,
        }


def _fnv1a_utf16(text: str) -> int:
    """FNV-1a over UTF-16 code units, matching the frontend's charCodeAt hashing."""
    value = 0x811C9DC5
    data = text.encode("utf-16-le")
    for index in range(0, len(data), 2):
        value ^= data[index] | (data[index + 1] << 8)
        value = (value * 0x01000193) & 0xFFFFFFFF
    return value


def legacy_proposal_key(image_path: str) -> str:
    """The pre-v3 proposal file key (frontend imageProposalKey)."""
    normalized = image_path.replace("\\", "/")
    stem = re.sub(r"\.[^.]+$", "", normalized.split("/")[-1] or "image")
    safe = re.sub(r"[^a-zA-Z0-9_-]", "_", stem)[:60] or "image"
    return f"{safe}-{format(_fnv1a_utf16(normalized), 'x')[:8]}"


class _Planner:
    def __init__(self, source: dict[str, Any]):
        self.source = source
        self.root: Path = source["root"]
        self.base: Path = source["base"]
        self.plan = MigrationPlan(self.root, source)
        self.claimed: set[Path] = set()
        self.stamp = datetime.now().strftime("%Y%m%d")
        paths = self.source["config"].get("paths") if isinstance(self.source["config"], dict) else None
        self.config_paths: dict[str, str] = paths if isinstance(paths, dict) else {}

    # helpers
    def rel(self, path: Path) -> str:
        return path.resolve().relative_to(self.root).as_posix()

    def legacy(self, key: str, default: str) -> Path:
        value = self.config_paths.get(key) or default
        path = Path(value)
        return (path if path.is_absolute() else self.base / path).resolve()

    def target(self, key: str) -> Path:
        return self.root / RELATIVE_PATHS[key]

    def claim(self, path: Path) -> bool:
        path = path.resolve()
        if not path.exists() or path in self.claimed:
            return False
        if path.resolve() != self.root and self.root not in path.resolve().parents:
            self.plan.warnings.append(f"Skipped {path}: outside the workspace folder.")
            return False
        self.claimed.add(path)
        return True

    def move(self, src: Path, dst: Path, note: str) -> None:
        if not self.claim(src):
            return
        if src.resolve() == dst.resolve():
            return
        self.plan.steps.append(Step("move", self.rel(src), self.rel(dst), note))

    def merge_dir(self, src: Path, dst: Path, note: str) -> None:
        """Move each child of src into dst (dst may already have content)."""
        if not self.claim(src) or not src.is_dir():
            return
        if src.resolve() == dst.resolve():
            return
        for child in sorted(src.iterdir()):
            self.claimed.add(child.resolve())
            self.plan.steps.append(Step("move", self.rel(child), self.rel(dst / child.name), note))

    def retire(self, src: Path, note: str) -> None:
        """Superseded content: keep it, out of the way, under .rwb/migrated/."""
        if not self.claim(src):
            return
        dst = self.root / MIGRATED / self.rel(src)
        self.plan.steps.append(Step("move", self.rel(src), self.rel(dst), note))

    def rewrite(self, src: Path, dst: Path, document: Any, note: str) -> None:
        if not self.claim(src):
            return
        self.plan.steps.append(Step("rewrite", self.rel(src), self.rel(dst), note, document))

    # mapping
    def build(self) -> MigrationPlan:
        meta = self.base / "workspace"
        media = self.legacy("image_pool", "media")
        if not media.is_dir() and (self.base / "image_pool").is_dir():
            media = self.base / "image_pool"
        media_names = sorted(p.name for p in media.iterdir() if p.is_file()) if media.is_dir() else []

        self.move(media, self.target("media"), "Source media")
        self.move(self.legacy("detect_labels", "detect_labels"), self.target("imageLabels"), "Image box labels")
        self.move(self.legacy("metadata", "metadata.csv"), self.target("imageStatus"), "Per-image status")
        self._video_annotations(self.legacy("video_annotations", "workspace/video_annotations"))
        self._segments(self.legacy("video_segments", "video_segments"))
        self._proposals(meta / "proposals", media_names)
        self.move(meta / "overlays", self.target("overlays"), "Blackout overlays")
        self.move(meta / "auto_label_runs.json", self.target("autolabelRuns"), "Auto-label history")
        self._classes(meta)
        self.move(self.base / "models", self.target("models"), "Imported models")
        self.move(meta / "autolabel_models.json", self.target("modelRegistry"), "Active auto-label models")
        self.move(self.base / "runs", self.target("runs"), "Training runs")
        self.merge_dir(self.legacy("exports", "exports"), self.target("exports"), "Exports")
        self.move(self.base / "image_pool_backup", self.target("originals"), "Originals kept before edits")

        derived = self.target("exports") / f"legacy-{self.stamp}"
        for key, default in (("detect_dataset", "detect_dataset"), ("clf_dataset", "clf_dataset")):
            path = self.legacy(key, default)
            self.move(path, derived / path.name, "Built dataset (derived; now produced by Export)")
        self.move(self.base / "auto_label", derived / "auto_label", "Auto-label output datasets (derived)")
        for name in ("data.yaml", "classes.txt"):
            self.move(self.base / name, derived / name, "Derived from classes.json at export time")

        self.move(meta / "session.json", self.target("session"), "UI state")
        self.retire(self.base / ".yolo_label_viewer", "Pre-v2 UI state")
        self.move(meta / "thumb_cache", self.target("thumbs"), "Thumbnail cache")
        self.move(meta / "video_proxy", self.target("videoProxy"), "Video proxy cache")
        self.move(meta / "image_pool_snapshot.json", self.target("scanCache"), "Media scan cache")
        self.retire(self.legacy("cache", ".cache"), "Old cache folder")
        self.retire(self.base / ".tmp-autolabel-frames", "Temporary frames")
        self.merge_dir(self.legacy("logs", "workspace/logs"), self.target("logs"), "Logs")
        if self.root != self.base:
            self.move(self.root / "workspace" / "logs", self.target("logs") / "container", "Logs")

        if self.source.get("configFile"):
            self.retire(Path(self.source["configFile"]), "Replaced by rwb.json")
        if self.root != self.base or (self.root / SNAPSHOT_MANIFEST).exists():
            self.retire(self.root / SNAPSHOT_MANIFEST, "Replaced by versions/versions.json")
        for name in ("sources.json", "annotations"):
            self.retire(meta / name, "Unused placeholder")
        for path in sorted(meta.glob("classes.before-*.json")) if meta.is_dir() else []:
            self.retire(path, "Old classes backup")
        self.retire(self.base / "WORKSPACE_README.txt", "Described the old layout")
        for name in ("inbox_workflow.json", "workspace_meta.json"):
            self.retire(meta / name, "Pre-v2 state")

        self._other_versions()
        self._manifest()
        self._leftovers()
        self._conflicts()
        return self.plan

    def _video_annotations(self, folder: Path) -> None:
        if not folder.is_dir():
            return
        self.claim(folder)
        for file in sorted(folder.glob("*.json")):
            data = _read_json(file)
            video = data.get("video") if isinstance(data, dict) else None
            name = Path(str(video.get("name") or video.get("path") or "")).name if isinstance(video, dict) else ""
            if not name:
                self.retire(file, "Video annotation without a video name")
                continue
            video["path"] = f"{RELATIVE_PATHS['media']}/{name}"
            self.rewrite(file, self.target("videoLabels") / f"{name}.json", data, "Video annotations (relative video path)")

    def _segments(self, folder: Path) -> None:
        if not folder.is_dir():
            return
        self.claim(folder)
        for file in sorted(folder.glob("*.json")):
            data = _read_json(file)
            raw = str(data.get("videoPath") or "") if isinstance(data, dict) else ""
            name = Path(raw.replace("\\", "/")).name
            if not name:
                self.retire(file, "Segments without a video name")
                continue
            data["videoPath"] = f"{RELATIVE_PATHS['media']}/{name}"
            self.rewrite(file, self.target("segments") / f"{name}.json", data, "Video segments (relative video path)")

    def _proposals(self, folder: Path, media_names: list[str]) -> None:
        detect = folder / "detect"
        if not detect.is_dir():
            if folder.is_dir():
                self.retire(folder, "Proposals")
            return
        self.claim(folder)
        self.claim(detect)
        media_dir = RELATIVE_PATHS["media"]
        by_key = {legacy_proposal_key(f"{media_dir}/{name}"): name for name in media_names}
        for file in sorted(detect.glob("*.json")):
            data = _read_json(file)
            name = by_key.get(file.stem)
            if not isinstance(data, dict) or not name:
                self.retire(file, "Proposals for an image that is no longer in media")
                continue
            if not data.get("proposals"):
                self.retire(file, "Empty proposal file")
                continue
            data["imageKey"] = name
            self.rewrite(file, self.target("proposals") / f"{name}.json", data, "Auto-label proposals")

    def _classes(self, meta: Path) -> None:
        classes_file = self.legacy("classes", "workspace/classes.json")
        if classes_file.is_file():
            self.move(classes_file, self.target("classes"), "Class taxonomy")
            return
        detect_names: list[str] = []
        classes_txt = self.base / "classes.txt"
        if classes_txt.is_file():
            detect_names = [line.strip() for line in classes_txt.read_text(encoding="utf-8").splitlines() if line.strip()]
        clf_names = [str(n) for n in self.source["config"].get("classification_classes") or []]
        defs: list[dict[str, Any]] = []
        seen: dict[str, str] = {}

        def key_for(name: str) -> str:
            key = re.sub(r"[^a-z0-9_]+", "_", name.lower()).strip("_") or "class"
            if key not in seen:
                seen[key] = name
                defs.append({"key": key, "name": name})
            return key

        document = {
            "version": 1,
            "classDefs": defs,
            "tasks": {
                "detect": {"classKeys": [key_for(n) for n in detect_names]},
                "clf": {"classKeys": [key_for(n) for n in clf_names]},
            },
        }
        self.plan.steps.append(Step("write", None, self.rel(self.target("classes")), "Class taxonomy built from classes.txt", document))

    def _other_versions(self) -> None:
        versions = self.source.get("otherVersions") or []
        if not versions:
            return
        entries = []
        for version in versions:
            vid, folder = version["id"], Path(version["path"])
            dest = self.target("versions") / vid
            config = _legacy_config(folder)
            paths = (config[1].get("paths") if config else None) or {}

            def legacy(key: str, default: str, folder: Path = folder, paths: dict = paths) -> Path:
                value = Path(str(paths.get(key) or default))
                return value if value.is_absolute() else folder / value

            self.move(legacy("detect_labels", "detect_labels"), dest / "labels/images", f"{vid} box labels")
            self.move(legacy("metadata", "metadata.csv"), dest / "labels/images.csv", f"{vid} image status")
            self.move(legacy("video_annotations", "workspace/video_annotations"), dest / "labels/videos-legacy", f"{vid} video annotations")
            self.move(legacy("classes", "workspace/classes.json"), dest / "classes.json", f"{vid} classes")
            entries.append({"id": vid, "createdAt": None, "note": f"Annotations of former version {vid}"})
            self.plan.warnings.append(
                f"Former version {vid} kept only its annotations under versions/{vid}; "
                f"its full copy at {folder} is left untouched — delete it once you have checked the migration."
            )
            self.claimed.add(folder.resolve())
        self.plan.steps.append(
            Step("write", None, self.rel(self.target("versions") / "versions.json"), "Annotation snapshots", {"version": 1, "snapshots": entries})
        )

    def _manifest(self) -> None:
        config = self.source["config"] if isinstance(self.source["config"], dict) else {}
        document = manifest_document(self.root.name, created_at=config.get("createdAt"))
        document["migratedFrom"] = {"kind": self.source["kind"], "version": config.get("version"), "activeVersion": self.source.get("activeVersion")}
        self.plan.steps.append(Step("write", None, MANIFEST_FILENAME, "Workspace manifest", document))

    def _leftovers(self) -> None:
        """Report what the migration does not touch, then prune folders it emptied."""
        scan = [self.base, self.base / "workspace"]
        if self.root != self.base:
            scan += [self.root, self.root / "workspace"]
        for folder in scan:
            if not folder.is_dir():
                continue
            for child in sorted(folder.iterdir()):
                resolved = child.resolve()
                if resolved in self.claimed or resolved == self.base or child.name in ("workspace", ".rwb", MANIFEST_FILENAME):
                    continue
                if any(c in resolved.parents for c in self.claimed):
                    continue
                if self.root != self.base and folder == self.base:
                    # Unknown items in the version folder move up with everything else.
                    self.move(child, self.root / child.name, "Unrecognized item kept as is")
                elif self.root != self.base and folder == self.root / "workspace":
                    # The container's own workspace/ folder only held stubs created with it.
                    self.retire(child, "Container stub")
                else:
                    self.plan.untouched.append(self.rel(child))
        prune = [self.root / "workspace"]
        if self.root != self.base:
            prune.append(self.base)
        prune += [c for c in self.claimed if c.is_dir() and c != self.root]
        self.plan.steps.append(
            Step("prune", None, None, "Remove folders the migration emptied", sorted({self.rel(p) for p in prune if p.exists()}))
        )

    def _conflicts(self) -> None:
        sources = {s.src for s in self.plan.steps if s.src}
        seen: set[str] = set()
        for step in self.plan.steps:
            if not step.dst:
                continue
            if step.dst in seen:
                self.plan.conflicts.append(f"Two items would move to {step.dst}")
            seen.add(step.dst)
            dst = self.root / step.dst
            if dst.exists() and step.dst not in sources:
                self.plan.conflicts.append(f"{step.dst} already exists")


def plan_migration(path: Path | str) -> MigrationPlan:
    source = detect_legacy_workspace(path)
    if source is None:
        raise ValueError(f"No older workspace found at {path}")
    return _Planner(source).build()


# ── Execution ────────────────────────────────────────────────────────────────


def _journal_path(root: Path) -> Path:
    return root / JOURNAL


def _save_journal(root: Path, journal: dict[str, Any]) -> None:
    path = _journal_path(root)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(journal, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _move(src: Path, dst: Path) -> None:
    if dst.exists():
        raise FileExistsError(f"Refusing to overwrite {dst}")
    os.replace(src, dst)  # same volume: a rename, never a copy


def _write_json_file(path: Path, document: Any) -> None:
    if path.exists():
        raise FileExistsError(f"Refusing to overwrite {path}")
    path.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def execute_migration(plan: MigrationPlan, *, on_step: Callable[[int, int], None] | None = None) -> dict[str, Any]:
    if plan.conflicts:
        raise ValueError("Migration has conflicts: " + "; ".join(plan.conflicts))
    root = plan.root
    if _journal_path(root).exists():
        raise ValueError("A previous migration journal exists; roll it back or remove it first.")
    journal: dict[str, Any] = {"version": 1, "startedAt": datetime.now().isoformat(), "done": []}
    _save_journal(root, journal)
    done = journal["done"]
    total = len(plan.steps)

    def make_parents(path: Path) -> None:
        missing = [p for p in (path.parent, *path.parent.parents) if not p.exists()]
        for folder in reversed(missing):
            folder.mkdir()
            done.append({"kind": "mkdir", "src": folder.relative_to(root).as_posix()})

    try:
        for index, step in enumerate(plan.steps):
            src = root / step.src if step.src else None
            dst = root / step.dst if step.dst else None
            if step.kind == "move":
                make_parents(dst)
                _move(src, dst)
                done.append({"kind": "move", "src": step.src, "dst": step.dst})
            elif step.kind == "rewrite":
                backup = root / MIGRATED / "rewritten" / step.src
                make_parents(backup)
                _move(src, backup)
                done.append({"kind": "move", "src": step.src, "dst": backup.relative_to(root).as_posix()})
                make_parents(dst)
                _write_json_file(dst, step.payload)
                done.append({"kind": "write", "dst": step.dst})
            elif step.kind == "write":
                make_parents(dst)
                _write_json_file(dst, step.payload)
                done.append({"kind": "write", "dst": step.dst})
            elif step.kind == "prune":
                for top in step.payload:
                    folder = root / top
                    if not folder.is_dir():
                        continue
                    nested = sorted((p for p in folder.rglob("*") if p.is_dir()), key=lambda p: len(p.parts), reverse=True)
                    for candidate in [*nested, folder]:
                        if candidate.is_dir() and not any(candidate.iterdir()):
                            candidate.rmdir()
                            done.append({"kind": "rmdir", "src": candidate.relative_to(root).as_posix()})
            _save_journal(root, journal)
            if on_step:
                on_step(index + 1, total)
    except Exception as error:
        _save_journal(root, journal)
        rollback_migration(root)
        raise RuntimeError(f"Migration failed and was rolled back: {error}") from error
    journal["finishedAt"] = datetime.now().isoformat()
    _save_journal(root, journal)
    return {"ok": True, "root": str(root), "steps": total, "formatVersion": FORMAT_VERSION}


def rollback_migration(path: Path | str) -> dict[str, Any]:
    """Undo a migration step by step from its journal (newest first)."""
    root = workspace_root_path(path)
    journal = _read_json(_journal_path(root))
    if not isinstance(journal, dict):
        raise ValueError(f"No migration journal in {root}")
    undone = 0
    for entry in reversed(journal.get("done") or []):
        kind = entry["kind"]
        if kind == "move":
            target = root / entry["src"]
            target.parent.mkdir(parents=True, exist_ok=True)
            _move(root / entry["dst"], target)
        elif kind == "write":
            (root / entry["dst"]).unlink(missing_ok=True)
        elif kind == "rmdir":
            (root / entry["src"]).mkdir(parents=True, exist_ok=True)
        elif kind == "mkdir":
            folder = root / entry["src"]
            if folder.is_dir() and not any(folder.iterdir()):
                folder.rmdir()
        undone += 1
    _journal_path(root).unlink(missing_ok=True)
    state = root / ".rwb"
    if state.is_dir() and not any(state.iterdir()):
        state.rmdir()
    return {"ok": True, "root": str(root), "undone": undone}


def has_pending_migration(path: Path | str) -> bool:
    """A finished migration whose journal is kept until the user keeps or undoes it."""
    return _journal_path(workspace_root_path(path)).is_file()


def finish_migration(path: Path | str) -> None:
    """Forget the journal once the user is happy with the result (keeps .rwb/migrated)."""
    _journal_path(workspace_root_path(path)).unlink(missing_ok=True)


__all__ = [
    "IMAGE_EXTENSIONS",
    "VIDEO_EXTENSIONS",
    "detect_legacy_workspace",
    "execute_migration",
    "finish_migration",
    "has_pending_migration",
    "legacy_proposal_key",
    "plan_migration",
    "rollback_migration",
]
