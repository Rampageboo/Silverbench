param(
    [Parameter(Mandatory = $true)][string]$Checkpoint,
    [string]$Config = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path -LiteralPath $Checkpoint)) {
    throw "Fine-tuned checkpoint does not exist: $Checkpoint"
}
if (-not $Config) {
    $Config = Join-Path (Split-Path -Parent $Checkpoint) "anime_hrnet_w32_256x192.py"
}
if (-not (Test-Path -LiteralPath $Config)) {
    throw "Fine-tuning config does not exist: $Config"
}
$target = Join-Path $projectRoot "private\models\anime-pose"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath $Config -Destination (Join-Path $target "config.py") -Force
Copy-Item -LiteralPath $Checkpoint -Destination (Join-Path $target "checkpoint.pth") -Force
Write-Host "Anime pose model activated for future local captures: $target" -ForegroundColor Green
