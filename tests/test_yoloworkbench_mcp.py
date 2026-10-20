from __future__ import annotations

import json
import os
import tempfile
import threading
import tomllib
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from yoloworkbench_mcp.bridge import (
    BackendClient,
    BackendError,
    BackendUnavailableError,
    PathPolicy,
    YoloWorkBenchBridge,
)

ROOT = Path(__file__).resolve().parents[1]


class FakeBackend:
    def __init__(self) -> None:
        self.calls: list[tuple[str, list[Any]]] = []
        self.results: dict[str, Any] = {}

    def health(self) -> dict[str, Any]:
        return {"ok": True, "apiSchemaVersion": 22}

    def call(self, method: str, args: list[Any]) -> Any:
        self.calls.append((method, args))
        if method == "openFolder":
            return {"ok": True, "kind": "workspace", "root": args[0]}
        if method in self.results:
            return self.results[method]
        if method.startswith("start"):
            return {"jobId": "job-1", "status": "running"}
        if method == "getPtJob":
            return {"jobId": args[0], "status": "running"}
        if method == "cancelPtJob":
            return {"jobId": args[0], "status": "cancelling"}
        return {"ok": True}


class PathPolicyTests(unittest.TestCase):
    def test_rejects_paths_outside_allowed_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            allowed = Path(tmp) / "allowed"
            outside = Path(tmp) / "outside"
            allowed.mkdir()
            outside.mkdir()
            policy = PathPolicy([allowed])

            self.assertEqual(policy.require(allowed, kind="directory"), allowed.resolve())
            with self.assertRaises(PermissionError):
                policy.require(outside, kind="directory")

    def test_child_rejects_workspace_escape(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            allowed = Path(tmp) / "allowed"
            workspace = allowed / "workspace"
            allowed.mkdir()
            workspace.mkdir()
            policy = PathPolicy([allowed])

            with self.assertRaises(PermissionError):
                policy.child(workspace.resolve(), "..\\sibling", label="path", must_exist=False)


class BridgeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name).resolve()
        (self.root / "workspace").mkdir()
        (self.root / "workspace" / "models").mkdir()
        (self.root / "workspace" / "media").mkdir()
        (self.root / "workspace" / "output").mkdir()
        (self.root / "workspace" / "models" / "model.pt").write_bytes(b"pt")
        (self.root / "workspace" / "media" / "image.jpg").write_bytes(b"jpg")
        self.backend = FakeBackend()
        self.bridge = YoloWorkBenchBridge(self.backend, PathPolicy([self.root]))
        self.workspace = self.root / "workspace"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_inspect_workspace_opens_without_initializing(self) -> None:
        self.backend.results["getWorkspaceInfo"] = {"ok": True, "imageCount": 3}

        result = self.bridge.inspect_workspace(str(self.workspace))

        self.assertEqual(result["imageCount"], 3)
        self.assertEqual(self.backend.calls[0], ("openFolder", [str(self.workspace)]))
        self.assertEqual(self.backend.calls[1], ("getWorkspaceInfo", [str(self.workspace)]))

    def test_start_detection_image_uses_relative_children(self) -> None:
        result = self.bridge.start_image_inference(
            str(self.workspace),
            "detect",
            "models/model.pt",
            "media/image.jpg",
            image_size=640,
            confidence=0.4,
            device="cpu",
        )

        self.assertEqual(result["jobId"], "job-1")
        method, args = self.backend.calls[-1]
        self.assertEqual(method, "startDetectImageWithPt")
        self.assertEqual(args[:3], [str(self.workspace), "models/model.pt", "media/image.jpg"])
        self.assertEqual(args[3:], [640, 0.4, "cpu"])

    def test_start_classification_folder_maps_existing_service_contract(self) -> None:
        result = self.bridge.start_folder_inference(
            str(self.workspace),
            "classify",
            "models/model.pt",
            "media",
            "new-output",
            include_filenames=["image.jpg"],
        )

        self.assertEqual(result["status"], "running")
        method, args = self.backend.calls[-1]
        self.assertEqual(method, "startClassifyFolderWithPt")
        self.assertEqual(args[0], str(self.workspace / "models" / "model.pt"))
        self.assertEqual(args[1], str(self.workspace / "media"))
        self.assertEqual(args[2], str(self.workspace / "new-output"))
        self.assertEqual(args[3:6], [224, "0", True])
        self.assertEqual(json.loads(args[6]), ["image.jpg"])

    def test_rejects_unsafe_inference_paths_before_backend_start(self) -> None:
        outside = self.root / "outside.pt"
        outside.write_bytes(b"pt")

        with self.assertRaises(PermissionError):
            self.bridge.start_image_inference(
                str(self.workspace),
                "detect",
                str(outside),
                "media/image.jpg",
            )

        self.assertFalse(any(method.startswith("start") for method, _ in self.backend.calls))

    def test_job_methods_do_not_accept_empty_ids(self) -> None:
        with self.assertRaises(ValueError):
            self.bridge.get_inference_job(" ")
        with self.assertRaises(ValueError):
            self.bridge.cancel_inference_job("")


class _ApiHandler(BaseHTTPRequestHandler):
    response_payload: dict[str, Any] = {}
    response_status = 200
    received: dict[str, Any] | None = None

    def do_GET(self) -> None:  # noqa: N802
        self._send()

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        type(self).received = json.loads(self.rfile.read(length).decode("utf-8"))
        self._send()

    def _send(self) -> None:
        payload = json.dumps(type(self).response_payload).encode("utf-8")
        self.send_response(type(self).response_status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format: str, *args: Any) -> None:
        return


class BackendClientTests(unittest.TestCase):
    def setUp(self) -> None:
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _ApiHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        host, port = self.server.server_address
        self.client = BackendClient(f"http://{host}:{port}", timeout_seconds=1)

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        _ApiHandler.response_payload = {}
        _ApiHandler.response_status = 200
        _ApiHandler.received = None

    def test_call_unwraps_result_and_posts_expected_envelope(self) -> None:
        _ApiHandler.response_payload = {"ok": True, "method": "ping", "result": "ready"}

        self.assertEqual(self.client.call("ping", []), "ready")
        self.assertEqual(_ApiHandler.received, {"method": "ping", "args": []})

    def test_call_surfaces_backend_error(self) -> None:
        _ApiHandler.response_payload = {"ok": False, "error": "bad method"}

        with self.assertRaisesRegex(BackendError, "bad method"):
            self.client.call("broken", [])

    def test_rejects_non_loopback_backend_url(self) -> None:
        with self.assertRaises(ValueError):
            BackendClient("https://example.com")

    def test_unavailable_backend_has_actionable_error(self) -> None:
        unavailable = BackendClient("http://127.0.0.1:1", timeout_seconds=0.1)

        with self.assertRaisesRegex(BackendUnavailableError, "run.bat"):
            unavailable.health()


class McpStdioContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_stdio_initializes_with_expected_tools_and_annotations(self) -> None:
        params = StdioServerParameters(
            command="cmd.exe",
            args=["/d", "/c", str(ROOT / "scripts" / "run-yoloworkbench-mcp.cmd")],
            cwd=str(ROOT),
        )

        async with stdio_client(params) as (read_stream, write_stream):
            async with ClientSession(read_stream, write_stream) as session:
                await session.initialize()
                response = await session.list_tools()

        tools = {tool.name: tool for tool in response.tools}
        self.assertEqual(len(tools), 26)
        self.assertEqual(
            set(tools),
            {
                "backend_health",
                "torch_runtime_info",
                "inspect_workspace",
                "list_workspace_files",
                "list_workspace_videos",
                "list_dataset_files",
                "list_classes",
                "add_classes",
                "list_images",
                "view_image",
                "get_labels",
                "set_boxes",
                "set_class",
                "mark_junk",
                "set_image_status",
                "export_dataset",
                "gallery_search",
                "gallery_view_image",
                "gallery_describe",
                "get_image_pool_backup_stats",
                "find_image_pool_duplicates",
                "inspect_pt_model",
                "start_image_inference",
                "start_folder_inference",
                "get_inference_job",
                "cancel_inference_job",
            },
        )
        stateful = {
            "start_image_inference",
            "start_folder_inference",
            "cancel_inference_job",
            "add_classes",
            "set_boxes",
            "set_class",
            "mark_junk",
            "set_image_status",
            "export_dataset",
            "gallery_describe",
        }
        for name, tool in tools.items():
            self.assertEqual(tool.annotations.readOnlyHint, name not in stateful, name)
            self.assertFalse(tool.annotations.openWorldHint, name)
        self.assertFalse(tools["start_image_inference"].annotations.readOnlyHint)
        self.assertFalse(tools["start_image_inference"].annotations.destructiveHint)
        self.assertTrue(tools["cancel_inference_job"].annotations.idempotentHint)

    async def test_stdio_tool_call_reaches_local_backend(self) -> None:
        _ApiHandler.response_payload = {
            "ok": True,
            "app": "yoloworkbench",
            "apiSchemaVersion": 22,
        }
        backend = ThreadingHTTPServer(("127.0.0.1", 0), _ApiHandler)
        thread = threading.Thread(target=backend.serve_forever, daemon=True)
        thread.start()
        host, port = backend.server_address
        env = dict(os.environ)
        env["YWB_BACKEND_URL"] = f"http://{host}:{port}"
        env["YWB_MCP_ALLOWED_ROOTS"] = str(ROOT)
        params = StdioServerParameters(
            command="cmd.exe",
            args=["/d", "/c", str(ROOT / "scripts" / "run-yoloworkbench-mcp.cmd")],
            cwd=str(ROOT),
            env=env,
        )

        try:
            async with stdio_client(params) as (read_stream, write_stream):
                async with ClientSession(read_stream, write_stream) as session:
                    await session.initialize()
                    result = await session.call_tool("backend_health", {})
        finally:
            backend.shutdown()
            backend.server_close()
            thread.join(timeout=2)
            _ApiHandler.response_payload = {}

        self.assertFalse(result.isError)
        self.assertEqual(result.structuredContent["app"], "yoloworkbench")
        self.assertEqual(result.structuredContent["apiSchemaVersion"], 22)


class ProjectConfigTests(unittest.TestCase):
    def test_project_config_targets_existing_launcher_from_codex_directory(self) -> None:
        with (ROOT / ".codex" / "config.toml").open("rb") as handle:
            config = tomllib.load(handle)

        server = config["mcp_servers"]["yoloworkbench"]
        configured_cwd = (ROOT / ".codex" / server["cwd"]).resolve()
        launcher = configured_cwd / server["args"][-1]
        self.assertEqual(configured_cwd, ROOT)
        self.assertTrue(launcher.is_file())
        self.assertEqual(server["default_tools_approval_mode"], "writes")


if __name__ == "__main__":
    unittest.main()
