' Create a desktop shortcut that launches RampageWorkbench.vbs (no console window).
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
launcher = root & "\RampageWorkbench.vbs"
icon = root & "\assets\app-icon.ico"
desktop = shell.SpecialFolders("Desktop")
linkPath = desktop & "\RampageWorkbench.lnk"

If Not fso.FileExists(launcher) Then
    MsgBox "Launcher not found: " & launcher, vbCritical, "Silverbench"
    WScript.Quit 1
End If

Set link = shell.CreateShortcut(linkPath)
link.TargetPath = launcher
link.WorkingDirectory = root
If fso.FileExists(icon) Then link.IconLocation = icon
link.Description = "Silverbench"
link.Save

MsgBox "Desktop shortcut created:" & vbCrLf & linkPath, vbInformation, "Silverbench"
