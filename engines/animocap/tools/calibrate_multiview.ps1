param(
    [Parameter(Mandatory = $true)][string]$Manifest,
    [Parameter(Mandatory = $true)][double]$SquareSizeMeters,
    [int]$Columns = 9,
    [int]$Rows = 6,
    [string]$Output = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MMPose environment is missing. Run tools/setup_mmpose.ps1 first."
}
if (-not $Output) { $Output = Join-Path (Split-Path -Parent $Manifest) "calibration.json" }
& $python (Join-Path $projectRoot "python\animocap_ml_adapters\calibrate_multiview.py") `
    --manifest $Manifest --output $Output --columns $Columns --rows $Rows `
    --square-size-m $SquareSizeMeters
if ($LASTEXITCODE -ne 0) { throw "Multi-camera calibration failed." }
