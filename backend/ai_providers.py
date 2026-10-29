"""Small, bounded model API adapters. No workspace writes or tool execution."""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener


class ProviderError(RuntimeError):
    """A sanitized error; provider bodies may contain images or credentials."""

    def __init__(self, message: str, *, http_status: int | None = None, code: str = ""):
        super().__init__(message)
        self.http_status = http_status
        self.code = code


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def post_json(url: str, body: dict, headers: dict) -> dict:
    request = Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    try:
        with build_opener(_NoRedirect()).open(request, timeout=45) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ProviderError("Provider response exceeded the size limit.")
        result = json.loads(raw)
        if not isinstance(result, dict):
            raise ValueError
        return result
    except HTTPError as error:
        code = ""
        try:
            error_data = json.loads(error.read(65536)).get("error", {})
            candidate = str(error_data.get("code") or error_data.get("type") or "")
            if re.fullmatch(r"[A-Za-z0-9_.-]{1,100}", candidate):
                code = candidate
        except (ValueError, AttributeError):
            pass
        raise ProviderError(f"Provider returned HTTP {error.code}; request was not retried.",
                            http_status=error.code, code=code) from None
    except (URLError, TimeoutError, OSError):
        raise ProviderError("Provider request failed; billing is unknown. Request was not retried.") from None
    except (ValueError, UnicodeError):
        raise ProviderError("Provider returned invalid JSON.") from None


REVIEW_SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "objects": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"class_id": {"type": "integer"},
                           "box": {"type": "array", "items": {"type": "number"}, "minItems": 4, "maxItems": 4},
                           "evidence": {"type": "string"}},
            "required": ["class_id", "box", "evidence"]}},
        "uncertainty": {"type": "string"},
    },
    "required": ["objects", "uncertainty"],
}


def request_body(provider: str, model: str, image: str, prompt: str, *, detail: str,
                 max_output_tokens: int, questions: list[dict] | None = None,
                 schema: dict | None = None) -> tuple[str, dict]:
    schema = schema or REVIEW_SCHEMA
    if provider == "openai_decisions":
        wire_questions = []
        for question in questions or []:
            entry = dict(question)
            if entry["type"] == "choice":
                entry["choices"] = [{"value": value, "description": value} for value in entry["choices"]]
            elif entry["type"] == "score":
                entry["levels"] = [{"label": value, "description": value} for value in entry["levels"]]
            wire_questions.append(entry)
        return "https://api.openai.com/v1/decisions", {
            "model": model,
            "input": [{"role": "user", "content": [
                {"type": "input_image", "image_url": image, "detail": detail}, {"type": "input_text", "text": prompt}]}],
            "questions": wire_questions,
        }
    if provider == "openai":
        return "https://api.openai.com/v1/responses", {
            "model": model, "store": False, "max_output_tokens": max_output_tokens,
            "input": [{"role": "user", "content": [
                {"type": "input_image", "image_url": image, "detail": detail},
                {"type": "input_text", "text": prompt}]}],
            "text": {"format": {"type": "json_schema", "name": "annotation_review",
                                "strict": True, "schema": schema}},
            **({"reasoning": {"effort": "none"}} if model.startswith("gpt-6") else {}),
        }
    if provider == "claude":
        return "https://api.anthropic.com/v1/messages", {
            "model": model, "max_tokens": max_output_tokens,
            "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg",
                                                 "data": image.split(",", 1)[1]}},
                {"type": "text", "text": prompt + "\nReturn JSON only matching: " + json.dumps(schema)}]}],
        }
    raise ValueError("Unknown AI provider.")


def send(provider: str, key: str, url: str, body: dict) -> dict:
    headers = ({"x-api-key": key, "anthropic-version": "2023-06-01"} if provider == "claude"
               else {"Authorization": "Bearer " + key})
    return post_json(url, body, headers)


def review_output(provider: str, response: dict) -> Any:
    if provider == "claude":
        if response.get("stop_reason") != "end_turn":
            raise ProviderError("Provider output was incomplete or refused.")
        blocks = response.get("content", [])
    else:
        if response.get("status") != "completed":
            raise ProviderError("Provider output was incomplete or refused.")
        blocks = [block for message in response.get("output", [])
                  if message.get("type") == "message" for block in message.get("content", [])]
    texts = [block["text"] for block in blocks if block.get("type") in {"text", "output_text"}]
    try:
        return json.loads("".join(texts))
    except (ValueError, TypeError):
        raise ProviderError("Provider did not return a structured review.") from None
