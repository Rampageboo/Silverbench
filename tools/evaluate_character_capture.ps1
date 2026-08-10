param(
    [Parameter(Mandatory = $true)][string]$GroundTruth,
    [Parameter(Mandatory = $true)][string]$Baseline,
    [Parameter(Mandatory = $true)][string]$Candidate,
    [Parameter(Mandatory = $true)][string]$CandidateCheckpoint,
    [Parameter(Mandatory = $true)][string]$CandidateConfig,
    [Parameter(Mandatory = $true)][string]$Profile,
    [Parameter(Mandatory = $true)][string]$DatasetManifest,
    [Parameter(Mandatory = $true)][string]$Output,
    [switch]$VisualReviewAccepted,
    [int]$HighConfidenceMoveAttempts = 0
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) { $python = "python" }
$evaluator = Join-Path $projectRoot "python\animocap_ml_adapters\evaluate_character_capture.py"
$arguments = @(
    $evaluator,
    "--ground-truth", (Resolve-Path -LiteralPath $GroundTruth).Path,
    "--baseline", (Resolve-Path -LiteralPath $Baseline).Path,
    "--candidate", (Resolve-Path -LiteralPath $Candidate).Path,
    "--candidate-checkpoint", (Resolve-Path -LiteralPath $CandidateCheckpoint).Path,
    "--candidate-config", (Resolve-Path -LiteralPath $CandidateConfig).Path,
    "--profile", (Resolve-Path -LiteralPath $Profile).Path,
    "--dataset-manifest", (Resolve-Path -LiteralPath $DatasetManifest).Path,
    "--output", ([System.IO.Path]::GetFullPath($Output)),
    "--high-confidence-move-attempts", [string][Math]::Max(0, $HighConfidenceMoveAttempts)
)
if ($VisualReviewAccepted) { $arguments += "--visual-review-accepted" }
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw "Candidate failed the animation-character activation gate." }
Write-Host "Candidate passed: $Output" -ForegroundColor Green
