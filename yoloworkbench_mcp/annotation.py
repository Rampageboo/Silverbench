"""Labeling tools for agents: look at workspace images and write YOLO boxes and classes.

Everything goes through the running RampageWorkbench backend, so the app and an
agent share one set of files and locks. Annotations follow the v3 workspace
layout: boxes in ``labels/images/<stem>.txt`` (YOLO, normalized centre x/y/w/h),
per-image status in ``labels/images.csv``, classes in ``classes.json``.
"""

from __future__ import annotations

import base64
import io
import json
import time
from pathlib import Path
from typing import Any, Literal

from backend.classes_store import add_class, classify_classes, detect_classes, resolve_class
from backend.workspace_layout import RELATIVE_PATHS

from .bridge import BackendError, YoloWorkBenchBridge

ImageFilter = Literal["all", "unlabeled", "no_boxes", "no_class", "detect", "classify", "junk"]
JUNK_CLASS = "__junk__"
_PALETTE = ["#ff3b30", "#34c759", "#0a84ff", "#ffd60a", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff375f"]


def _label_path(filename: str) -> str:
    return f"{RELATIVE_PATHS['imageLabels']}/{Path(filename).stem}.txt"


def _parse_boxes(text: str) -> list[tuple[int, float, float, float, float]]:
    boxes = []
    for line in text.splitlines():
        parts = line.split()
        if len(parts) < 5:
            continue
        try:
            boxes.append((int(float(parts[0])), *(float(value) for value in parts[1:5])))
        except ValueError:
            continue
    return boxes


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _normalize_box(box: dict[str, Any]) -> tuple[float, float, float, float]:
    """Accept YOLO centre form {x, y, w, h} or corner form {x1, y1, x2, y2}, both normalized 0..1."""
    if all(key in box for key in ("x1", "y1", "x2", "y2")):
        x1, x2 = sorted((float(box["x1"]), float(box["x2"])))
        y1, y2 = sorted((float(box["y1"]), float(box["y2"])))
        x1, y1, x2, y2 = (_clamp(v) for v in (x1, y1, x2, y2))
        return (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
    if all(key in box for key in ("x", "y", "w", "h")):
        x, y, w, h = (float(box[key]) for key in ("x", "y", "w", "h"))
        x1, y1, x2, y2 = _clamp(x - w / 2), _clamp(y - h / 2), _clamp(x + w / 2), _clamp(y + h / 2)
        return (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1
    raise ValueError("Each box needs x,y,w,h (normalized centre) or x1,y1,x2,y2 (normalized corners).")


def _draw_boxes(jpeg: bytes, boxes: list[tuple[int, float, float, float, float]], names: dict[int, str]) -> bytes:
    from PIL import Image, ImageDraw

    image = Image.open(io.BytesIO(jpeg)).convert("RGB")
    draw = ImageDraw.Draw(image)
    width, height = image.size
    stroke = max(2, round(min(width, height) / 300))
    for index, (class_id, x, y, w, h) in enumerate(boxes):
        color = _PALETTE[class_id % len(_PALETTE)]
        rect = ((x - w / 2) * width, (y - h / 2) * height, (x + w / 2) * width, (y + h / 2) * height)
        draw.rectangle(rect, outline=color, width=stroke)
        tag = f"#{index} {class_id}:{names.get(class_id, '?')}"
        tx, ty = rect[0], max(0, rect[1] - 14)
        draw.rectangle((tx, ty, tx + 7 * len(tag) + 4, ty + 14), fill=color)
        draw.text((tx + 2, ty + 1), tag, fill="black")
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88)
    return out.getvalue()


class AnnotationTools:
    def __init__(self, bridge: YoloWorkBenchBridge) -> None:
        self.bridge = bridge
        self.backend = bridge.backend

    # ── helpers ─────────────────────────────────────────────────────────────

    def _root(self, workspace_root: str) -> Path:
        return self.bridge._workspace_ready(workspace_root)

    def _read_text(self, root: Path, relative: str) -> str:
        try:
            result = self.backend.call("readTextFile", [str(root), relative])
        except BackendError:
            return ""
        return result if isinstance(result, str) else json.dumps(result)

    def _write_text(self, root: Path, relative: str, text: str) -> None:
        self.backend.call("writeTextFile", [str(root), relative, text])

    def _classes(self, root: Path) -> dict[str, Any]:
        text = self._read_text(root, RELATIVE_PATHS["classes"])
        try:
            document = json.loads(text) if text.strip() else {}
        except json.JSONDecodeError as error:
            raise BackendError(f"classes.json is not valid JSON: {error}") from error
        return document if isinstance(document, dict) else {}

    def _status_rows(self, root: Path) -> dict[str, dict[str, Any]]:
        payload = self.backend.call("readMetadataRows", [str(root)])
        rows = payload.get("rows", []) if isinstance(payload, dict) else []
        return {row["filename"]: row for row in rows if isinstance(row, dict) and row.get("filename")}

    def _upsert(self, root: Path, updates: list[dict[str, Any]]) -> dict[str, Any]:
        result = self.backend.call("upsertMetadataRows", [str(root), json.dumps(updates, ensure_ascii=False)])
        if isinstance(result, dict) and result.get("ok") is False:
            raise BackendError(str(result.get("error") or "Status update failed."))
        return result if isinstance(result, dict) else {}

    def _media_files(self, root: Path) -> list[str]:
        payload = self.backend.get_json("/api/image-pool", {"workspaceRoot": str(root), "fast": "false"})
        return [item["filename"] for item in payload.get("files", []) if isinstance(item, dict)]

    def _check_media(self, root: Path, filename: str) -> str:
        name = Path(str(filename).replace("\\", "/")).name
        if not name or not (root / RELATIVE_PATHS["media"] / name).is_file():
            raise FileNotFoundError(f"{filename} is not an image in this workspace's media folder.")
        return name

    # ── classes ─────────────────────────────────────────────────────────────

    def list_classes(self, workspace_root: str) -> dict[str, Any]:
        document = self._classes(self._root(workspace_root))
        return {
            "detect": [{"id": c["id"], "key": c["key"], "name": c["name"], "archived": c["archived"]} for c in detect_classes(document)],
            "classify": classify_classes(document),
        }

    def add_classes(self, workspace_root: str, task: Literal["detect", "classify"], names: list[str]) -> dict[str, Any]:
        root = self._root(workspace_root)
        document = self._classes(root)
        task_key = "detect" if task == "detect" else "clf"
        added, existing = [], []
        for name in names:
            document, key, was_added = add_class(document, name, task_key)
            (added if was_added else existing).append(key)
        if added:
            self._write_text(root, RELATIVE_PATHS["classes"], json.dumps(document, indent=2, ensure_ascii=False) + "\n")
        return {"added": added, "alreadyPresent": existing, "classes": self.list_classes(workspace_root)}

    # ── images ──────────────────────────────────────────────────────────────

    def list_images(self, workspace_root: str, filter: ImageFilter = "all", offset: int = 0, limit: int = 50) -> dict[str, Any]:
        root = self._root(workspace_root)
        files = self._media_files(root)
        rows = self._status_rows(root)
        labels = self.backend.call("readLabelTextsBatch", [str(root), json.dumps([_label_path(name) for name in files])]) or {}
        items = []
        for name in files:
            row = rows.get(name, {})
            boxes = len(_parse_boxes(labels.get(_label_path(name), "")))
            clf_class = str(row.get("clf_class") or "")
            junk = clf_class == JUNK_CLASS or str(row.get("detect_junk")) in {"1", "True", "true"}
            item = {
                "filename": name,
                "split": row.get("split") or "train",
                "boxes": boxes,
                "detectEnabled": str(row.get("detect_enabled")) in {"1", "True", "true"},
                "class": "" if clf_class == JUNK_CLASS else clf_class,
                "reviewed": str(row.get("reviewed")) in {"1", "True", "true"},
                "junk": junk,
            }
            keep = {
                "all": True,
                "unlabeled": not junk and not boxes and not item["class"],
                "no_boxes": not junk and not boxes,
                "no_class": not junk and not item["class"],
                "detect": item["detectEnabled"] and not junk,
                "classify": bool(item["class"]),
                "junk": junk,
            }[filter]
            if keep:
                items.append(item)
        limit = max(1, min(int(limit), 500))
        return {"total": len(items), "offset": offset, "items": items[offset : offset + limit]}

    def get_labels(self, workspace_root: str, filename: str) -> dict[str, Any]:
        root = self._root(workspace_root)
        name = self._check_media(root, filename)
        names = {c["id"]: c["name"] for c in detect_classes(self._classes(root))}
        boxes = _parse_boxes(self._read_text(root, _label_path(name)))
        row = self._status_rows(root).get(name, {})
        return {
            "filename": name,
            "boxes": [
                {"index": i, "classId": c, "class": names.get(c, "?"), "x": x, "y": y, "w": w, "h": h}
                for i, (c, x, y, w, h) in enumerate(boxes)
            ],
            "class": row.get("clf_class") or "",
            "split": row.get("split") or "train",
            "reviewed": str(row.get("reviewed")) in {"1", "True", "true"},
        }

    def view_image(self, workspace_root: str, filename: str, max_edge: int = 1280, show_boxes: bool = True) -> tuple[bytes, dict[str, Any]]:
        root = self._root(workspace_root)
        name = self._check_media(root, filename)
        edge = max(256, min(int(max_edge), 2048))
        encoded = self.backend.call("readFilePreviewBase64", [str(root), f"{RELATIVE_PATHS['media']}/{name}", edge, 88])
        jpeg = base64.b64decode(encoded)
        labels = self.get_labels(workspace_root, name)
        if show_boxes and labels["boxes"]:
            names = {b["classId"]: b["class"] for b in labels["boxes"]}
            jpeg = _draw_boxes(jpeg, [(b["classId"], b["x"], b["y"], b["w"], b["h"]) for b in labels["boxes"]], names)
        return jpeg, labels

    # ── writing ─────────────────────────────────────────────────────────────

    def set_boxes(
        self,
        workspace_root: str,
        filename: str,
        boxes: list[dict[str, Any]],
        mode: Literal["replace", "append"] = "replace",
        mark_reviewed: bool = False,
    ) -> dict[str, Any]:
        root = self._root(workspace_root)
        name = self._check_media(root, filename)
        document = self._classes(root)
        lines = []
        if mode == "append":
            lines = [f"{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}" for c, x, y, w, h in _parse_boxes(self._read_text(root, _label_path(name)))]
        for box in boxes:
            if "class" not in box:
                raise ValueError("Each box needs a 'class' (detect class name, key or YOLO id).")
            cls = resolve_class(document, box["class"], "detect")
            x, y, w, h = _normalize_box(box)
            if w <= 0 or h <= 0:
                raise ValueError(f"Box {box} has no area after clamping to the image.")
            lines.append(f"{cls['id']} {x:.6f} {y:.6f} {w:.6f} {h:.6f}")
        self._write_text(root, _label_path(name), "".join(f"{line}\n" for line in lines))
        update: dict[str, Any] = {"filename": name, "detect_enabled": True, "detect_junk": False}
        if mark_reviewed:
            update["reviewed"] = True
        self._upsert(root, [update])
        return self.get_labels(workspace_root, name)

    def set_class(self, workspace_root: str, filenames: list[str], class_name: str) -> dict[str, Any]:
        root = self._root(workspace_root)
        cls = resolve_class(self._classes(root), class_name, "clf")
        names = [self._check_media(root, filename) for filename in filenames]
        self._upsert(root, [{"filename": name, "clf_class": cls["key"], "clf_enabled": True} for name in names])
        return {"class": cls["key"], "updated": names}

    def mark_junk(self, workspace_root: str, filenames: list[str], scope: Literal["both", "detect", "classify"] = "both") -> dict[str, Any]:
        root = self._root(workspace_root)
        names = [self._check_media(root, filename) for filename in filenames]
        updates = []
        for name in names:
            update: dict[str, Any] = {"filename": name}
            if scope in ("both", "detect"):
                update.update(detect_junk=True, detect_enabled=False)
            if scope in ("both", "classify"):
                update.update(clf_class=JUNK_CLASS, clf_enabled=False)
            updates.append(update)
        self._upsert(root, updates)
        return {"junk": names, "scope": scope}

    def set_image_status(
        self,
        workspace_root: str,
        filename: str,
        split: Literal["train", "val"] | None = None,
        reviewed: bool | None = None,
        flagged: bool | None = None,
        next_train: bool | None = None,
    ) -> dict[str, Any]:
        root = self._root(workspace_root)
        update: dict[str, Any] = {"filename": self._check_media(root, filename)}
        for key, value in (("split", split), ("reviewed", reviewed), ("flagged", flagged), ("next_train", next_train)):
            if value is not None:
                update[key] = value
        self._upsert(root, [update])
        return self.get_labels(workspace_root, update["filename"])

    def export_dataset(self, workspace_root: str, timeout_seconds: float = 1800) -> dict[str, Any]:
        root = self._root(workspace_root)
        state = self.backend.call("startExportDataset", [str(root), json.dumps({"rebuild": True})])
        deadline = time.monotonic() + timeout_seconds
        while isinstance(state, dict) and state.get("status") not in ("done", "error"):
            if time.monotonic() > deadline:
                return {"status": "running", "jobId": state.get("id"), "detail": "Still exporting; check the app."}
            time.sleep(0.5)
            state = self.backend.call("getBuildJob", [state["id"]])
        if not isinstance(state, dict) or state.get("status") == "error":
            raise BackendError("Export failed: " + "; ".join((state or {}).get("errors") or []))
        return state.get("result") or {}
