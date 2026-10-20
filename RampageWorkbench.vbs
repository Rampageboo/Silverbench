Set shell = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(WScript.ScriptFullName)

' Immediate splash (PowerShell) — sole boot UI until Tauri main window is ready.
splashCmd = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & root & "\scripts\launch-splash.ps1"" -Root """ & root & """"
shell.Run splashCmd, 0, False

shell.Run "cmd /c """ & root & "\run-silent.bat""", 0, False
