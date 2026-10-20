"""Pure prompt conversion. Reading a record never edits metadata or reruns inference.

Model scores are accepted as ``{model: {tags: [{name, category, probability}]}}``.
All scores survive in ``modelTags`` and ``tags[].probabilities``; selection for
rendering is separate. Categories must come from a model or an explicit rule.
"""
from __future__ import annotations

import copy
import json
import math
import re
from collections import Counter
from pathlib import Path

DEFAULT_RULES_PATH = Path(__file__).resolve().parent.parent / "config" / "gallery_rules.json"
_CATEGORIES = {"quality", "rating", "count", "character", "copyright", "artist", "general"}
_CATEGORY_IDS = {0: "general", 1: "artist", 3: "copyright", 4: "character", 9: "rating"}


def _key(value):
    return re.sub(r"\s+", " ", str(value).replace("_", " ").strip()).lower()


def _strings(value, field):
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise ValueError(f"{field} must be a list of strings")
    return value


def _validate_rules(rules):
    if not isinstance(rules, dict):
        raise ValueError("rules must be a JSON object")
    for field in ("aliases", "corrections", "categories", "characterCopyright"):
        value = rules.get(field, {})
        if not isinstance(value, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in value.items()):
            raise ValueError(f"rules.{field} must map strings to strings")
    for category in rules.get("categories", {}).values():
        if category not in _CATEGORIES:
            raise ValueError(f"Unknown tag category: {category}")
    for field in ("fixedFeatures", "outfitFeatures", "removeTags", "categoryOrder"):
        _strings(rules.get(field, []), f"rules.{field}")
    if "categoryOrder" in rules and (len(rules["categoryOrder"]) != len(_CATEGORIES) or set(rules["categoryOrder"]) != _CATEGORIES):
        raise ValueError("rules.categoryOrder must contain each supported category once")
    for field in ("quality", "negative"):
        value = rules.get(field, {})
        if not isinstance(value, dict):
            raise ValueError(f"rules.{field} must be an object")
        for target, tags in value.items():
            if target not in ("noobai", "anima"):
                raise ValueError(f"Unsupported prompt target: {target}")
            _strings(tags, f"rules.{field}.{target}")
    thresholds = rules.get("thresholds", {})
    if not isinstance(thresholds, dict):
        raise ValueError("rules.thresholds must be an object")
    for mode, values in thresholds.items():
        if mode not in ("prompt", "train") or not isinstance(values, dict):
            raise ValueError("rules.thresholds must contain prompt/train objects")
        for category, value in values.items():
            if category not in ("general", "character"):
                raise ValueError("Threshold category must be general or character")
            _probability(value, "threshold")
    resolutions = rules.get("sdxlResolutions", [])
    if not isinstance(resolutions, list):
        raise ValueError("rules.sdxlResolutions must be a list")
    for pair in resolutions:
        if not isinstance(pair, list) or len(pair) != 2 or any(type(x) is not int or x < 64 or x > 16384 for x in pair):
            raise ValueError("SDXL resolutions must be positive integer width/height pairs")
    recommendations = rules.get("recommendations", {})
    if not isinstance(recommendations, dict) or any(not isinstance(v, dict) for v in recommendations.values()):
        raise ValueError("rules.recommendations must contain objects")
    return rules


def load_rules(path=None):
    """Read editable JSON. Invalid rules fail explicitly rather than silently reset."""
    target = Path(path) if path is not None else DEFAULT_RULES_PATH
    with target.open("r", encoding="utf-8-sig") as stream:
        value = json.load(stream)
    return _validate_rules(value)


def _probability(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 1:
        raise ValueError(f"{field} must be a finite number between 0 and 1")
    return float(value)


def _options(options, rules):
    if options is not None and not isinstance(options, dict):
        raise ValueError("options must be an object")
    result = dict(options or {})
    for field, default, choices in (("mode", "prompt", ("prompt", "train")), ("captionStyle", "mixed", ("mixed", "tags", "natural")), ("trainingKind", "character", ("character", "style"))):
        result.setdefault(field, default)
        if result[field] not in choices:
            raise ValueError(f"Invalid {field}: {result[field]}")
    for field in ("trigger", "outfitTrigger", "sourceTag"):
        result.setdefault(field, "")
        if not isinstance(result[field], str):
            raise ValueError(f"{field} must be a string")
    _strings(result.get("removeTags", []), "removeTags")
    corrections = result.get("corrections", {})
    if not isinstance(corrections, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in corrections.items()):
        raise ValueError("corrections must map strings to strings")
    defaults = {"prompt": {"general": .30, "character": .75}, "train": {"general": .45, "character": .85}}
    for category in ("general", "character"):
        field = category + "Threshold"
        result.setdefault(field, rules.get("thresholds", {}).get(result["mode"], {}).get(category, defaults[result["mode"]][category]))
        result[field] = _probability(result[field], field)
    return result


def _split_tags(text):
    """Split only top-level commas so weighted groups retain their exact syntax."""
    tokens, start, depth, escaped = [], 0, 0, False
    for index, char in enumerate(text):
        if escaped:
            escaped = False
        elif char == "\\":
            escaped = True
        elif char in "([<":
            depth += 1
        elif char in ")]>":
            depth = max(0, depth - 1)
        elif char == "," and not depth:
            tokens.append(text[start:index].strip())
            start = index + 1
    tokens.append(text[start:].strip())
    return [x for x in tokens if x]


def _category(name, explicit, rules):
    if explicit is not None:
        category = _CATEGORY_IDS.get(explicit, explicit)
        if category not in _CATEGORIES:
            raise ValueError(f"Unknown tag category: {explicit}")
        if category != "general":
            return category
    category = {_key(k): v for k, v in rules.get("categories", {}).items()}.get(_key(name))
    if category:
        return category
    if re.fullmatch(r"(?:\d+|multiple)\s*(?:girls?|boys?|others?|people|girls? and boys?)|solo", _key(name)):
        return "count"
    return "general"


def _model_entries(payload):
    if isinstance(payload, dict) and "tags" in payload:
        payload = payload["tags"]
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        # Also accept simple probability maps, or category -> probability maps.
        entries = []
        for name, value in payload.items():
            if isinstance(value, (int, float)):
                entries.append({"name": name, "probability": value})
            elif name in _CATEGORIES and isinstance(value, dict):
                entries.extend({"name": tag, "category": name, "probability": score} for tag, score in value.items())
            elif isinstance(value, dict) and "probability" in value:
                entries.append({**value, "name": value.get("name", name)})
        return entries
    raise ValueError("modelTags model payload must be a tag list or object")


def _collect(record, options, rules, warnings):
    metadata = record.get("metadata", {})
    if metadata is None:
        metadata = {}
    if not isinstance(metadata, dict):
        raise ValueError("record.metadata must be an object")
    if "parameters" in metadata and not isinstance(metadata["parameters"], dict):
        raise ValueError("metadata.parameters must be an object")
    positive = metadata.get("positive", "")
    if not isinstance(positive, str):
        raise ValueError("metadata.positive must be a string")
    # A plain metadata prompt is an exact original, not evidence of semantic tag categories.
    entries, index = [], {}
    rename = {_key(k): v for k, v in {**rules.get("aliases", {}), **rules.get("corrections", {}), **options.get("corrections", {})}.items()}

    def add(name, category=None, model=None, probability=None, metadata_tag=False):
        if not isinstance(name, str) or not name.strip():
            raise ValueError("Tag names must be nonempty strings")
        name = rename.get(_key(name), name.strip())
        if not name.strip():  # Explicit correction to empty removes a tag.
            return
        key = _key(name)
        cat = _category(name, category, rules)
        if key not in index:
            index[key] = len(entries)
            entries.append({"name": name, "category": cat, "probability": None, "source": "metadata" if metadata_tag else "model", "probabilities": {}, "categorySources": {}, "metadata": metadata_tag,
                            "categorySource": "explicit" if category is not None else "rules" if cat != "general" else "unspecified"})
        entry = entries[index[key]]
        if metadata_tag:
            entry["metadata"] = True
        if model is not None:
            entry["probabilities"][model] = max(probability, entry["probabilities"].get(model, 0))
            entry["categorySources"][model] = _CATEGORY_IDS.get(category, category) if category is not None else "unspecified"
            entry["probability"] = max(entry["probabilities"].values())
            entry["source"] = "metadata+model" if entry["metadata"] else "model"
        if cat != "general" and entry["category"] == "general":
            entry["category"] = cat
        elif cat != entry["category"] and cat != "general":
            warnings.append(f"category_conflict: {name}: {entry['category']} / {cat}; preserving per-model categories")

    for token in _split_tags(positive):
        add(token, metadata_tag=True)
    model_tags = record.get("modelTags", {})
    if model_tags is None:
        model_tags = {}
    if not isinstance(model_tags, dict):
        raise ValueError("record.modelTags must be an object")
    model_names = []
    for model, payload in model_tags.items():
        values = _model_entries(payload)
        if not values:
            continue
        model_names.append(model)
        seen = set()
        for tag in values:
            if not isinstance(tag, dict):
                raise ValueError("Model tags must be objects with name/category/probability")
            name = tag.get("name", tag.get("tag"))
            if not isinstance(name, str):
                raise ValueError("Model tag name must be a string")
            if _key(name) in seen:
                raise ValueError(f"Duplicate tag in model {model}: {name}")
            seen.add(_key(name))
            score = _probability(tag.get("probability", tag.get("score")), f"{model}/{name} probability")
            add(name, tag.get("category"), str(model), score)
    if options["mode"] == "train" and model_names and len(model_names) < 2:
        warnings.append("training_intersection_requires_two_models: only one tagger has results")
    removed = {_key(x) for x in rules.get("removeTags", []) + options.get("removeTags", [])}
    if options["mode"] == "train":
        if options["trainingKind"] == "character":
            removed.update(_key(x) for x in rules.get("fixedFeatures", []))
        if options["outfitTrigger"]:
            removed.update(_key(x) for x in rules.get("outfitFeatures", []))
        if not options["trigger"].strip():
            warnings.append("training_trigger_missing: supply a trigger for the selected LoRA")
        if positive:
            warnings.append("training_metadata_categories_require_review: original prompt tokens have no guaranteed semantic categories; unclassified artist/identity prose cannot be safely removed automatically")
    for entry in entries:
        threshold = options["characterThreshold"] if entry["category"] == "character" else options["generalThreshold"]
        scores = entry["probabilities"]
        inferred = any(v >= threshold for v in scores.values())
        if options["mode"] == "train":
            inferred = len(model_names) >= 2 and all(scores.get(str(model), -1) >= threshold for model in model_names)
        selected = entry["metadata"] or inferred
        if _key(entry["name"]) in removed:
            selected = False
        if options["mode"] == "train":
            if entry["category"] == "quality":
                selected = False
            if options["trainingKind"] == "character" and entry["category"] in ("character", "artist"):
                selected = False
        entry["selected"] = bool(selected)
    inferred_ratings = [entry for entry in entries if entry["category"] == "rating" and entry["selected"] and not entry["metadata"]]
    if inferred_ratings:
        best = max(inferred_ratings, key=lambda entry: entry["probability"])
        for entry in inferred_ratings:
            entry["selected"] = entry is best
    return entries, metadata


def _format_tag(name, category, target, rules):
    # Prompt emphasis and LoRA syntax are expressions, not literal tag punctuation.
    if re.fullmatch(r"\(.+:\s*[-+]?\d+(?:\.\d+)?\)", name) or name.startswith("<"):
        return name
    if category == "character" and target == "noobai":
        copyright = {_key(k): v for k, v in rules.get("characterCopyright", {}).items()}.get(_key(name))
        if copyright and "(" not in name:
            name = f"{name} ({copyright})"
    if target == "noobai":
        return re.sub(r"(?<!\\)([()])", r"\\\1", name)
    name = _key(name)
    return "@" + name.lstrip("@") if category == "artist" else name


def _edited(edits, target, field):
    target_edits = edits.get(target, {})
    if target_edits is not None and not isinstance(target_edits, dict):
        raise ValueError(f"userEdits.{target} must be an object")
    for container in (target_edits or {}, edits):
        if field in container:
            if not isinstance(container[field], str):
                raise ValueError(f"userEdits.{field} must be a string")
            return True, container[field]
    return False, ""


def _caption(record, options, selected, rules, warnings):
    caption = record.get("caption") or ""
    if not isinstance(caption, str):
        raise ValueError("record.caption must be a string")
    caption = caption.strip()
    if not caption or options["captionStyle"] == "tags":
        if options["captionStyle"] == "natural":
            warnings.append("caption_missing: natural description is unavailable; no prose was invented")
        return ""
    sentences = [part.strip() for part in re.split(r"(?<=[.!?])\s+|(?<=[。！？])", caption) if part.strip()]
    if len(sentences) > 3:
        warnings.append("caption_truncated: mixed/natural export is limited to three sentences")
    if options["captionStyle"] == "natural" and len(sentences) < 2:
        warnings.append("caption_insufficient_sentences: natural description requires at least two sentences")
    caption = " ".join(sentences[:3])
    if options["mode"] == "train":
        # Free prose cannot be reliably rewritten by deleting substrings. Flag it.
        warnings.append("training_caption_requires_review: prose may retain character identity, fixed features or repeated tag semantics; not verified safe for training")
    elif options["captionStyle"] == "mixed" and selected:
        warnings.append("mixed_caption_requires_review: tag/description semantic repetition has not been validated")
    return caption


def _recommendations(record, target, rules):
    result = copy.deepcopy(rules.get("recommendations", {}).get(target, {}))
    width, height = record.get("width"), record.get("height")
    ratios = rules.get("sdxlResolutions", [])
    if ratios and type(width) in (int, float) and type(height) in (int, float) and math.isfinite(width) and math.isfinite(height) and width > 0 and height > 0:
        recommended = min(ratios, key=lambda p: abs(math.log((p[0] / p[1]) / (width / height))))
        result["width"], result["height"] = recommended
    return result


def assemble_prompts(record: dict, options: dict | None = None, rules: dict | None = None) -> dict:
    """Render two explicitly derived prompts, retaining exact original and edits.

    Explicit edit fields win, including empty strings. No generic quality token,
    caption, model identity or generation parameter is presented as inferred.
    ``parameters`` are original metadata; ``recommendations`` are suggestions.
    """
    if not isinstance(record, dict):
        raise ValueError("record must be an object")
    rules = load_rules() if rules is None else _validate_rules(copy.deepcopy(rules))
    options = _options(options, rules)
    warnings = []
    tags, metadata = _collect(record, options, rules, warnings)
    edits = record.get("userEdits", {})
    if edits is None:
        edits = {}
    if not isinstance(edits, dict):
        raise ValueError("record.userEdits must be an object")
    selected = [tag for tag in tags if tag["selected"]]
    caption = _caption(record, options, selected, rules, warnings)
    order = rules.get("categoryOrder", ["quality", "rating", "count", "character", "copyright", "artist", "general"])
    selected.sort(key=lambda t: order.index(t["category"]))
    result = {"tags": tags, "warnings": warnings, "modelTags": copy.deepcopy(record.get("modelTags") or {}), "originalMetadata": copy.deepcopy(metadata)}
    for target in ("noobai", "anima"):
        output_tags = list(selected)
        if options["mode"] == "prompt" and output_tags:
            # These are configured prompt additions, not inferred labels.
            allowed_quality = {_key(x) for x in rules.get("quality", {}).get(target, [])}
            output_tags = [t for t in output_tags if t["category"] != "quality" or _key(t["name"]) in allowed_quality]
            quality = [{"name": x, "category": "quality"} for x in rules.get("quality", {}).get(target, [])]
            output_tags = quality + [t for t in output_tags if t["category"] != "quality"]
        parts = [_format_tag(t["name"], t["category"], target, rules) for t in output_tags]
        if options["mode"] == "train":
            parts = [x.strip() for x in (options["trigger"], options["outfitTrigger"]) if x.strip()] + parts
            if options["sourceTag"].strip():
                parts.append(options["sourceTag"].strip())
        positive = ", ".join(dict.fromkeys(parts))
        if target == "anima" and caption:
            if options["captionStyle"] == "natural":
                artists = [_format_tag(t["name"], "artist", target, rules) for t in output_tags if t["category"] == "artist"]
                prefix = [x.strip() for x in (options["trigger"], options["outfitTrigger"]) if options["mode"] == "train" and x.strip()]
                if options["mode"] == "train" and options["sourceTag"].strip():
                    prefix.append(options["sourceTag"].strip())
                positive = " ".join([", ".join(prefix + artists), caption]).strip()
            else:
                positive = " ".join([positive, caption]).strip()
        positive_edit, edited_positive = _edited(edits, target, "positive")
        if positive_edit:
            positive = edited_positive
            if options["mode"] == "train":
                warnings.append(f"training_user_prompt_requires_review: {target} uses the exact explicit edit; training removals were not applied to that text")
        negative = metadata.get("negative", "")
        if not isinstance(negative, str):
            raise ValueError("metadata.negative must be a string")
        negative_parts = _split_tags(negative)
        for token in rules.get("negative", {}).get(target, []):
            if _key(token) not in {_key(x) for x in negative_parts}:
                negative_parts.append(token)
        negative = ", ".join(negative_parts)
        negative_edit, edited_negative = _edited(edits, target, "negative")
        if negative_edit:
            negative = edited_negative
        has_model = any(t["probabilities"] and t["selected"] for t in tags)
        source = "user" if positive_edit else "derived-metadata" if metadata.get("positive") else "derived-model" if has_model else "caption" if caption and target == "anima" else "none"
        if not positive_edit and positive and positive == metadata.get("positive"):
            source = "metadata"
        if options["mode"] == "train" and not selected and any(options[field].strip() for field in ("trigger", "outfitTrigger", "sourceTag")) and not positive_edit:
            source = "user-options"
        negative_source = "user" if negative_edit else "metadata" if negative and negative == metadata.get("negative") else "derived-metadata" if metadata.get("negative") else "rules" if negative else "none"
        result[target] = {"positive": positive, "negative": negative, "parameters": copy.deepcopy(metadata.get("parameters") or {}), "source": source, "negativeSource": negative_source, "recommendations": _recommendations(record, target, rules)}
    if not metadata.get("positive") and not any(t["probabilities"] for t in tags) and not caption and not any(_edited(edits, t, "positive")[0] for t in ("noobai", "anima")):
        warnings.append("no_prompt_evidence: no original positive prompt, tagger scores, user prompt or caption; image content was not inferred")
    return result


def summarize_records(records, options=None, rules=None):
    """Aggregate stored selections only; no model execution or metadata mutation."""
    if not isinstance(records, (list, tuple)):
        raise ValueError("records must be a list")
    rules = load_rules() if rules is None else _validate_rules(copy.deepcopy(rules))
    frequencies, names, rendered, warnings = Counter(), {}, [], []
    for record in records:
        output = assemble_prompts(record, options, rules)
        keys = set()
        for tag in output["tags"]:
            if tag["selected"]:
                key = (_key(tag["name"]), tag["category"])
                names[key] = tag["name"]
                keys.add(key)
        frequencies.update(keys)
        rendered.append({target: _split_tags(output[target]["positive"]) for target in ("noobai", "anima")})
        warnings.extend(output["warnings"])
    prefixes = {}
    for target in ("noobai", "anima"):
        prefix = list(rendered[0][target]) if rendered else []
        for output in rendered[1:]:
            prefix = prefix[:next((i for i, pair in enumerate(zip(prefix, output[target])) if pair[0] != pair[1]), min(len(prefix), len(output[target])))]
        prefixes[target] = ", ".join(prefix)
    count = len(records)
    return {"count": count, "tagFrequencies": [{"name": names[key], "category": key[1], "count": frequency, "frequency": frequency / count if count else 0} for key, frequency in sorted(frequencies.items(), key=lambda x: (-x[1], x[0]))], "sharedTags": [names[key] for key, frequency in sorted(frequencies.items()) if frequency == count], "sharedPrefix": prefixes, "warnings": list(dict.fromkeys(warnings))}
