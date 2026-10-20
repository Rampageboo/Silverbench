"""Pure record/format contract tests; no weights, GPU, network or inference."""
import copy
import json

import pytest

from backend.gallery_prompts import assemble_prompts, load_rules, summarize_records
from backend.gallery_inference import get_capabilities


def tagged(*entries):
    return {"tags": [{"name": name, "category": category, "probability": probability} for name, category, probability in entries]}


def test_empty_record_does_not_fabricate_image_content():
    result = assemble_prompts({})
    assert result["noobai"]["positive"] == ""
    assert result["anima"]["positive"] == ""
    assert result["noobai"]["source"] == "none"
    assert any(w.startswith("no_prompt_evidence:") for w in result["warnings"])


def test_union_intersection_and_thresholds_reuse_unfiltered_scores():
    record = {"modelTags": {
        "wd": tagged(("tree", "general", .50), ("moon", "general", .40), ("alice", "character", .80), ("low score", "general", .01)),
        "pixai": tagged(("tree", "general", .46), ("moon", "general", .20), ("alice", "character", .86)),
    }}
    before = copy.deepcopy(record)
    prompt = assemble_prompts(record, {"captionStyle": "tags"})
    assert {t["name"] for t in prompt["tags"] if t["selected"]} == {"tree", "moon", "alice"}
    training = assemble_prompts(record, {"mode": "train", "trigger": "myStyle", "trainingKind": "style"})
    assert {t["name"] for t in training["tags"] if t["selected"]} == {"tree"}
    moon = next(t for t in training["tags"] if t["name"] == "moon")
    assert moon["probabilities"] == {"wd": .40, "pixai": .20}
    assert training["modelTags"] == before["modelTags"]
    assert record == before


def test_explicit_blank_and_per_target_edits_win_without_rewriting():
    record = {"metadata": {"positive": "old prompt", "negative": "bad", "parameters": {"seed": 123}},
              "userEdits": {"positive": "", "negative": "", "anima": {"positive": " Keep MY prompt, (chibi:2) "}}}
    result = assemble_prompts(record)
    assert result["noobai"]["positive"] == result["noobai"]["negative"] == ""
    assert result["anima"]["positive"] == " Keep MY prompt, (chibi:2) "
    assert result["anima"]["negative"] == ""
    assert result["anima"]["source"] == "user"
    assert result["originalMetadata"] == record["metadata"]


def test_order_artist_copyright_parentheses_and_weighted_expression():
    rules = load_rules()
    rules["characterCopyright"] = {"alice": "example world"}
    record = {"modelTags": {"wd": tagged(("flower", "general", .9), ("Jane_Doe", "artist", .9),
              ("example world", "copyright", .9), ("alice", "character", .9), ("1girl", "general", .9),
              ("general", "rating", .9), ("sensitive", "rating", .4))}, "metadata": {"positive": "(chibi:2)"}}
    result = assemble_prompts(record, rules=rules)
    noob = result["noobai"]["positive"]
    assert noob.startswith("masterpiece, best quality, newest, absurdres, highres, general, 1girl, alice \\(example world\\), example world, Jane_Doe")
    assert "(chibi:2)" in noob
    assert "sensitive" not in noob
    anima = result["anima"]["positive"]
    assert anima.startswith("masterpiece, best quality, newest, general, 1girl, alice, example world, @jane doe")
    assert "score_9" not in anima
    assert result["anima"]["negative"] == "signature, artist name"


def test_plain_metadata_artist_is_not_guessed():
    result = assemble_prompts({"metadata": {"positive": "FooArtist, tree"}})
    assert "@fooartist" not in result["anima"]["positive"]
    assert next(t for t in result["tags"] if t["name"] == "FooArtist")["category"] == "general"


def test_exact_original_has_metadata_source_and_derivative_is_labelled():
    record = {"metadata": {"positive": "masterpiece, best quality, newest, absurdres, highres, tree", "negative": "blur", "model": "owner model", "loras": ["owner LoRA"], "format": "a1111", "source": "metadata"}}
    result = assemble_prompts(record)
    assert result["noobai"]["positive"] == record["metadata"]["positive"]
    assert result["noobai"]["source"] == "metadata"
    assert result["noobai"]["negativeSource"] == "metadata"
    assert result["anima"]["source"] == "derived-metadata"
    assert result["originalMetadata"] == record["metadata"]


def test_training_corrects_removes_and_preserves_style_artist():
    rules = load_rules()
    rules["fixedFeatures"] = ["white wings"]
    record = {"metadata": {"positive": "masterpiece, white wings, cross, blue dress"},
              "modelTags": {"wd": tagged(("alice", "character", .9), ("artist x", "artist", .9))}}
    options = {"mode": "train", "trigger": "charToken", "outfitTrigger": "outfitToken", "corrections": {"cross": "star (symbol)"}, "removeTags": ["blue dress"], "sourceTag": "3d"}
    char = assemble_prompts(record, options, rules)
    assert char["noobai"]["positive"] == "charToken, outfitToken, star \\(symbol\\), 3d"
    assert "masterpiece" not in char["anima"]["positive"]
    # Explicitly categorized metadata artist, using editable rules, survives style training.
    rules["categories"]["artist x"] = "artist"
    record["metadata"]["positive"] += ", artist x"
    style = assemble_prompts(record, {**options, "trainingKind": "style"}, rules)
    assert "@artist x" in style["anima"]["positive"]
    assert "white wings" in style["anima"]["positive"]


def test_natural_caption_conflicts_are_reported_not_claimed_safe():
    record = {"caption": "Alice wears a blue dress with white wings.", "metadata": {"positive": "white wings"}}
    result = assemble_prompts(record, {"mode": "train", "trigger": "charToken", "removeTags": ["white wings"], "captionStyle": "natural"})
    assert "white wings" in result["anima"]["positive"]
    assert any(w.startswith("training_caption_requires_review:") for w in result["warnings"])
    assert any(w.startswith("caption_insufficient_sentences:") for w in result["warnings"])


def test_parameters_are_original_and_recommendations_are_separate():
    record = {"width": 1200, "height": 800, "metadata": {"positive": "tree", "parameters": {"steps": 12, "seed": 55}}}
    result = assemble_prompts(record)
    assert result["noobai"]["parameters"] == {"steps": 12, "seed": 55}
    assert result["noobai"]["recommendations"]["width"] == 1216
    assert result["noobai"]["recommendations"]["height"] == 832
    assert result["noobai"]["recommendations"]["sampler"] == "Euler a"
    assert result["anima"]["recommendations"]["scheduler"] == "simple"


def test_summary_counts_images_once_and_shared_prefix():
    records = [{"metadata": {"positive": "tree, moon"}}, {"metadata": {"positive": "tree, sun"}}]
    summary = summarize_records(records)
    tree = next(t for t in summary["tagFrequencies"] if t["name"] == "tree")
    assert tree["count"] == 2 and tree["frequency"] == 1
    assert summary["sharedTags"] == ["tree"]
    assert summary["sharedPrefix"]["anima"].endswith("tree")
    assert summarize_records([])["sharedPrefix"] == {"noobai": "", "anima": ""}


@pytest.mark.parametrize("options", [{"generalThreshold": float("nan")}, {"characterThreshold": 1.2}, {"mode": "bogus"}, {"removeTags": "tree"}, {"corrections": []}])
def test_invalid_options_fail_actionably(options):
    with pytest.raises(ValueError):
        assemble_prompts({}, options)


def test_invalid_custom_rules_rejected(tmp_path):
    path = tmp_path / "rules.json"
    path.write_text(json.dumps({"categories": {"tree": "imaginary"}}), encoding="utf-8")
    with pytest.raises(ValueError, match="Unknown tag category"):
        load_rules(path)


def test_readiness_never_claims_unconfigured_models_work(monkeypatch):
    monkeypatch.setattr("backend.gallery_inference._package_available", lambda _: False)
    result = get_capabilities()
    assert result["available"] is False
    assert result["runtimeVerified"] is False
    assert result["cpuFallback"] is False
    assert result["adapters"]["wd_onnx"]["ready"] is False
    assert result["adapters"]["pixai"]["implemented"] is False
    assert result["adapters"]["captioner"]["implemented"] is False
    assert "wdModelPath" in " ".join(result["adapters"]["wd_onnx"]["blockers"])
