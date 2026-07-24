from __future__ import annotations

import json
import os
import socket
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


DEFAULT_BACKEND_URL = "http://127.0.0.1:8765"
DEFAULT_TIMEOUT_SECONDS = 60.0
MAX_RESPONSE_BYTES = 32 * 1024 * 1024

InferenceKind = Literal["detect", "classify"]
DatasetKind = Literal["detect", "classify"]


class BackendError(RuntimeError):
    """Raised when the local YoloWorkBench backend rejects a request."""


class BackendUnavailableError(BackendError):
    """Raised when the local YoloWorkBench backend cannot be reached."""


def _validated_backend_url(raw_url: str) -> str:
    value = str(raw_url or DEFAULT_BACKEND_URL).strip().rstrip("/")
    parsed = urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("YWB_BACKEND_URL must use http://localhost or an IP loopback address.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in {"", "/"}:
        raise ValueError("YWB_BACKEND_URL must contain only the local backend origin.")
    return value


class BackendClient:
    """Small JSON client for the existing localhost FastAPI backend."""

    def __init__(self, base_url: str = DEFAULT_BACKEND_URL, timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS) -> None:
        self.base_url = _validated_backend_url(base_url)
        self.timeout_seconds = max(0.1, float(timeout_seconds))

    def health(self) -> dict[str, Any]:
        payload = self._request("GET", "/health")
        if not isinstance(payload, dict):
            raise BackendError("YoloWorkBench /health returned an invalid response.")
        return payload

    def call(self, method: str, args: list[Any]) -> Any:
        payload = self._request(
            "POST",
            "/api/call",
            {"method": str(method), "args": args},
        )
        if not isinstance(payload, dict):
            raise BackendError(f"YoloWorkBench method {method} returned an invalid response.")
        if not payload.get("ok"):
            message = str(payload.get("error") or payload.get("detail") or "Unknown backend error.")
            raise BackendError(f"YoloWorkBench method {method} failed: {message}")
        return payload.get("result")

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = None
        headers = {"Accept": "application/json"}
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except HTTPError as error:
            raw = error.read(MAX_RESPONSE_BYTES + 1)
            message = _response_error_message(raw) or str(error.reason)
            raise BackendError(f"YoloWorkBench HTTP {error.code}: {message}") from error
        except (URLError, TimeoutError, socket.timeout, ConnectionError, OSError) as error:
            raise BackendUnavailableError(
                f"YoloWorkBench backend is not reachable at {self.base_url}. "
                "Start YoloWorkBench with run.bat, then retry."
            ) from error

        if len(raw) > MAX_RESPONSE_BYTES:
            raise BackendError(f"YoloWorkBench response exceeded {MAX_RESPONSE_BYTES // (1024 * 1024)} MB.")
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise BackendError("YoloWorkBench returned malformed JSON.") from error


def _response_error_message(raw: bytes) -> str:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return raw.decode("utf-8", errors="replace")[:1000].strip()
    if not isinstance(payload, dict):
        return str(payload)[:1000]
    return str(payload.get("error") or payload.get("detail") or "")[:1000]


class PathPolicy:
    """Restrict every MCP filesystem argument to configured local roots."""

    def __init__(self, allowed_roots: list[Path] | tuple[Path, ...], base_dir: Path | None = None) -> None:
        if not allowed_roots:
            raise ValueError("At least one MCP allowed root is required.")
        self.base_dir = (base_dir or allowed_roots[0]).expanduser().resolve()
        self.allowed_roots = tuple(self._resolve_raw(path) for path in allowed_roots)

    @classmethod
    def from_environment(cls, project_root: Path) -> "PathPolicy":
        raw = os.environ.get("YWB_MCP_ALLOWED_ROOTS", "").strip()
        entries = [entry.strip() for entry in raw.split(os.pathsep) if entry.strip()]
        roots = [Path(entry) for entry in entries] if entries else [project_root]
        return cls(roots, base_dir=project_root)

    def require(
        self,
        value: Path | str,
        *,
        label: str = "path",
        kind: Literal["any", "file", "directory"] = "any",
        must_exist: bool = True,
    ) -> Path:
        resolved = self._resolve_raw(value)
        if not any(self._is_within(resolved, root) for root in self.allowed_roots):
            allowed = ", ".join(str(root) for root in self.allowed_roots)
            raise PermissionError(f"{label} is outside the MCP allowed roots ({allowed}): {resolved}")
        if must_exist and not resolved.exists():
            raise FileNotFoundError(f"{label} does not exist: {resolved}")
        if kind == "file" and resolved.exists() and not resolved.is_file():
            raise ValueError(f"{label} must be a file: {resolved}")
        if kind == "directory" and resolved.exists() and not resolved.is_dir():
            raise ValueError(f"{label} must be a directory: {resolved}")
        return resolved

    def child(
        self,
        root: Path,
        value: Path | str,
        *,
        label: str,
        kind: Literal["any", "file", "directory"] = "any",
        must_exist: bool = True,
    ) -> Path:
        raw = Path(str(value).strip()).expanduser()
        candidate = raw if raw.is_absolute() else root / raw
        resolved = self.require(candidate, label=label, kind=kind, must_exist=must_exist)
        if not self._is_within(resolved, root):
            raise PermissionError(f"{label} escapes workspace root {root}: {resolved}")
        return resolved

    def _resolve_raw(self, value: Path | str) -> Path:
        raw = Path(str(value).strip()).expanduser()
        if not raw.is_absolute():
            raw = self.base_dir / raw
        return raw.resolve(strict=False)

    @staticmethod
    def _is_within(path: Path, root: Path) -> bool:
        try:
            path.relative_to(root)
            return True
        except ValueError:
            if os.name != "nt":
                return False
            path_text = os.path.normcase(str(path))
            root_text = os.path.normcase(str(root)).rstrip("\\/")
            return path_text == root_text or path_text.startswith(root_text + os.sep)


class YoloWorkBenchBridge:
    """Maps MCP business tools onto the existing FastAPI service methods."""

    def __init__(self, backend: BackendClient, paths: PathPolicy) -> None:
        self.backend = backend
        self.paths = paths

    @classmethod
    def from_environment(cls) -> "YoloWorkBenchBridge":
        project_root = Path(__file__).resolve().parents[1]
        backend_url = os.environ.get("YWB_BACKEND_URL", DEFAULT_BACKEND_URL)
        timeout = float(os.environ.get("YWB_MCP_BACKEND_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
        return cls(BackendClient(backend_url, timeout), PathPolicy.from_environment(project_root))

    def backend_health(self) -> dict[str, Any]:
        return self.backend.health()

    def torch_runtime_info(self) -> dict[str, Any]:
        return _dict_result(self.backend.call("torchRuntimeInfo", []), "torchRuntimeInfo")

    def inspect_workspace(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(self.backend.call("getWorkspaceInfo", [str(root)]), "getWorkspaceInfo")

    def list_workspace_files(self, workspace_root: str) -> list[str]:
        root = self._workspace_ready(workspace_root)
        return _string_list(self.backend.call("listWorkspaceFiles", [str(root)]), "listWorkspaceFiles")

    def list_workspace_videos(self, workspace_root: str) -> list[dict[str, Any]]:
        root = self._workspace_ready(workspace_root)
        result = self.backend.call("listWorkspaceVideos", [str(root)])
        if not isinstance(result, list) or not all(isinstance(item, dict) for item in result):
            raise BackendError("YoloWorkBench method listWorkspaceVideos returned an invalid list.")
        return result

    def list_dataset_files(self, workspace_root: str, dataset: DatasetKind = "detect") -> list[str]:
        kind = _inference_kind(dataset)
        info = self.inspect_workspace(workspace_root)
        key = "detectDataset" if kind == "detect" else "clfDataset"
        dataset_root = self.paths.require(
            str(info.get(key) or ""),
            label=f"{kind} dataset",
            kind="directory",
        )
        return _string_list(self.backend.call("listDatasetFiles", [str(dataset_root)]), "listDatasetFiles")

    def get_workspace_classes(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(self.backend.call("getWorkspaceClasses", [str(root)]), "getWorkspaceClasses")

    def list_classification_classes(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(
            self.backend.call("listClfDatasetClasses", [str(root)]),
            "listClfDatasetClasses",
        )

    def read_metadata_rows(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(self.backend.call("readMetadataRows", [str(root)]), "readMetadataRows")

    def get_image_pool_backup_stats(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(
            self.backend.call("getImagePoolBackupStats", [str(root)]),
            "getImagePoolBackupStats",
        )

    def find_image_pool_duplicates(self, workspace_root: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        return _dict_result(
            self.backend.call("findImagePoolDuplicates", [str(root)]),
            "findImagePoolDuplicates",
        )

    def inspect_pt_model(self, workspace_root: str, model_path: str) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        model = self.paths.child(root, model_path, label="model_path", kind="file")
        if model.suffix.lower() != ".pt":
            raise ValueError("model_path must point to a .pt file.")
        relative = model.relative_to(root).as_posix()
        return _dict_result(self.backend.call("ptModelInfo", [str(root), relative]), "ptModelInfo")

    def start_image_inference(
        self,
        workspace_root: str,
        kind: InferenceKind,
        model_path: str,
        image_path: str,
        image_size: int = 0,
        confidence: float = 0.25,
        device: str = "0",
        top_k: int = 5,
    ) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        inference_kind = _inference_kind(kind)
        model = self.paths.child(root, model_path, label="model_path", kind="file")
        image = self.paths.child(root, image_path, label="image_path", kind="file")
        if model.suffix.lower() != ".pt":
            raise ValueError("model_path must point to a .pt file.")
        _validate_device(device)
        model_relative = model.relative_to(root).as_posix()
        image_relative = image.relative_to(root).as_posix()
        if inference_kind == "detect":
            args = [
                str(root),
                model_relative,
                image_relative,
                _positive_int(image_size, 640, "image_size"),
                _probability(confidence, "confidence"),
                str(device),
            ]
            method = "startDetectImageWithPt"
        else:
            args = [
                str(root),
                model_relative,
                image_relative,
                max(0, int(image_size)),
                str(device),
                _bounded_int(top_k, 1, 50, "top_k"),
            ]
            method = "startClassifyImageWithPt"
        return _dict_result(self.backend.call(method, args), method)

    def start_folder_inference(
        self,
        workspace_root: str,
        kind: InferenceKind,
        model_path: str,
        source_dir: str,
        output_dir: str,
        image_size: int = 0,
        confidence: float = 0.25,
        device: str = "0",
        include_filenames: list[str] | None = None,
        confidence_prefix: bool = True,
    ) -> dict[str, Any]:
        root = self._workspace_ready(workspace_root)
        inference_kind = _inference_kind(kind)
        model = self.paths.child(root, model_path, label="model_path", kind="file")
        source = self.paths.child(root, source_dir, label="source_dir", kind="directory")
        output = self.paths.child(root, output_dir, label="output_dir", must_exist=False)
        if model.suffix.lower() != ".pt":
            raise ValueError("model_path must point to a .pt file.")
        _validate_device(device)
        filenames = _filenames(include_filenames)
        if inference_kind == "detect":
            args = [
                str(model),
                str(source),
                str(output),
                _positive_int(image_size, 640, "image_size"),
                _probability(confidence, "confidence"),
                str(device),
                json.dumps(filenames, ensure_ascii=False),
            ]
            method = "startDetectFolderWithPt"
        else:
            args = [
                str(model),
                str(source),
                str(output),
                _positive_int(image_size, 224, "image_size"),
                str(device),
                bool(confidence_prefix),
                json.dumps(filenames, ensure_ascii=False),
            ]
            method = "startClassifyFolderWithPt"
        return _dict_result(self.backend.call(method, args), method)

    def get_inference_job(self, job_id: str) -> dict[str, Any]:
        identifier = _job_id(job_id)
        return _dict_result(self.backend.call("getPtJob", [identifier]), "getPtJob")

    def cancel_inference_job(self, job_id: str) -> dict[str, Any]:
        identifier = _job_id(job_id)
        return _dict_result(self.backend.call("cancelPtJob", [identifier]), "cancelPtJob")

    def _workspace_ready(self, workspace_root: str) -> Path:
        root = self.paths.require(
            workspace_root,
            label="workspace_root",
            kind="directory",
        )
        result = self.backend.call("openFolder", [str(root), False])
        if isinstance(result, dict) and not result.get("ok", True):
            raise BackendError(str(result.get("error") or "YoloWorkBench could not open the workspace."))
        return root


def _dict_result(result: Any, method: str) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise BackendError(f"YoloWorkBench method {method} returned an invalid object.")
    if result.get("ok") is False:
        raise BackendError(str(result.get("error") or f"YoloWorkBench method {method} failed."))
    return result


def _string_list(result: Any, method: str) -> list[str]:
    if not isinstance(result, list) or not all(isinstance(item, str) for item in result):
        raise BackendError(f"YoloWorkBench method {method} returned an invalid list.")
    return result


def _inference_kind(value: str) -> InferenceKind:
    normalized = str(value).strip().lower()
    if normalized not in {"detect", "classify"}:
        raise ValueError("kind must be 'detect' or 'classify'.")
    return normalized  # type: ignore[return-value]


def _probability(value: float, label: str) -> float:
    parsed = float(value)
    if not 0.0 <= parsed <= 1.0:
        raise ValueError(f"{label} must be between 0 and 1.")
    return parsed


def _positive_int(value: int, default: int, label: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        parsed = int(default)
    if parsed > 8192:
        raise ValueError(f"{label} must not exceed 8192.")
    return parsed


def _bounded_int(value: int, minimum: int, maximum: int, label: str) -> int:
    parsed = int(value)
    if not minimum <= parsed <= maximum:
        raise ValueError(f"{label} must be between {minimum} and {maximum}.")
    return parsed


def _validate_device(value: str) -> None:
    device = str(value).strip()
    if not device or len(device) > 32:
        raise ValueError("device must be a short PyTorch device string such as '0' or 'cpu'.")


def _filenames(values: list[str] | None) -> list[str]:
    result: list[str] = []
    for raw in values or []:
        value = str(raw).strip()
        if not value or Path(value).name != value:
            raise ValueError("include_filenames entries must be plain file names.")
        result.append(value)
    return result


def _job_id(value: str) -> str:
    identifier = str(value).strip()
    if not identifier or len(identifier) > 128:
        raise ValueError("job_id must be a non-empty identifier of at most 128 characters.")
    return identifier
