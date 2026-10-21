# RampageWorkbench MCP

RampageWorkbench exposes a stdio MCP server so Codex or Claude can help with
YOLO labeling and with describing gallery images. The MCP process is only an
adapter: it calls the running app's localhost FastAPI backend at
`http://127.0.0.1:8765`, so the app and an agent share one set of files and
locks. The app must be running while tools are used.

## Setup (once per computer)

1. Clone the repository to `D:\Projects\RampageWorkbench` and run `run.bat`
   once (creates `.venv` with the `mcp` package).
2. Register the server at user level, so it is available in every project:

   **Claude Code**

   ```bash
   claude mcp add -s user rampageworkbench -- C:\Windows\System32\cmd.exe /d /c D:\Projects\RampageWorkbench\scripts\run-yoloworkbench-mcp.cmd
   ```

   **Codex** — add to `~/.codex/config.toml`:

   ```toml
   [mcp_servers.rampageworkbench]
   command = 'C:\Windows\System32\cmd.exe'
   args = ["/d", "/c", 'D:\Projects\RampageWorkbench\scripts\run-yoloworkbench-mcp.cmd']
   startup_timeout_sec = 60
   tool_timeout_sec = 1800
   required = false
   default_tools_approval_mode = "writes"
   ```

3. Restart Codex / start a new Claude session.

Workspaces the user has opened in the app (its recent list in app data) are
allowed automatically; `YWB_MCP_ALLOWED_ROOTS` (semicolon-separated) adds more.
`YWB_BACKEND_URL` accepts loopback HTTP origins only.

## Tools

Labeling (v3 workspaces):

- `list_classes`, `list_images` (filters: all, unlabeled, no_boxes, no_class,
  detect, classify, junk), `get_labels`
- `view_image` — the image with its current boxes drawn, so an agent can check
  its own work
- `set_boxes` (corner `{x1,y1,x2,y2}` or YOLO centre `{x,y,w,h}`, normalized,
  class by name, key or id), `set_class`, `mark_junk`, `set_image_status`,
  `add_classes`, `export_dataset`

Agent edits are proposals: they are never marked reviewed unless asked.

Gallery:

- `gallery_search`, `gallery_view_image`, `gallery_describe` (caption, tags,
  notes, rating, collection)

Workspace and inference:

- `backend_health`, `torch_runtime_info`, `inspect_workspace`,
  `list_workspace_files`, `list_workspace_videos`, `list_dataset_files`,
  `get_image_pool_backup_stats`, `find_image_pool_duplicates`,
  `inspect_pt_model`
- `start_image_inference`, `start_folder_inference`, `get_inference_job`,
  `cancel_inference_job` — inference starts asynchronously; keep the `jobId`
  and poll.

No tool deletes images or files.
