"""Gallery (图集) tools for agents: find images, look at them, write captions and tags."""

from __future__ import annotations

import io
from typing import Any, Literal
from urllib.parse import quote

from .bridge import BackendClient, BackendError

_EDITABLE = ("caption", "notes", "rating", "collection")


def _shrink(data: bytes, max_edge: int) -> bytes:
    from PIL import Image, ImageOps

    image = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    image.thumbnail((max_edge, max_edge))
    if image.mode != "RGB":
        image = image.convert("RGB")
    out = io.BytesIO()
    image.save(out, format="JPEG", quality=88)
    return out.getvalue()


def _brief(record: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "filename", "width", "height", "rating", "collection", "personalTags", "caption", "notes", "missing")
    return {key: record.get(key) for key in keys if key in record}


class GalleryTools:
    def __init__(self, backend: BackendClient) -> None:
        self.backend = backend

    def _asset(self, asset_id: str) -> dict[str, Any]:
        record = self.backend.get_json(f"/api/gallery/assets/{quote(asset_id, safe='')}")
        if not isinstance(record, dict) or not record.get("id"):
            raise BackendError(f"Gallery asset {asset_id} not found.")
        return record

    def search(
        self,
        query: str = "",
        collection: str | None = None,
        min_rating: int = 0,
        offset: int = 0,
        limit: int = 30,
    ) -> dict[str, Any]:
        payload = self.backend.get_json(
            "/api/gallery/assets",
            {"q": query, "collection": collection, "minRating": min_rating, "offset": offset, "limit": max(1, min(limit, 200))},
        )
        return {
            "total": payload.get("total", 0),
            "offset": payload.get("offset", offset),
            "items": [_brief(item) for item in payload.get("items", [])],
        }

    def view(self, asset_id: str, max_edge: int = 1280) -> tuple[bytes, dict[str, Any]]:
        record = self._asset(asset_id)
        data = self.backend.get_bytes(f"/api/gallery/assets/{quote(asset_id, safe='')}/image")
        details = _brief(record)
        prompt = (record.get("metadata") or {}).get("prompt")
        if prompt:
            details["generationPrompt"] = prompt
        details["modelTags"] = record.get("modelTags") or {}
        return _shrink(data, max(256, min(int(max_edge), 2048))), details

    def describe(
        self,
        asset_id: str,
        caption: str | None = None,
        tags: list[str] | None = None,
        tags_mode: Literal["replace", "add", "remove"] = "add",
        notes: str | None = None,
        rating: int | None = None,
        collection: str | None = None,
    ) -> dict[str, Any]:
        record = self._asset(asset_id)
        edits: dict[str, Any] = {}
        for key, value in (("caption", caption), ("notes", notes), ("rating", rating), ("collection", collection)):
            if value is not None:
                edits[key] = value
        if tags is not None:
            clean = [str(tag).strip() for tag in tags if str(tag).strip()]
            current = list(record.get("personalTags") or [])
            if tags_mode == "replace":
                edits["personalTags"] = clean
            elif tags_mode == "add":
                edits["personalTags"] = current + [tag for tag in clean if tag not in current]
            else:
                edits["personalTags"] = [tag for tag in current if tag not in set(clean)]
        if not edits:
            raise ValueError("Nothing to change: pass caption, tags, notes, rating or collection.")
        updated = self.backend.post_json(f"/api/gallery/assets/{quote(asset_id, safe='')}", edits)
        return _brief(updated if isinstance(updated, dict) else record)
