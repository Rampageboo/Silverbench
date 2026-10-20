# RampageWorkbench 桌面端（React）代码评审与重构指南

> 适用范围：仅 `apps/desktop`（React + Tauri 外壳）。遗留 `legacy/web/` 旧版引擎不在本次重构范围，仅在与 React 交互处提及。
> 本文面向后续执行重构的 agent。每个问题给出：**位置 / 为什么 / 怎么改 / 验收标准**。
> 通用约束：不要新增重型依赖；保持 `tsconfig` 的 `strict`；每次改动后运行 `npm run build`（即 `tsc && vite build`）确保类型与构建通过。

---

## 0. 快速上手

- 入口：`src/main.tsx` → `src/app/App.tsx`。
- 全局状态：`src/app/WorkspaceProvider.tsx`（React Context）。
- 后端通信：`src/api.ts`（唯一网络层）。
- 功能模块：`src/features/<feature>/`，典型为 `useXxx.ts`（逻辑）+ `*.tsx`（视图）+ `session.ts` / `core.ts`。
- 已原生化：所有工具页均为 React 原生实现；`legacy/web/` 仅作为 legacy 启动路径与静态资源保留。
- 构建校验：`npm run build`。开发：`npm run tauri:dev`。

---

## 问题清单（按优先级）

### P1 — `BoxLabelView.tsx` 严重超大（1452 行）｜风险：高

**位置**：`src/features/box-label/BoxLabelView.tsx`

**为什么**：单个组件同时负责 Canvas 渲染、拖拽绘框、缩放放大镜、撤销栈、目标追踪、类别增删改、会话持久化。约 22 个 `useState` + 约 20 个 `useRef`，且存在大量"影子 ref"（如 `boxesRef`/`selectedRef`/`modeRef` 与对应 state 并存）需手动同步，极易状态不一致。

**怎么改**（分步、可独立提交）：
1. 先抽**纯函数/渲染器**：把所有调用 `geometry.ts` 的画布绘制逻辑收敛到 `boxCanvasRenderer.ts`（输入：boxes/viewport/image，输出：在 canvas 上绘制），不持有 React 状态。
2. 抽 `useBoxUndo.ts`：把 `undoRef` + `UndoSnapshot` 类型 + push/pop/apply 逻辑独立。
3. 抽 `useBoxEditing.ts`：负责 boxes 状态、选中、拖拽/缩放交互（合并 state 与对应影子 ref，能用 ref 就不要再开 state，反之亦然）。
4. 抽 `useBoxTracking.ts`：封装 `trackYoloForward` 相关追踪流程。
5. `BoxLabelView.tsx` 最终只保留：JSX 布局 + 事件绑定 + 组合上述 hook。

**验收标准**：
- `BoxLabelView.tsx` ≤ 400 行；不再有"state 与同名 ref 并存且手动赋值同步"的模式（除非确有 RAF 性能需要并加注释说明）。
- 标注交互（拖框、A/D 切换、0-9 分配类别、J 废片、Ctrl+Shift+Z 撤回）行为不变。
- `npm run build` 通过。

---

### P2 — API 层双范式 + 字符串类型 RPC + 重复 JSON 解包｜风险：高

**位置**：`src/api.ts`

**为什么**：一半是类型化 REST（`scanImagePool`/`loadLabels`…），一半是通用 `callBackend("methodName", [posArg, JSON.stringify(arg2)])`。`if (typeof raw === "string") return JSON.parse(raw)` 重复出现十余次；返回值每处单独 `as T`，后端签名变更不会被类型系统捕获。

**怎么改**：
1. 新增集中泛型解包：
   ```ts
   export async function callJson<T>(method: string, args: unknown[] = []): Promise<T> {
     const raw = await callBackend(method, args);
     return (typeof raw === "string" ? JSON.parse(raw) : raw) as T;
   }
   ```
   用 `callJson<T>(...)` 替换所有 `const raw = await callBackend(...); if (typeof raw === "string") ...` 模式。
2. 为 RPC 方法名建联合类型常量（如 `type BackendMethod = "readMetadataRows" | "upsertMetadataRows" | ...`），`callBackend`/`callJson` 的 `method` 参数改用该类型，避免裸字符串拼错。
3. 不要求一次性统一 REST/RPC 两种范式（改动面大），但**新代码统一走 `callJson`**。

**验收标准**：
- `src/api.ts` 中不再出现重复的 `typeof raw === "string"` 解包样板（集中到 `callJson`）。
- 所有 RPC 方法名来自 `BackendMethod` 联合类型。
- `npm run build` 通过，运行时行为不变。

---

### P3 — 模块级可变单例脱离 React 生命周期｜风险：中

**位置**：`src/features/shared/workspaceCache.ts`、`src/features/shared/junkUndo.ts`、`src/components/KeepAlivePanel.tsx`（`mountedPanels`）

**为什么**：缓存 `Map`、撤销栈、已挂载面板集合都是模块级全局变量，不随工作区切换或组件卸载清理。后果：切换工作区后撤销栈跨工作区残留；`mountedPanels` 永不清空；StrictMode 双调用 / 未来多窗口下出现陈旧状态；单测相互污染。

**怎么改**：
1. `junkUndo`：撤销栈已有 `context` key，但需再叠加 `workspaceRoot` 维度（key = `${context}::${workspaceRoot}`），并在工作区切换时清理无关 key；或在 `WorkspaceProvider` 切换工作区时显式清空。
2. `workspaceCache`：保留内存缓存，但提供并调用 `invalidateImagePoolCache/invalidateBoxLabelCache` 在工作区切换时清理；考虑由一个 `WorkspaceCacheContext` 持有 Map，而非模块级全局。
3. `KeepAlivePanel.mountedPanels`：改为由 `WorkbenchBody` 内的 `useRef(new Set())` 持有并通过 props/context 传入，组件树卸载即回收。

**验收标准**：
- 切换工作区后，旧工作区的撤销栈/缓存不再影响新工作区。
- 没有新的模块级 `let`/`const new Map()`/`new Set()` 充当跨实例可变状态（确需保留的要加注释说明作用域与清理时机）。

---

### P4 — React ↔ 旧版 iframe 的 postMessage 协议零散弱类型｜风险：中

**位置**：`src/app/App.tsx`、`src/app/WorkbenchBody.tsx`、`src/components/LegacyWorkbenchHost.tsx`、`src/lib/legacyWorkbench.ts`

**为什么**：`ywb-embed-ready` / `ywb-embed-progress` / `ywb-embed-tab` / `ywb-shell-tab` / `ywb-focus-image` 等消息散落三处，靠 `payload.type === "..."` 字符串判断、`String(payload.tab)` 容错；`inbox/yolo/image-pool` 的标签映射特判在多处重复。协议无类型契约，旧版改动会静默失效。

**怎么改**：
1. 在 `src/lib/legacyBridge.ts`（新建）集中定义：
   - 消息类型联合 `type LegacyMessage = ...`（带 `type` 字面量与 payload 字段）。
   - 收发封装：`postToLegacy(frame, msg)`、`subscribeLegacy(handler): () => void`（内部统一做 `event.origin === LEGACY_WORKBENCH_ORIGIN` 校验）。
   - 标签映射：`mapLegacyTabToShell(tab)`（把 `inbox/yolo/image-pool` 等映射逻辑收敛为一处）。
2. `App.tsx` / `WorkbenchBody.tsx` / `LegacyWorkbenchHost.tsx` 改用上述封装，删除重复的 origin 校验与标签特判。

**验收标准**：
- 三个文件不再各自硬编码消息字符串与 origin 校验；统一来自 `legacyBridge.ts`。
- 标签同步、启动进度、聚焦图片功能行为不变。

---

### P5 — 硬编码端口/地址且多处重复｜风险：中（**建议作为第一步，见末尾**）

**位置**：`src/api.ts`(`API_BASE_URL`)、`src/lib/legacyWorkbench.ts`(`LEGACY_WORKBENCH_ORIGIN`)；另在 `src-tauri/src/main.rs`、`scripts/start-backend-and-wait.mjs` 各自硬编码 `8765`。

**为什么**：同一地址在 4 处独立硬编码，端口被占用或需可配置时要改多处、易漏；前端/Rust/Node 三方对端口与 schema 版本认知可能漂移。

**怎么改**（前端部分先做，最安全）：
1. `legacyWorkbench.ts` 不再写字面量，改为 `import { API_BASE_URL } from "../api"; export const LEGACY_WORKBENCH_ORIGIN = API_BASE_URL;`。
2. （后续）把端口提取为可配置（环境变量 / 单一配置文件），让 `api.ts`、`main.rs`、`start-backend-and-wait.mjs` 共享同一来源。

**验收标准**：
- 前端只有一处定义后端地址；`LEGACY_WORKBENCH_ORIGIN` 引用自 `API_BASE_URL`。
- `npm run build` 通过，行为不变。

---

### P6 — `WorkspaceProvider` 上帝 Context｜风险：中

**位置**：`src/app/WorkspaceProvider.tsx`

**为什么**：暴露 24 个字段，内含 5+ 个相互依赖的 `useEffect`，依赖 `autoScanStarted`/`settingsLoaded`/`prevConnectedRef`/`sessionTabLoaded` 等 ref 做"只跑一次/防重入"门闩，执行顺序隐式耦合；连接态变化时存在重复扫描与潜在竞态（自动扫描与 newCount 扫描打同一接口）。

**怎么改**（渐进，勿一次性重写）：
1. 把"恢复上次工作区 + 恢复会话 + 自动扫描"合并为**一个**明确的初始化 effect（或一个小状态机 `idle → restoring → ready`），消除多个 ref 门闩间的隐式顺序。
2. 把与图片库强相关的字段（`imagePoolNewCount` 等）下沉到 `image-pool` 自身，Context 只保留工作区身份与跨功能必需项。
3. 合并重复的扫描调用路径。

**验收标准**：
- 初始化路径单一可读，不再依赖多个布尔 ref 门闩串联。
- 启动 → 恢复工作区 → 默认进入 image-pool 的行为不变，且无重复扫描（可用 Network 面板确认同一接口不重复触发）。

---

### P7 — 错误静默吞掉 + 阻塞式原生弹窗 + 重复样板｜风险：中

**位置**：全仓大量 `.catch(() => {})`；`err instanceof Error ? err.message : String(err)` 重复数十处；`window.confirm/alert`（如 `useImagePool.ts`、`useBoxLabel.ts`）。

**为什么**：失败被无声忽略难诊断；错误归一化样板重复；原生弹窗阻塞、无法测试、风格不一致。

**怎么改**：
1. 新增 `src/lib/errors.ts`：`export const errMessage = (e: unknown) => e instanceof Error ? e.message : String(e);`，替换所有重复表达式。
2. 真正"可忽略"的 `.catch(() => {})` 保留但加简短注释说明为何可忽略；其余改为上报到统一 error 状态/通知。
3. 逐步用非阻塞的应用内确认/通知组件替换 `window.confirm/alert`（可后置，先不强制）。

**验收标准**：
- 不再有裸 `err instanceof Error ? ... : String(err)` 重复（统一走 `errMessage`）。
- 关键操作失败有可见反馈，不再纯静默。

---

### P8 — 缺少测试 / Lint / 格式化｜风险：中

**位置**：`apps/desktop`（无 `*.test.*`、无 ESLint、无 Prettier 配置）

**为什么**：最复杂的几何/元数据逻辑无测试网；无统一风格与静态检查。

**怎么改**：
1. 引入轻量测试（Vitest，开发依赖即可），优先覆盖纯函数：`features/box-label/geometry.ts`、`features/image-pool/metadata.ts`、各 `session.ts`。
2. 加 ESLint + Prettier 基础配置（沿用 `@typescript-eslint` 推荐集）。
3. 在 `package.json` 加 `test` / `lint` 脚本。

**验收标准**：
- `geometry.ts`、`metadata.ts` 有基础单测且通过。
- `npm run lint` 可运行且无致命错误。

---

### P9 — 元数据布尔表示不一致｜风险：低

**位置**：`src/features/image-pool/metadata.ts`、`src/features/shared/junkUndo.ts`

**为什么**：标志位在 `"1"` / `true` / `1` 间混用，到处 `=== "1" || === true` 或 `truthyFlag()`；`MetadataRow` 类型宽松，转换分散易漏。

**怎么改**：在 `loadMetadataMap` 入口一次性把所有标志归一化为 `boolean`，收紧 `MetadataRow` 中这些字段为 `boolean`，下游删除散落的强转。

**验收标准**：`loadMetadataMap` 之后下游不再做 `=== "1"` 之类判断；废片/复核/标记行为不变。

---

## 附：未证实但需关注（非本次必做）

- **打包/分发**：`src-tauri/src/main.rs` 与 `scripts/start-backend-and-wait.mjs` 均假设目标机存在 `.venv` 或系统 Python，缺依赖时运行时 `pip install`。Tauri 仅打包前端 `dist`，**Python 后端未作为 sidecar 打包**。分发到无 Python 的机器会无法启动。重构前端时勿加深此耦合；如要解决需后端配合（打包 sidecar 或独立安装器），超出前端范围。
- 前端假设 `apiSchemaVersion=3` 且各 `callBackend` 方法与后端签名一致，前端无法单方面验证；改 API 时需与 `backend_api/main.py` 同步确认。

---

## 推荐执行顺序（历史记录）

> 以下顺序用于 2026-06 重构阶段，**P1–P9 主项已全部完成**。后续见「工程优化」。

1. **P5（前端部分）** — 改动最小、零风险，先做：合并后端地址来源。
2. **P2（`callJson`）+ P7（`errMessage`）** — 纯样板收敛，低风险、收益大。
3. **P8（测试脚手架）** — 为后续大改动建立安全网。
4. **P3 / P4** — 收敛全局单例与桥接协议。
5. **P1 / P6** — 最大的结构性拆分，放到有测试网之后再做。

> 每完成一项：跑 `npm run build`；涉及交互的改动用 `npm run tauri:dev` 手动验一遍对应功能。

---

## 已完成（2026-06-15）

**P1–P9 主项均已落地**，无已知阻塞性功能问题。下表为各条目的核心交付；与原文「验收标准」100% 对齐的剩余项见下一节「工程优化」。

| 项 | 状态 | 说明 |
|---|---|---|
| P5 | ✅ | `LEGACY_WORKBENCH_ORIGIN` 改为引用 `API_BASE_URL` |
| P2 | ✅ | 新增 `BackendMethod` + `callJson<T>()`，消除重复 JSON 解包（含 base64/纯文本误解析修复） |
| P7 | ✅ | 新增 `src/lib/errors.ts`（`errMessage`），`src/` 内已无裸 `err instanceof Error` 样板；关键操作走 Toast/Confirm |
| P4 | ✅ | 新增 `src/lib/legacyBridge.ts`，重构 `App.tsx` / `WorkbenchBody.tsx` / `LegacyWorkbenchHost.tsx` |
| P3 | ✅ | `junkUndo` 按工作区隔离 + 切换时清理；`KeepAlivePanel` 改为 `KeepAliveProvider` 作用域；工作区切换时 invalidate 缓存 |
| P6 | ✅ | `WorkspaceProvider` 初始化合并为单次 bootstrap（`idle → bootstrapping → ready`），移除重复 `openWorkspace` / 多个 ref 门闩 |
| P9 | ✅ | `loadMetadataMap` 入口归一化布尔字段；下游移除 `=== "1"` 判断 |
| P1 | ✅ | `BoxLabelView.tsx` 214 行；逻辑拆至 `useBoxLabelEditor` / `useBoxLabelClasses` / `useBoxLabelInteraction`（编排层 + canvas/pointer/keyboard/persistence 四 hook）/ `useBoxUndo` / `useBoxTracking` / `boxCanvasRenderer` |
| P8 | ✅ | Vitest + ESLint + Prettier；纯函数/ mock 单测 **76 项**（含 `labelUtils`、`junkUndo`、`datasetCore`、`workspaceCache`、`backendConfig`） |

### 重构期额外修复（未单独占 P 编号）

| 问题 | 说明 |
|---|---|
| Box Label 类别继承 | 拖框不再每次回到 class 0；`applyCurrentClass` 同步 `classRef`，加载图片时不强制重置类别 |
| Review / Box Label 加载报错 | `callJson` 不再对已是 plain string 的 RPC 结果二次 `JSON.parse` |
| Image Pool 预览灯箱 | 修复 dialog 三列网格与 React DOM 不匹配导致放大图挤左；Prev/Next 移出 stage；方向键切换时 filmstrip 自动滚动 |

---

## 工程优化 EO-1～EO-8（2026-06-15 完成）

> 均在 **`apps/desktop`（React/Tauri）** 内完成；未改 `legacy/web/` 遗留 HTML 引擎。

| 项 | 状态 | 交付摘要 |
|---|---|---|
| EO-5 | ✅ | `npm run lint` **0 error / 0 warning** |
| EO-6 | ✅ | 新增 4 套单测，合计 **76** 用例（≥45） |
| EO-4 | ✅ | `ToastProvider` + `ConfirmProvider`；React 端无 `window.confirm`/`alert` |
| EO-2 | ✅ | `backend.config.json` + `YWB_BACKEND_PORT`；api / Node / Rust 统一读端口 |
| EO-1 | ✅ | `WorkspaceCacheProvider` + `createWorkspaceCacheStore()`，无模块级 Map |
| EO-3 | ✅ | `ImagePoolBadgeProvider`；`WorkspaceContext` **12 字段**（scan/selected 等已移除） |
| EO-7 | ✅ | `useBoxLabelInteraction` 拆为 canvas / pointer / keyboard / persistence |
| EO-8 | ✅（最小） | `main.rs` Python 多路径探测 + `PACKAGING.md` + `bundle.resources` 预留 |

### 关键新增文件

- `components/ToastProvider.tsx`、`ConfirmProvider.tsx`
- `features/shared/WorkspaceCacheProvider.tsx`
- `features/image-pool/ImagePoolBadgeProvider.tsx`
- `backend.config.json`、`src/lib/backendConfig.ts`
- `features/box-label/useBoxLabel{Canvas,Pointer,Keyboard,Persistence}.ts`
- `PACKAGING.md`

### 验收命令

```bash
cd apps/desktop
npm run lint && npm run test && npm run build
npm run tauri:dev   # 交互：image-pool / box-label / review / 切工作区
```

---

## 工程优化（历史说明，已由上表取代）

<details>
<summary>原始 EO 需求描述（归档）</summary>

### EO-1 — P3 缓存 Context 化

**现状**：~~`workspaceCache.ts` 仍为模块级 `Map`~~ → 已 Context 化。

### EO-2 — P5 端口/地址全栈可配置

**现状**：~~Rust/Node 硬编码 8765~~ → 已统一 `backend.config.json`。

### EO-3 — P6 Context 瘦身

**现状**：~~约 24 字段~~ → Context 12 字段 + `ImagePoolBadgeProvider`。

### EO-4 — P7 错误反馈与确认 UI

**现状**：~~`window.confirm` / 静默 catch~~ → Toast + Confirm + 关键 catch 收敛。

### EO-5 — P8 Lint warning 清零

**现状**：~~约 40 warning~~ → 0 warning。

### EO-6 — P8 测试覆盖面扩大

**现状**：~~26 项~~ → 76 项。

### EO-7 — P1 Box Label 继续拆分

**现状**：~~单文件 ~800 行~~ → 四 hook + 薄编排层。

### EO-8 — 打包与分发

**现状**：完整 PyInstaller 未做；**最小** sidecar 路径探测 + 文档已就绪。

</details>

---

## 工程优化（可选后续 — 已清空主清单）

以下仅为 **EO-8 完整版** 等超出当前范围的后续项：

| 项 | 说明 |
|---|---|
| EO-8 完整 | PyInstaller / sidecar 可执行文件打入 `bundle.resources`，干净 Windows 机器免装 Python |
