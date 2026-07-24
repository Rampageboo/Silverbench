from __future__ import annotations

from pathlib import Path

import pytest

from backend import ui_orchestrator_store as store


def _valid_doc() -> dict[str, object]:
    return {
        "schemaVersion": "1.0",
        "game": "Zenless_Zone_Zero",
        "pages": [
            {
                "id": "Schedule.Errands",
                "trigger": {"clf": "Schedule_Errands", "minConfidence": 0.9},
                "elements": {
                    "root": {"kind": "container", "detClass": "errands_container"},
                },
            }
        ],
        "flows": [],
    }


@pytest.fixture
def ui_maps_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "ui_maps"
    monkeypatch.setattr(store, "UI_MAPS_ROOT", root)
    return root


def test_save_load_round_trip(ui_maps_root: Path) -> None:
    doc = _valid_doc()

    saved = store.save_ui_map("coffee errands", doc)

    assert saved == {"name": "coffee_errands", "path": "ui_maps/coffee_errands.json"}
    assert (ui_maps_root / "coffee_errands.json").is_file()
    assert store.load_ui_map("coffee errands") == doc


@pytest.mark.parametrize("name", ["../escape", "nested/map", r"nested\map", "..", r"C:\escape"])
def test_unsafe_names_are_rejected(ui_maps_root: Path, name: str) -> None:
    with pytest.raises(store.UnsafeUiMapNameError):
        store.save_ui_map(name, _valid_doc())
    assert not ui_maps_root.exists() or not list(ui_maps_root.glob("*.json"))


def test_newer_major_version_is_rejected_with_typed_error(ui_maps_root: Path) -> None:
    doc = _valid_doc()
    doc["schemaVersion"] = "2.0"

    with pytest.raises(store.UnsupportedUiMapVersionError) as caught:
        store.save_ui_map("future", doc)

    assert caught.value.code == "unsupported_ui_map_version"
    assert caught.value.schema_version == "2.0"


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (lambda doc: doc.pop("pages"), "pages must be a non-empty array"),
        (lambda doc: doc.__setitem__("pages", {}), "pages must be a non-empty array"),
    ],
)
def test_envelope_rejects_invalid_pages(
    ui_maps_root: Path,
    mutation,
    message: str,
) -> None:
    doc = _valid_doc()
    mutation(doc)

    with pytest.raises(store.UiMapEnvelopeError, match=message):
        store.save_ui_map("invalid", doc)
