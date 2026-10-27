# Assemble what the installer carries into packaging/stage (git-ignored):
#   stage/app/     backend code, engine binaries + adapters, runtime lock, bootstrap
#   stage/python/  self-contained CPython (python-build-standalone, pinned + hashed)
# Run after building the engine (engines/animocap/tools/build_msvc.ps1 -Configuration Release).
# tauri.release.conf.json maps both folders into the installer's resources.

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$stage = Join-Path $PSScriptRoot "stage"
$app = Join-Path $stage "app"

# Same CPython minor version as the tested dev venv; cp314 wheels in requirements.lock.txt.
$pythonUrl = "https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.14.8%2B20261013-x86_64-pc-windows-msvc-install_only.tar.gz"
$pythonSha256 = "3adacae2a39dfcbebe8d95a6e87a0dee167a057ab8f822eacf38e5fa4c97f76e"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $app | Out-Null

function Copy-Tree($from, $to) {
    # robocopy: fast, keeps structure; exit codes below 8 mean success.
    robocopy (Join-Path $repo $from) (Join-Path $app $to) /E /NFL /NDL /NJH /NJS /NP `
        /XD __pycache__ .pytest_cache tests node_modules /XF *.pyc | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "copy failed: $from" }
}

Copy-Tree "backend" "backend"
Copy-Tree "backend_api" "backend_api"
Copy-Tree "yoloworkbench_mcp" "yoloworkbench_mcp"
New-Item -ItemType Directory -Force (Join-Path $app "apps\desktop"), (Join-Path $app "packaging") | Out-Null
Copy-Item (Join-Path $repo "apps\desktop\backend.config.json") (Join-Path $app "apps\desktop\")
Copy-Item (Join-Path $repo "packaging\bootstrap.py"), (Join-Path $repo "packaging\requirements.lock.txt") (Join-Path $app "packaging\")

# AniMocap engine: the built CLI and Maxine bridge, the Python adapters and setup scripts.
$engineBuild = Join-Path $repo "engines\animocap\build\windows-ninja"
foreach ($binary in @("animocap.exe", "animocap_maxine_vsr.dll")) {
    if (-not (Test-Path (Join-Path $engineBuild $binary))) { throw "engine not built: $binary (run tools/build_msvc.ps1 -Configuration Release)" }
}
$engineOut = Join-Path $app "engines\animocap"
New-Item -ItemType Directory -Force (Join-Path $engineOut "build\windows-ninja") | Out-Null
Copy-Item (Join-Path $engineBuild "animocap.exe"), (Join-Path $engineBuild "animocap_maxine_vsr.dll") (Join-Path $engineOut "build\windows-ninja\")
foreach ($folder in @("python", "tools", "configs", "schemas", "blender_addon")) {
    if (Test-Path (Join-Path $repo "engines\animocap\$folder")) { Copy-Tree "engines\animocap\$folder" "engines\animocap\$folder" }
}
Copy-Item (Join-Path $repo "engines\animocap\LICENSES.md"), (Join-Path $repo "engines\animocap\README.md") $engineOut

# Bundled CPython.
$archive = Join-Path $env:TEMP "rwb-python-$pythonSha256.tar.gz"
if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $pythonSha256) {
    Invoke-WebRequest -Uri $pythonUrl -OutFile $archive -UseBasicParsing
}
$actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower()
if ($actual -ne $pythonSha256) { throw "Python archive hash mismatch: $actual" }
# Windows' own bsdtar: a GNU tar on PATH (Git) reads "C:\..." as a remote host.
& (Join-Path $env:SystemRoot "System32\tar.exe") -xzf $archive -C $stage
if ($LASTEXITCODE) { throw "could not extract Python" }
if (-not (Test-Path (Join-Path $stage "python\python.exe"))) { throw "unexpected Python archive layout" }

$size = [math]::Round(((Get-ChildItem $stage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB), 1)
Write-Host "Staged $stage ($size MB)"
