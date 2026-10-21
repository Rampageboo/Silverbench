# Decisions

These decisions summarize reviewed Codex chats as of 2026-10-03. Historical decisions are labeled in their consequences; verify current code before treating them as runtime acceptance.

## Keep runtime Sessions/cache out of Git.

- **Decision:** Keep runtime Sessions/cache out of Git.
- **Reason:** Thousands of generated cache files had been tracked.
- **Consequences:** Ignore and remove them from the index; historical cleanup is separate.

## Serialize workspace session updates.

- **Decision:** Serialize workspace session updates.
- **Reason:** Multiple read/merge/write paths could overwrite shortcut values.
- **Consequences:** Queue writes and load Pool Label data before updating.

## Back up source images before any edit that writes them back.

- **Decision:** Back up source images before any edit that writes them back.
- **Reason:** Protection previously covered only some modes.
- **Consequences:** Apply the same guard to black-frame and crop operations; prior damage cannot be inferred back.

## Treat Tauri as the current default entrypoint and mark the old PySide6 run.bat as superseded.

- **Decision:** Treat Tauri as the current default entrypoint and mark the old PySide6 run.bat as superseded.
- **Reason:** The product migrated beyond the earlier launch path.
- **Consequences:** Keep old startup notes historical.
