param(
    [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$environmentPath = Join-Path $projectRoot ".venv-mmpose"

Write-Host "AniMocap Fusion - MMPose environment setup" -ForegroundColor Cyan
Write-Host "This installs research dependencies only. Upstream model checkpoints are"
Write-Host "downloaded on first inference and retain their own model/data terms." -ForegroundColor Yellow

$python = $null
try {
    $python = (& py -3.12 -c "import sys; print(sys.executable)").Trim()
} catch {
    $python = $null
}
if (-not $python -or -not (Test-Path -LiteralPath $python)) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Python 3.12 is required and winget is unavailable. Install Python 3.12 manually."
    }
    Write-Host "Installing Python 3.12 for the current user..."
    winget install --id Python.Python.3.12 --exact --scope user --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Python 3.12 installation failed." }
    $python = (& py -3.12 -c "import sys; print(sys.executable)").Trim()
}

if (-not (Test-Path -LiteralPath (Join-Path $environmentPath "Scripts\python.exe"))) {
    & $python -m venv $environmentPath
}
$venvPython = Join-Path $environmentPath "Scripts\python.exe"
& $venvPython -m pip install --upgrade "pip==26.0.1" "setuptools==80.9.0" wheel

if ($CpuOnly) {
    & $venvPython -m pip install "torch==2.6.0" "torchvision==0.21.0" --index-url https://download.pytorch.org/whl/cpu
} else {
    & $venvPython -m pip install "torch==2.6.0" "torchvision==0.21.0" --index-url https://download.pytorch.org/whl/cu124
}
if ($LASTEXITCODE -ne 0) { throw "PyTorch installation failed." }

& $venvPython -m pip install "numpy==1.26.4" "scipy==1.13.1"
if ($LASTEXITCODE -ne 0) { throw "NumPy/SciPy installation failed." }
& $venvPython -m pip install --no-build-isolation "chumpy==0.70"
if ($LASTEXITCODE -ne 0) { throw "chumpy compatibility installation failed." }
& $venvPython -m pip install "cython==3.1.3"
if ($LASTEXITCODE -ne 0) { throw "Cython installation failed." }
& $venvPython -m pip install --no-build-isolation "xtcocotools==1.14.3"
if ($LASTEXITCODE -ne 0) { throw "xtcocotools compatibility installation failed." }
& $venvPython -m pip install `
    "numpy==1.26.4" `
    "scipy==1.13.1" `
    "opencv-python==4.10.0.84" `
    "mmengine>=0.9.0,<1.0.0" `
    "mmcv-lite>=2.0.1,<2.2.0" `
    "mmdet==3.3.0" `
    "mmpose==1.3.2"
if ($LASTEXITCODE -ne 0) { throw "MMPose installation failed." }

& $venvPython (Join-Path $projectRoot "python\animocap_ml_adapters\mmpose_adapter.py") --check
if ($LASTEXITCODE -ne 0) { throw "MMPose verification failed." }

Write-Host ""
Write-Host "Environment ready: $environmentPath" -ForegroundColor Green
Write-Host "Return to AniMocap Fusion and click 'Run Motion Capture'."

