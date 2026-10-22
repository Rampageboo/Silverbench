# AniMocap Fusion 整合进 RampageWorkbench

状态：计划（2026-10-23）。基线：AniMocap `main` @ `12d2e4e`，RWB `main` @ `d874ea06`。
实施地点：开发电脑（这台电脑只运行 `update.bat`）。

## 目标与完成标准

在 RWB 里用一个"动捕"工具完成 AniMocap Studio 现在能做的所有事，之后退役 Win32 Studio。

完成 = 在 RWB 里能：

1. 从工作区 `media/` 选单视角视频，或 2–8 视角（fan3 / cardinal4 / `capture.json`）；自动人物范围或手动框选；开始/取消捕捉，看到阶段、帧进度、已用时间与预计剩余；
2. 看原视频 + 2D 关键点叠加（含关节名）、可拖视角的 3D 骨架（含 A/B 深度对比虚影与毫米差）、多视角 2×4 总览与单视角只读回看（与参考时间轴同步）、问题面板（NPU 复查帧、低置信度等）；
3. 时间轴：播放、逐帧/跳 10 帧、区间起止、区间循环、关键帧菱形与影响曲线；
4. 手动修正：拖关节生成稀疏关键帧（局部三次缓入缓出传播）、删除当前键、撤销/重做、保存；导入角色骨架预设并显示实际修正样本数和毫米数；
5. 导出 BVH（厘米/米）与 VRMA，存在区间时只导出区间；打开已有 `motion.amotion`；
6. 一键安装/检查推理环境（MMPose、本地 VLM、可选 OpenVINO NPU、SAM 2.1），状态如实显示；
7. 在同一段测试视频上（Owner 的 367 帧单视角视频 + 一组 fan3 多视角），RWB 结果与旧 Studio **逐字节或在明确容差内一致**（见验证）。

快捷键保持：空格、←/→、Shift+←/→、I/O、L、Delete、Ctrl+Z/Y、Ctrl+S。

## 已定（Owner 2026-10-23 选"完全重写进 RWB 界面"）

- **只重写界面，不重写算法。** C++20 核心继续是动作数据与算法的唯一权威（平滑、优化、重建、多视角融合、关键帧修正、导出、契约校验）。TypeScript 不实现任何求解或修正数学，只做显示和交互。理由：AniMocap 的已确认决策是"产品首选 C++，Python 只用于必须的 ML 生态"，而且这些算法有大量确定性测试，重写等于重新验证。
- **Python ML 适配器原样保留**（`mmpose_adapter.py`、`multiview_pipeline.py`、`local_vlm_adapter.py`、NPU 等），用 AniMocap 自己的环境 `.venv-mmpose`，与 RWB 的 `.venv` **分开**（两边 torch / mmcv 版本约束不同，合并必冲突）。
- **单仓库**：AniMocap 以 `git subtree add`（保留历史）进入 RWB 的 `engines/animocap/`。两台电脑只同步一个仓库，`update.bat` 一并更新。AniMocap 原仓库在切换完成后由 Owner 决定归档。
- **C++ 引擎通过命令行 + JSON 被调用**，不做 Python 绑定/DLL。RWB 后端是编排者：按旧 Studio 的顺序调用 Python 适配器，再调用 `animocap.exe`。
- **数据落在 v3 工作区**：每次捕捉是一个 take 目录 `mocap/<take>/`（`capture.json`、各视角 `pose_sequence*.json`、诊断、日志、`motion.amotion/`、修正关键帧 `corrections.json`）。`mocap` 加进 `RELATIVE_PATHS`（前后端布局一致性测试会提醒同步）。导出文件写到 `exports/mocap/`。手动修正是用户劳动，单独存成关键帧文件，始终从不可变基线重放；快照（`versions/`）是否包含 `mocap/` 的修正文件见"待定"。
- **模型权重和推理环境按电脑各自安装**（`engines/animocap/private/`、`.venv-mmpose`，均 git 忽略），同 ComfyUI 的做法；RWB 设置里显示状态与"安装"按钮。
- 视频文件不复制：take 引用 `media/` 的相对路径。

## 必须先定下的契约（并行开发前）

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

- **AniMocap 仍在活跃排查**（多视角 joint10、输入审计的 Codex 交接，2026-10-23 刚推送）。subtree 导入要在这些分支合并或明确暂停之后；导入后 AniMocap 的改动只在 RWB 仓库进行，避免两边分叉。`codex/m4-s1-s3-measurement` 有 7 个未合并提交（8 月）——Owner 决定合并还是放弃。
- **交互延迟**：每次拖关节都起一个 `animocap.exe` 进程。若"松手到更新"超过约 200 ms，改为常驻 `animocap serve`（stdin/stdout JSON-RPC），而不是把算法搬到 TS。拖动过程中的即时预览只移动被拖的关节，松手后以引擎结果为准。
- **解码差异**导致叠加错位（见契约 3）。用 fixture 和真实视频逐帧检查关节落点。
- **多视角 8 路同时预览**在浏览器里的解码压力：用缩略帧/代理视频，回看时只解码当前视角。
- **许可证**：`LICENSES.md` 与 `third_party/`（模型许可）随 subtree 一起进入，RWB 的 README 链接到它。
- **两个项目的协作上下文**：AniMocap 的 `project-context/`（决策、风险）保留在 `engines/animocap/` 下继续有效；RWB 的 `DECISIONS.md` 只记整合层面的决定。

## 待定（实施中由 Owner 决定）

- 3D 视图用 three.js 还是 Canvas 2D 投影（旧 Studio 是 GDI 投影绘制，Canvas 2D 足够复刻；three.js 便于以后做角色预览）。实施者给出建议。
- 快照是否包含 `mocap/*/corrections.json`（建议包含：它是用户劳动，体积小）。
- AniMocap Blender 插件放在 `engines/animocap/blender_addon/` 原处，还是另行处理。
- 动捕结果是否进入 MCP（例如让 Agent 读取问题帧）——不在本计划内。

## 验证

- 引擎：AniMocap 现有 C++ 测试在 RWB 构建中全部通过；新增 CLI 子命令各有确定性测试（fixture 动作包，固定种子）。
- **与旧 Studio 对拍**：同一输入（fixture + Owner 的单视角视频 + 一组 fan3），旧 Studio 与 RWB 产出的 `motion.amotion`、BVH、VRMA 一致（同一引擎，期望逐字节；若有差异须解释到具体参数）。修正：同一组关键帧在两边重放结果一致。
- 界面：叠加关节与旧 Studio 截图逐帧对照（抽样帧）；时间轴区间导出帧数正确；撤销/重做和保存后重开一致。
- 后端：捕捉取消后无残留进程，中间结果保留；环境缺失时状态和提示准确，不静默降级。
- 全部 RWB 测试（后端 pytest、前端 vitest、类型检查）通过。
