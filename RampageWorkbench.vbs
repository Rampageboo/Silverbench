Set shell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' Immediate splash (PowerShell) — sole boot UI until Tauri main window is ready.
splashCmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\scripts\launch-splash.ps1"" -Root """ & root & """"
shell.Run splashCmd, 0, False

' The built app (update.bat makes it) starts in seconds and needs no Node/Rust at run time.
' Without it, fall back to development mode.
app = root & "\apps\desktop\src-tauri\target\release\rampageworkbench-desktop.exe"
If fso.FileExists(app) Then
    shell.CurrentDirectory = root
    shell.Run """" & app & """", 1, False
Else
    shell.Run "cmd /c """ & root & "\run-silent.bat""", 0, False
End If
