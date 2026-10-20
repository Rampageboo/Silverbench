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
