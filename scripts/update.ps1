# Update this computer to the latest main on GitHub.
# Development happens on the other computer; this one only pulls and runs.
# Reinstalls Python / frontend dependencies only when the pulled changes touch them.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Fail($message) {
    Write-Host ""
    Write-Host $message -ForegroundColor Red
    exit 1
}

if (Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue) {
    Write-Host "RampageWorkbench seems to be running (port 8765). Close it first so files are not replaced under it." -ForegroundColor Yellow
    $answer = Read-Host "Continue anyway? (y/N)"
    if ($answer -ne "y") { exit 1 }
}

$changes = git status --porcelain --untracked-files=no
if ($changes) {
    Write-Host "This computer has local edits to tracked files:" -ForegroundColor Yellow
    $changes | ForEach-Object { Write-Host "  $_" }
    Fail "This computer only receives updates. Move the edits to the development computer, or discard them with 'git restore .', then run update again."
}

$branch = git rev-parse --abbrev-ref HEAD
if ($branch -ne "main") {
    Write-Host "Switching from $branch to main..."
    git switch main
    if ($LASTEXITCODE) { Fail "Could not switch to main." }
}

$old = git rev-parse HEAD
Write-Host "Fetching from GitHub..."
git fetch origin
if ($LASTEXITCODE) { Fail "git fetch failed (network or GitHub sign-in)." }
git merge-base --is-ancestor HEAD origin/main
if ($LASTEXITCODE) {
    Fail "main here has commits GitHub does not have, so it cannot fast-forward. Push them from here once, or reset with 'git reset --hard origin/main' if they are not needed."
}
git merge --ff-only origin/main
if ($LASTEXITCODE) { Fail "Could not fast-forward (see git's message above): usually an untracked file here has the same name as a new file in the update. Move it away and run update again." }
$new = git rev-parse HEAD

if ($old -eq $new) {
    Write-Host "Already up to date." -ForegroundColor Green
    exit 0
}

Write-Host ""
Write-Host "New changes:" -ForegroundColor Cyan
git log --oneline "$old..$new"
$changed = git diff --name-only $old $new

$python = Join-Path $repo ".venv\Scripts\python.exe"
if (($changed -contains "requirements.txt") -and (Test-Path $python)) {
    Write-Host ""
    Write-Host "requirements.txt changed: updating Python packages..." -ForegroundColor Cyan
    & $python -m pip install -r requirements.txt
    if ($LASTEXITCODE) { Fail "pip install failed." }
    # requirements.txt owns torch/cv2; keep ultralytics from replacing them (same as run.bat).
    & $python -m pip install ultralytics --no-deps
}

$desktop = Join-Path $repo "apps\desktop"
if (($changed -match '^apps/desktop/package(-lock)?\.json$') -and (Test-Path (Join-Path $desktop "node_modules"))) {
    Write-Host ""
    Write-Host "Frontend dependencies changed: running npm ci..." -ForegroundColor Cyan
    Push-Location $desktop
    try {
        npm ci
        if ($LASTEXITCODE) { Fail "npm ci failed." }
    } finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Updated. Start RampageWorkbench as usual (desktop shortcut or run.bat)." -ForegroundColor Green
