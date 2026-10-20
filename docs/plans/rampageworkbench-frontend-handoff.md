# RampageWorkbench：给 Claude 的前端接口与接入说明

更新：2026-10-20。Owner 已明确由 Claude 设计前端；本次不交付新的图库页面、不指定视觉稿。这里约定接入边界、实际接口和能力状态，供 Claude 直接实现。

## 1. 目标与功能划分

软件正式名称 **RampageWorkbench**，GitHub 为 https://github.com/Rampageboo/RampageWorkbench 。本地正式目录为 `D:\Projects\RampageWorkbench`（目录重命名收尾后使用）。

若目前还在 `D:\Projects\YoloWorkBench`，说明目录正被打开的 Codex/Claude/终端占用。`Finish-RampageRename.vbs` 是一次性收尾入口；保存并关闭占用程序后，后台脚本重试改名、修复已有 Git worktree 关联与桌面快捷方式，并清理本项目包含旧绝对路径的 Tauri 生成缓存。状态在 `logs/rename-project-status.json`；改名后重新打开正式目录，首次桌面启动需重新构建缓存。不要另复制一份项目来代替正式目录改名。

需求来源：https://claude.ai/artifact/ExjuripRXhJ8yV4SyunEL8 ，标题《图集提示词反推工具：需求文档》。原文包含 P0/P1/P2 与 M1–M4；不要把本接口的存在当成全部里程碑完成。

建议只增加 **“图库与提示词”一个主入口**，无需把扫描、打标、NoobAI、Anima、LoRA、画师、任务分别变成主页面：

| 位置 | 放什么 | 边界 |
|---|---|---|
| 图库与提示词 | 图片根目录、集合、筛选、缩略图、详情、提示词、批量选择、训练集导出、页内任务进度 | 全局图库，不要求先打开 YOLO 工作区 |
| 现有 Library / 资源库 | YOLO 工作区的类别、媒体、版本等 | 保留既有标注与数据集语义 |
| 现有 Settings | 图库模型路径、能力检查、规则配置 | 不另建一套全局设置 |
| 现有 Label / Review / Orchestrate / Export | 原有工作流 | 保持原路由、隐藏工具入口和行为 |

原文建议图库三栏：左侧位置/集合/筛选、中间图片网格、右侧详情。具体视觉、宽度、交互与响应式由 Claude 设计。提示词模式与训练集模式共用图片和原始推理记录，只改变预览/导出规则。

## 2. 直接可用的代码

前端类型及薄客户端：`apps/desktop/src/features/gallery/galleryApi.ts`。

```ts
import { galleryApi, galleryImageUrl, GalleryApiError } from "../gallery/galleryApi";
import type { GalleryAssetDetail, PromptOptions } from "../gallery/galleryApi";

const status = await galleryApi.status();
const page = await galleryApi.assets({ offset: 0, limit: 60 });
const asset = await galleryApi.asset(page.items[0].id);
const thumbnailUrl = galleryImageUrl(asset.id);
const originalUrl = galleryImageUrl(asset.id, true);
```

示例中的相对 import 按实际页面位置调整。客户端从现有 `backendBaseUrl()` 取地址，默认 `http://127.0.0.1:8765`，不要在页面硬编码端口。所有调用支持最后一个 `AbortSignal` 参数；客户端只处理 HTTP，不持有选择、草稿、任务轮询或弹窗状态。

后端：`backend_api/gallery.py` 的 `APIRouter`，已接入 `backend_api/main.py`。统一前缀 **`/api/gallery`**。响应直接返回对象，**没有 `{ok,result}` 包装**，也不走旧 `/api/call`。

`GET /health` 应返回 `app: "rampageworkbench"`，`apiSchemaVersion >= 25`。旧后端应通过现有启动流程重启，不能把缺少图库路由误判为“空图库”。开发入口沿用 `apps/desktop` 中 `npm run dev` / `npm run tauri:dev`。

## 3. REST 接口

以下路径均省略 `/api/gallery`。

| 方法 / 路径 | 请求 | 返回 | 用途 |
|---|---|---|---|
| `GET /status` | 无 | `{total, roots, collections, jobs, capabilities}` | 初始化、概览与后台进度 |
| `GET /capabilities` | 无 | `GalleryCapabilities` | 区分已实现、满足前提与实机验收 |
| `GET /settings` | 无 | `GallerySettings` | 读取图库配置 |
| `POST /settings` | 完整配置对象 | 保存后的配置对象 | 替换配置，先 GET 后合并再保存 |
| `POST /roots` | `{path, source, recursive}` | 根目录对象及 `job` | 登记位置并自动排队扫描 |
| `POST /scan` | `{rootId?}` | `GalleryJob` | 增量扫描一个或全部已登记位置 |
| `GET /assets` | 下文筛选参数 | `{items,total,offset,limit}` | SQL 分页，不遍历源文件夹 |
| `GET /assets/{id}` | 无 | `GalleryAssetDetail`，包含 `prompts` | 读取单图完整数据 |
| `POST /assets/{id}` | 可编辑字段补丁 | 更新后的完整详情，包含 `prompts` | 保存评分、集合、备注、提示词修改等 |
| `POST /assets/{id}/preview` | `PromptOptions` **直接作为 body** | `GalleryPrompts` | 切换模式/阈值，纯计算，不推理、不保存 |
| `POST /preview` | `{ids, options?}` | `{items,count}` | 批量预览，返回包含 prompts 的详情 |
| `GET /assets/{id}/thumbnail` | 无 | JPEG 图片 | 本机缓存的缩略图 |
| `GET /assets/{id}/image` | 无 | 原图文件 | 仅限已索引图片 ID，不接受任意路径 |
| `GET /collections` | 无 | `{collections:string[]}` | 集合列表 |
| `POST /collections` | `{name}` | `{collections:string[]}` | 新建命名集合 |
| `GET /jobs` | 无 | `GalleryJob[]` | 最近最多 100 个持久化任务 |
| `POST /jobs/{id}/pause` | `{}` | 更新的 `GalleryJob` | 暂停 |
| `POST /jobs/{id}/resume` | `{}` | 更新的 `GalleryJob` | 继续暂停任务 |
| `POST /jobs/{id}/cancel` | `{}` | 更新的 `GalleryJob` | 取消任务 |
| `POST /process` | `{ids, model:"wd"}` | `GalleryJob` | 真实可选 WD 后台推理，前提不足时报错 |
| `POST /summary` | `{ids,options?}` | `GallerySummary` | 汇总存量标签，完全不重跑模型 |
| `POST /export` | 下文导出对象 | `{count,destination,files,warnings}` | 安全导出所选记录 |

图库位置 `path` 必须是存在的绝对目录，可以为本机路径或已挂载 NAS；`source` 是来源文字，如“ComfyUI 输出”“下载图集”“训练集”“Blender 渲染”“其他”；`recursive` 为布尔值。登记后只读源图；根目录重叠会被拒绝以避免扫描归属冲突。

### 分页与查询

`GET /assets` 支持 `q`、`rootId`、`collection`、`minRating`（0–5）、`hasMetadata`（true/false）、`offset`（默认 0）、`limit`（默认 60，最大 200）。无过滤条件时省略参数；`collection=""` 与不传 collection 含义不同。

`q` 使用 SQLite FTS5（不可用时回退文本匹配），检索已入库的文件名、提示词/标签、模型和备注等（LoRA 名称只有已出现在提示词中时才可搜，独立 LoRA 字段尚无过滤接口）。当前不是语义搜索，不支持复杂 Danbooru 概率布尔查询。按创建时间降序、ID 排序。不要在前端一次读取五万条完整详情；网格按页或窗口加载，详情按选中 ID 获取。列表为 `GalleryAssetSummary`：不带 `prompts/notes/userEdits/modelTags/caption`，metadata 仅 format/source/model；personalTags 截至 30 个并附 personalTagsCount。完整原始节点图只在详情加载。

### 错误

失败返回非 2xx，格式 `{detail: string}`（框架参数验证可能为结构化数组）。客户端抛出带 `status`、`detail` 的 `GalleryApiError`；网络失败/取消仍为浏览器原始异常。

| 状态 | 前端处理 |
|---|---|
| 400 | 路径、规则、状态转换或模型前提不满足；展示可操作的 detail |
| 403 | 本地文件权限不足 |
| 404 | 图片/任务不存在 |
| 409 | 文件离线、变更或输出冲突等文件操作问题 |
| 422 | 参数类型/范围无效 |

不要把请求失败转为空图库或“处理成功”。导出接口当前是同步完成后返回；扫描和 WD 推理返回异步任务。

## 4. 数据与来源语义

图片 ID 是**文件内容 SHA256**，不是数组下标或路径。同一内容在多个路径出现共用记录；移动/改名后扫描按哈希关联，评分、备注和手工修改跟随内容保留。`missing` 表示当前没有可用索引路径，NAS 离线不能等同于用户删除。

`GalleryAsset` 包含 `id/path/filename/width/height/format/source`、`metadata`、`rating`、`personalTags`、`notes`、`collection`、`userEdits`、`modelTags`、`caption`、时间与可用性字段。**当前只有单个字符串 collection**，没有多集合/嵌套集合接口，不要设计成已接通多选归组。

`metadata` 保存 `format`（a1111/comfyui/novelai/none）、`source`（metadata/none）、`positive/negative/parameters/model/loras/warnings/raw`。ComfyUI 追踪采样器的正负 conditioning 连线；不把第一个文本节点直接当最终提示词。解析不了的自定义节点保留原图元数据并发出 warnings，不能悄悄填默认提示词。

`prompts.noobai` 和 `prompts.anima` 分别包含：

- `positive`、`negative`：当前模式下渲染后的文字。
- `source`、`negativeSource`：来源标记。`metadata` 仅用于与原文完全一致的内容；`derived-metadata` 是格式转换；`derived-model` 是模型标签组装；`user` 是人工覆盖；`none` 表示没有内容证据。
- `parameters`：**原始参数**，不可与建议参数混为一谈。
- `recommendations`：建议采样器/CFG/步数/分辨率，不是推测出的原作者参数。

`tags` 保存类别、`selected`、每个模型各自的 `probabilities`、最终用于当前模式的 `probability` 和来源。**元数据标签的 probability 可以为 null**，表示没有概率；不要显示为 0% 或 100% 模型置信度。`selected=false` 的原始分数仍保留，用于修改阈值后重新组装。后台打标不会覆盖手工提示词。

保存两种提示词使用嵌套字段，**不是 `noobaiPositive` 这样的扁平字段**：

```ts
await galleryApi.editAsset(id, {
  rating: 4,
  collection: "角色参考",
  personalTags: ["待核对"],
  notes: "原始构图值得保留",
  userEdits: {
    ...asset.userEdits,
    noobai: { ...asset.userEdits.noobai, positive: editedPositive },
  },
});
```

`userEdits` 作为一个字段整体替换；保存时先合并其他格式和负面修改，避免互相覆盖。显式 `positive:""` 代表用户清空，**不能自动回填**；去掉该属性才是取消覆盖。顶层 positive/negative 为两种格式共用的旧式覆盖，界面优先使用嵌套格式。

## 5. 提示词与训练集模式

```ts
const options: PromptOptions = {
  mode: "train",                 // prompt 或 train
  trigger: "remielle",
  outfitTrigger: "remielle white outfit",
  removeTags: ["wings", "white wings"],
  corrections: { cross: "star (symbol)" },
  generalThreshold: 0.45,
  characterThreshold: 0.85,
  captionStyle: "mixed",         // mixed / tags / natural
  trainingKind: "character",     // character / style
  sourceTag: "3d",
};
const preview = await galleryApi.preview(id, options);
```

提示词模式默认 general=0.30、character=0.75，取模型并集；训练模式默认 0.45/0.85，取可用模型交集、触发词置前、移除指定固定特征与质量词，角色 LoRA 去画师、画风 LoRA 保留。**一个 WD 模型有结果不代表通过双模型校验**；查看 warnings。

NoobAI 使用质量/分级/人数/角色/作品/画师/其余标签顺序；Anima 采用小写空格及 `@artist`；默认不加 score_9。规则来自 `config/gallery_rules.json`，可在 settings.rules 提供完整规则对象覆盖。现有规则不会凭空识别不明画师/作品类别，也不会为无元数据、无模型结果的图片伪造反推。

描述仅使用已保存的 caption；当前没有可运行的自动描述适配器。自然语言训练标注中的固定特征无法可靠自动删除，接口会给复核警告。用户手工正面覆盖按原文保留，训练删除规则不强制改写它，必须显示复核提示。

汇总 `tagFrequencies[].frequency` 为 0–1；前端可用可调阈值（例如 0.8）划出“几乎每张都有”。当前 `sharedTags` 是 100% 出现，`sharedPrefix` 是文字共同前缀，不能把它等同于 80% 的统计。修改阈值/模式只调用 preview/summary，不调用 process。

## 6. 后台任务与模型配置

任务状态：`queued → running → completed/failed`；`queued/running → paused → queued`；活动任务可 `cancelled`。已完成/失败任务不能 resume，应重新 scan/process。暂停/取消对当前文件存在收尾延迟。任务存 SQLite；重启后中断的 running 重排为 queued，paused 保持暂停。

`GalleryJob.progress` 包含 scanned、imported、skipped、errors、currentPath 等；`processed` 为 scanned 别名。扫描事前可能不知道总数，**没有稳定 total 就显示已处理数/不定进度，不编百分比**。WD 队列按图片独立子进程运行，保留完整标签概率；尚未完成持久化的当前图在恢复时可能重算。

建议仅图库页可见时每 2–3 秒轮询 status/jobs；观察 `modifiedAt/status/processed` 的变化后刷新当前分页，**完成事件也刷新**，不能只在 running 时刷新，否则快速扫描结束和元数据更新会漏掉。切图、搜索、切页使用 AbortController 与请求序号，避免旧响应覆盖新选择。编辑草稿按图片 ID 保存；轮询不能重置编辑框；保存完成后核对当前选中 ID。

```ts
const current = await galleryApi.settings();
await galleryApi.saveSettings({
  ...current,
  wdModelPath: "N:\\Models\\.taggers\\wd-eva02-large-v3\\model.onnx",
  wdTagsPath: "N:\\Models\\.taggers\\wd-eva02-large-v3\\selected_tags.csv",
  wdModelId: "SmilingWolf/wd-eva02-large-tagger-v3",
  wdProfile: "wd-v3",
  deviceId: 0,
});
const capabilities = await galleryApi.capabilities();
```

路径仅为配置格式示例，**不表示已在机器上找到这些文件**。同时要求 GPU 版 ONNX Runtime 及 CUDAExecutionProvider、相配套模型/标签。软件不自动下载，不悄悄回退 CPU。`implemented` 表示有适配器，`ready` 表示允许尝试运行，`runtimeVerified` 才是实际执行证据；总体能力检查不能代替真实任务或基准测试结果。

PixAI 权重需要 Owner 本人完成下载许可/联系方式同意；仅填写 PixAI 或描述模型路径不能使尚未实现的适配器变为可运行。原文要求的 Remielle ground truth 和生成元数据样本尚未提供，模型组合、阈值和精度未验收。

## 7. 导出与文件边界

```ts
const result = await galleryApi.export({
  ...options,
  ids: selectedIds,
  destination: "D:\\Datasets\\remielle-export", // 已存在的绝对目录
  format: "anima",
  extension: ".atxt",
  artifact: "all",
  copyImages: true,
});
```

选中 1–10000 个 ID。导出前由前端展示目标、数量、用途、是否复制图片，让用户确认。默认不改原图；输出拒绝覆盖，路径/内容变化会报错；失败会清理本次新建文件。文件名冲突时才用内容哈希消歧，复制的图片与 caption 使用相同 stem。

`artifact=all` 包含所选格式的同名 caption、`results.json`、`results.csv`；`copyImages=true` 额外复制所选图片。`mode=train && copyImages=true` 生成 sd-scripts `dataset.toml`；为保证训练目录只含所选图，此时要求目标目录为空。仅标注导出不要求复制原图。当前扩展名只接受 `.txt` 和 `.atxt`，其他扩展名尚未开放。提示词模式 caption 附 `Negative prompt:` 行，训练集模式 caption 只含正面标注。

导出 warnings 必须可见，尤其是没有反推、只跑一个模型、人工覆盖训练文本需要复核等。CSV 中可能触发电子表格公式的单元格会加安全前缀，精确原文以 JSON 为准。

## 8. 实际能力边界

| 状态 | 内容 |
|---|---|
| 已实现后端与接口 | 本地 SQLite、哈希去重/重关联、增量后台扫描、暂停/继续/取消、分页搜索、缩略图、原始元数据解析、单集合/个人标签/评分/备注、人工修改、两版提示词规则、图集汇总、选择导出 |
| 可选适配器，待安装与实测 | CUDA WD ONNX 推理和全部原始概率保存；当前环境缺少 onnxruntime，模型权重/标签未确认 |
| 尚未实现，界面应禁用或标“待接入” | PixAI 双模型实跑、自动自然语言描述、画师参考与候选、语义/以图搜图、近似去重、文件实时监视/NAS 自动轮询、ComfyUI 自动入库与回环、双机工作节点、跨应用显存调度、嵌套/多集合/智能集合、文件移动/重命名/回收站、视频元数据/拖放/剪贴板入库、图库自动备份 |
| 待验收 | 2000/50000 张实际规模性能、两台 GPU 上模型速度/质量、Remielle 标注一致性、真实来源图片的完整解析覆盖率 |

## 9. Claude 实现入口与验收

现有 React 入口 `src/app/App.tsx`、布局 `src/app/WorkbenchBody.tsx`、导航类型 `src/types/tools.ts`、组件懒加载 `src/app/toolRegistry.tsx`、侧栏 `src/components/ToolNav.tsx`。添加 `gallery` ToolTab，`requiresWorkspace` 设 false，按已有 keep-alive 机制接入；模型设置可接现有 SettingsModal/SettingsPage。沿用现有主题系统，不建立另一套全局导航/状态。

目录与技术栈：`apps/desktop`，React 18、TypeScript、Vite、Tauri 2。原有 `api.ts` 仍有 Owner 未提交的视频功能改动；不要覆盖整个文件。工作区 schema、`YWB_*` 环境变量、localStorage key 与 Tauri identifier 保留旧标识是兼容决策，品牌显示用 RampageWorkbench。

前端验收至少覆盖：空图库和后端错误分开显示；导入→后台扫描→分页→切图；原始/派生/人工来源正确；空概率不当百分数；草稿不被任务刷新或旧响应覆盖；保存不覆盖另一格式；阈值改变不打标；选中集跨页明确；离线文件与坏图可解释；导出确认、冲突/错误和实际文件清单可见；未实现能力不伪装成功。

默认对未知/成人分级缩略图做模糊或隐藏，并提供清晰开关。`contentRating` 是可选推理证据的最高概率 rating 标签，可能为 null、可能不准确，**不是已校准安全结论**；原始元数据的 rating 尚不填充该字段，无法确定时按未知处理。原文要求中文界面、英文 tag/提示词保持原样。构建通过后还需要实际页面交互与截图验证。

## 10. 交接时的验证证据

独立 Verifier 已通过：前端生产构建；相关既有前端测试 11 项；图库、元数据与提示词 Python 测试 46 项；完整 FastAPI app 的 23 项小样本接口检查（后台扫描、编辑、预览、图片流、所选图片导出、冲突拒绝、原图保持不变、未就绪推理拒绝）。五万行 SQL 测试只证明列表有界分页，不代表五万张真实图/NAS/缩略图或 GPU 性能验收。

桌面 Rust 离线构建在清理旧路径缓存后通过，生成 `rampageworkbench-desktop.exe`。这是构建证据，尚未作为实际桌面窗口/GPU 模型验收。

对应本地日志在 `logs/rampage-verifier-build-final.log`、`logs/rampage-verifier-frontend-tests-localtmp.log`、`logs/rampage-verifier-gallery-tests-host.log`、`logs/rampage-verifier-api-smoke-host.log`，均为忽略的运行产物，不随 GitHub 提交。沙箱环境中的空 FastAPI TestClient 也曾卡在 Windows socketpair；同一接口检查移到宿主执行后通过，未据此修改产品逻辑。

## 11. 前端实现状态（Claude，2026-10-20）

分支 `feat/ui-redesign`。入口：侧栏顶部「图库与提示词」（`gallery` ToolTab，不需要工作区，keep-alive）。代码在 `apps/desktop/src/features/gallery/`：`GalleryPage`（状态与轮询）、`GalleryNav` / `GalleryGrid` / `GalleryDetail`（三栏）、`GalleryDialogs`（添加位置、规则、批量整理、汇总、导出、原图查看）、`galleryDomain.ts`（纯逻辑，有单测）、`useGallery.ts`（带 AbortController 的请求钩子）。模型路径与能力状态在现有 Settings 对话框的「图库模型」一节。

用隔离后端（worktree 自己的 `Sessions/gallery`）和合成样本（A1111 / ComfyUI 带诱饵文本节点 / 无元数据 JPG / 子目录 WEBP / 损坏文件）实测通过：

- 空图库与后端不可达分开显示；后端恢复后页面自动恢复。
- 添加位置 → 后台扫描（损坏文件计为错误并可展开）→ 分页 → 切图。
- 来源标记：原始元数据 / 由元数据转换 / 模型反推 / 用户修改 / 无依据；元数据标签显示“元数据”而非百分比。
- 草稿按图片 ID 保存，扫描完成触发的刷新不会覆盖编辑框；保存 NoobAI 负面与 Anima 正面后两者同时保留在 `userEdits`。
- 切换训练集模式、调阈值只调用 `/preview`，不调用 `/process`；WD 未就绪时“打标”禁用并显示真实 blockers。
- 选中集按 ID 跨页保留，选择栏显示不在当前页的数量。
- 导出前确认目标/数量/用途/触发词；成功显示文件清单与 warnings；非空目录的 dataset 导出显示后端错误；原图哈希不变。
- 未知/成人分级缩略图默认模糊，可一键切换或单张显示；Enter 不会绕过遮挡打开原图。
- 快捷键：←→ 切图、↑↓ 按行移动（可跨未加载块），0–5 评分（立即保存），Enter 看原图，Ctrl/Shift 多选；“选择可见”替代“选择本页”。

未做 / 待定：

- 列表 / 时间线视图。
- 缩略图网格已改为虚拟滚动（`features/image-pool/virtualGrid.ts` 的 `useVirtualGrid`）：只渲染可见行 ± 3 行，按 offset 以 200 张为块加载可见范围及预读一块；3004 张实测 DOM 约 36–70 个格子，行内滚动零 DOM 变更，跳到中段/末尾只请求所需块，改缩略图大小时首个可见图保持在顶部。
- 拖放/剪贴板导入、文件操作、多集合等后端未开放的能力，界面未提供入口。
- 后端发现（未改）：Anima 写法的元数据（如 `@kantoku`）转成 NoobAI 版时仍保留 `@`，需求要求 NoobAI 画师写成普通 tag。
- 尚未在 Tauri 窗口和真实 NAS / 大图库上验收。
