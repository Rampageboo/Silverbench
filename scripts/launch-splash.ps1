# Immediate launch splash — shown before Tauri boots. Closes when the main
# workbench window is ready (ywb-launch-ready marker or visible main window).

param(
    [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ErrorActionPreference = "SilentlyContinue"

$stringsPath = Join-Path $Root "scripts\launch-splash.strings.json"
$strings = @{
    title = "Silverbench"
    tagline = ""
    stages = @("Starting...")
    timeoutHint = "Startup is taking longer than expected. See logs\desktop.log"
}
if (Test-Path $stringsPath) {
    $loaded = Get-Content -Path $stringsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($loaded.title) { $strings.title = [string]$loaded.title }
    if ($loaded.tagline) { $strings.tagline = [string]$loaded.tagline }
    if ($loaded.stages) { $strings.stages = @($loaded.stages | ForEach-Object { [string]$_ }) }
    if ($loaded.timeoutHint) { $strings.timeoutHint = [string]$loaded.timeoutHint }
}

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YwbWin32 {
  [DllImport("user32.dll")]
  public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@

$form = New-Object System.Windows.Forms.Form
$form.Text = "YWB-Launch-Splash"
$form.Name = "YWB-Launch-Splash"
$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.Size = New-Object System.Drawing.Size(460, 300)
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(8, 14, 26)

$iconPath = Join-Path $Root "assets\app-icon.ico"
if (Test-Path $iconPath) {
    $form.Icon = New-Object System.Drawing.Icon($iconPath)
}

$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Size = New-Object System.Drawing.Size(420, 36)
$title.Location = New-Object System.Drawing.Point(20, 118)
$title.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(232, 237, 246)
$title.Text = $strings.title
$form.Controls.Add($title)

$tagline = New-Object System.Windows.Forms.Label
$tagline.AutoSize = $false
$tagline.Size = New-Object System.Drawing.Size(420, 22)
$tagline.Location = New-Object System.Drawing.Point(20, 154)
$tagline.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$tagline.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$tagline.ForeColor = [System.Drawing.Color]::FromArgb(158, 172, 193)
$tagline.Text = $strings.tagline
$form.Controls.Add($tagline)

$status = New-Object System.Windows.Forms.Label
$status.AutoSize = $false
$status.Size = New-Object System.Drawing.Size(420, 20)
$status.Location = New-Object System.Drawing.Point(20, 228)
$status.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$status.Font = New-Object System.Drawing.Font("Segoe UI", 9)
$status.ForeColor = [System.Drawing.Color]::FromArgb(199, 210, 227)
$status.Text = $strings.stages[0]
$form.Controls.Add($status)

$barBack = New-Object System.Windows.Forms.Panel
$barBack.Size = New-Object System.Drawing.Size(220, 6)
$barBack.Location = New-Object System.Drawing.Point(120, 200)
$barBack.BackColor = [System.Drawing.Color]::FromArgb(40, 55, 80)
$form.Controls.Add($barBack)

$barFill = New-Object System.Windows.Forms.Panel
$barFill.Size = New-Object System.Drawing.Size(60, 6)
$barFill.Location = New-Object System.Drawing.Point(0, 0)
$barFill.BackColor = [System.Drawing.Color]::FromArgb(59, 130, 246)
$barBack.Controls.Add($barFill)

$mark = New-Object System.Windows.Forms.PictureBox
$mark.Size = New-Object System.Drawing.Size(72, 72)
$mark.Location = New-Object System.Drawing.Point(194, 34)
$mark.SizeMode = [System.Windows.Forms.PictureBoxSizeMode]::Zoom
$pngPath = Join-Path $Root "assets\app-icon.png"
if (Test-Path $pngPath) {
    $mark.Image = [System.Drawing.Image]::FromFile($pngPath)
}
$form.Controls.Add($mark)

$pidFile = Join-Path $env:TEMP "ywb-launch-splash.pid"
$readyFile = Join-Path $env:TEMP "ywb-launch-ready"
Set-Content -Path $pidFile -Value $PID -Encoding ascii
if (Test-Path $readyFile) { Remove-Item $readyFile -Force }

$startedAt = Get-Date
$barOffset = 0
$stageIndex = 0

function Test-MainWorkbenchReady {
    if (Test-Path $readyFile) { return $true }
    foreach ($proc in Get-Process -ErrorAction SilentlyContinue) {
        if ($proc.Id -eq $PID) { continue }
        if ($proc.MainWindowHandle -eq 0) { continue }
        if ($proc.MainWindowTitle -ne "Silverbench") { continue }
        $rect = New-Object YwbWin32+RECT
        if (-not [YwbWin32]::GetWindowRect($proc.MainWindowHandle, [ref]$rect)) { continue }
        $width = $rect.Right - $rect.Left
        if ($width -ge 600) { return $true }
    }
    return $false
}

$tick = New-Object System.Windows.Forms.Timer
$tick.Interval = 200
$tick.Add_Tick({
    $elapsed = ((Get-Date) - $startedAt).TotalSeconds
    $stageIndex = [Math]::Min($strings.stages.Length - 1, [int]($elapsed / 4))
    $status.Text = $strings.stages[$stageIndex]

    $script:barOffset = ($script:barOffset + 14) % 180
    $barFill.Location = New-Object System.Drawing.Point($script:barOffset, 0)

    if (Test-MainWorkbenchReady) {
        $tick.Stop()
        $form.Close()
        return
    }

    if ($elapsed -ge 120) {
        $status.Text = $strings.timeoutHint
    }
})
$tick.Start()

$form.Add_FormClosed({
    $tick.Stop()
    if (Test-Path $pidFile) { Remove-Item $pidFile -Force }
    if ($mark.Image) { $mark.Image.Dispose() }
})

# Escape hatch: a borderless TopMost window with no chrome can otherwise trap
# the desktop during a long first-run compile. Allow drag-to-move and Esc-close.
$script:dragging = $false
$script:dragAnchor = [System.Drawing.Point]::Empty
$script:formAnchor = [System.Drawing.Point]::Empty
$beginDrag = {
    $script:dragging = $true
    $script:dragAnchor = [System.Windows.Forms.Cursor]::Position
    $script:formAnchor = $form.Location
}
$doDrag = {
    if ($script:dragging) {
        $p = [System.Windows.Forms.Cursor]::Position
        $form.Location = New-Object System.Drawing.Point(
            ($script:formAnchor.X + $p.X - $script:dragAnchor.X),
            ($script:formAnchor.Y + $p.Y - $script:dragAnchor.Y))
    }
}
$endDrag = { $script:dragging = $false }
foreach ($c in @($form, $title, $tagline, $status, $mark, $barBack)) {
    $c.Add_MouseDown($beginDrag)
    $c.Add_MouseMove($doDrag)
    $c.Add_MouseUp($endDrag)
}
$form.KeyPreview = $true
$form.Add_KeyDown({
    if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $form.Close() }
})

[void]$form.ShowDialog()
