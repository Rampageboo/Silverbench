# AniMocap Fusion 合并交接

此文档替代会话上下文。源码保存于私有仓库 `Rampageboo/AniMocap_Fusion`；
2026-10-23 的归档 Release 使用 `archive-2026-10-23` 标签，源码与二进制附件由该标签绑定。
这是一份工程迁移归档，不是经过真实视频质量验收的正式产品发布。

## 应保留的产品边界

AniMocap 负责捕捉、检查、修正和选择最终姿态；Blender 负责 Action、F-Curve、插值及后续动画编辑。
不要把“模型推理过的帧”“用户锁定的可信帧”“用于 Blender 导出的选中帧”合并成同一个状态。

| 能力 | 集成入口与约束 |
| --- | --- |
| 逐关节纠错 | `include/animocap/pose_review.hpp`、`src/pose_review.cpp`；单点锁定、软权重、局部排除、区间重建；两端需锁定，连续无支持缺口不超过 0.75 秒 |
| 修复工程 | `.amotion.areview/` 保存 `source.json` 和 `review.json`；保存基线、标记、区间，撤销栈与历史手动偏移曲线不跨会话保存 |
| 人体预览 | `src/gui_main.cpp` 原生 Win32/GDI；人体左右、正侧面、点击选点、修复状态、叠影和撤销/重做；它不是网页应用 |
| 辅助 AI 间隔 | `python/animocap_ml_adapters/expert_schedule.py`；1/2/3/auto，只调度 RTMW 与 Human-Art；基础 HRNet/MotionBERT、光流和动画时间轴仍逐帧 |
| 风险加密 | 缺失/低置信度、快速/突变运动、跟踪失败、专家冲突或无结果；每个视频使用独立调度状态；跳过的专家不贡献旧帧预测 |
| ROI AI 放大 | `src/maxine_vsr_bridge.cpp`、`maxine_vsr.py`；固定人物 ROI → Maxine VSR 2× → 专家共享输入；必须将关键点除回缩放比例并加上 ROI 原点 |
| 多视角 | `src/multiview.cpp`；默认保留平衡融合结果，旧参考图像平面覆盖仅在 `--reference-image-plane-anchor` 显式启用；分别录制的方向视频不等于同步多相机 |
| Blender 交换 | `blender_exchange.hpp`、`export_blender.cpp`、`schemas/animocap-blender.schema.json`、`blender_addon/animocap_fusion/`；导出选定帧的完整规范姿态，在 Blender 新建 Action，保留已有 Action |
| 外观参考 | `local_vlm_adapter.py`；只辅助识别人物外观和歧义，当前视频帧仍是坐标权威，不能照搬参考图姿势 |
| 置信度 | 保留不同模型原始分数域，RTMW 响应可能超过 1；校准必须有独立标注证据，不能将模型自信当作真实准确率 |

## 当前验收事实

2026-10-23 从 Git 暂存区导出的独立源码目录构建，未依赖工作区未跟踪文件：

- MSVC Release 完整构建成功：CLI、Studio、核心库、Maxine 桥接 DLL、四个测试程序。
- CTest：`animocap_core`、`animocap_animation_curve`、`animocap_pose_review`、`animocap_blender_exchange`，4/4 通过。
- Python：`test_expert_schedule.py` 与 `test_ml_adapters.py` 共 43 项，42 项通过，1 项因验证解释器缺少 MMPose 跳过。
- 跳过项为 `test_humanart_config_is_migrated_without_legacy_mmcls_arguments`。9 月在项目推理环境中的历史运行也未完成；不能视为已通过。
- Git 暂存新增内容扫描未发现个人目录和常见凭据模式。归档附件是私有工程备份，可能保留原有输入路径和诊断日志，不能直接转成公开下载。
- 本次修正了 Blender CTest 的输出参数，并纠正 README 中隐藏曲线按钮和辅助专家默认调度的陈旧说明。

原始构建/测试日志、软件可执行文件和依赖清单随 Release 附件保存。
诊断实验工具与过去的图形验收记录保留为历史证据，不代表它们在本次全部重新运行。

## 不应误称为完成的工作

1. 缺少同片段的真实 GPU 逐帧/interval 对照；每 2 帧是试用默认值，不保证两倍速度或质量不降。
2. 最新修复面板没有完成实片端到端视觉验收。代码和单元测试通过不等同于实时窗口和导出结果均被接受。
3. 当前修复只作用于已生成的观测；此前平滑或融合传播到邻点的错误不会被反向消除，也不是重新三角化。
4. 锁定精确性适用于观测编辑层；后续重定向与脚部处理仍可能改变导出骨架的世界坐标。
5. 脚滑、根位置漂移、错误深度、长时间遮挡仍需要独立约束与验收。禁止以“更平滑”替代真实姿态准确率。
6. Maxine 历史桥接存在 SDK effect 销毁阻塞的进程退出回收策略；真实视频长期运行和生命周期尚需验证。

## 恢复与合并

1. 获取标签 `archive-2026-10-23` 的源码。保留 `include/animocap/`、`src/` 的合同和测试，再决定是否替换 GUI。
2. 安装 Windows C++ Build Tools/CMake；`tools/build_msvc.ps1` 是正常构建入口。不要搬运旧 CMakeCache，它包含本机路径。
3. 用 `tools/setup_mmpose.ps1` 重建 Python 环境；归档中的 package-version 清单用于对照。CUDA/PyTorch、MMPose、MMPTrain、OpenVINO 与 Maxine 需分别验证。
4. 解压工程数据附件到新源码根目录，可恢复 `outputs/`、`private/` 和视觉证据。项目目录外的视频按附件 manifest 的原路径映射恢复或更新 `source_video`/capture manifest。
5. 参考 [关节修复](joint-review.md)、[推理间隔](expert-interval.md) 和 [Blender 插件](../blender_addon/animocap_fusion/README.md) 接入目标软件。
6. 迁移后先跑合同测试，再用真实视频对照姿态、漂移、输出帧数、时间戳和速度；不要直接将试用间隔固化成新产品质量承诺。

## 归档范围与删除边界

- Git：全部当前源码、文档、诊断脚本、测试、schema、必要展示资源和历史决策。
- Git bundle 附件：保留当前本地全部 refs 可达的提交，包含尚未合入主线的历史分支；不会保存任意未提交文件或远端未知提交。
- 数据附件：当前 `outputs/`、`private/`，现存被引用的外部视频，部分 UI 截图与本次验证证据；manifest 为每个文件记录哈希和原始相对路径。
- 不备份可再生成的虚拟环境、编译缓存、Graphify 缓存和 Python 字节码；第三方大型模型如位于本项目之外的用户缓存中，也不自动搬入。依赖和模型获取入口保留在源码中。
- 部分历史输入引用在备份前已经失效；完整原路径清单留在私有数据附件 manifest。不能声称附件恢复了不存在的文件，也不能用同名视频冒充。
- 只在 Release 附件上传且尺寸/摘要核对完成后删除本地项目；若还需要引用失效的原视频，应先在其他备份中找回。

历史讨论出处见 [DECISIONS.md](../DECISIONS.md) 与 [THREAD_INDEX.md](../THREAD_INDEX.md)。
即使那些会话被删除，本文件与源码仍应足以解释实现、限制和下一步验收。
