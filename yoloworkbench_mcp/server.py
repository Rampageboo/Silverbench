from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from .bridge import YoloWorkBenchBridge


SERVER_INSTRUCTIONS = (
    "YoloWorkBench tools operate only on configured local workspace roots. "
    "Start YoloWorkBench before calling backend tools. Inspect workspace and model state before inference. "
    "Inference starts asynchronously: retain the returned jobId, poll get_inference_job, and cancel only when requested. "
    "Never treat output paths as disposable; this server exposes no delete, overwrite, training, export, or model-promotion tool."
)


def _read_only(title: str) -> ToolAnnotations:
    return ToolAnnotations(title=title, readOnlyHint=True, openWorldHint=False)


def _stateful(title: str, *, idempotent: bool = False) -> ToolAnnotations:
    return ToolAnnotations(
        title=title,
        readOnlyHint=False,
        destructiveHint=False,
        idempotentHint=idempotent,
        openWorldHint=False,
    )


def create_server(bridge: YoloWorkBenchBridge | None = None) -> FastMCP:
    tools = bridge or YoloWorkBenchBridge.from_environment()
    server = FastMCP("YoloWorkBench", instructions=SERVER_INSTRUCTIONS)

    @server.tool(annotations=_read_only("Backend health"))
    def backend_health() -> dict[str, Any]:
        """Check whether the localhost YoloWorkBench FastAPI backend is ready."""
        return tools.backend_health()

    @server.tool(annotations=_read_only("Torch and CUDA runtime"))
    def torch_runtime_info() -> dict[str, Any]:
        """Report the backend Python, PyTorch, CUDA availability, and GPU device."""
        return tools.torch_runtime_info()

    @server.tool(annotations=_read_only("Inspect workspace"))
    def inspect_workspace(workspace_root: str) -> dict[str, Any]:
        """Return canonical paths and image/label counts for an existing workspace."""
        return tools.inspect_workspace(workspace_root)

    @server.tool(annotations=_read_only("List workspace files"))
    def list_workspace_files(workspace_root: str) -> list[str]:
        """List browsable image and annotation paths relative to an existing workspace."""
        return tools.list_workspace_files(workspace_root)

    @server.tool(annotations=_read_only("List workspace videos"))
    def list_workspace_videos(workspace_root: str) -> list[dict[str, Any]]:
        """List imported videos that belong to an existing workspace."""
        return tools.list_workspace_videos(workspace_root)

    @server.tool(annotations=_read_only("List dataset files"))
    def list_dataset_files(
        workspace_root: str,
        dataset: Literal["detect", "classify"] = "detect",
    ) -> list[str]:
        """List files in the workspace detection or classification dataset."""
        return tools.list_dataset_files(workspace_root, dataset)

    @server.tool(annotations=_read_only("Get workspace classes"))
    def get_workspace_classes(workspace_root: str) -> dict[str, Any]:
        """Return the workspace class taxonomy."""
        return tools.get_workspace_classes(workspace_root)

    @server.tool(annotations=_read_only("List classification classes"))
    def list_classification_classes(workspace_root: str) -> dict[str, Any]:
        """List class folders currently present in the classification dataset."""
        return tools.list_classification_classes(workspace_root)

    @server.tool(annotations=_read_only("Read metadata rows"))
    def read_metadata_rows(workspace_root: str) -> dict[str, Any]:
        """Read workspace metadata assignments and their known class sets."""
        return tools.read_metadata_rows(workspace_root)

    @server.tool(annotations=_read_only("Image-pool backup stats"))
    def get_image_pool_backup_stats(workspace_root: str) -> dict[str, Any]:
        """Return image-pool backup coverage without creating or restoring backups."""
        return tools.get_image_pool_backup_stats(workspace_root)

    @server.tool(annotations=_read_only("Find image-pool duplicates"))
    def find_image_pool_duplicates(workspace_root: str) -> dict[str, Any]:
        """Scan and report duplicate image-pool entries without deleting anything."""
        return tools.find_image_pool_duplicates(workspace_root)

    @server.tool(annotations=_read_only("Inspect PT model"))
    def inspect_pt_model(workspace_root: str, model_path: str) -> dict[str, Any]:
        """Inspect a workspace-relative safe .pt model and return task/classes."""
        return tools.inspect_pt_model(workspace_root, model_path)

    @server.tool(annotations=_stateful("Start image inference"))
    def start_image_inference(
        workspace_root: str,
        kind: Literal["detect", "classify"],
        model_path: str,
        image_path: str,
        image_size: int = 0,
        confidence: float = 0.25,
        device: str = "0",
        top_k: int = 5,
    ) -> dict[str, Any]:
        """Start asynchronous detection or classification for one workspace image."""
        return tools.start_image_inference(
            workspace_root,
            kind,
            model_path,
            image_path,
            image_size,
            confidence,
            device,
            top_k,
        )

    @server.tool(annotations=_stateful("Start folder inference"))
    def start_folder_inference(
        workspace_root: str,
        kind: Literal["detect", "classify"],
        model_path: str,
        source_dir: str,
        output_dir: str,
        image_size: int = 0,
        confidence: float = 0.25,
        device: str = "0",
        include_filenames: list[str] | None = None,
        confidence_prefix: bool = True,
    ) -> dict[str, Any]:
        """Start asynchronous inference over a workspace folder and write new outputs."""
        return tools.start_folder_inference(
            workspace_root,
            kind,
            model_path,
            source_dir,
            output_dir,
            image_size,
            confidence,
            device,
            include_filenames,
            confidence_prefix,
        )

    @server.tool(annotations=_read_only("Get inference job"))
    def get_inference_job(job_id: str) -> dict[str, Any]:
        """Get progress, errors, and result for an inference job."""
        return tools.get_inference_job(job_id)

    @server.tool(annotations=_stateful("Cancel inference job", idempotent=True))
    def cancel_inference_job(job_id: str) -> dict[str, Any]:
        """Request cancellation of a running inference job."""
        return tools.cancel_inference_job(job_id)

    return server


mcp = create_server()


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
