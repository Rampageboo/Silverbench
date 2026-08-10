param([string]$HistoryDirectory = "")

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$target = Join-Path $projectRoot "private\models\anime-pose"
$historyRoot = Join-Path $projectRoot "private\models\anime-pose-history"
if (-not $HistoryDirectory) {
    $candidate = Get-ChildItem -LiteralPath $historyRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if (-not $candidate) { throw "No previous activated anime-pose model is available." }
    $HistoryDirectory = $candidate.FullName
}
$history = (Resolve-Path -LiteralPath $HistoryDirectory).Path
foreach ($name in @("checkpoint.pth", "config.py")) {
    $source = Join-Path $history $name
    if (-not (Test-Path -LiteralPath $source)) { throw "Rollback package is missing $name." }
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath (Join-Path $history "checkpoint.pth") -Destination $target -Force
Copy-Item -LiteralPath (Join-Path $history "config.py") -Destination $target -Force
if (Test-Path -LiteralPath (Join-Path $history "active.json")) {
    Copy-Item -LiteralPath (Join-Path $history "active.json") -Destination $target -Force
} elseif (Test-Path -LiteralPath (Join-Path $target "active.json")) {
    Remove-Item -LiteralPath (Join-Path $target "active.json")
}
Write-Host "Restored anime pose model from: $history" -ForegroundColor Green
