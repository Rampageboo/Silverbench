param(
    [switch]$Rebuild,
    [string]$CharacterProfile
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$nmakeExecutable = Join-Path $projectRoot "build\windows-nmake\animocap_studio.exe"
$ninjaExecutable = Join-Path $projectRoot "build\windows-ninja\animocap_studio.exe"
$candidates = @($nmakeExecutable, $ninjaExecutable) |
    Where-Object { Test-Path -LiteralPath $_ } |
    ForEach-Object { Get-Item -LiteralPath $_ } |
    Sort-Object LastWriteTime -Descending
$executable = if ($candidates) { $candidates[0].FullName } else { $ninjaExecutable }

if ($Rebuild -or -not (Test-Path -LiteralPath $executable)) {
    & (Join-Path $PSScriptRoot "build_msvc.ps1")
    if ($LASTEXITCODE -ne 0) { throw "AniMocap Fusion build failed." }
    $executable = $ninjaExecutable
}

$launchArguments = @()
if ($CharacterProfile) {
    $resolvedCharacterProfile = (Resolve-Path -LiteralPath $CharacterProfile).Path
    $launchArguments = @("--character-profile", ('"{0}"' -f $resolvedCharacterProfile))
}

if ($launchArguments.Count -gt 0) {
    Start-Process -FilePath $executable -WorkingDirectory $projectRoot -ArgumentList $launchArguments
} else {
    Start-Process -FilePath $executable -WorkingDirectory $projectRoot
}

