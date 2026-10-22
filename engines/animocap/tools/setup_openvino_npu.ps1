param(
    [string]$EnvironmentPath,
    [switch]$SkipCompile
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvironmentPath) {
    $EnvironmentPath = Join-Path $projectRoot ".venv-mmpose"
}
$python = Join-Path $EnvironmentPath "Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MMPose environment is missing: $python. Run tools/setup_mmpose.ps1 first."
}

Write-Host "AniMocap Fusion - Intel NPU shadow observer setup" -ForegroundColor Cyan
& $python -m pip install "openvino==2026.2.1"
if ($LASTEXITCODE -ne 0) { throw "OpenVINO installation failed." }

$modelDirectory = Join-Path $projectRoot `
    "private\models\openvino\human-pose-estimation-0005\FP16"
New-Item -ItemType Directory -Path $modelDirectory -Force | Out-Null
$baseUrl = "https://storage.openvinotoolkit.org/repositories/open_model_zoo/2022.1/models_bin/1/human-pose-estimation-0005/FP16"
$files = @(
    @{
        Name = "human-pose-estimation-0005.xml"
        Sha256 = "DA933E50966A54835642C7E69D204637A4C97145002F990557F5E52D91736AA3"
    },
    @{
        Name = "human-pose-estimation-0005.bin"
        Sha256 = "64439882EB1333CFF477A6267B808FDE0528B7FA5AC6F19685F324EF52655200"
    }
)
foreach ($file in $files) {
    $target = Join-Path $modelDirectory $file.Name
    $valid = (Test-Path -LiteralPath $target) -and `
        ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $file.Sha256)
    if (-not $valid) {
        Write-Host "Downloading Intel Open Model Zoo $($file.Name)..." -ForegroundColor Cyan
        Invoke-WebRequest -Uri "$baseUrl/$($file.Name)" -OutFile $target
    }
    $actual = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($actual -ne $file.Sha256) {
        throw "NPU model hash mismatch for $target. Expected $($file.Sha256), got $actual."
    }
}

if (-not $SkipCompile) {
    Write-Host "Compiling the pose observer on Intel NPU (first run can take about 90 seconds)..." -ForegroundColor Cyan
    & $python (Join-Path $projectRoot `
        "python\animocap_ml_adapters\openvino_npu_pose.py") --check
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Intel NPU shadow observer is unavailable. CUDA mocap remains enabled."
        exit 0
    }
}

Write-Host "Intel NPU shadow observer ready. CUDA remains the authoritative mocap path." -ForegroundColor Green
