# 全面去补丁：审计与执行计划（2026-10-20）

Owner 决定：旧界面全部退役（legacy/web、legacy/qt、React 里两个“旧版”页面）；样式按功能重写，删除 `styles.css` 与 `legacy-web.css`。“Legacy assign”（硬链接分配工具）不在本次退役范围，单独待定。

## 审计结果（量化）

前端（`apps/desktop/src`）
- 样式：旧 `styles.css` 2536 行 + `legacy-web.css` 3426 行打底，新样式靠更高优先级覆盖；157 个类在多个文件中重复定义（含 `#labelWorkbench` 覆盖层），约 190 条选择器不匹配任何组件，34 处 `!important`。
- 三套界面并存的痕迹：108 处 “legacy” 代码与注释；`legacy-web.css` 只为兼容旧页面存在。
- 6 份各自实现的缩略图懒加载/网格（ImagePoolGrid、BoxLabelGallery、DatasetReviewGallery、ImageAssignGrid、LabelMediaGrid、GalleryGrid），只有部分真正虚拟化；图片库此前因容器高度链断裂实际渲染全部条目。
- 17 个各自注册的全局 keydown 监听。
- 子组件通过 effect 向父组件回报状态（reportInspectorState / registerWorkbenchActions / onWorkbenchBridgeChange / reportSourceSummary），此前两次造成渲染循环。
- 5 个从未被引用的文件；12 处 “Phase 3A/3B” 过期注释。

后端
- 后端同时服务三套界面：`POST /api`（仅 legacy/web 用，含把结果转成字符串的兼容逻辑）、在 lifespan 中延迟挂载 legacy/web 静态目录的变通、`backend/bridge.py`（仅 Qt 用）。
- `/api/call` 104 个方法中 22 个不被 React 前端调用；其中一部分只服务 legacy/web。
- 43 处 `except Exception`，13 处吞掉异常直接 `pass`。
- `yolo_workspace.py` 的旧会话迁移是用户数据兼容，不是界面补丁，保留。

## 阶段

1. 退役旧界面：删 legacy/web、legacy/qt、启动脚本与 Tauri 配置、`POST /api`、静态挂载、Qt bridge、React 旧版视频标注与独立图片标注页及其独占代码；清理只被它们使用的后端方法。
2. 删死代码：未引用文件、死后端方法、过期注释。
3. 样式按功能重写：每个功能一份自己的样式文件，只用 token；删 `styles.css`、`legacy-web.css`、`#labelWorkbench` 覆盖层；无跨文件覆盖、无 `!important` 压优先级。逐页截图对比。
4. 前端结构：统一虚拟网格与缩略图组件；标注页检查器改为由各标注面直接渲染（去掉向上回报状态）；整理键盘监听。
5. 后端：逐个审查吞异常的地方；视情况拆分 `service.py`。

每阶段：类型检查、lint、前端与 Python 测试、相关页面实际操作验证，然后单独提交。

## 结果（2026-10-20）

| 阶段 | 提交 | 结果 |
| --- | --- | --- |
| 1 退役旧界面 | `52a153f` | legacy/web、legacy/qt、两个“旧版”页面、`POST /api`、静态挂载、Qt bridge 及只服务它们的后端方法已删除；旧会话里保存的已退役页签会打开“标注”。 |
| 2 死代码 | `0abb85e` | 约 50 个无引用导出、穿过 6 个文件却从未调用的 `onUndoJunk`、无调用方的后端 RPC/REST 及其辅助函数已删除。 |
| 3 样式 | `784c8dd`、`fbad4fa` | `styles.css`、`legacy-web.css` 已删除；每个功能自带样式文件；`@layer app, label` 取代 249 个 `#labelWorkbench` 选择器与所有 id 选择器；`!important` 只剩 4 类策略（`[hidden]`、控件箭头光标、减少动效、打印）；891 条从未生效的声明已删除。 |
| 4 前端结构 | `5bcf848` | 标注页各标注面直接渲染自己的检查器与审阅操作；`LabelWorkbenchContext`、向上回报状态的回调、编辑器 bridge 和防渲染循环的 ref 补丁已删除。 |
| 5 后端 | 本提交 | 逐个审查吞异常处：均为合理的尽力而为操作（清理临时文件、可选缓存写入等）；一处解析回退收窄为具体异常。 |

验证方式：17 个视图（含视频标注模式、控制面板、设置）的计算样式快照，逐元素比较全部样式与几何，改动前后一致；另用级联检查器比较每对可能命中同一元素的声明的胜者。

### 顺带修掉的问题

- 视频模式下检查器一直为空、标题栏没有审阅按钮（选中视频时清空了回报的状态，回报 effect 不再触发）。
- 基础输入框的 `:focus` / `:disabled` 样式被自身过高的选择器优先级压住，从不生效。
- 全局样式晚于组件样式加载，命令面板等组件的设计值被共享规则覆盖（面板本应距顶 12vh）。
- Dataset review 与标注页同时渲染 `#previewPanel` 等重复 id。

### 留待决定

- **Legacy assign**（硬链接分配工具）：不在本次退役范围，仍可从侧栏“Legacy assign”进入。
- **标注页中“标为废片”无法撤回**：键盘撤回早已移除，界面上也没有撤回入口（图片库页可以撤回）。需要的话加一个按钮即可。
- **未接入界面的功能代码**：视频导出规划/执行、遮挡（blackout）层、相似度比对、视频自动标注提议等有完整测试，但应用里没有入口。是接入还是删除需要决定。
- **三个旧网格**（图片库、分配、数据集审阅）仍用 `virtualGrid` 的兼容层（同一套窗口算法，只是保留旧几何）；换成 `useVirtualGrid` 会改变这几页的列数和行高。
- **`service.py` 未拆分**：它是平铺的分发表，拆分收益小；且未提交的视频截图改动正在修改它。
