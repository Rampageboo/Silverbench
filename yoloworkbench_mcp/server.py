from __future__ import annotations

from typing import Any, Literal

from mcp.server.fastmcp import FastMCP, Image
from mcp.types import ToolAnnotations

from .annotation import AnnotationTools, ImageFilter
from .bridge import YoloWorkBenchBridge
from .gallery import GalleryTools


SERVER_INSTRUCTIONS = (
    "Silverbench: a local workbench for YOLO datasets and an image gallery. "
    "The app must be running. Workspaces are folders the user opened in the app (or configured roots).\n"
    "Labeling: call list_classes, then list_images (e.g. filter='unlabeled'), view_image to look at a picture "
    "(existing boxes are drawn as '#index classId:name'), then set_boxes / set_class. Boxes are normalized 0..1: "
    "either corners {x1,y1,x2,y2} or YOLO centre {x,y,w,h}, each with a 'class' (name, key or YOLO id). "
    "After set_boxes, call view_image again to check the drawn boxes and correct them. Add classes with add_classes "
    "only when the user agrees. Labels are proposals the user reviews: never mark images reviewed unless asked. "
    "export_dataset rebuilds exports/dataset from the labels.\n"
    "Gallery: gallery_search, gallery_view_image, then gallery_describe to write a caption and tags "
    "(tags are added to the user's own tags by default).\n"
    "Inference starts asynchronously: keep the jobId and poll get_inference_job. No tool deletes images or files."
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
    server = FastMCP("RampageWorkbench", instructions=SERVER_INSTRUCTIONS)

    @server.tool(annotations=_read_only("Backend health"))
    def backend_health() -> dict[str, Any]:
        """Check whether the localhost RampageWorkbench FastAPI backend is ready."""
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

    labels = AnnotationTools(tools)
    gallery = GalleryTools(tools.backend)

    # -- Labeling --------------------------------------------------------------

    @server.tool(annotations=_read_only("List classes"))
    def list_classes(workspace_root: str) -> dict[str, Any]:
        """Detection classes (YOLO id = position) and classification classes of a workspace."""
        return labels.list_classes(workspace_root)

    @server.tool(annotations=_stateful("Add classes", idempotent=True))
    def add_classes(workspace_root: str, task: Literal["detect", "classify"], names: list[str]) -> dict[str, Any]:
        """Add detection or classification classes to classes.json (existing names are reused, never duplicated)."""
        return labels.add_classes(workspace_root, task, names)

    @server.tool(annotations=_read_only("List images"))
    def list_images(workspace_root: str, filter: ImageFilter = "all", offset: int = 0, limit: int = 50) -> dict[str, Any]:
        """List media images with box count, class, split, reviewed and junk state.

        filter: all | unlabeled (no boxes and no class) | no_boxes | no_class | detect | classify | junk."""
        return labels.list_images(workspace_root, filter, offset, limit)

    @server.tool(annotations=_read_only("View image"), structured_output=False)
    def view_image(workspace_root: str, filename: str, max_edge: int = 1280, show_boxes: bool = True) -> list[Any]:
        """Show a media image (downscaled) with its current boxes drawn as '#index classId:name', plus its labels."""
        jpeg, details = labels.view_image(workspace_root, filename, max_edge, show_boxes)
        return [Image(data=jpeg, format="jpeg"), details]

    @server.tool(annotations=_read_only("Get labels"))
    def get_labels(workspace_root: str, filename: str) -> dict[str, Any]:
        """Boxes (normalized YOLO centre form), classification class, split and reviewed state of one image."""
        return labels.get_labels(workspace_root, filename)

    @server.tool(annotations=_stateful("Set boxes"))
    def set_boxes(
        workspace_root: str,
        filename: str,
        boxes: list[dict[str, Any]],
        mode: Literal["replace", "append"] = "replace",
        mark_reviewed: bool = False,
    ) -> dict[str, Any]:
        """Write detection boxes for an image and enable it for detection.

        Each box: {"class": name|key|yolo id, "x1","y1","x2","y2"} or {"class", "x","y","w","h"}, all normalized 0..1.
        mode=replace overwrites the image's boxes; append keeps existing ones. An empty list in replace mode
        records the image as having no objects (a negative sample)."""
        return labels.set_boxes(workspace_root, filename, boxes, mode, mark_reviewed)

    @server.tool(annotations=_stateful("Set class", idempotent=True))
    def set_class(workspace_root: str, filenames: list[str], class_name: str) -> dict[str, Any]:
        """Assign a classification class (name or key) to one or more images."""
        return labels.set_class(workspace_root, filenames, class_name)

    @server.tool(annotations=_stateful("Mark junk", idempotent=True))
    def mark_junk(workspace_root: str, filenames: list[str], scope: Literal["both", "detect", "classify"] = "both") -> dict[str, Any]:
        """Mark images as junk so they are left out of detection and/or classification exports (nothing is deleted)."""
        return labels.mark_junk(workspace_root, filenames, scope)

    @server.tool(annotations=_stateful("Set image status", idempotent=True))
    def set_image_status(
        workspace_root: str,
        filename: str,
        split: Literal["train", "val"] | None = None,
        reviewed: bool | None = None,
        flagged: bool | None = None,
        next_train: bool | None = None,
    ) -> dict[str, Any]:
        """Change an image's split, reviewed, flagged or next-training flags."""
        return labels.set_image_status(workspace_root, filename, split, reviewed, flagged, next_train)

    @server.tool(annotations=_stateful("Export dataset", idempotent=True))
    def export_dataset(workspace_root: str) -> dict[str, Any]:
        """Rebuild the YOLO dataset in <workspace>/exports/dataset from the current labels (images and video frames)."""
        return labels.export_dataset(workspace_root)

    # -- Gallery -----------------------------------------------------------------

    @server.tool(annotations=_read_only("Search gallery"))
    def gallery_search(
        query: str = "",
        collection: str | None = None,
        min_rating: int = 0,
        offset: int = 0,
        limit: int = 30,
    ) -> dict[str, Any]:
        """Search gallery images by text (filename, prompt, tags), collection and minimum rating."""
        return gallery.search(query, collection, min_rating, offset, limit)

    @server.tool(annotations=_read_only("View gallery image"), structured_output=False)
    def gallery_view_image(asset_id: str, max_edge: int = 1280) -> list[Any]:
        """Show a gallery image (downscaled) with its caption, tags, notes and generation prompt if any."""
        jpeg, details = gallery.view(asset_id, max_edge)
        return [Image(data=jpeg, format="jpeg"), details]

    @server.tool(annotations=_stateful("Describe gallery image", idempotent=True))
    def gallery_describe(
        asset_id: str,
        caption: str | None = None,
        tags: list[str] | None = None,
        tags_mode: Literal["replace", "add", "remove"] = "add",
        notes: str | None = None,
        rating: int | None = None,
        collection: str | None = None,
    ) -> dict[str, Any]:
        """Write a caption and/or tags (plus optional notes, 0-5 rating, collection) for a gallery image."""
        return gallery.describe(asset_id, caption, tags, tags_mode, notes, rating, collection)

    # -- Inference jobs ----------------------------------------------------------

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
