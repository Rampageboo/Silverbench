# 存储格式 v3：按生命周期分层

Owner 的要求：YOLO 数据集从工作区分离；应用（RWB）只存工作区路径；其余按功能合理设计；视频分帧不需要落盘。

## 现状的问题（以 `D:\Yolo\ZZZ` 为例）

- **版本 = 整个工作区的完整拷贝。** `ZZZ/V1/` 里有 24 GB 素材；新建 V2 会再复制 24 GB。
- **四类生命周期完全不同的文件混在一个目录树里：** 源素材（大、只读）、标注（小、是真相）、派生产物（数据集、缓存、视频代理、临时帧，可再生）、界面状态（滚动位置、当前图片、工具开关）。
- **类别定义存了四份：** `workspace/classes.json`、根目录 `classes.txt`、`workspace.json` 的 `classification_classes`、`data.yaml` 的 `names`；分配页甚至从 `clf_dataset` 的文件夹名和 `detect_dataset/data.yaml` 反推类别——派生产物成了真相来源。
- **数据集常驻工作区：** `detect_dataset/`、`clf_dataset/`、`auto_label/` 是工作目录，同时被当作输入和输出。
- **视频标注存的是绝对路径**（`D:\Yolo\ZZZ\V1\media\...mp4`），移动工作区或建版本就会断链。
- 占位文件从未使用：`workspace/sources.json`、`workspace/annotations/`。
- 应用自身的数据放在安装目录（`Sessions/`、`yolo_app_settings.json`），工作区路径同时存在后端设置和浏览器 localStorage 两处。

## 设计原则

1. 一个事实只存一处。
2. 按生命周期分层：**源素材**不复制、不改写内容；**标注**是唯一真相、体积小、可版本化；**产物**可以随时删掉重建；**本机状态与缓存**可以随时删掉，不影响任何数据。
3. 工作区内只存相对路径，整个文件夹可以移动、复制、同步。
4. 视频只按时间戳标注；帧只在导出数据集或自动标注时临时抽取，不持久保存。

## 应用层（RWB）

位置：`%APPDATA%\RampageWorkbench\`（不再写安装目录）。

```text
%APPDATA%\RampageWorkbench\
  settings.json      { version, workspaces: [路径...], lastWorkspace, 界面偏好(主题/侧栏/启动页) }
  gallery\           图库与提示词（跨工作区的独立功能，原 Sessions\gallery）
  logs\              后端日志
```

应用只记住工作区路径。浏览器 localStorage 不再保存工作区路径（只留纯界面偏好）。

## 工作区（v3）

```text
MyProject\
  rwb.json                  清单：format "rwb-workspace"、version 3、id、name、时间戳、各任务开关
  classes.json              唯一的类别表（检测类带稳定 yoloId，分类类带 key；改名/归档都在这里）
  media\                    源图片与视频（原样存放，应用不改写内容）
  labels\                   标注 = 唯一真相
    images\<图片名>.txt      YOLO 框（类别 id 来自 classes.json 的 yoloId）
    images.csv              每张图的状态：split、任务开关、分类、废片、已审、标记、下次训练
    videos\<视频名>.json     视频标注：按时间戳存框和分类；视频用 media 下的相对路径引用
    segments\<视频名>.json   视频片段
    proposals\              自动标注提议（未确认的预测）
    autolabel-runs.json     哪些图已用哪个模型自动标注过（防止重复）
  models\                   导入的 .pt 模型 + registry.json（当前启用的自动标注模型）
  runs\                     训练输出（Ultralytics）
  exports\                  默认的数据集导出位置（可以改到工作区外）
  backups\originals\        裁剪/涂黑等破坏性编辑前的原图与原标注
  versions\                 标注快照：每个版本只含 labels\ + classes.json
    versions.json
    V1\ ...
  .rwb\                     本机状态与缓存，随时可删
    session.json            界面状态（当前图片、筛选、快捷键槽、工具开关）
    cache\thumbs\  cache\video-proxy\  cache\frames\  cache\scan.json
    logs\
```

### 关键决定

- **YOLO 数据集不再常驻工作区。** “导出数据集”从 `labels\` + `images.csv` + `classes.json` + `media\` 生成一个标准 YOLO 文件夹（`images/`、`labels/`、`data.yaml`），视频按标注时间戳临时抽帧写入；附 `rwb-export.json` 记录来源工作区、版本与时间。数据集准备、合并、训练都针对导出的文件夹进行。
- **类别只认 `classes.json`。** `classes.txt`、`data.yaml` 里的名字都是导出时生成的；分配页和标注页不再从数据集文件夹反推类别。
- **框继续用 YOLO txt 存。** 格式简单、通用；类别 id 由 `classes.json` 的稳定 yoloId 保证，改名不影响。
- **版本只快照标注。** 新建版本 = 复制 `labels\` 和 `classes.json`（几 MB）；切换版本 = 把快照换回 `labels\`。素材始终只有一份。
- **视频分帧不落盘。** 抽出的帧只进 `.rwb\cache\frames\`，用完即删。“视频截图”页是主动把画面导入为图片，保存到 `media\`，属于导入而不是分帧缓存。

## 迁移（v2 → v3）

- 打开旧工作区时检测并提示迁移；先给出预览（会移动哪些文件、删除哪些可再生内容），确认后执行。
- 只在同一卷内移动/重命名，不复制素材；每一步写入 `.rwb\migration-journal.json`，可以回滚。
- 旧的 `V1\` 容器被展开为工作区根目录；如果有多个 V*，非当前版本只保留其标注作为快照。
- 视频标注里的绝对路径改写为 `media\` 相对路径。
- 旧的 `detect_dataset\`、`clf_dataset\`、`auto_label\` 是由硬链接/拷贝生成的产物：移到 `exports\legacy-<日期>\` 保留，不删除。
- 缓存、代理、临时帧移入 `.rwb\cache\`；`sources.json`、`workspace\annotations\` 这类空占位直接删除。
- 不处理真实数据：迁移代码在测试工作区上验证，Owner 确认后再对 `D:\Yolo\ZZZ` 执行。

## 实施顺序

1. 后端路径层：一个 `WorkspaceLayout` 解析所有路径（v3 原生，v2 只用于迁移），替换各处硬编码目录名。
2. 迁移：预览 / 执行 / 回滚，含视频标注路径改写；单元测试覆盖。
3. 类别单一来源；去掉从数据集反推类别。
4. 数据集导出（含视频按时间戳抽帧）；数据集工具改为读写导出文件夹。
5. 版本改为标注快照。
6. 应用层数据移到 `%APPDATA%`；会话状态与缓存移到 `.rwb\`。
7. 前端：路径全部来自后端返回的布局；新的打开/迁移流程。
