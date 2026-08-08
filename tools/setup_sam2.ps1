param(
    [string]$EnvironmentPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvironmentPath) {
    $EnvironmentPath = Join-Path $projectRoot ".venv-mmpose"
}
$venvPython = Join-Path $EnvironmentPath "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $venvPython)) {
    throw "MMPose environment is missing. Run tools/setup_mmpose.ps1 first."
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "Git is required once to install the official SAM 2 source."
}

$runtimeRoot = Join-Path $projectRoot "private\runtime"
$sam2Repository = Join-Path $runtimeRoot "sam2"
$checkpointDirectory = Join-Path $projectRoot "private\models\sam2"
$checkpoint = Join-Path $checkpointDirectory "sam2.1_hiera_small.pt"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Force -Path $checkpointDirectory | Out-Null

Write-Host "AniMocap Fusion - optional SAM 2.1 video masks" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath (Join-Path $sam2Repository "setup.py"))) {
    git clone --depth 1 https://github.com/facebookresearch/sam2.git $sam2Repository
    if ($LASTEXITCODE -ne 0) { throw "Could not clone the official SAM 2 repository." }
}

$env:SAM2_BUILD_CUDA = "0"
& $venvPython -m pip install --no-build-isolation --no-deps -e $sam2Repository
if ($LASTEXITCODE -ne 0) { throw "SAM 2 Python package installation failed." }
& $venvPython -m pip install "hydra-core>=1.3.2" "iopath>=0.1.10" "tqdm>=4.66"
if ($LASTEXITCODE -ne 0) { throw "SAM 2 runtime dependency installation failed." }

if (-not (Test-Path -LiteralPath $checkpoint)) {
    $partialCheckpoint = "$checkpoint.partial"
    Invoke-WebRequest `
        -Uri "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt" `
        -OutFile $partialCheckpoint
    Move-Item -LiteralPath $partialCheckpoint -Destination $checkpoint
}

& $venvPython -c "from sam2.build_sam import build_sam2_video_predictor; print('SAM 2.1 adapter ready')"
if ($LASTEXITCODE -ne 0) { throw "SAM 2 import verification failed." }
Write-Host "Checkpoint ready: $checkpoint" -ForegroundColor Green
