"""Global, local SQLite image gallery. Imported roots and originals are read-only."""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import re
import sqlite3
import subprocess
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from PIL import Image, ImageOps, UnidentifiedImageError

from backend.gallery_metadata import extract_metadata

IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"})
MAX_PAGE = 200
MAX_EXPORT = 10000
MAX_PIXELS = 100_000_000


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _within(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


class GalleryError(ValueError):
    """An actionable invalid request, suitable for a desktop API error."""


class GalleryLibrary:
    def __init__(self, directory: str | Path | None = None, *, autostart: bool = True):
        self.directory = Path(directory or os.environ.get("YWB_GALLERY_DIR") or
                              Path(__file__).resolve().parents[1] / "Sessions" / "gallery").resolve()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.thumbnails = self.directory / "thumbnails"
        self.thumbnails.mkdir(exist_ok=True)
        self.database = self.directory / "gallery.sqlite3"
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._settings_lock = threading.Lock()
        self._thumbnail_slots = threading.BoundedSemaphore(2)
        self._init_db()
        if autostart:
            self.start()

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=30000")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def _init_db(self) -> None:
        with self.connection() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS roots (
                    id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, source TEXT NOT NULL,
                    recursive INTEGER NOT NULL, created_at TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS assets (
                    id TEXT PRIMARY KEY, filename TEXT NOT NULL, width INTEGER NOT NULL,
                    height INTEGER NOT NULL, format TEXT NOT NULL, metadata TEXT NOT NULL,
                    metadata_brief TEXT NOT NULL DEFAULT '{}',
                    rating INTEGER NOT NULL DEFAULT 0 CHECK(rating BETWEEN 0 AND 5),
                    personal_tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
                    collection TEXT NOT NULL DEFAULT '', user_edits TEXT NOT NULL DEFAULT '{}',
                    model_tags TEXT NOT NULL DEFAULT '{}', caption TEXT NOT NULL DEFAULT '',
                    content_rating TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL, modified_at TEXT NOT NULL,
                    has_metadata INTEGER NOT NULL DEFAULT 0, search_text TEXT NOT NULL DEFAULT '');
                CREATE TABLE IF NOT EXISTS paths (
                    path TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id),
                    root_id TEXT NOT NULL REFERENCES roots(id), size INTEGER NOT NULL,
                    mtime_ns INTEGER NOT NULL, seen_job TEXT NOT NULL, missing INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE IF NOT EXISTS collections (name TEXT PRIMARY KEY);
                CREATE TABLE IF NOT EXISTS jobs (
                    id TEXT PRIMARY KEY, root_ids TEXT NOT NULL, status TEXT NOT NULL,
                    progress TEXT NOT NULL, created_at TEXT NOT NULL, modified_at TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT 'scan', payload TEXT NOT NULL DEFAULT '{}');
                CREATE INDEX IF NOT EXISTS paths_asset ON paths(asset_id, missing);
                CREATE INDEX IF NOT EXISTS paths_root ON paths(root_id, missing, asset_id);
                CREATE INDEX IF NOT EXISTS assets_order ON assets(created_at DESC, id);
                CREATE INDEX IF NOT EXISTS assets_collection ON assets(collection, created_at DESC, id);
                CREATE INDEX IF NOT EXISTS assets_rating ON assets(rating, created_at DESC);
                CREATE INDEX IF NOT EXISTS assets_metadata ON assets(has_metadata, created_at DESC);
                CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
            """)
            try:
                db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(id UNINDEXED, text, tokenize='unicode61')")
                self._fts = True
            except sqlite3.OperationalError:
                self._fts = False
            # Paused jobs stay paused. An interrupted running job is safely enumerated again.
            db.execute("UPDATE jobs SET status='queued', modified_at=? WHERE status='running'", (_now(),))

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._worker, name="gallery-scan", daemon=True)
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=5)

    def get_settings(self) -> dict:
        path = self.directory / "settings.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            raise GalleryError(f"Gallery settings could not be read: {error}") from error

    def save_settings(self, settings: dict) -> dict:
        from backend.gallery_inference import get_capabilities
        from backend.gallery_prompts import assemble_prompts
        if not isinstance(settings, dict):
            raise GalleryError("Gallery settings must be an object.")
        get_capabilities(config=settings)  # Validates values, without loading model weights.
        if "rules" in settings:
            if not isinstance(settings["rules"], dict):
                raise GalleryError("settings.rules must be an object.")
            assemble_prompts({}, rules=settings["rules"])
        text = _json(settings)
        if len(text.encode("utf-8")) > 1024 * 1024:
            raise GalleryError("Gallery settings exceed the 1 MiB limit.")
        with self._settings_lock:
            temporary = self.directory / f".settings-{uuid.uuid4().hex}.tmp"
            try:
                temporary.write_text(text, encoding="utf-8")
                os.replace(temporary, self.directory / "settings.json")
            finally:
                temporary.unlink(missing_ok=True)
        return settings

    def roots(self) -> list[dict]:
        with self.connection() as db:
            return [{"id": row["id"], "path": row["path"], "source": row["source"],
                     "recursive": bool(row["recursive"])} for row in db.execute("SELECT * FROM roots ORDER BY created_at,id")]

    def add_root(self, path: str, source: str = "local", recursive: bool = True) -> dict:
        requested = Path(path).expanduser()
        if not requested.is_absolute():
            raise GalleryError("Select an absolute image directory.")
        resolved = requested.resolve()
        if not resolved.is_dir():
            raise GalleryError(f"Image directory is unavailable: {resolved}")
        if _within(resolved, self.directory):
            raise GalleryError("The gallery database/cache directory cannot be an imported image root.")
        with self.connection() as db:
            for existing in db.execute("SELECT path FROM roots"):
                other = Path(existing["path"])
                if other != resolved and (_within(resolved, other) or _within(other, resolved)):
                    raise GalleryError("This folder overlaps a registered root; use its existing root to avoid competing scan ownership.")
            row = db.execute("SELECT * FROM roots WHERE path=?", (str(resolved),)).fetchone()
            root_id = row["id"] if row else uuid.uuid4().hex
            db.execute("INSERT INTO roots VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET source=excluded.source,recursive=excluded.recursive",
                       (root_id, str(resolved), source[:200], int(recursive), _now()))
        job = self.scan(root_id)
        return {"id": root_id, "path": str(resolved), "source": source[:200], "recursive": recursive, "job": job}

    def scan(self, root_id: str | None = None) -> dict:
        with self.connection() as db:
            roots = db.execute("SELECT id FROM roots" + (" WHERE id=?" if root_id else "") + " ORDER BY created_at,id",
                               (root_id,) if root_id else ()).fetchall()
            ids = [row["id"] for row in roots]
            if not ids:
                raise GalleryError("No registered image root found. Add an available folder first.")
            # Reuse an active job for the exact request; serialize overlapping jobs in the worker.
            encoded = _json(ids)
            active = db.execute("SELECT * FROM jobs WHERE root_ids=? AND status IN ('queued','running','paused') ORDER BY created_at LIMIT 1", (encoded,)).fetchone()
            if active:
                return self._job(active)
            job_id, stamp = uuid.uuid4().hex, _now()
            progress = {"scanned": 0, "imported": 0, "unchanged": 0, "skipped": 0,
                        "missing": 0, "currentPath": "", "errors": [], "completedRoots": []}
            db.execute("INSERT INTO jobs(id,root_ids,status,progress,created_at,modified_at) VALUES (?,?,?,?,?,?)", (job_id, encoded, "queued", _json(progress), stamp, stamp))
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        self._wake.set()
        return self._job(row)

    @staticmethod
    def _job(row: sqlite3.Row) -> dict:
        progress = json.loads(row["progress"])
        progress["processed"] = progress["scanned"]
        return {"id": row["id"], "type": row["type"], "rootIds": json.loads(row["root_ids"]),
                "status": row["status"], "progress": progress, "processed": progress["scanned"],
                "createdAt": row["created_at"], "modifiedAt": row["modified_at"]}

    def jobs(self) -> list[dict]:
        with self.connection() as db:
            return [self._job(row) for row in db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT 100")]

    def job_action(self, job_id: str, action: str) -> dict:
        if action not in ("pause", "resume", "cancel"):
            raise GalleryError("Job action must be pause, resume, or cancel.")
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row:
                raise KeyError(job_id)
            status = row["status"]
            target = {"pause": "paused", "resume": "queued", "cancel": "cancelled"}[action]
            if status in ("completed", "cancelled", "failed"):
                if action == "cancel" and status == "cancelled":
                    return self._job(row)
                raise GalleryError(f"This job is {status}; start a new scan to retry it.")
            if action == "resume" and status != "paused":
                return self._job(row)
            db.execute("UPDATE jobs SET status=?,modified_at=? WHERE id=?", (target, _now(), job_id))
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        self._wake.set()
        return self._job(row)

    def _running(self, job_id: str) -> bool:
        if self._stop.is_set():
            return False
        with self.connection() as db:
            row = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
            return bool(row and row["status"] == "running")

    def _progress(self, job_id: str, progress: dict, status: str | None = None) -> None:
        with self.connection() as db:
            # A control action always wins over a worker finishing its current image.
            db.execute("UPDATE jobs SET progress=?,modified_at=?" + (",status=?" if status else "") +
                       (" WHERE id=? AND status='running'" if status else " WHERE id=? AND status IN ('running','paused','queued','cancelled')"),
                       (_json(progress), _now(), status, job_id) if status else (_json(progress), _now(), job_id))

    def _worker(self) -> None:
        while not self._stop.is_set():
            row = None
            try:
                with self.connection() as db:
                    row = db.execute("SELECT * FROM jobs WHERE status='queued' ORDER BY created_at,id LIMIT 1").fetchone()
                    if row:
                        db.execute("UPDATE jobs SET status='running',modified_at=? WHERE id=? AND status='queued'", (_now(), row["id"]))
                if row:
                    if row["type"] == "wd":
                        self._run_process_job(row["id"])
                    else:
                        self.run_job(row["id"])
                else:
                    self._wake.wait(1)
                    self._wake.clear()
            except Exception as error:
                if row:
                    try:
                        progress = json.loads(row["progress"])
                        progress["errors"] = [*progress.get("errors", []), f"Worker failed: {error}"][-20:]
                        self._progress(row["id"], progress, "failed")
                    except sqlite3.Error:
                        pass  # A database outage is retried without killing the worker thread.
                self._stop.wait(1)

    def _files(self, root: Path, recursive: bool, errors: list[str], job_id: str) -> Iterator[Path]:
        pending = [root]
        while pending:
            if not self._running(job_id):
                return
            directory = pending.pop()
            try:
                with os.scandir(directory) as entries:
                    for index, entry in enumerate(entries):
                        if index % 128 == 0 and not self._running(job_id):
                            return
                        if entry.is_symlink():
                            continue
                        candidate = Path(entry.path)
                        if _within(candidate, self.directory):
                            continue
                        try:
                            if recursive and entry.is_dir(follow_symlinks=False):
                                pending.append(candidate)
                            elif entry.is_file(follow_symlinks=False) and candidate.suffix.lower() in IMAGE_EXTENSIONS:
                                yield candidate
                        except OSError as error:
                            errors[:] = [*errors, f"{candidate}: {error}"][-20:]
            except OSError as error:
                errors[:] = [*errors, f"{directory}: {error}"][-20:]

    def run_job(self, job_id: str) -> None:
        """Run one durable scan; also useful for deterministic dedicated-verifier tests."""
        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] in ("completed", "cancelled", "failed", "paused"):
                return
            db.execute("UPDATE jobs SET status='running' WHERE id=?", (job_id,))
        job = self._job(row)
        progress = job["progress"]
        try:
            for root_id in job["rootIds"]:
                if root_id in progress["completedRoots"]:
                    continue
                with self.connection() as db:
                    root = db.execute("SELECT * FROM roots WHERE id=?", (root_id,)).fetchone()
                if not root or not Path(root["path"]).is_dir():
                    raise GalleryError(f"Root is unavailable; existing assets were retained: {root['path'] if root else root_id}")
                enumeration_errors: list[str] = []
                for path in self._files(Path(root["path"]), bool(root["recursive"]), enumeration_errors, job_id):
                    if not self._running(job_id):
                        return
                    progress["currentPath"] = str(path)
                    try:
                        outcome = self._index(path, root_id, job_id)
                        if outcome != "alreadySeen":
                            progress["scanned"] += 1
                            progress[outcome] += 1
                    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError) as error:
                        progress["scanned"] += 1
                        progress["skipped"] += 1
                        progress["errors"] = [*progress["errors"], f"{path}: {error}"][-20:]
                    self._progress(job_id, progress)
                if not self._running(job_id):
                    return
                if enumeration_errors:
                    progress["errors"] = [*progress["errors"], *enumeration_errors][-20:]
                    # An unreadable directory must never mark its contents deleted.
                    raise GalleryError("Some directories could not be read; missing-file reconciliation was skipped.")
                with self.connection() as db:
                    state = db.execute("SELECT status FROM jobs WHERE id=?", (job_id,)).fetchone()
                    if not state or state["status"] != "running":
                        return
                    count = db.execute("SELECT count(*) FROM paths WHERE root_id=? AND seen_job<>? AND missing=0", (root_id, job_id)).fetchone()[0]
                    db.execute("UPDATE paths SET missing=1 WHERE root_id=? AND seen_job<>?", (root_id, job_id))
                progress["missing"] += count
                progress["completedRoots"].append(root_id)
                self._progress(job_id, progress)
            progress["currentPath"] = ""
            self._progress(job_id, progress, "completed")
        except Exception as error:
            progress["errors"] = [*progress["errors"], str(error)][-20:]
            self._progress(job_id, progress, "failed")

    @staticmethod
    def _search_text(record: dict) -> str:
        metadata = record.get("metadata", {})
        return " ".join([record.get("filename", ""), metadata.get("positive", ""), metadata.get("negative", ""),
                         metadata.get("model", ""), record.get("notes", ""), record.get("collection", ""),
                         *record.get("personalTags", []), record.get("caption", ""), _json(record.get("modelTags", {}))])

    def _set_search(self, db: sqlite3.Connection, asset_id: str, text: str) -> None:
        db.execute("UPDATE assets SET search_text=? WHERE id=?", (text, asset_id))
        if self._fts:
            rowid = db.execute("SELECT rowid FROM assets WHERE id=?", (asset_id,)).fetchone()[0]
            db.execute("DELETE FROM asset_search WHERE rowid=?", (rowid,))
            db.execute("INSERT INTO asset_search(rowid,id,text) VALUES (?,?,?)", (rowid, asset_id, text))

    def _index(self, path: Path, root_id: str, job_id: str) -> str:
        before = path.stat()
        with self.connection() as db:
            previous = db.execute("SELECT * FROM paths WHERE path=?", (str(path),)).fetchone()
            if previous and previous["size"] == before.st_size and previous["mtime_ns"] == before.st_mtime_ns:
                if previous["seen_job"] == job_id and not previous["missing"]:
                    return "alreadySeen"
                db.execute("UPDATE paths SET seen_job=?,root_id=?,missing=0 WHERE path=?", (job_id, root_id, str(path)))
                return "unchanged"
        asset_id = _digest(path)
        with Image.open(path) as image:
            width, height = image.size
            if width * height > MAX_PIXELS:
                raise GalleryError(f"Image exceeds gallery decode limit ({MAX_PIXELS} pixels).")
            image_format = image.format or path.suffix.lstrip(".").upper()
            image.verify()
        with Image.open(path) as image:
            metadata = extract_metadata(image)
        after = path.stat()
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise GalleryError("File changed during scanning; scan again when its writer finishes.")
        stamp = _now()
        with self.connection() as db:
            exists = db.execute("SELECT id FROM assets WHERE id=?", (asset_id,)).fetchone()
            if not exists:
                brief = {k: metadata.get(k) for k in ("format", "source", "model")}
                db.execute("INSERT INTO assets(id,filename,width,height,format,metadata,metadata_brief,created_at,modified_at,has_metadata) VALUES (?,?,?,?,?,?,?,?,?,?)",
                           (asset_id, path.name, width, height, image_format, _json(metadata), _json(brief), stamp, stamp, int(metadata["source"] == "metadata")))
                self._set_search(db, asset_id, self._search_text({"filename": path.name, "metadata": metadata}))
            db.execute("INSERT INTO paths VALUES (?,?,?,?,?,?,0) ON CONFLICT(path) DO UPDATE SET asset_id=excluded.asset_id,root_id=excluded.root_id,size=excluded.size,mtime_ns=excluded.mtime_ns,seen_job=excluded.seen_job,missing=0",
                       (str(path), asset_id, root_id, after.st_size, after.st_mtime_ns, job_id))
        return "imported"

    def _record(self, db: sqlite3.Connection, row: sqlite3.Row, *, brief: bool = False) -> dict:
        path = db.execute("SELECT p.*,r.source FROM paths p JOIN roots r ON r.id=p.root_id WHERE asset_id=? ORDER BY p.missing,p.path LIMIT 1", (row["id"],)).fetchone()
        record = {"id": row["id"], "path": path["path"] if path else "", "filename": Path(path["path"]).name if path else row["filename"],
                  "width": row["width"], "height": row["height"], "format": row["format"], "source": path["source"] if path else "local",
                  "metadata": json.loads(row["metadata"]), "rating": row["rating"], "personalTags": json.loads(row["personal_tags"]),
                  "collection": row["collection"], "contentRating": row["content_rating"] or None, "createdAt": row["created_at"],
                  "modifiedAt": row["modified_at"], "missing": not path or bool(path["missing"])}
        record["hasMetadata"] = record["metadata"].get("source") == "metadata"
        if brief:
            record["metadata"] = {key: record["metadata"].get(key) for key in ("format", "source", "model")}
            record["personalTagsCount"] = len(record["personalTags"])
            record["personalTags"] = record["personalTags"][:30]
        else:
            record.update(notes=row["notes"], userEdits=json.loads(row["user_edits"]),
                          modelTags=json.loads(row["model_tags"]), caption=row["caption"])
        return record

    def list_assets(self, *, q: str = "", root_id: str | None = None, collection: str | None = None,
                    min_rating: int = 0, has_metadata: bool | None = None, offset: int = 0, limit: int = 60) -> dict:
        if offset < 0 or limit < 1 or limit > MAX_PAGE or not 0 <= min_rating <= 5:
            raise GalleryError(f"Use offset >= 0, limit 1..{MAX_PAGE}, and minRating 0..5.")
        conditions, params = ["a.rating>=?"], [min_rating]
        if root_id:
            conditions.append("EXISTS(SELECT 1 FROM paths p WHERE p.asset_id=a.id AND p.root_id=?)")
            params.append(root_id)
        if collection is not None:
            conditions.append("a.collection=?")
            params.append(collection)
        if has_metadata is not None:
            conditions.append("a.has_metadata=?")
            params.append(int(has_metadata))
        q = q.strip()[:1000]
        if q and self._fts:
            tokens = re.findall(r"\w+", q, flags=re.UNICODE)
            if tokens:
                conditions.append("a.id IN (SELECT id FROM asset_search WHERE text MATCH ?)")
                params.append(" AND ".join('"' + token.replace('"', '""') + '"*' for token in tokens))
            else:
                conditions.append("a.search_text LIKE ? ESCAPE '\\'")
                params.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        elif q:
            conditions.append("a.search_text LIKE ? ESCAPE '\\'")
            params.append("%" + q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%")
        clause = " WHERE " + " AND ".join(conditions)
        with self.connection() as db:
            count = db.execute("SELECT count(*) FROM assets a" + clause, params).fetchone()[0]
            projection = "a.id,a.filename,a.width,a.height,a.format,a.metadata_brief AS metadata,a.rating,a.personal_tags,a.collection,a.content_rating,a.created_at,a.modified_at"
            rows = db.execute("SELECT " + projection + " FROM assets a" + clause + " ORDER BY a.created_at DESC,a.id LIMIT ? OFFSET ?", (*params, limit, offset)).fetchall()
            records = [self._record(db, row, brief=True) for row in rows]
        return {"items": records, "total": count, "offset": offset, "limit": limit}

    def asset(self, asset_id: str) -> dict:
        with self.connection() as db:
            row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if not row:
                raise KeyError(asset_id)
            return self._record(db, row)

    def edit_asset(self, asset_id: str, edits: dict) -> dict:
        allowed = {"rating": "rating", "personalTags": "personal_tags", "notes": "notes", "collection": "collection",
                   "userEdits": "user_edits", "modelTags": "model_tags", "caption": "caption"}
        unknown = set(edits) - set(allowed)
        if unknown:
            raise GalleryError("Unsupported asset edits: " + ", ".join(sorted(unknown)))
        if "rating" in edits and (type(edits["rating"]) is not int or not 0 <= edits["rating"] <= 5):
            raise GalleryError("Rating must be an integer from 0 to 5.")
        if "personalTags" in edits and (not isinstance(edits["personalTags"], list) or
                                       len(edits["personalTags"]) > 2000 or
                                       not all(isinstance(v, str) and len(v) <= 500 for v in edits["personalTags"])):
            raise GalleryError("personalTags must contain at most 2000 strings of at most 500 characters.")
        for key in ("userEdits", "modelTags"):
            if key in edits and not isinstance(edits[key], dict):
                raise GalleryError(f"{key} must be an object.")
        for key in ("notes", "collection", "caption"):
            if key in edits and (not isinstance(edits[key], str) or len(edits[key]) > (200 if key == "collection" else 100000)):
                raise GalleryError(f"{key} must be a string within the supported length.")
        if len(_json(edits).encode("utf-8")) > 2 * 1024 * 1024:
            raise GalleryError("Asset edits exceed 2 MiB.")
        with self.connection() as db:
            row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if not row:
                raise KeyError(asset_id)
            record = self._record(db, row)
            record.update(edits)
            from backend.gallery_prompts import assemble_prompts, load_rules
            settings = self.get_settings()
            rules = settings.get("rules") if isinstance(settings.get("rules"), dict) else load_rules()
            assemble_prompts(record, rules=rules)  # Invalid edits roll back before persistence.
            for key, value in edits.items():
                db.execute(f"UPDATE assets SET {allowed[key]}=? WHERE id=?", (_json(value) if isinstance(value, (dict, list)) else value, asset_id))
            db.execute("UPDATE assets SET modified_at=? WHERE id=?", (_now(), asset_id))
            if record["collection"]:
                db.execute("INSERT OR IGNORE INTO collections VALUES (?)", (record["collection"],))
            self._set_search(db, asset_id, self._search_text(record))
        return self.asset(asset_id)

    def collections(self) -> list[str]:
        with self.connection() as db:
            return [row[0] for row in db.execute("SELECT name FROM collections UNION SELECT collection FROM assets WHERE collection<>'' ORDER BY 1")]

    def add_collection(self, name: str) -> list[str]:
        if not isinstance(name, str) or not name.strip() or len(name) > 200:
            raise GalleryError("Collection name must have 1..200 characters.")
        with self.connection() as db:
            db.execute("INSERT OR IGNORE INTO collections VALUES (?)", (name.strip(),))
        return self.collections()

    def source_path(self, asset_id: str, *, verify_hash: bool = False) -> Path:
        with self.connection() as db:
            if not db.execute("SELECT id FROM assets WHERE id=?", (asset_id,)).fetchone():
                raise KeyError(asset_id)
            rows = db.execute("SELECT p.*,r.path AS root_path FROM paths p JOIN roots r ON p.root_id=r.id WHERE asset_id=? AND missing=0 ORDER BY p.path", (asset_id,)).fetchall()
        for row in rows:
            path = Path(row["path"])
            try:
                resolved = path.resolve(strict=True)
                stat = resolved.stat()
                if (resolved != path or not _within(resolved, Path(row["root_path"])) or
                        not resolved.is_file() or stat.st_size != row["size"] or stat.st_mtime_ns != row["mtime_ns"]):
                    continue
                if verify_hash and _digest(resolved) != asset_id:
                    continue
                return resolved
            except OSError:
                continue
        raise GalleryError("Original image is missing or changed. Reconnect its root and run a scan.")

    def thumbnail(self, asset_id: str) -> Path:
        # Validate the id before using it in a filesystem path.
        if not re.fullmatch(r"[a-f0-9]{64}", asset_id):
            raise KeyError(asset_id)
        self.asset(asset_id)
        target = self.thumbnails / f"{asset_id}.jpg"
        if target.is_file():
            return target
        source = self.source_path(asset_id)
        temporary = self.thumbnails / f".{asset_id}-{uuid.uuid4().hex}.tmp"
        try:
            with self._thumbnail_slots, Image.open(source) as opened:
                if opened.width * opened.height > MAX_PIXELS:
                    raise GalleryError("Image is too large to thumbnail safely.")
                opened.draft("RGB", (384, 384))
                image = ImageOps.exif_transpose(opened)
                image.thumbnail((384, 384), Image.Resampling.LANCZOS)
                if image.mode in ("RGBA", "LA") or "transparency" in image.info:
                    rgba = image.convert("RGBA")
                    output = Image.new("RGB", image.size, "#202020")
                    output.paste(rgba, mask=rgba.getchannel("A"))
                else:
                    output = image.convert("RGB")
                output.save(temporary, format="JPEG", quality=82)
            os.replace(temporary, target)
        finally:
            temporary.unlink(missing_ok=True)
        return target

    def status(self) -> dict:
        with self.connection() as db:
            count = db.execute("SELECT count(*) FROM assets").fetchone()[0]
        return {"total": count, "roots": self.roots(), "collections": self.collections(), "jobs": self.jobs(),
                "capabilities": {"localLibrary": True, "originalMetadata": True, "backgroundScanning": True,
                                 "persistentJobs": True, "watcher": False, "semanticSearch": False,
                                 "nearDuplicateSearch": False, "artistReferences": False, "dualComputerWorkers": False,
                                 "gpuScheduling": False, "comfyuiRoundtrip": False,
                                 "exactDuplicateRelinking": True, "fullTextSearch": self._fts}}

    def selected(self, ids: list[str]) -> list[dict]:
        if not isinstance(ids, list) or not ids or len(ids) > MAX_EXPORT or not all(isinstance(v, str) for v in ids):
            raise GalleryError(f"Select between 1 and {MAX_EXPORT} asset IDs.")
        return [self.asset(asset_id) for asset_id in dict.fromkeys(ids)]

    def process(self, ids: list[str], model: str = "wd") -> dict:
        """Queue the real optional WD worker only when local prerequisites are ready."""
        from backend.gallery_inference import get_capabilities

        if model != "wd":
            raise GalleryError("Only the optional local WD adapter is implemented. PixAI and captions are unavailable.")
        records = self.selected(ids)
        config = self.get_settings()
        adapter = get_capabilities(config=config).get("adapters", {}).get("wd_onnx", {})
        if not adapter.get("ready"):
            raise GalleryError("WD processing is unavailable: " + "; ".join(adapter.get("blockers") or ["Configure local model and tags files in Settings."]))
        for record in records:
            self.source_path(record["id"])
        progress = {"scanned": 0, "imported": 0, "skipped": 0, "nextIndex": 0,
                    "total": len(records), "currentPath": "", "errors": []}
        payload = {"ids": [record["id"] for record in records], "config": config}
        stamp, job_id = _now(), uuid.uuid4().hex
        with self.connection() as db:
            db.execute("INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?)", (job_id, "[]", "queued", _json(progress), stamp, stamp, "wd", _json(payload)))
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        self._wake.set()
        return self._job(row)

    def _store_inference(self, asset_id: str, result: dict) -> None:
        model_id = result.get("modelId")
        if not isinstance(model_id, str) or not model_id or not isinstance(result.get("tags"), list):
            raise GalleryError("WD worker returned an invalid model identity or tag list.")
        with self.connection() as db:
            row = db.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
            if not row:
                raise KeyError(asset_id)
            record = self._record(db, row)
            record["modelTags"][model_id] = result
            ratings = [tag for tag in result["tags"] if tag.get("category") in (9, "rating")
                       and tag.get("name") in ("general", "sensitive", "questionable", "explicit")]
            rating = max(ratings, key=lambda tag: tag.get("probability", 0))["name"] if ratings else row["content_rating"]
            db.execute("UPDATE assets SET model_tags=?,content_rating=?,modified_at=? WHERE id=?", (_json(record["modelTags"]), rating, _now(), asset_id))
            self._set_search(db, asset_id, self._search_text(record))

    def _run_process_job(self, job_id: str) -> None:
        from backend.gallery_inference import start_wd_worker

        with self.connection() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] != "running":
                return
        payload, progress = json.loads(row["payload"]), json.loads(row["progress"])
        try:
            for index in range(progress["nextIndex"], len(payload["ids"])):
                if not self._running(job_id):
                    return
                asset_id = payload["ids"][index]
                process = None
                try:
                    path = self.source_path(asset_id, verify_hash=True)
                    progress["currentPath"] = str(path)
                    process = start_wd_worker(str(path), payload["config"])
                    deadline = time.monotonic() + 300
                    while True:
                        if not self._running(job_id):
                            return  # finally owns termination; resume retries this image.
                        if time.monotonic() > deadline:
                            raise GalleryError("WD worker exceeded five minutes for one image.")
                        try:
                            stdout, stderr = process.communicate(timeout=0.5)
                            break
                        except subprocess.TimeoutExpired:
                            continue
                    response = json.loads(stdout)
                    if process.returncode or not response.get("ok"):
                        raise GalleryError(str(response.get("error") or stderr[-1000:] or "WD worker failed."))
                    # Do not attach results if the original changed while the worker read it.
                    self.source_path(asset_id, verify_hash=True)
                    self._store_inference(asset_id, response["result"])
                    progress["imported"] += 1
                except Exception as error:
                    progress["skipped"] += 1
                    progress["errors"] = [*progress["errors"], f"{asset_id}: {error}"][-20:]
                finally:
                    if process is not None and process.poll() is None:
                        process.terminate()
                        try:
                            process.communicate(timeout=3)
                        except subprocess.TimeoutExpired:
                            process.kill()
                            process.communicate()
                progress["scanned"] += 1
                progress["nextIndex"] = index + 1
                self._progress(job_id, progress)
            progress["currentPath"] = ""
            self._progress(job_id, progress, "failed" if progress["skipped"] and not progress["imported"] else "completed")
        except Exception as error:
            progress["errors"] = [*progress["errors"], str(error)][-20:]
            self._progress(job_id, progress, "failed")

    def export(self, request: dict) -> dict:
        from backend.gallery_prompts import assemble_prompts, load_rules

        records = self.selected(request.get("ids", []))
        destination_text = request.get("destination", "")
        if not isinstance(destination_text, str) or not destination_text:
            raise GalleryError("Choose an explicit export destination directory.")
        destination = Path(destination_text).expanduser()
        if not destination.is_absolute() or not destination.is_dir():
            raise GalleryError("Choose an existing absolute export destination directory.")
        destination = destination.resolve()
        if _within(destination, self.directory) or any(_within(destination, Path(root["path"])) for root in self.roots()):
            raise GalleryError("Choose an export destination outside imported roots and the gallery database/cache.")
        rendering = request.get("format", "noobai")
        extension = request.get("extension", ".txt")
        artifact = request.get("artifact", "all")
        if rendering not in ("noobai", "anima") or extension not in (".txt", ".atxt"):
            raise GalleryError("Use format noobai/anima and extension .txt/.atxt.")
        if artifact not in ("all", "captions", "json", "csv", "dataset"):
            raise GalleryError("artifact must be all, captions, json, csv, or dataset.")
        if request.get("mode", "prompt") not in ("prompt", "train"):
            raise GalleryError("Export mode must be prompt or train.")
        settings = self.get_settings()
        rules = settings.get("rules") if isinstance(settings.get("rules"), dict) else load_rules()
        options = {**request.get("options", {}), **{k: v for k, v in request.items() if k not in
                   ("ids", "destination", "format", "extension", "copyImages", "artifact", "options")}}
        payloads: dict[str, bytes | Path] = {}
        output_names: set[str] = set()

        def put(name: str, payload: bytes | Path) -> None:
            if Path(name).name != name or name.casefold() in output_names:
                raise GalleryError("Selected export filenames collide or escape the destination; no files were written.")
            output_names.add(name.casefold())
            payloads[name] = payload

        warnings: list[str] = []
        manifest = []
        stems: dict[str, int] = {}
        for record in records:
            key = Path(record["filename"]).stem.casefold()
            stems[key] = stems.get(key, 0) + 1
        for record in records:
            rendered = assemble_prompts(record, options=options, rules=rules)
            warnings.extend(rendered.get("warnings", []))
            stem = Path(record["filename"]).stem
            if stems[stem.casefold()] > 1:
                stem = stem[:200] + "_" + record["id"][:16]
            caption_name = stem + extension
            prompt = rendered[rendering]
            if artifact in ("all", "captions", "dataset"):
                text = prompt.get("positive", "")
                if request.get("mode", "prompt") == "prompt" and prompt.get("negative"):
                    text += "\nNegative prompt: " + prompt["negative"]
                put(caption_name, (text.rstrip() + "\n").encode("utf-8"))
            else:
                caption_name = ""
            image_name = ""
            if request.get("copyImages"):
                source = self.source_path(record["id"], verify_hash=True)
                image_name = stem + source.suffix.lower()
                put(image_name, source)
            manifest.append({"asset": record, "prompt": rendered, "captionFile": caption_name,
                             "imageFile": image_name})
        if artifact in ("all", "json"):
            put("results.json", (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
        if artifact in ("all", "csv"):
            buffer = io.StringIO(newline="")
            writer = csv.writer(buffer)
            columns = ["id", "path", "filename", "width", "height", "format", "source", "metadata", "rating", "personalTags",
                       "notes", "collection", "userEdits", "modelTags", "caption", "createdAt", "modifiedAt", "missing"]
            writer.writerow([*columns, "captionFile", "imageFile", "noobai", "anima", "tags", "warnings"])
            for row in manifest:
                record = row["asset"]
                # Prefix spreadsheet formula cells; JSON retains exact original text.
                values = [record.get(key, "") for key in columns] + [row["captionFile"], row["imageFile"],
                          row["prompt"].get("noobai", {}), row["prompt"].get("anima", {}),
                          row["prompt"].get("tags", []), row["prompt"].get("warnings", [])]
                values = [_json(v) if isinstance(v, (dict, list)) else v for v in values]
                writer.writerow(["'" + str(v) if str(v).startswith(("=", "+", "-", "@")) else v for v in values])
            put("results.csv", buffer.getvalue().encode("utf-8-sig"))
        dataset = artifact == "dataset" or (artifact == "all" and request.get("mode", "prompt") == "train" and request.get("copyImages"))
        if dataset:
            if not request.get("copyImages"):
                raise GalleryError("Dataset TOML requires copyImages=true so it references only the selected exported images.")
            # No training defaults (resolution/repeats/model) are fabricated.
            toml = "# Selected gallery images only. Configure trainer/model settings explicitly.\n[general]\ncaption_extension = " + json.dumps(extension) + "\n\n[[datasets]]\n"
            toml += "[[datasets.subsets]]\nimage_dir = " + json.dumps(str(destination), ensure_ascii=False) + "\n"
            put("dataset.toml", toml.encode("utf-8"))
        elif artifact == "all" and request.get("mode", "prompt") == "train":
            warnings.append("Dataset TOML was omitted: enable copyImages and choose an empty destination to export a selected-only dataset.")
        # Training loaders scan image_dir; require it empty before publishing selected-only TOML.
        if dataset and any(destination.iterdir()):
            raise GalleryError("Dataset export needs an empty destination so its image_dir contains only the selected images.")
        names = list(payloads)
        if len({name.casefold() for name in names}) != len(names):
            raise GalleryError("Selected export filenames collide; no files were written.")
        existing = {entry.name.casefold() for entry in destination.iterdir()}
        collisions = [name for name in names if name.casefold() in existing]
        if collisions:
            raise GalleryError("Export would overwrite existing files: " + ", ".join(collisions[:5]))
        created: list[Path] = []
        try:
            for name, payload in payloads.items():
                target = destination / name
                if target.parent != destination or not _within(target, destination):
                    raise GalleryError("Export filename escaped its destination.")
                with target.open("xb") as stream:
                    created.append(target)
                    if isinstance(payload, Path):
                        digest = hashlib.sha256()
                        with payload.open("rb") as source:
                            for block in iter(lambda: source.read(1024 * 1024), b""):
                                stream.write(block)
                                digest.update(block)
                        expected = next(row["asset"]["id"] for row in manifest if row["imageFile"] == name)
                        if digest.hexdigest() != expected:
                            raise GalleryError("Source image changed during export; no export was retained.")
                    else:
                        stream.write(payload)
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
        return {"count": len(records), "destination": str(destination), "files": [str(destination / name) for name in names],
                "warnings": list(dict.fromkeys(warnings))}
