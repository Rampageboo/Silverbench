# YoloWorkBench Desktop 打包与分发

本文档描述当前 **Tauri 桌面壳 + 外部 Python FastAPI 后端** 的架构，以及后续 sidecar / PyInstaller 的接入点。

## 当前架构

```
┌─────────────────────┐     HTTP      ┌──────────────────────────┐
│  Tauri (React dist) │ ────────────► │  uvicorn backend_api     │
│  apps/desktop       │  127.0.0.1    │  仓库根目录 backend_api/ │
└─────────────────────┘               └──────────────────────────┘
         ▲                                         ▲
         │                                         │
   npm run tauri:dev                         Python 3 + requirements.txt
   或 release .exe                          或项目根 .venv
```

- **前端**：`apps/desktop` 构建为 `dist/`，由 Tauri 窗口加载（开发时 Vite `5173`）。
- **后端**：`backend_api.main:app`，默认 `127.0.0.1:8765`（见 `backend.config.json`）。
- **启动**：
  - 开发：`npm run dev:shell` → `scripts/start-backend-and-wait.mjs` 再启 Vite/Tauri。
  - Tauri release：`src-tauri/src/main.rs` 在端口未占用时自动 `spawn` uvicorn。

## 开发机要求

1. **Node.js** 18+（运行 `apps/desktop`）
2. **Rust** toolchain（`cargo tauri build`）
3. **Python 3** + 仓库根 `requirements.txt`（推荐先运行根目录 `run.bat` 创建 `.venv`）

## 分发机要求（当前）

目标机器需要以下之一：

| 方式 | 说明 |
|------|------|
| 项目根 `.venv` | 与开发相同，整仓拷贝或 git clone 后 `run.bat` |
| 系统 Python | 已 `pip install -r requirements.txt`，且 `python`/`py -3` 可用 |
| **预留** bundle `resources/` | 见下文「未来 sidecar 布局」 |

若 Python 不可用，Tauri 启动会失败并提示查看本文档。

## Python 探测顺序（`main.rs`）

1. 可执行文件旁 `resources/.venv/`（Windows: `Scripts/python.exe`）
2. 可执行文件旁 `resources/python/python.exe`（预留独立 Python 目录）
3. 项目根 `.venv/`
4. Windows：`py -3`，再 `python`
5. Unix：`python3`，再 `python`

## 端口配置

编辑 [`backend.config.json`](backend.config.json)：

```json
{ "host": "127.0.0.1", "port": 8765 }
```

环境变量 **`YWB_BACKEND_PORT`** 优先于 JSON（前端 Vite 构建、Node 启动脚本、Rust 均读取）。

## 未来 sidecar / PyInstaller 接入点

| 位置 | 用途 |
|------|------|
| `src-tauri/tauri.conf.json` → `bundle.resources` | 将 `resources/python` 或 sidecar 可执行文件打进安装包 |
| `src-tauri/src/main.rs` → `bundled_resource_roots()` | 已预留 `resources/` 探测 |
| 仓库根 `backend_api/` | 可改为只读资源目录或 frozen 包内的模块路径 |

**非目标（当前阶段）**：完整 PyInstaller 单文件后端、自动 `pip install` GUI。完整 EO-8 可在上述接入点落地 sidecar 后再做。

## 相关命令

```bash
cd apps/desktop
npm run tauri:dev    # 开发（自动等 backend）
npm run build        # 仅前端
npm run tauri build  # 桌面安装包（仍需 Python 后端）
```
