# AniMocap Fusion

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

## 稀疏锚点校准

自动捕捉完成后点击“手动修正”。只拖动错位的头、肩、肘、腕、髋、膝或踝；一次拖动的关节偏移会传播到整段视频，并重新生成内存中的规范动作，不需要逐帧调整。

## 动作导出

捕捉完成或打开已有 `motion.amotion` 后，可直接点击“导出 BVH”或“导出 VRMA”。两种格式都会把 `sceneRoot` 世界位移/旋转与髋部局部运动正确合并到目标格式的 `Hips` 根节点；置信度、有效性、脚接触和推理来源继续保留在原始 `.amotion` 动作包中。

- BVH 默认使用厘米、Y 轴向上，适合 Blender、Maya 和多数通用 DCC。
- VRMA 使用正式的 `VRMC_vrm_animation` 1.0 扩展和二进制 glTF 容器，可将同一动作重定向到不同 VRM 1.0 人形模型。

时间线上的“设为起点”“设为终点”可创建非破坏性片段区间，“区间循环”用于检查首尾衔接；存在区间时，BVH 和 VRMA 只导出该区间。原始 `.amotion` 不会被裁掉。

常用快捷键：空格播放/暂停，←/→ 逐帧，Shift+←/→ 跳 10 帧，I/O 设置区间起点/终点，L 切换区间循环，Ctrl+Z/Ctrl+Y 撤销/重做修正，Ctrl+S 保存动作。

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

加载捕捉结果时会自动执行三帧中值去跳点、五帧对称时序平滑和全序列运动学优化。优化器使用稳健骨长、关节置信度和二阶时间约束，只移动有效 3D 观测，不改手工 2D 点，也不会把缺失点伪造成有效数据。接触帧还会约束脚掌水平漂移。

GUI 默认使用最高精度模式：HRNet/MotionBERT 生成基础观测，RTMW-x 384 对每帧 2D 关节再推理；两个模型明显冲突时降低置信度而不是盲目平均。LK 光流只在人物前景中延续关节。若本机已有 `private/models/sam2/sam2.1_hiera_small.pt`，前景来自 SAM 2.1 整段视频传播；否则自动回退 GrabCut。

重建时还会依据脚掌/脚尖相对地面高度与速度生成左右脚接触轨道，并用滞回阈值与单帧毛刺过滤保持稳定。接触帧数、接触占比、置信度范围和无效观测数写入每个动作包的 `diagnostics.json`。

## 本地视觉纠错

界面默认启用“本地视觉纠错”。它只在低置信度、轨迹突跳、遮挡或左右肢体混淆的候选帧调用本机 Qwen3-VL，不会逐帧占用显存；HRNet 与光流仍负责连续跟踪。所有视频帧只在本机处理，不上传云端。

在目标 RTX 5070 Ti Laptop（12 GB VRAM）上，点击“配置本地 AI”会安装 Ollama 并拉取 qwen3-vl:4b。本地模型未启动时，捕捉会继续使用 HRNet、光流和时序平滑，并在状态栏明确提示纠错阶段不可用。

## 单目深度说明

单方向视频不能唯一确定人体前后深度，动漫角色也超出常见真人训练集分布。软件会检测 MotionBERT 深度是否符合人体尺度；深度异常时明确回退为 `mmpose-hrnet-motionbert+2.5d-fallback`，以真实 HRNet 2D 关节点为准，将深度限制在小范围内。这样优先保证四肢拓扑和画面对齐，不把错误深度伪装成可靠 3D。

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

## 四视角捕捉

将同一段动作从四个固定方向各录制一次，四个视频不要求同时开始，也不要求长度和动作速度完全一致。把视频放进同一文件夹，并让文件名分别包含 `front`、`right`、`back`、`left`（也识别“正面”“右侧”“背面”“左侧”）；每个方向必须恰好一个文件。软件支持 MP4、MOV、AVI、MKV、WebM 和 M4V。

在软件中点击“导入四视角”，选择该文件夹，然后点击“开始捕捉”。处理顺序是：逐视角提取 2D 关节与置信度 → 自动动作相位/速度对齐 → 跨视角左右肢体纠错 → 按置信度和对齐质量进行正交多视角三角化 → 时间与骨长约束。某一路被遮挡的关节会由其他有效视角恢复；视角间误差超过阈值时会作为冲突显示在右侧问题面板和时间轴。

最终动作不是四份单视角动作的平均值。四路视频只分别生成观测，随后共同求解同一副三维骨架。结果目录包含 `motion.amotion`、`fused_pose_sequence.json` 和 `multiview-diagnostics.json`。目前默认方向角为正面 0°、右侧 90°、背面 180°、左侧 -90°；相机应尽量保持相近高度和画面尺度。

## 同步标定多机捕捉

需要真实透视深度时，可固定 2–4 台相机并完成一次棋盘格标定。软件同步是“同时 grab、随后 retrieve”，会保存每帧取帧跨度；若相机支持硬件同步，应优先使用硬件同步。标定完成后不要移动相机。

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

然后在 GUI 点“导入四视角”，选择 `private\take-01`。程序会识别其中的 `capture.json`，逐机推理后执行镜头畸变校正、置信度加权透视三角化和像素重投影离群剔除。校准求解不会用单目深度填充失败点；少于两个有效相机的关节保持无效，交给问题面板和手工修正。

## 动漫域数据与本地微调

手工修正过的 pose sequence 可连同原视频导出为私有 COCO 17 点数据集。脸部缺少的眼/耳点不参与监督；默认至少需要 8 个高置信身体关节。数据和训练权重都保存在 Git 忽略的 `private/`。

```powershell
.\tools\export_anime_dataset.ps1 `
  -Video private\source.mp4 -Pose outputs\take\fused_pose_sequence.json

.\tools\train_anime_pose.ps1 -Epochs 40 -BatchSize 4

# 验证满意后才显式启用某个 checkpoint
.\tools\activate_anime_pose.ps1 `
  -Checkpoint private\training\anime-hrnet-w32\best_coco_AP_epoch_40.pth
```

训练配置使用 HRNet-W32、AMP、梯度裁剪和小批量，面向 12 GB VRAM。它需要本机缓存中的 HRNet 初始权重；也可通过 `-PretrainedCheckpoint` 显式指定。新权重不会自动替换正式推理模型，需先在独立验证集上比较关键点误差和失败帧，再用 `activate_anime_pose.ps1` 启用；启用后 GUI 和多机管线会自动发现它，RTMW 仍作为独立二次校验器。
