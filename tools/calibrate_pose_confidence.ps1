param(
    [Parameter(Mandatory=$true)][string]$Evidence,
    [string]$Output = "private/calibration/pose_confidence.json",
    [double]$ErrorThreshold = 0.05,
    [int]$MinimumSamples = 30
)
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose/Scripts/python.exe"
if (-not (Test-Path -LiteralPath $python)) { $python = "python.exe" }
& $python -m python.animocap_ml_adapters.calibrate_pose_confidence `
    --evidence $Evidence --output $Output `
    --error-threshold $ErrorThreshold --minimum-samples $MinimumSamples
if ($LASTEXITCODE -ne 0) { throw "Confidence calibration failed." }
