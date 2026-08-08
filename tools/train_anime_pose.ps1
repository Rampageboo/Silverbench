param(
    [string]$Dataset = "",
    [string]$WorkDirectory = "",
    [string]$PretrainedCheckpoint = "",
    [int]$Epochs = 40,
    [int]$BatchSize = 4
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $projectRoot ".venv-mmpose\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
    throw "MMPose environment is missing. Run tools/setup_mmpose.ps1 first."
}
if (-not $Dataset) {
    $Dataset = Join-Path $projectRoot "private\training\anime-keypoints"
}
if (-not $WorkDirectory) {
    $WorkDirectory = Join-Path $projectRoot "private\training\anime-hrnet-w32"
}
if (-not $PretrainedCheckpoint) {
    $checkpointRoot = Join-Path $env:USERPROFILE ".cache\torch\hub\checkpoints"
    $candidate = Get-ChildItem -LiteralPath $checkpointRoot `
        -Filter "*hrnet*w32*coco*256x192*.pth" -ErrorAction SilentlyContinue `
        | Select-Object -First 1
    if ($candidate) { $PretrainedCheckpoint = $candidate.FullName }
}
if (-not $PretrainedCheckpoint -or -not (Test-Path -LiteralPath $PretrainedCheckpoint)) {
    throw "HRNet-W32 pretrained checkpoint is missing. Pass -PretrainedCheckpoint explicitly."
}

New-Item -ItemType Directory -Force -Path $WorkDirectory | Out-Null
$config = Join-Path $WorkDirectory "anime_hrnet_w32_256x192.py"
& $python (Join-Path $projectRoot "python\animocap_ml_adapters\make_anime_finetune_config.py") `
    --dataset $Dataset --output $config --pretrained $PretrainedCheckpoint `
    --epochs $Epochs --batch-size $BatchSize
if ($LASTEXITCODE -ne 0) { throw "Could not generate the MMPose fine-tuning config." }

$mmposeRoot = (& $python -c "import pathlib,mmpose; print(pathlib.Path(mmpose.__file__).resolve().parent)").Trim()
$trainScript = Join-Path $mmposeRoot ".mim\tools\train.py"
if (-not (Test-Path -LiteralPath $trainScript)) {
    throw "MMPose training entry point is unavailable: $trainScript"
}
& $python $trainScript $config --work-dir $WorkDirectory
if ($LASTEXITCODE -ne 0) { throw "Anime pose fine-tuning failed." }
Write-Host "Fine-tuned checkpoints: $WorkDirectory" -ForegroundColor Green
