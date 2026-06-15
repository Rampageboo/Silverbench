' Create a desktop shortcut that launches YoloWorkBench.vbs (no console window).
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = root & "\YoloWorkBench.vbs"
icon = root & "\assets\app-icon.ico"
desktop = shell.SpecialFolders("Desktop")
linkPath = desktop & "\YoloWorkBench.lnk"

If Not fso.FileExists(launcher) Then
    MsgBox "找不到启动脚本：" & launcher, vbCritical, "YoloWorkBench"
    WScript.Quit 1
End If

Set link = shell.CreateShortcut(linkPath)
link.TargetPath = launcher
link.WorkingDirectory = root
If fso.FileExists(icon) Then link.IconLocation = icon
link.Description = "YoloWorkBench — YOLO 数据集全流程工作台"
link.Save

MsgBox "已在桌面创建快捷方式：" & vbCrLf & linkPath, vbInformation, "YoloWorkBench"
