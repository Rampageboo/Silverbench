param(
    [string]$Model = "qwen3-vl:4b"
)

$ErrorActionPreference = "Stop"
Write-Host "AniMocap Fusion - local visual recovery setup" -ForegroundColor Cyan
Write-Host "Target: RTX 5070 Ti Laptop, 12 GB VRAM; offline inference only."

$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
if (-not $ollama) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Ollama is not installed and winget is unavailable. Install from https://ollama.com/download/windows"
    }
    Write-Host "Installing Ollama..."
    & $winget.Source install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw "Ollama installation failed with exit code $LASTEXITCODE." }
    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path -LiteralPath $candidate) {
        $ollama = Get-Item -LiteralPath $candidate
    } else {
        $ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
    }
}
if (-not $ollama) { throw "Ollama executable was not found after installation." }

Write-Host "Downloading $Model. This is stored locally and no video is uploaded..."
& $ollama.Source pull $Model
if ($LASTEXITCODE -ne 0) { throw "Model download failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "Local visual recovery is ready: $Model" -ForegroundColor Green
Write-Host "You can close this window and return to AniMocap Fusion."