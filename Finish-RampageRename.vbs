' One-time GUI launcher. Save work, run this, then close apps using the project.
Set taskShell = CreateObject("WScript.Shell")
Set taskFso = CreateObject("Scripting.FileSystemObject")
taskRoot = taskFso.GetParentFolderName(WScript.ScriptFullName)
taskShell.CurrentDirectory = taskFso.GetParentFolderName(taskRoot)
taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & taskRoot & "\scripts\finish-project-rename.ps1"" -SourceRoot """ & taskRoot & """ -WaitMinutes 30"
taskShell.Run taskCommand, 0, False
