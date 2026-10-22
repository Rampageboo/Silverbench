param(
    [string]$Model = "qwen3-vl:4b"
)

$ErrorActionPreference = "Stop"
Write-Host "AniMocap Fusion - local visual recovery setup" -ForegroundColor Cyan
Write-Host "Target: RTX 5070 Ti Laptop, 12 GB VRAM; offline inference only."

function Resolve-OllamaPath {
    $command = Get-Command ollama.exe -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidate = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path -LiteralPath $candidate) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    return $null
}

$ollamaPath = Resolve-OllamaPath
if (-not $ollamaPath) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Ollama is not installed and winget is unavailable. Install from https://ollama.com/download/windows"
    }
    Write-Host "Installing Ollama..."
    & $winget.Source install --id Ollama.Ollama --exact --accept-package-agreements --accept-source-agreements
    $installExitCode = $LASTEXITCODE
    $ollamaPath = Resolve-OllamaPath
    if (-not $ollamaPath) {
        throw "Ollama installation failed with exit code $installExitCode."
    }
    if ($installExitCode -ne 0) {
        Write-Warning "winget returned exit code $installExitCode, but Ollama is available at $ollamaPath. Continuing."
    }
}
if (-not $ollamaPath) { throw "Ollama executable was not found after installation." }

Write-Host "Downloading $Model. This is stored locally and no video is uploaded..."
& $ollamaPath pull $Model
if ($LASTEXITCODE -ne 0) { throw "Model download failed with exit code $LASTEXITCODE." }

Write-Host ""
Write-Host "Local visual recovery is ready: $Model" -ForegroundColor Green
Write-Host "You can close this window and return to AniMocap Fusion."
