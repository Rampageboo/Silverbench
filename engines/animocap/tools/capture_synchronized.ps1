param(
    [Parameter(Mandatory = $true)][int[]]$Cameras,
    [Parameter(Mandatory = $true)][string]$Output,
    [string[]]$Names = @(),
    [double]$Duration = 15.0,
    [double]$Fps = 30.0,
    [int]$Width = 1920,
    [int]$Height = 1080,
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MMPose environment is missing. Run tools/setup_mmpose.ps1 first."
}
$arguments = @(
    (Join-Path $projectRoot "python\animocap_ml_adapters\capture_synchronized.py"),
    "--cameras"
) + $Cameras + @(
    "--output", $Output, "--duration", $Duration, "--fps", $Fps,
    "--width", $Width, "--height", $Height
)
if ($Names.Count -gt 0) { $arguments += @("--names") + $Names }
if ($Preview) { $arguments += "--preview" }
& $python $arguments
if ($LASTEXITCODE -ne 0) { throw "Synchronized capture failed." }
