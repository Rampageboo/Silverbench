param(
    [Parameter(Mandatory = $true)][string]$Checkpoint,
    [Parameter(Mandatory = $true)][string]$EvaluationReport,
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
$reportPath = (Resolve-Path -LiteralPath $EvaluationReport).Path
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.kind -ne "animocap.character_checkpoint_evaluation" -or $report.status -ne "pass") {
    throw "Evaluation report does not contain a passing character-checkpoint gate."
}
if (-not $report.visual_review_accepted) {
    throw "Evaluation report has not accepted the side-by-side visual review."
}
$baselineMetrics = $report.metrics.baseline
$candidateMetrics = $report.metrics.candidate
if ([double]$report.metrics.relative_error_improvement -lt 0.10 -or
    [double]$candidateMetrics.invalid_or_low_confidence_rate -gt [double]$baselineMetrics.invalid_or_low_confidence_rate -or
    [int]$candidateMetrics.left_right_swap_count -gt [int]$baselineMetrics.left_right_swap_count -or
    [int]$report.high_confidence_move_attempts -ne 0 -or
    -not $report.dataset_split.activation_eligible -or
    -not $report.dataset_split.motion_identity_complete) {
    throw "Evaluation report does not satisfy the numeric, confidence, split, and high-confidence-motion gates."
}
$checkpointHash = (Get-FileHash -LiteralPath $Checkpoint -Algorithm SHA256).Hash.ToLowerInvariant()
$configHash = (Get-FileHash -LiteralPath $Config -Algorithm SHA256).Hash.ToLowerInvariant()
if ($checkpointHash -ne ([string]$report.candidate_checkpoint_sha256).ToLowerInvariant()) {
    throw "Checkpoint hash does not match the passing evaluation report."
}
if ($configHash -ne ([string]$report.candidate_config_sha256).ToLowerInvariant()) {
    throw "Config hash does not match the passing evaluation report."
}
$target = Join-Path $projectRoot "private\models\anime-pose"
$historyRoot = Join-Path $projectRoot "private\models\anime-pose-history"
if (Test-Path -LiteralPath (Join-Path $target "checkpoint.pth")) {
    $history = Join-Path $historyRoot (Get-Date -Format "yyyyMMdd-HHmmss")
    New-Item -ItemType Directory -Force -Path $history | Out-Null
    Copy-Item -LiteralPath (Join-Path $target "checkpoint.pth") -Destination $history
    if (Test-Path -LiteralPath (Join-Path $target "config.py")) {
        Copy-Item -LiteralPath (Join-Path $target "config.py") -Destination $history
    }
    if (Test-Path -LiteralPath (Join-Path $target "active.json")) {
        Copy-Item -LiteralPath (Join-Path $target "active.json") -Destination $history
    }
}
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item -LiteralPath $Config -Destination (Join-Path $target "config.py") -Force
Copy-Item -LiteralPath $Checkpoint -Destination (Join-Path $target "checkpoint.pth") -Force
$active = [ordered]@{
    schema_version = "1.0.0"
    checkpoint_sha256 = $checkpointHash
    config_sha256 = $configHash
    evaluation_report = $reportPath
    evaluation_report_sha256 = (Get-FileHash -LiteralPath $reportPath -Algorithm SHA256).Hash.ToLowerInvariant()
    activated_at = (Get-Date).ToUniversalTime().ToString("o")
}
$active | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $target "active.json") -Encoding UTF8
Write-Host "Anime pose model activated for future local captures: $target" -ForegroundColor Green
