param(
    [string[]]$CorrectedRealTraining = @(),
    [string[]]$Synthetic = @(),
    [string[]]$HeldOut = @(),
    [string]$OutputDirectory = "",
    [int]$Seed = 20260810,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { $python = "python" }
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot "private\training\animation-character-keypoints"
}
$assembler = Join-Path $projectRoot "python\animocap_ml_adapters\assemble_character_dataset.py"
$arguments = @($assembler, "--output", ([System.IO.Path]::GetFullPath($OutputDirectory)), "--seed", [string]$Seed)
foreach ($dataset in $CorrectedRealTraining) {
    $arguments += @("--real-train", (Resolve-Path -LiteralPath $dataset).Path)
}
foreach ($dataset in $Synthetic) {
    $arguments += @("--synthetic", (Resolve-Path -LiteralPath $dataset).Path)
}
foreach ($dataset in $HeldOut) {
    $arguments += @("--held-out", (Resolve-Path -LiteralPath $dataset).Path)
}
if ($Force) { $arguments += "--force" }
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw "Character dataset assembly failed." }
Write-Host "Assembled character dataset: $OutputDirectory" -ForegroundColor Green
