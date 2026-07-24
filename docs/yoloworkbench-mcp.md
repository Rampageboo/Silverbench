# YoloWorkBench MCP

YoloWorkBench exposes a project-scoped stdio MCP server for Codex. The MCP
process is only an adapter: it calls the existing localhost FastAPI backend at
`http://127.0.0.1:8765` and does not duplicate dataset or inference logic.

## Setup

1. Run `run.bat` once. This creates `.venv` and installs `requirements.txt`.
2. Keep YoloWorkBench running while using its MCP tools.
3. Trust this repository in Codex so `.codex/config.toml` is loaded.
4. Restart Codex after the first dependency installation.

The launcher allows only the repository root and its descendants by default.
Set `YWB_MCP_ALLOWED_ROOTS` to a semicolon-separated list before launching
Codex only when additional local workspace roots are intentionally required.
`YWB_BACKEND_URL` accepts loopback HTTP origins only.

## Tools

Read-only tools:

- `backend_health`
- `torch_runtime_info`
- `inspect_workspace`
- `list_workspace_files`
- `list_workspace_videos`
- `list_dataset_files`
- `get_workspace_classes`
- `list_classification_classes`
- `read_metadata_rows`
- `get_image_pool_backup_stats`
- `find_image_pool_duplicates`
- `inspect_pt_model`
- `get_inference_job`

State-changing tools:

- `start_image_inference`
- `start_folder_inference`
- `cancel_inference_job`

Inference starts asynchronously. Save the returned `jobId`, poll
`get_inference_job`, and cancel only when needed. Folder inference creates new
output files under the workspace. No delete, overwrite, training, export, or
model-promotion tool is exposed.
