param(
    [Parameter(Mandatory = $true)][string]$CharacterBlend,
    [Parameter(Mandatory = $true)][string]$Config,
    [string]$OutputDirectory = "",
    [string]$Blender = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$blendPath = (Resolve-Path -LiteralPath $CharacterBlend).Path
$configPath = (Resolve-Path -LiteralPath $Config).Path
$configValue = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if (-not $configValue.profile_id) { throw "Config profile_id is required." }

if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $projectRoot ("private\character_profiles\" + $configValue.profile_id)
}
$outputPath = [System.IO.Path]::GetFullPath($OutputDirectory)
$privateRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "private"))
$outputsRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "outputs"))
if (-not ($outputPath.StartsWith($privateRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
          $outputPath.StartsWith($outputsRoot, [System.StringComparison]::OrdinalIgnoreCase))) {
    throw "Character-reference outputs must stay under private/ or outputs/."
}
$profilePath = Join-Path $outputPath "profile.json"
if ((Test-Path -LiteralPath $profilePath) -and -not $Force) {
    throw "Refusing to overwrite character reference: $profilePath (pass -Force explicitly)."
}

if (-not $Blender) {
    $candidates = @(
        "C:\Program Files\Blender Foundation\Blender\blender.exe",
        "C:\Program Files (x86)\Steam\steamapps\common\Blender\blender.exe"
    )
    $Blender = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Blender -or -not (Test-Path -LiteralPath $Blender)) {
    throw "Blender was not found. Pass -Blender explicitly."
}

$exporter = Join-Path $projectRoot "tools\codex-skills\blender-character-mocap-export\scripts\export_character_layers.py"
$validator = Join-Path $projectRoot "tools\codex-skills\blender-character-mocap-export\scripts\validate_glb_layers.py"
$beforeHash = (Get-FileHash -LiteralPath $blendPath -Algorithm SHA256).Hash
$configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
$beforeTimestamp = (Get-Item -LiteralPath $blendPath).LastWriteTimeUtc.Ticks
$startedUtc = [DateTime]::UtcNow
$arguments = @("--background", $blendPath, "--python", $exporter, "--", "--config", $configPath, "--output-dir", $outputPath)
if ($Force) { $arguments += "--force" }
& $Blender @arguments
if ($LASTEXITCODE -ne 0) { throw "Character-reference export failed." }
if (-not (Test-Path -LiteralPath $profilePath)) {
    throw "Blender did not produce profile.json. Review the traceback above."
}
$profileFile = Get-Item -LiteralPath $profilePath
$profile = Get-Content -LiteralPath $profilePath -Raw | ConvertFrom-Json
if ($profileFile.LastWriteTimeUtc -lt $startedUtc.AddSeconds(-2) -or
    $profile.schema_version -ne "1.1.0" -or
    $profile.role -ne "source_character_reference" -or
    ([string]$profile.source_hashes.blend_sha256).ToUpperInvariant() -ne $beforeHash -or
    ([string]$profile.source_hashes.config_sha256).ToUpperInvariant() -ne $configHash) {
    throw "Character-reference completion evidence is stale or inconsistent."
}

$validationPath = Join-Path $outputPath "validation.json"
& $Blender --background --python $validator -- --input-dir $outputPath --report $validationPath
if ($LASTEXITCODE -ne 0) { throw "Character-reference validation failed." }
if (-not (Test-Path -LiteralPath $validationPath)) {
    throw "Blender did not produce clean re-import validation evidence."
}
$validationFile = Get-Item -LiteralPath $validationPath
$validation = Get-Content -LiteralPath $validationPath -Raw | ConvertFrom-Json
if ($validationFile.LastWriteTimeUtc -lt $startedUtc.AddSeconds(-2) -or
    $validation.kind -ne "animocap.character_glb_validation" -or
    $validation.status -ne "ok" -or
    -not $validation.layers.character -or -not $validation.layers.mocap_mask -or
    ($profile.exports.effects -and -not $validation.layers.effects)) {
    throw "Clean re-import validation evidence is stale or incomplete."
}
$afterHash = (Get-FileHash -LiteralPath $blendPath -Algorithm SHA256).Hash
$afterTimestamp = (Get-Item -LiteralPath $blendPath).LastWriteTimeUtc.Ticks
if ($beforeHash -ne $afterHash -or $beforeTimestamp -ne $afterTimestamp) {
    throw "The source .blend changed during export; discard the generated package and inspect Blender state."
}
Write-Host "Validated character reference: $outputPath" -ForegroundColor Green
