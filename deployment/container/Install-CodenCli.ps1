# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Install-CodenCli — the Windows twin of deployment/container/install-coden-cli.sh.
#
# NOT EXECUTED WHERE IT WAS WRITTEN, and that sentence is the point of writing it down.
# There is no PowerShell on the host this file was authored on (measured: neither `pwsh`
# nor `powershell` resolves), and this project's rules forbid installing tooling to satisfy
# a rule. So it is covered by STRUCTURAL assertions only — the cross-platform installer
# suite reports it as static, never as passing, exactly as it already does for
# deployment/windows/ and for tools/coden-evolution.ps1. The declared verification level
# for a Windows installation is UNVERIFIED until someone runs this on a real Windows host.
#
# The POSIX half of this pair HAS been run end to end against a live installation, so the
# design is proved and it is the dialect that is not. That is a materially different claim
# from "we think it works", and the difference is the reason both are said out loud.
#
# It obeys the same law as its twin: never root (here, never Administrator), never a change
# to the container engine's group membership, never an edit to anything outside this user's
# own profile, never publishing the session socket. The user PATH is written through the
# per-user environment, which needs no elevation — the machine PATH is deliberately not
# touched, because installing a tool for one person must not change the machine for
# everyone on it.

param(
    [string]$BinDir,
    [string]$Engine,
    [string]$Container,
    [switch]$NoPath,
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProgramName     = 'install-coden-cli'
$ExitUsage       = 2
$ExitNoSession   = 3
$ExitAmbiguous   = 4

$DiscoveryLabel  = 'org.noesar.authority=reference-node'
$RemoteLauncher  = '/opt/noesar/tools/coden-evolution.ps1'
$InstalledName   = 'coden_evolution'

function Write-Note([string]$Message) {
    [Console]::Error.WriteLine("${ProgramName}: $Message")
}

# The destination. LOCALAPPDATA is this user's own, needs no elevation, and matches where
# deployment/windows/Install-Noesar.ps1 already puts things — one product must not install
# itself into two places on one machine, or it has two uninstall procedures.
if (-not $BinDir) {
    if (-not $env:LOCALAPPDATA) {
        Write-Note 'LOCALAPPDATA is not set, so there is no per-user location to install into.'
        Write-Note "name one explicitly: -BinDir C:\some\directory"
        exit $ExitUsage
    }
    $BinDir = Join-Path $env:LOCALAPPDATA 'NOESAR-Evolution\bin'
}

$Destination    = Join-Path $BinDir "$InstalledName.ps1"
$ShimDestination = Join-Path $BinDir "$InstalledName.cmd"

# Uninstall names what it did NOT undo. An uninstaller that implies it took back more than
# it did is worse than one that leaves things behind.
if ($Uninstall) {
    foreach ($path in @($Destination, $ShimDestination)) {
        if (Test-Path $path) { Remove-Item -Force $path; Write-Note "removed $path" }
        else { Write-Note "nothing to remove at $path" }
    }
    Write-Note 'left alone: the PATH entry in your user environment, and anything the optional'
    Write-Note 'ssh recipe (08_INSTALLAZIONE §12) installed on the host — neither was written here.'
    exit 0
}

# The engine, discovered the same way as everywhere else in this product: a candidate is
# used because it ANSWERS, not because it is on PATH. On Windows a `docker` shim with
# Docker Desktop stopped behind it is the ordinary case, not the exotic one.
$engineCandidates = if ($Engine) { @($Engine) } else { @('docker', 'podman', 'nerdctl') }
$attempts = New-Object System.Collections.Generic.List[string]
$resolvedEngine = $null

foreach ($candidate in $engineCandidates) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if (-not $command) { $attempts.Add("'$candidate' is not on PATH") ; continue }
    & $command.Source version > $null 2>&1
    if ($LASTEXITCODE -eq 0) { $resolvedEngine = $command.Source; break }
    $attempts.Add("'$candidate' is installed but did not answer (engine not running, or this account may not talk to it)")
}

if (-not $resolvedEngine) {
    Write-Note 'no container engine answered, so there is nothing to install from.'
    foreach ($line in $attempts) { [Console]::Error.WriteLine("  - $line") }
    Write-Note ''
    Write-Note 'if the installation runs on ANOTHER machine, you do not need this file at all:'
    Write-Note 'open http://<that-machine>:8100/ in a browser. That works on every operating'
    Write-Note 'system, needs nothing installed, and is the same session.'
    exit $ExitNoSession
}

# The installation, found by the label the image already carries.
if ($Container) {
    $matches = @($Container)
} else {
    $output = & $resolvedEngine ps --filter "label=$DiscoveryLabel" --filter 'status=running' --format '{{.Names}}' 2>$null
    $matches = @($output | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

if ($matches.Count -eq 0) {
    Write-Note "'$resolvedEngine' answered, but no running container carries the label $DiscoveryLabel."
    Write-Note 'start the installation first, then run this again.'
    exit $ExitNoSession
}

# Two matches are named, never silently resolved.
if ($matches.Count -gt 1) {
    Write-Note 'more than one running installation matched:'
    foreach ($name in $matches) { [Console]::Error.WriteLine("  - $name") }
    Write-Note "name the one you mean: -Container <name>"
    exit $ExitAmbiguous
}
$resolvedContainer = $matches[0]

# Staged, inspected, and only then moved into place. A half-written file on PATH under the
# product's name fails in a way that looks like the product is broken.
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$staged = "$Destination.incoming"
if (Test-Path $staged) { Remove-Item -Force $staged }

& $resolvedEngine cp "${resolvedContainer}:$RemoteLauncher" $staged > $null 2>&1
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $staged)) {
    Write-Note "'$resolvedEngine' could not copy $RemoteLauncher out of '$resolvedContainer'."
    Write-Note 'that path is where the image ships the PowerShell launcher; an image built before'
    Write-Note '2026-08-07 shipped only the POSIX one and does not contain it.'
    exit $ExitNoSession
}

if ((Get-Item $staged).Length -eq 0) {
    Remove-Item -Force $staged
    Write-Note "what came out of '$resolvedContainer' is empty; refusing to install it"
    exit $ExitNoSession
}

if (-not (Select-String -Path $staged -Pattern 'coden_evolution' -Quiet)) {
    Remove-Item -Force $staged
    Write-Note "what came out of '$resolvedContainer' does not look like the launcher; refusing to install it"
    exit $ExitNoSession
}

# Parsed before it is trusted. The POSIX twin proves the file by RUNNING `--help`; the
# nearest honest equivalent here is asking PowerShell itself to parse it, which catches the
# case this check exists for — a file that arrived truncated or mangled by a transfer.
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile($staged, [ref]$null, [ref]$parseErrors) | Out-Null
if ($parseErrors -and $parseErrors.Count -gt 0) {
    Remove-Item -Force $staged
    Write-Note "the launcher taken from '$resolvedContainer' does not parse as PowerShell; nothing was installed."
    exit $ExitNoSession
}

Move-Item -Force $staged $Destination

# The shim. Without it the word only works from PowerShell, and a person who opens cmd.exe
# or types it into the Run box gets "not recognized" — which reads as a failed installation
# rather than as the wrong shell.
@"
@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0$InstalledName.ps1" %*
"@ | Set-Content -Path $ShimDestination -Encoding ASCII

# PATH, per user, no elevation. Read back from the environment rather than from the current
# process, because the process PATH is a snapshot that may already be stale.
$pathNote = $null
if (-not $NoPath) {
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { $userPath = '' }
    $already = $userPath.Split(';') | Where-Object { $_ -and ($_.TrimEnd('\') -ieq $BinDir.TrimEnd('\')) }
    if ($already) {
        $pathNote = 'already in your user PATH (open a new terminal to pick it up)'
    } else {
        $updated = if ($userPath.Trim()) { "$userPath;$BinDir" } else { $BinDir }
        [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
        $pathNote = "added to your user PATH (open a new terminal to pick it up)"
    }
}

# The published address, asked of the engine rather than assumed.
$published = $null
$portOutput = & $resolvedEngine port $resolvedContainer 2>$null
if ($portOutput) {
    $line = $portOutput | Where-Object { $_ -match '^8100/tcp -> (.+)$' } | Select-Object -First 1
    if (-not $line) { $line = $portOutput | Where-Object { $_ -match '-> (.+)$' } | Select-Object -First 1 }
    if ($line -and $line -match '-> (.+)$') { $published = $Matches[1].Trim() }
}

Write-Host ''
Write-Host "Installed: $Destination"
Write-Host "Taken from: $resolvedContainer (found by label, not by name)"
if ($pathNote) { Write-Host "PATH: $pathNote" }
Write-Host ''
Write-Host 'Open the session by typing one word:'
Write-Host ''
Write-Host "    $InstalledName"
Write-Host ''
Write-Host 'Or open it in a browser -- nothing to install, any operating system, any device:'
Write-Host ''
if ($published) { Write-Host "    http://$published/" } else { Write-Host '    http://<this-host>:8100/' }
Write-Host ''
Write-Host 'Either way you are asked to authenticate after you are in, not before you can start.'
