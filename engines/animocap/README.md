# AniMocap Fusion

> **在 RampageWorkbench 里的形态**：这里只有引擎（C++ 核心库、`animocap` 命令行、Python 推理适配器、Maxine 桥接、Blender 插件），没有界面。
> 原 Win32 Studio（`src/gui_main.cpp`）在整合时删除，唯一的界面是 RWB 的“动捕”页；RWB 通过 [`docs/animocap-engine.md`](../../docs/animocap-engine.md) 的命令行合同调用引擎。
> 下文提到 “Studio” 的地方描述的是 RWB 复刻的行为；原版源码与二进制在 GitHub 标签 `archive-2026-10-23` 及其 Release 附件中。

合并到其他软件或恢复工程时，先读 [合并交接文档](docs/MERGE_HANDOFF.md)。它记录模块入口、已验证范围、未解决问题和私有归档的恢复方式；不需要保留原始对话。

AniMocap Fusion 是一个本地运行的单目/多机视频动作捕捉工具，面向动漫与游戏类人角色。核心、视频解码、动作数据合同和桌面 GUI 使用 C++20；MMPose、HRNet、RTMW、MotionBERT 与可选 SAM 2.1 作为独立 Python 推理进程运行。

目标运行硬件为 RTX 5070 Ti Laptop（12 GB VRAM），采用离线批处理；当前 RTX 2060 开发机只用于兼容性验证。

## 打开软件

在资源管理器中双击根目录的 `AniMocap Fusion.cmd`。

首次使用：

1. 点击“推理环境”，等待 PowerShell 完成安装。安装器会预先缓存 HRNet、MotionBERT、RTMW 权重，使后续推理无需联网；它也会尝试配置 SAM 2.1 Hiera Small，失败时不影响捕捉，会自动使用 GrabCut。
2. 点击“打开视频”并选择本地视频。
3. 优先保留“自动识别”：首次捕捉会根据整段人体关节自动得到包含头、双手和双脚的人物范围，并排除武器、翅膀、宠物和 UI。只有自动结果不正确时才点“手动框选”；手动模式会严格使用你拖出的范围，不复用或扩张自动框。
4. 断网后也可点击“开始捕捉”；耗时取决于显卡和视频长度。
5. 左侧查看原视频与 2D 关键点，右侧查看可拖动视角的观测 2.5D 骨架，底部播放或拖动时间轴。

捕捉期间状态栏会显示当前阶段、帧进度、已用时间和预计剩余时间。“开始捕捉”会变成“取消捕捉”；取消会终止整棵本地推理进程、保留已生成的中间结果，不需要强制关闭软件。

## 稀疏关键帧曲线修正

新增[按关节修复](docs/joint-review.md)：右侧人体预览可选择单个部位，锁定可信帧、调整可信权重、排除局部坏点，并在两个锁定帧之间重建动作。支持原始叠影、撤销/重做和可重新打开的 `.areview` 修复工程。

自动捕捉完成后点击“手动修正”。在需要修正的帧拖动错位的头、肩、肘、腕、髋、膝或踝；Studio 会在当前帧创建一个可见关键帧，并用局部三次缓入缓出曲线传播偏移，约四分之一秒外权重归零，不再把同一偏移复制到整段视频。时间线上的紫色菱形是关键帧，细线是影响曲线；绿色菱形表示当前帧。可用“删除当前键”或 Delete 删除当前帧关键帧，Ctrl+Z/Ctrl+Y 撤销/重做。

底层仍保留关键帧曲线和平滑功能；当前 Studio 界面以按关节修复和选中帧导出为主，旧曲线模式切换与批量平滑按钮暂不显示。

多视角联合求解还会自动执行一次有界防抖：低置信度噪声可向曲线靠拢；高置信度样本只有呈现小幅、相邻帧反向的高频摆动时才允许最多 6 mm 的修正。动作峰值、大幅转向、脚接触和无效帧保持锁定。完成状态会报告整体抖动指标降幅及其中高置信度微抖修正样本数。

需要处理局部抖动时，优先使用右侧“锁定此帧 / 排除此部位 / 重建区间”，并通过原始叠影检查结果。

## 动作导出

捕捉完成或打开已有 `motion.amotion` 后，可直接点击“导出 BVH”或“导出 VRMA”。两种格式都会把 `sceneRoot` 世界位移/旋转与髋部局部运动正确合并到目标格式的 `Hips` 根节点；置信度、有效性、脚接触和推理来源继续保留在原始 `.amotion` 动作包中。

- BVH 默认使用厘米、Y 轴向上，适合 Blender、Maya 和多数通用 DCC。
- VRMA 使用正式的 `VRMC_vrm_animation` 1.0 扩展和二进制 glTF 容器，可将同一动作重定向到不同 VRM 1.0 人形模型。

时间线上的“设为起点”“设为终点”可创建非破坏性片段区间，“区间循环”用于检查首尾衔接；存在区间时，BVH 和 VRMA 只导出该区间。原始 `.amotion` 不会被裁掉。

常用快捷键：空格播放/暂停，←/→ 逐帧，Shift+←/→ 跳 10 帧，I/O 设置区间起点/终点，L 切换区间循环，Delete 删除当前帧关键帧，Ctrl+Z/Ctrl+Y 撤销/重做修正，Ctrl+S 保存动作。

命令行也可导出，并可选择米或厘米：

```powershell
.\build\windows-ninja\animocap.exe export-bvh outputs\clip\motion.amotion `
  --output outputs\clip\motion.bvh --unit centimeters

.\build\windows-ninja\animocap.exe export-vrma outputs\clip\motion.amotion `
  --output outputs\clip\motion.vrma

.\build\windows-ninja\animocap.exe trim-motion outputs\clip\motion.amotion `
  --output outputs\clip\take-01.amotion --start-frame 30 --end-frame 180
```

默认拒绝覆盖已有文件；确认需要替换时添加 `--force`。

## 时序稳定

Studio 提供[辅助 AI 推理间隔](docs/expert-interval.md)，可选逐帧、每 2 帧、每 3 帧或自动，初始试用设置为每 2 帧。它减少辅助姿态专家调用，基础动捕与最终动画仍逐帧；风险帧会自动补算，调用记录保存在 `expert-schedule.json`。

加载捕捉结果时会自动执行三帧中值去跳点、五帧对称时序平滑和全序列运动学优化。优化器使用稳健骨长、关节置信度和二阶时间约束，只移动有效 3D 观测，不改手工 2D 点，也不会把缺失点伪造成有效数据。接触帧还会约束脚掌水平漂移。

GUI 保留最高精度模型配置：HRNet/MotionBERT 逐帧生成基础观测，RTMW-x 384 与 Human-Art ViTPose 按辅助 AI 间隔和风险信号复核；模型明显冲突时降低置信度而不是盲目平均。LK 光流只在人物前景中延续关节。若本机已有 `private/models/sam2/sam2.1_hiera_small.pt`，前景来自 SAM 2.1 整段视频传播；否则自动回退 GrabCut。

Studio 捕捉默认在固定人物 ROI 后运行 NVIDIA Maxine VFX 1.2 Video Super Resolution Mode 4，将人物区域 AI 放大 2× 后再交给 HRNet、RTMW-x 与 Human-Art ViTPose；三个专家共享同一张放大帧，关节点会按放大比例除回并加上 ROI 偏移，因此最终坐标仍属于原视频。桥接 DLL 由 Windows CMake 构建自动生成；本地运行还需要把 `NVCVImage.dll`、`NVVideoEffects.dll`、`nvngxruntime.dll`、`nvVFXVideoSuperRes.dll` 与 `nvngx_vsr.dll` 放在 Git 忽略的 `private/maxine-vfx/runtime/`。命令行可用 `--upscale off` 做无超分诊断，或通过 `ANIMOCAP_MAXINE_VFX_RUNTIME` 指定运行目录。

重建时还会依据脚掌/脚尖相对地面高度与速度生成左右脚接触轨道，并用滞回阈值与单帧毛刺过滤保持稳定。接触帧数、接触占比、置信度范围和无效观测数写入每个动作包的 `diagnostics.json`。

## 本地视觉纠错

界面默认启用“本地视觉纠错”。它只在低置信度、轨迹突跳、遮挡或左右肢体混淆的候选帧调用本机 Qwen3-VL，不会逐帧占用显存；HRNet 与光流仍负责连续跟踪。所有视频帧只在本机处理，不上传云端。

在目标 RTX 5070 Ti Laptop（12 GB VRAM）上，点击“配置本地 AI”会安装 Ollama 并拉取 qwen3-vl:4b。本地模型未启动时，捕捉会继续使用 HRNet、光流和时序平滑，并在状态栏明确提示纠错阶段不可用。

## 外观参考辅助

左侧“外观参考 · 导入”可载入目标角色的 PNG/JPG/WebP/BMP 参考图；“外观辅助 · 开”只在本地 Qwen3-VL 复核低置信度、遮挡、突跳或左右肢体歧义帧时发送参考图。当前视频帧仍是坐标和姿势的唯一空间权威，参考图只用于确认目标角色的外观、轮廓、可见肢体和服装连续性，不会把参考图的姿势或坐标硬套到当前动作。参考图路径和参与情况会写入 `visual-recovery-issues.json`；没有参考图或本地 VLM 不可用时，骨骼、前景掩码、光流和时序路径照常工作。

## Intel NPU 影子评估

Intel AI Boost NPU 是独立的低功耗观察器，不替代 RTX 上的 HRNet、Human-Art ViTPose-L、RTMW-x 或 MotionBERT。`tools/setup_openvino_npu.ps1` 会在本地虚拟环境固定安装 OpenVINO 2026.2.1，并把 Intel Open Model Zoo 的 `human-pose-estimation-0005` FP16 模型下载到 Git 忽略的 `private/`。第一次 NPU 编译可能需要约 90 秒；编译缓存保存在 `private/cache/openvino/`，之后启动复用缓存。

Studio 以 `shadow` 模式稀疏运行 NPU：默认每 15 帧以及部分低置信度帧生成一次独立 COCO 17 点观测，并在每个视角旁写出 `npu-shadow-diagnostics.json`。报告包含总帧数、采样间隔/比例、实际执行设备、模型哈希、延迟、无效关节、与 GPU 权威观测的人员框归一化误差及左右交换数。NPU 会把左右交换、至少 5 个缺失关节或明显 GPU/NPU 分歧的采样帧优先送入本地 VLM/GPU 疑难帧恢复，并记录请求帧、已处理帧及接受的关节修正数；它自己的坐标仍不参与融合。GUI 在参考时间轴和问题面板中显示这些帧及处理结果。低占用是稀疏巡检策略的预期结果，不是要求追满的吞吐指标；缺少 OpenVINO、模型、NPU 驱动或本地 VLM 只产生明确警告，CUDA Mocap 保持可用。

## 单目深度说明

单方向视频不能唯一确定人体前后深度，动漫角色也超出常见真人训练集分布。软件会检测 MotionBERT 深度是否符合人体尺度；深度异常时明确回退为 `mmpose-hrnet-motionbert+2.5d-fallback`，以真实 HRNet 2D 关节点为准，将深度限制在小范围内。这样优先保证四肢拓扑和画面对齐，不把错误深度伪装成可靠 3D。

## 骨架预设

“导入骨架预设”读取角色导出的 `profile.json` 或 `skeleton.json`，用于提供该角色的规范骨长、静止骨架比例和低置信度修正阈值。它会约束下一次捕捉，也可以按该骨架重建当前动作；它不会导入角色模型、贴图、服装或特效。Studio 会明确报告本次修正样本数、平均/最大修正毫米数；若没有触发低置信度修正，会显示“本次未产生影响 · 0 样本 · 0 mm”。

## 构建与测试

需要 Windows、Visual Studio C++ Build Tools 和 CMake/Ninja：

```powershell
.\tools\build_msvc.ps1
.\build\windows-ninja\animocap_tests.exe
```

主要目录：

```text
include/animocap/            C++ 公共接口
src/                         C++ 核心、Media Foundation 解码、CLI 与 Win32 GUI
python/animocap_ml_adapters/ MMPose 独立进程适配器
tools/                       构建、环境安装与启动脚本
outputs/                     本地推理产物（Git 忽略）
project-context/             持久项目决策与边界
```

规范坐标为右手系、Y 向上、+Z 向前、单位米；规范骨架包含规格 v0.2 明确列出的 23 个语义关节。模型权重、测试视频和专有游戏素材不会提交到仓库。

## 动画优先多视角捕捉

默认的方向重复采集是三视角 front fan：`front_left` -45°、`front` 0°、`front_right` +45°。同一动作不要求同时开始或拥有相同的前后空白长度；允许小幅编码/播放速率差异。GUI 直接导入会优先识别这三个明确标签；传统 `front`、`right`、`back`、`left` 四方向清单仍兼容，且 `front` 不会误匹配 `front_left` 或 `front_right`。软件支持 MP4、MOV、AVI、MKV、WebM 和 M4V。

`capture.json` 是任意角度和扩展视角的输入：`directional_repeat` 与 `synchronized_multiview` 都接受 2–8 个唯一 view id；方向重复模式的每个活动 view 必须显式提供有限 `yaw_degrees`，同步标定模式的 yaw 可由标定数据提供。可选 `time_offset_s` 是人工同步锚点：正值表示相对参考时间从该视角更晚的位置取帧；未提供或为零时使用自动动作相位匹配。直接文件/文件夹导入保持 fan3 或传统 cardinal4 的引导路径，4–8 个任意角度请使用清单；GUI 预览保留 8 个可选槽位，不要求填满。

确认后点击“开始捕捉”。处理顺序是：共享姿态模型 → 各视角独立 2D 观测 → 使用身体归一化、剔除最快异常肢端的视角不变运动能量指纹寻找共同动作事件 → 连续近仿射相位对齐 → 仅保留所有视角共同有效的动作区间 → 带确认帧的左右肢体状态 → 每关节在 hip-relative、人体框归一化坐标中的 2D 重投影共识与严格多数离群剔除 → 可见性加权共同三维求解 → 后续时序/骨长约束。相位映射不允许某路逐帧停顿后再追赶；区间外观测也不会夹到首尾帧继续投票。可见性权重逐帧检查身体侧别、镜像关节重叠、跨视角肢段稳定性和画面边缘；近侧关节最多增强 15%，远侧最多降低 30%，肢段差异低于 20% 不触发权重变化，并用短时因果滤波避免权重闪烁。它只能调整已经兼容的观测，不能推翻严格多数离群判断。方向重复模式自动选择最接近 0° 的视角为参考；最终优化后，参考视角高置信度关节的两个图像平面坐标会被恢复，其他视角只补充正交深度、遮挡恢复和低置信度证据。不兼容观测不会被平均。

最终动作不是各视角单独动作的平均值；所有视频只生成观测，随后共同求解同一副三维骨架。结果目录包含 `motion.amotion`、`fused_pose_sequence.json`、`comparison_pose_sequence.json` 和 `multiview-diagnostics.json`。高置信正面参考在另一视角贡献且未被严格多数判为离群时保持图像平面所有权；单个冲突侧视角不能拉走正面，只有明确的严格多数拒绝才让正面让权。诊断同时记录每路偏移、近仿射速率和“共同覆盖帧/原参考帧”。捕捉完成后默认显示可点击的 2×4 多视角总览；进入任一画面后，Studio 使用连续解码在同一参考时间轴上播放该路视频及其本路 2D 姿势。“FUSED 3D · A/B DEPTH REVIEW”会以灰色虚线显示未增强基线、紫色显示增强结果，并报告当前帧平均/最大差异毫米数；默认斜视角可直接看出 Z 轴变化。非参考视角只读。只有显式角色 profile 可从同一不可变基线修正低置信度样本。上述结构和确定性测试不代表已经完成真实视频质量验收；真实相机高度、尺度和任意角度 QA 仍需单独进行。

融合不会把三个视角的全部缺陷逐帧累加。每个视角先在自身的身体尺度归一化轨迹中计算局部速度与加速度；只有某个视角出现而其他视角没有的瞬时尖峰才会在该关节、该帧被降权。其余视角继续形成稳健共识，不永久删除任何机位。被识别的跨视角时序分歧会临时放宽有界动画曲线的修正权限，但最终输出置信度保持融合证据本身的数值；动作峰值、转向、接触段和无效观察仍按原规则保护。诊断字段 `temporal_outlier_downweighted_observations` 与 Studio 状态栏显示实际触发次数。

## 同步标定多机捕捉

需要真实透视深度时，可使用 2–8 台相机并完成一次棋盘格标定。软件同步是“同时 grab、随后 retrieve”，会保存每帧取帧跨度；若相机支持硬件同步，应优先使用硬件同步。标定完成后不要移动相机。

```powershell
# 先录制所有相机都能看到、在空间中缓慢移动的 9×6 内角点棋盘格
.\tools\capture_synchronized.ps1 -Cameras 0,1,2 `
  -Names front,left,right -Output private\calibration -Duration 25 -Preview

# 方格边长示例为 25 mm；会写 calibration.json 并更新 capture.json
.\tools\calibrate_multiview.ps1 `
  -Manifest private\calibration\capture.json -SquareSizeMeters 0.025

# 保持相机不动，再录制演员动作
.\tools\capture_synchronized.ps1 -Cameras 0,1,2 `
  -Names front,left,right -Output private\take-01 -Duration 15 -Preview
Copy-Item private\calibration\calibration.json private\take-01\calibration.json
```

然后在 GUI 点“导入多视角”，选择 `private\take-01\capture.json`。程序会读取 2–8 视角清单，逐机推理后执行镜头畸变校正、置信度加权透视三角化和像素重投影离群剔除。校准求解不会用单目深度填充失败点；少于两个有效相机的关节保持无效，交给问题面板和手工修正。

## 动画角色参考、合成数据与本地微调

角色参考用于提高动画/游戏画面的捕捉稳定性，不是输出目标绑定。输入必须是已保存且可映射 23 个身体关节的 `.blend`；导出器不会保存或修改源文件。默认 `similar_reference` 只用模型比例辅助低置信观察：同一骨骼两端在至少 10 帧且至少全片 5% 的帧中达到阈值时，视频比例优先。高置信端点、无效观察和手工修正不会被角色先验覆盖。

```powershell
# 从 Blender/MMD 角色制作本地 v1.1 参考包并在干净 Blender 中重导验证
.\tools\prepare_character_reference.ps1 `
  -CharacterBlend private\characters\character.blend `
  -Config private\characters\profile-config.json `
  -OutputDirectory private\character_profiles\character

# 从训练动作生成配对 RGB、人体掩码和精确 COCO 关键点；特效只作为无标签干扰
.\tools\generate_character_dataset.ps1 `
  -Profile private\character_profiles\character\profile.json `
  -Motions private\motions\train-01.amotion `
  -MotionIds train-01 `
  -HeldOutMotions private\motions\holdout-01.amotion `
  -HeldOutMotionIds holdout-01 -IncludeEffects
```

`character.glb`、可选 `effects.glb`、`mocap_mask.glb`、`skeleton.json` 和 `profile.json` 全部写入 Git 忽略的 `private/`。多网格、显式骨骼覆盖和无特效角色均受支持；物理、辅助、面部、布料、头发、武器和翅膀骨不进入 23 关节映射。

手工修正过的 pose sequence 可连同原视频导出为私有 COCO 17 点数据集。脸部缺少的眼/耳点不参与监督；默认至少需要 8 个高置信身体关节。必须先按源动作划分训练/留出集，再提取帧；同一动作的不同机位不能作为唯一留出。用于激活证据的真人训练集和留出集都必须用 `-SourceMotion` 绑定 `.amotion` 内容哈希，并用稳定的 `-SourceMotionId` 标记动作本身；同一动作的所有机位必须使用同一 ID。合成渲染也必须传入对应 `MotionIds`/`HeldOutMotionIds`。合成样本最多为修正真人样本的两倍；允许纯合成训练，但其 checkpoint 不具备激活资格。

```powershell
.\tools\export_anime_dataset.ps1 `
  -Video private\source.mp4 -Pose outputs\take\fused_pose_sequence.json `
  -SourceMotion private\motions\train-01.amotion -SourceMotionId train-01

.\tools\assemble_character_dataset.ps1 `
  -CorrectedRealTraining private\datasets\real-train `
  -Synthetic private\training\character\synthetic `
  -HeldOut private\datasets\distinct-motion-holdout

.\tools\train_anime_pose.ps1 -Epochs 40 -BatchSize 4

# 对独立动作评估；侧对侧检查不得出现新增滑脚或更多手工修正
.\tools\evaluate_character_capture.ps1 `
  -GroundTruth private\evaluation\corrected.json `
  -Baseline private\evaluation\baseline.json `
  -Candidate private\evaluation\candidate.json `
  -CandidateCheckpoint private\training\anime-hrnet-w32\best.pth `
  -CandidateConfig private\training\anime-hrnet-w32\anime_hrnet_w32_256x192.py `
  -Profile private\character_profiles\character\profile.json `
  -DatasetManifest private\training\animation-character-keypoints\dataset.json `
  -Output private\evaluation\candidate-report.json -VisualReviewAccepted

# 仅接受哈希匹配的通过报告；旧活动模型会进入可回滚历史
.\tools\activate_anime_pose.ps1 `
  -Checkpoint private\training\anime-hrnet-w32\best.pth `
  -EvaluationReport private\evaluation\candidate-report.json

.\tools\rollback_anime_pose.ps1
```

训练配置使用 HRNet-W32、AMP、梯度裁剪和小批量，面向 12 GB VRAM。激活门槛为边界框对角线归一化身体关节中位误差至少相对下降 10%，无无效/低置信率或左右互换增加，高置信关节的角色先验移动为零，并通过人工并排检查。新权重永不自动替换活动模型；RTMW 保持独立置信度复核器，本地 VLM 仍只处理稀疏恢复帧。

## Animation-domain expert fusion

The maximum offline path now keeps MotionBERT as the only production 3D lifter and runs three independent 17-joint 2D hypotheses where available: the active base HRNet (or the activated character-HRNet checkpoint), Human-Art ViTPose-L, and RTMW-x 384. Hypotheses are clustered per COCO joint using the active person ROI/body box. Compatible evidence may be combined; incompatible limbs are never averaged. An unresolved conflict keeps an observed hypothesis with reduced confidence, and missing predictions remain invalid.

When `--expert-interval` is omitted, quality scheduling is unchanged: `fast` is base-only, `balanced` invokes ViTPose-L and RTMW adaptively, and `maximum` invokes both experts on every usable frame. An explicit expert interval overrides balanced/maximum scheduling; Studio starts with interval 2 and checks risk frames densely. MMPose 1.3.2's bundled Human-Art config still names the retired `mmcls.VisionTransformer`; the adapter non-destructively migrates the in-memory config to `mmpretrain.VisionTransformer`, removes the legacy output argument, and loads the immutable official checkpoint with a narrowly scoped PyTorch 2.6+ compatibility boundary. Model failure is still reported explicitly and the available CUDA path remains usable.

Held-out confidence calibration is a local, evidence-bound JSON profile. Create it with `tools\calibrate_pose_confidence.ps1 -Evidence private\calibration\labelled_pose_evidence.json`; the evidence must contain labelled real samples from at least two distinct source motions for HRNet, Human-Art ViTPose-L, and RTMW. The fitter preserves each model's raw score domain (including RTMW SimCC responses above one) and produces monotonic per-model/per-joint curves plus the source hash and motion IDs. Pass the result with `--confidence-calibration private\calibration\pose_confidence.json`, or use that ignored conventional path for auto-discovery. Structurally valid curves without the held-out evidence block are rejected. Without a profile, probability-like experts keep their native scale, RTMW uses a monotonic bounded response transform, and compatible experts publish conservative agreement support rather than the maximum score.

Directional multiview fusion now keeps the balanced multiview image plane through the final optimization stage. The former raw reference-view image-plane overwrite remains available only as the explicit `fuse-multiview --reference-image-plane-anchor` compatibility option; diagnostic F0 controls enable it explicitly.

The official Human-Art ViTPose-L config/checkpoint and the required MMPreTrain dependency are installed/cached only by `tools\setup_mmpose.ps1`; weights and calibration remain local/Git-ignored and are never bundled. Local verification on 2026-08-11 loaded the full maximum HRNet + MotionBERT + RTMW-x + ViTPose-L session and ran a real 2304×1440 animation frame through ViTPose-L on CUDA (17/17 returned joints). This proves execution compatibility, not held-out quality or checkpoint activation evidence.
