param(
    [Parameter(Mandatory = $true)][string]$Profile,
    [Parameter(Mandatory = $true)][string[]]$Motions,
    [string[]]$HeldOutMotions = @(),
    [string[]]$MotionIds = @(),
    [string[]]$HeldOutMotionIds = @(),
    [string]$OutputDirectory = "",
    [string]$Blender = "",
    [int]$FramesPerMotion = 120,
    [int]$Seed = 20260810,
    [switch]$IncludeEffects,
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$profilePath = (Resolve-Path -LiteralPath $Profile).Path
$profileValue = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
if (-not $profileValue.profile_id) { throw "Profile is missing profile_id." }
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot ("private\training\" + $profileValue.profile_id + "\synthetic")
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path -LiteralPath $outputPath) -and -not $Force) {
    throw "Refusing to overwrite synthetic dataset: $outputPath (pass -Force explicitly)."
}
if (-not $Blender) {
    $Blender = @(
        "C:\Program Files\Blender Foundation\Blender\blender.exe",
        "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Blender -or -not (Test-Path -LiteralPath $Blender)) {
    throw "Blender was not found. Pass -Blender explicitly."
}
$generator = Join-Path $projectRoot "python\animocap_ml_adapters\character_synthetic_dataset.py"
$arguments = @(
    "--background", "--python", $generator, "--",
    "--profile", $profilePath, "--output", $outputPath,
    "--frames-per-motion", [string][Math]::Max(1, $FramesPerMotion), "--seed", [string]$Seed
)
foreach ($motion in $Motions) {
    $arguments += @("--motion", (Resolve-Path -LiteralPath $motion).Path)
}
foreach ($motion in $HeldOutMotions) {
    $arguments += @("--held-out-motion", (Resolve-Path -LiteralPath $motion).Path)
}
if ($MotionIds.Count -gt 0 -and $MotionIds.Count -ne $Motions.Count) {
    throw "MotionIds must contain one stable source-motion id per training motion."
}
if ($HeldOutMotionIds.Count -gt 0 -and $HeldOutMotionIds.Count -ne $HeldOutMotions.Count) {
    throw "HeldOutMotionIds must contain one stable source-motion id per held-out motion."
}
foreach ($motionId in $MotionIds) { $arguments += @("--motion-id", $motionId) }
foreach ($motionId in $HeldOutMotionIds) {
    $arguments += @("--held-out-motion-id", $motionId)
}
if ($IncludeEffects) { $arguments += "--include-effects" }
$startedUtc = [DateTime]::UtcNow
if ($Force) { $arguments += "--force" }
& $Blender @arguments
if ($LASTEXITCODE -ne 0) { throw "Synthetic character dataset generation failed." }
$manifestPath = Join-Path $outputPath "dataset.json"
$annotationsPath = Join-Path $outputPath "annotations.json"
if (-not (Test-Path -LiteralPath $manifestPath) -or -not (Test-Path -LiteralPath $annotationsPath)) {
    throw "Blender did not produce a complete synthetic dataset. Review the traceback above."
}
$manifestFile = Get-Item -LiteralPath $manifestPath
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifestFile.LastWriteTimeUtc -lt $startedUtc.AddSeconds(-2) -or
    $manifest.kind -ne "animocap.character_synthetic_dataset" -or
    [int]$manifest.images -lt 1) {
    throw "Synthetic dataset completion evidence is stale or invalid: $manifestPath"
}
Write-Host "Synthetic character dataset: $outputPath" -ForegroundColor Green
