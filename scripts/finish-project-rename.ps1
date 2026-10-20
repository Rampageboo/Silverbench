param(
    [string]$SourceRoot = (Split-Path -Parent $PSScriptRoot),
    [ValidateRange(1, 120)][int]$WaitMinutes = 30
)

$ErrorActionPreference = 'Stop'
$taskSource = [IO.Path]::GetFullPath($SourceRoot).TrimEnd('\')
$taskParent = Split-Path -Parent $taskSource
$taskDestination = Join-Path $taskParent 'RampageWorkbench'
if ((Split-Path -Leaf $taskSource) -notin @('YoloWorkBench', 'RampageWorkbench')) {
    throw 'This helper only renames the verified YoloWorkBench project.'
}
if (-not (Test-Path -LiteralPath (Join-Path $taskSource 'backend_api\main.py')) -or
    -not (Test-Path -LiteralPath (Join-Path $taskSource '.git'))) {
    throw 'The source is not the expected project checkout.'
}
# Do not hold the directory that this process is trying to rename.
Set-Location -LiteralPath $taskParent
[Environment]::CurrentDirectory = $taskParent
$script:TaskCurrentRoot = $taskSource

function Write-RenameState([string]$State, [string]$Message) {
    if (-not (Test-Path -LiteralPath $script:TaskCurrentRoot -PathType Container)) {
        throw 'Project root disappeared; refusing to recreate the old directory for logging.'
    }
    $taskLogDirectory = Join-Path $script:TaskCurrentRoot 'logs'
    [IO.Directory]::CreateDirectory($taskLogDirectory) | Out-Null
    [IO.File]::AppendAllText((Join-Path $taskLogDirectory 'rename-project.log'), "$(Get-Date -Format o) $State $Message`r`n")
    @{ state = $State; message = $Message; source = $taskSource; destination = $taskDestination; updatedAt = (Get-Date -Format o) } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskLogDirectory 'rename-project-status.json') -Encoding utf8
}

try {
    $taskDeadline = (Get-Date).AddMinutes($WaitMinutes)
    Write-RenameState 'waiting' 'Save work and close Codex, Claude and terminals using this folder. No process will be terminated.'
    while ($taskSource -ne $taskDestination) {
        if (Test-Path -LiteralPath $taskDestination) { throw 'Destination already exists; refusing to merge or overwrite it.' }
        try {
            Rename-Item -LiteralPath $taskSource -NewName 'RampageWorkbench' -ErrorAction Stop
            $script:TaskCurrentRoot = $taskDestination
            break
        } catch {
            # Only retry actual sharing/lock violations. Access or permission errors need attention.
            $taskException = $_.Exception
            while ($taskException.InnerException) { $taskException = $taskException.InnerException }
            $taskWin32Code = $taskException.HResult -band 0xffff
            if ($taskWin32Code -notin @(32, 33) -or (Get-Date) -ge $taskDeadline) { throw }
            Start-Sleep -Seconds 5
        }
    }
    $script:TaskCurrentRoot = $taskDestination
    Write-RenameState 'renamed' 'Project folder renamed; reconciling links and generated cache.'

    $taskGit = (Get-Command git -ErrorAction Stop).Source
    $taskWorktrees = @(& $taskGit -C $taskDestination worktree list --porcelain | Where-Object { $_.StartsWith('worktree ') } | ForEach-Object { $_.Substring(9) })
    if ($LASTEXITCODE -ne 0) { throw 'Could not list linked worktrees after the rename.' }
    foreach ($taskWorktree in $taskWorktrees) {
        if ([IO.Path]::GetFullPath($taskWorktree) -notin @($taskSource, $taskDestination)) {
            & $taskGit -C $taskDestination worktree repair $taskWorktree
            if ($LASTEXITCODE -ne 0) { throw "Git worktree repair failed: $taskWorktree" }
        }
    }

    $taskDesktop = [Environment]::GetFolderPath('Desktop')
    $taskOldLink = Join-Path $taskDesktop 'YoloWorkBench.lnk'
    $taskNewLink = Join-Path $taskDesktop 'RampageWorkbench.lnk'
    $taskShell = New-Object -ComObject WScript.Shell
    $taskAllowedTargets = @(
        (Join-Path $taskSource 'YoloWorkBench.vbs'),
        (Join-Path $taskSource 'RampageWorkbench.vbs'),
        (Join-Path $taskDestination 'RampageWorkbench.vbs')
    )
    # Inspect both links before moving either. A same-named launcher in another
    # checkout is not authorization to replace that checkout's desktop entry.
    foreach ($taskCandidate in @($taskOldLink, $taskNewLink)) {
        if (Test-Path -LiteralPath $taskCandidate) {
            $taskExisting = $taskShell.CreateShortcut($taskCandidate)
            if (-not $taskExisting.TargetPath -or
                [IO.Path]::GetFullPath($taskExisting.TargetPath) -notin $taskAllowedTargets -or
                $taskExisting.Arguments) {
                throw "Unrelated desktop shortcut preserved: $taskCandidate"
            }
        }
    }
    if ((Test-Path -LiteralPath $taskOldLink) -and -not (Test-Path -LiteralPath $taskNewLink)) {
        Move-Item -LiteralPath $taskOldLink -Destination $taskNewLink
    }
    $taskLink = $taskShell.CreateShortcut($taskNewLink)
    $taskLink.TargetPath = Join-Path $taskDestination 'RampageWorkbench.vbs'
    $taskLink.Arguments = ''
    $taskLink.WorkingDirectory = $taskDestination
    $taskLink.Description = 'RampageWorkbench'
    $taskIcon = Join-Path $taskDestination 'assets\app-icon.ico'
    if (Test-Path -LiteralPath $taskIcon) { $taskLink.IconLocation = $taskIcon }
    $taskLink.Save()

    # Tauri build output contains absolute permission paths. Clean only this
    # checkout's generated target directory so the next launch rebuilds correctly.
    $taskTarget = [IO.Path]::GetFullPath((Join-Path $taskDestination 'apps\desktop\src-tauri\target'))
    if (-not $taskTarget.StartsWith($taskDestination + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Generated cache target escaped the renamed checkout.'
    }
    if (Test-Path -LiteralPath $taskTarget) {
        if ((Get-Item -LiteralPath $taskTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw 'Generated target is a link; refusing to clean an unverified cache location.'
        }
        $taskCargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
        if (-not (Test-Path -LiteralPath $taskCargo)) { $taskCargo = (Get-Command cargo -ErrorAction Stop).Source }
        & $taskCargo clean --manifest-path (Join-Path $taskDestination 'apps\desktop\src-tauri\Cargo.toml') --target-dir $taskTarget
        if ($LASTEXITCODE -ne 0) { throw 'Folder renamed, but generated cache cleanup failed. See rename-project.log.' }
    }
    Write-RenameState 'completed' 'Folder, Git worktree links and shortcut updated. Reopen D:\Projects\RampageWorkbench; first desktop launch rebuilds its cache.'
} catch {
    Write-RenameState 'needs-attention' $_.Exception.Message
    exit 1
}
