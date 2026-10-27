# AniMocap Fusion 整合进 RampageWorkbench

状态：A、B、C、D 完成（2026-10-23），剩 E 与多视角逐视角回看。D：常驻引擎 `animocap serve`（3000 帧每次编辑 ≈ 23 ms）、拖动关键帧与曲线、关键帧平滑、按部位锁定/加权/排除/区间重建/恢复自动、撤销/重做（每次编辑即保存）、人物范围框选、Blender 选帧导出。2026-10-27 补齐：拖动方向按 take 自身拟合（多视角随参考相机），多视角可拖动；2×4 总览与逐视角只读回看（参考时间轴，`source_frame_at_reference`）。3D 视图选 Canvas 2D（复刻 Studio 投影，无新依赖）。基线：AniMocap `main` @ `50549a85`（已 subtree 进 `engines/animocap/`），RWB `main` @ `d589c203`。
实施地点：Owner 改为这台电脑完成（"全部在这台电脑做"），另一台收尾。

**Owner 2026-10-23 追加**：AniMocap 原前端不要。Studio（`gui_main.cpp` 等）已在整合时删除，不再等 E 阶段；对拍改用标签 `archive-2026-10-23` 的源码/Release 二进制在临时目录构建旧 Studio。引擎版本固定为 `50549a85`（= 该标签），归档 bundle 中唯一未合并的 `codex/multiview-architecture` 为受阻 R&D 且与 main 冲突，不合入（见 `DECISIONS.md`）。

AniMocap 侧的交接文档是 `engines/animocap/docs/MERGE_HANDOFF.md`（产品边界、验收事实、不能宣称完成的事项），本计划以它为准补充。

## 目标与完成标准

在 RWB 里用一个"动捕"工具完成 AniMocap Studio 现在能做的所有事，之后退役 Win32 Studio。

完成 = 在 RWB 里能：

1. 从工作区 `media/` 选单视角视频，或 2–8 视角（fan3 / cardinal4 / `capture.json`）；自动人物范围或手动框选；开始/取消捕捉，看到阶段、帧进度、已用时间与预计剩余；
2. 看原视频 + 2D 关键点叠加（含关节名）、可拖视角的 3D 骨架（含 A/B 深度对比虚影与毫米差）、多视角 2×4 总览与单视角只读回看（与参考时间轴同步）、问题面板（NPU 复查帧、低置信度等）；
3. 时间轴：播放、逐帧/跳 10 帧、区间起止、区间循环、关键帧菱形与影响曲线；
4. 手动修正：拖关节生成稀疏关键帧（局部曲线传播，5 种预设）、删除当前键、关键帧平滑、撤销/重做、保存；导入角色骨架预设并显示实际修正样本数和毫米数；
   逐关节修复（`docs/joint-review.md`）：锁定/加权（4×/8×/16×）/排除、区间重建、原始叠影、恢复自动，推算点单独显示；打开/保存 `.areview`；
   选帧导出到 Blender（`blender_exchange`），"推理过的帧 / 用户锁定的帧 / 导出选中的帧"是三个独立状态，界面不得合并；
   辅助 AI 间隔（1/2/3/auto）与 ROI AI 放大（Maxine VSR）作为捕捉选项；
5. 导出 BVH（厘米/米）与 VRMA，存在区间时只导出区间；打开已有 `motion.amotion`；
6. 一键安装/检查推理环境（MMPose、本地 VLM、可选 OpenVINO NPU、SAM 2.1），状态如实显示；
7. 在同一段测试视频上（Owner 的 367 帧单视角视频 + 一组 fan3 多视角），RWB 结果与旧 Studio **逐字节或在明确容差内一致**（见验证）。

快捷键保持：空格、←/→、Shift+←/→、I/O、L、Delete、Ctrl+Z/Y、Ctrl+S。

## 已定（Owner 2026-10-23 选"完全重写进 RWB 界面"）

- **只重写界面，不重写算法。** C++20 核心继续是动作数据与算法的唯一权威（平滑、优化、重建、多视角融合、关键帧修正、导出、契约校验）。TypeScript 不实现任何求解或修正数学，只做显示和交互。理由：AniMocap 的已确认决策是"产品首选 C++，Python 只用于必须的 ML 生态"，而且这些算法有大量确定性测试，重写等于重新验证。
- **Python ML 适配器原样保留**（`mmpose_adapter.py`、`multiview_pipeline.py`、`local_vlm_adapter.py`、NPU 等），用 AniMocap 自己的环境 `.venv-mmpose`，与 RWB 的 `.venv` **分开**（两边 torch / mmcv 版本约束不同，合并必冲突）。
- **单仓库**：AniMocap 以 `git subtree add`（保留历史）进入 RWB 的 `engines/animocap/`。两台电脑只同步一个仓库，`update.bat` 一并更新。AniMocap 原仓库在切换完成后由 Owner 决定归档。
- **C++ 引擎通过命令行 + JSON 被调用**，不做 Python 绑定/DLL。RWB 后端是编排者：按旧 Studio 的顺序调用 Python 适配器，再调用 `animocap.exe`。
- **数据落在 v3 工作区**：每次捕捉是一个 take 目录 `mocap/<take>/`（文件清单见 `docs/animocap-engine.md`：原始观测、不可变 `refined.json`、用户编辑 `edits.json`、`motion.amotion/`）。`mocap` 加进 `RELATIVE_PATHS`（前后端布局一致性测试会提醒同步）。导出文件写到 `exports/mocap/`。手动修正是用户劳动，单独存成关键帧文件，始终从不可变基线重放；快照（`versions/`）是否包含 `mocap/` 的修正文件见"待定"。
- **模型权重和推理环境按电脑各自安装**（`engines/animocap/private/`、`.venv-mmpose`，均 git 忽略），同 ComfyUI 的做法；RWB 设置里显示状态与"安装"按钮。
- 视频文件不复制：take 引用 `media/` 的相对路径。

## 必须先定下的契约（并行开发前）

**已定（A 阶段完成部分）**：见 `docs/animocap-engine.md`。编辑不再分散成 `apply-corrections`：引擎新增 `edit_session`（核心库，把 Studio 的拖拽曲线、关键帧平滑、逐关节修复按 Studio 顺序合成一次重放）和 `apply-edits` 命令；`reconstruct-pose --pose-output` 保存编辑基线；`--review-output` 写出与 Studio 兼容的 `.areview`，用于对拍和互通。下面第 1 条的其余部分（界面读取字段）在 B 阶段落实。

1. **引擎 CLI 补齐**：旧 Studio 有若干步骤是进程内调用、CLI 没有的。至少需要：
   - 与 Studio 单视角路径一致的重建（Studio：`smooth → optimize_detailed(options, profile, proportion_policy) → reconstruct`；`reconstruct-pose` 已基本一致，需确认 VLM 修正后的输入、无 profile 时的默认策略与 Studio 完全相同）；
   - 应用稀疏关键帧修正：`apply-corrections <baseline> --keyframes corrections.json --output`（调用 `apply_manual_pose_corrections` / `make_bounded_keyframe_curve_weights`），返回修正后的观测姿态与动作；
   - 供界面读取的 JSON：每帧 2D 关键点、3D 观测关节、A/B 对比姿态、问题列表、时间映射（多视角源帧 ↔ 参考时间）。可以是 `inspect-*` 子命令，也可以直接读现有 JSON 文件——实施者选，但字段要写成文档。
2. **进度/取消**：Python 适配器已写 JSON 行日志（`event` 字段），旧 Studio 解析它算进度。RWB 后端复用同一日志格式；取消必须结束整棵进程树并保留中间结果（与旧行为一致）。
3. **时间与帧映射**：旧 Studio 用 Media Foundation 解码；RWB 现在用 OpenCV / HTML5 视频。叠加层按"源帧序号 ↔ 时间"对齐，必须用引擎给出的 `source_time_s`，不能用浏览器 `currentTime` 自行换算帧号。

## 范围与可并行部分

| 范围 | 内容 | 依赖 |
|---|---|---|
| A 引擎 | subtree 导入、在 RWB 构建（CMake/Ninja + MSVC）、CLI 补齐、契约文档、确定性测试 | 无，最先做 |
| B 后端 | take 管理、捕捉任务（编排/进度/取消）、环境检查与安装、导出、打开已有动作 | A 的 CLI 契约 |
| C 界面（只读） | 视频 + 2D 叠加、3D 视图、时间轴、多视角回看、问题面板、导出 | B 的接口；可先用 `generate-fixture` 数据并行 |
| D 界面（编辑） | 人物框选、关节拖拽关键帧、撤销/重做、角色预设、保存 | A 的 `apply-corrections`、C |
| E 切换 | 对比验收、退役 `gui_main.cpp`、`update.bat` 构建引擎、文档 | 全部 |

C 可以在 A/B 完成前用 fixture 动作包开工。

## 构建与两台电脑

- Windows 上 Rust 的 MSVC 工具链已需要 VS C++ Build Tools，运行电脑应已具备；实施时确认 CMake/Ninja 可用。
- `update.bat`：仅当 `engines/animocap/` 的 C++ 源变化或 `animocap.exe` 不存在时构建引擎；Python 适配器无需构建；推理环境不随更新自动重装（与旧 `setup_*.ps1` 一致，由用户在界面点安装）。
- 目标推理硬件是 RTX 5070 Ti Laptop（12 GB）；RTX 2060 只做兼容验证。实施者记录哪台电脑是哪种 GPU，真实视频验收要在目标机上做。

## 风险与会改变计划的情况

- **AniMocap 上游**：Owner 已推送归档提交 `50549a85`（标签 `archive-2026-10-23`），之前导入的 `12d2e4e` 缺 `src/import_bvh.cpp` 无法构建，已用 `git subtree pull` 更新。此后 AniMocap 的改动只在 RWB 仓库进行，避免两边分叉；若上游再有提交，用 `git subtree pull --prefix=engines/animocap` 合入。`codex/m4-s1-s3-measurement` 等未合并分支保留在上游和归档 bundle 里，不导入。
- **未经实片验收的能力**（交接文档"不应误称为完成"）：辅助 AI 间隔的速度/质量、修复面板实片端到端、Maxine 长时运行。RWB 界面照搬能力，但对拍验收不能把这些写成已通过。
- **交互延迟（已测，结论：D 阶段做常驻进程）**：400 帧 `apply-edits` ≈ 280 ms，其中 ≈ 160 ms 是这台 Windows 启动任何新编译的未签名 exe 的固定开销（hello world 同样 160 ms；延迟加载 Media Foundation 无改善）。捕捉/导出用一次性命令；编辑循环在 D 阶段改为常驻 `animocap serve`（stdin/stdout JSON，常驻 refined 姿态），而不是把算法搬到 TS。拖动过程中的即时预览只移动被拖的关节，松手后以引擎结果为准。
- **解码差异**导致叠加错位（见契约 3）。用 fixture 和真实视频逐帧检查关节落点。
- **多视角 8 路同时预览**在浏览器里的解码压力：用缩略帧/代理视频，回看时只解码当前视角。
- **许可证**：`LICENSES.md` 与 `third_party/`（模型许可）随 subtree 一起进入，RWB 的 README 链接到它。
- **两个项目的协作上下文**：AniMocap 的 `project-context/`（决策、风险）保留在 `engines/animocap/` 下继续有效；RWB 的 `DECISIONS.md` 只记整合层面的决定。

## D 阶段必须处理的已知问题（2026-10-23 审查）

- ~~多视角拖拽方向~~（已修复 2026-10-27）：单视角与多视角的图像→世界约定相反（单视角图像右 = −X，多视角图像右 = cos(yaw)·X − sin(yaw)·Z）。`image_right_in_world` 从 take 自身最小二乘拟合方向，单视角结果与 Studio 一致。
- **未生效的标记**：加权/排除只在区间重建内起作用（见 `docs/animocap-engine.md`），界面要把区间外的这类标记显示为“待重建”。

## 待定（实施中由 Owner 决定）

- 3D 视图用 three.js 还是 Canvas 2D 投影（旧 Studio 是 GDI 投影绘制，Canvas 2D 足够复刻；three.js 便于以后做角色预览）。实施者给出建议。
- 快照是否包含 `mocap/*/corrections.json`（建议包含：它是用户劳动，体积小）。
- AniMocap Blender 插件：先留在 `engines/animocap/blender_addon/` 原处（上游已更新 Blender 交换与插件）；RWB 界面只负责导出选帧 JSON。
- 动捕结果是否进入 MCP（例如让 Agent 读取问题帧）——不在本计划内。

## 验证

- 引擎：AniMocap 现有 C++ 测试在 RWB 构建中全部通过；新增 CLI 子命令各有确定性测试（fixture 动作包，固定种子）。
- **与旧 Studio 对拍**：同一输入（fixture + Owner 的单视角视频 + 一组 fan3），旧 Studio 与 RWB 产出的 `motion.amotion`、BVH、VRMA 一致（同一引擎，期望逐字节；若有差异须解释到具体参数）。修正：同一组关键帧在两边重放结果一致。
- 界面：叠加关节与旧 Studio 截图逐帧对照（抽样帧）；时间轴区间导出帧数正确；撤销/重做和保存后重开一致。
- 后端：捕捉取消后无残留进程，中间结果保留；环境缺失时状态和提示准确，不静默降级。
- 全部 RWB 测试（后端 pytest、前端 vitest、类型检查）通过。
