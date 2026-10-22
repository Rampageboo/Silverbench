param(
    [Parameter(Mandatory = $true)][string]$Video,
    [Parameter(Mandatory = $true)][string]$Pose,
    [string]$SourceMotion = "",
    [string]$SourceMotionId = "",
    [string]$Output = "",
    [int]$Stride = 3,
    [double]$MinimumConfidence = 0.55
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MMPose environment is missing. Run tools/setup_mmpose.ps1 first."
}
if (-not $Output) {
    $Output = Join-Path $projectRoot "private\training\anime-keypoints"
}
$arguments = @(
    (Join-Path $projectRoot "python\animocap_ml_adapters\export_anime_dataset.py"),
    "--video", $Video, "--pose", $Pose, "--output", $Output,
    "--stride", [string]$Stride, "--minimum-confidence", [string]$MinimumConfidence
)
if ($SourceMotion) {
    $arguments += @("--source-motion", (Resolve-Path -LiteralPath $SourceMotion).Path)
}
if ($SourceMotionId) { $arguments += @("--source-motion-id", $SourceMotionId) }
& $python @arguments
if ($LASTEXITCODE -ne 0) { throw "Anime keypoint dataset export failed." }
Write-Host "Private training dataset ready: $Output" -ForegroundColor Green
