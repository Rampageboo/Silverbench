# Publish a new version: set the version everywhere, commit, tag, push.
# GitHub Actions (.github/workflows/release.yml) then builds, signs and publishes the
# installer; installed apps offer the update within six hours or on "检查更新".
#
#   scripts\release.ps1 -Version 0.3.0
#
# Release notes: docs/releases/v<version>.md (shown in the app's update dialog).
param(
    [Parameter(Mandatory = $true)][ValidatePattern('^\d+\.\d+\.\d+$')][string]$Version
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (git status --porcelain) { throw "Commit or stash your changes first." }
if ((git rev-parse --abbrev-ref HEAD) -ne "main") { throw "Release from main." }
if (git tag --list "v$Version") { throw "v$Version already exists." }

$notes = Join-Path $repo "docs\releases\v$Version.md"
if (-not (Test-Path $notes)) { throw "Write the release notes first: docs\releases\v$Version.md" }

function Set-JsonVersion($path) {
    $text = [IO.File]::ReadAllText($path)
    $updated = [regex]::Replace($text, '("version"\s*:\s*")[^"]+(")', "`${1}$Version`${2}", 1)
    [IO.File]::WriteAllText($path, $updated, (New-Object Text.UTF8Encoding $false))
}
Set-JsonVersion (Join-Path $repo "apps\desktop\src-tauri\tauri.conf.json")
Set-JsonVersion (Join-Path $repo "apps\desktop\package.json")
$cargo = Join-Path $repo "apps\desktop\src-tauri\Cargo.toml"
$text = [IO.File]::ReadAllText($cargo)
$text = [regex]::Replace($text, '(?m)^version = "[^"]+"', "version = `"$Version`"", 1)
[IO.File]::WriteAllText($cargo, $text, (New-Object Text.UTF8Encoding $false))

Push-Location (Join-Path $repo "apps\desktop")
try { npm install --package-lock-only --no-audit --no-fund | Out-Null } finally { Pop-Location }

git add apps/desktop/src-tauri/tauri.conf.json apps/desktop/package.json apps/desktop/package-lock.json apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/Cargo.lock $notes
git commit -m "Release v$Version"
git tag "v$Version"
git push origin main "v$Version"
Write-Host "Pushed v$Version. Build progress: https://github.com/Rampageboo/RampageWorkbench/actions" -ForegroundColor Green
