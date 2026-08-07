# SPDX-License-Identifier: AGPL-3.0-or-later
#
# coden_evolution — the Windows twin of tools/coden-evolution.
#
# NOT EXECUTED WHERE IT WAS WRITTEN. There is no PowerShell on the host this file was
# authored on (measured, 2026-08-07: neither `pwsh` nor `powershell` resolves), and
# CLAUDE10.md rule 45 forbids installing tooling to satisfy a rule. So this file is covered
# by STRUCTURAL assertions only — `launcher-portability.test.mjs` reports it as static, never
# as passing, exactly as `test-cross-platform-installers.mjs` already does for
# `deployment/windows/`. The declared level for a Windows installation is UNVERIFIED until
# someone runs it on a real Windows host. That sentence is the point of writing it down.
#
# It exists because CE-032 says the launcher must not presume an operating system, and a
# POSIX `sh` file presumes one. The two files are one design in two dialects: the same four
# rungs, the same exit codes, the same configuration keys, the same discovery label. The
# test asserts that correspondence on CODE, with comment lines stripped from both first —
# this project has already been bitten by a guard that was satisfied by a comment.
#
# Everything the POSIX launcher is forbidden to do, this one is forbidden to do: it does not
# publish the socket, does not touch group membership, does not edit the host, and does not
# dot-source its configuration file.

Set-StrictMode -Version Latest

$ProgramName   = 'coden_evolution'
$ExitUsage     = 2
$ExitNoSession = 3
$ExitAmbiguous = 4

$LauncherDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Note([string]$Message) {
    [Console]::Error.WriteLine("${ProgramName}: $Message")
}

function Write-Usage {
    [Console]::Error.WriteLine(@"
$ProgramName — open the CodeN Evolution session.

  $ProgramName          attach to this installation's session

It takes no arguments on purpose: the container name and the client path are what this
launcher exists to stop you from having to know. Authentication happens after you are in,
at the session's own prompt, exactly as it does in the browser.
"@)
}

# Arguments: there are none. Accepting a path or a container name would put back the two
# concepts this file exists to remove.
if ($args.Count -gt 0) {
    if ($args[0] -in @('-h', '--help', 'help')) { Write-Usage; exit 0 }
    Write-Note "takes no arguments (got '$($args[0])')"
    Write-Usage
    exit $ExitUsage
}

# Configuration — optional, written by the installation, never by the product. Read key by
# key; never dot-sourced, because a sourced configuration file is a second authority nobody
# declared.
$conf = @{ socket = ''; engine = ''; container = ''; elevate = ''; remote_launcher = '' }
$confFile = if ($env:NOESAR_EVOLUTION_LAUNCHER_CONF) {
    $env:NOESAR_EVOLUTION_LAUNCHER_CONF
} else {
    Join-Path $env:ProgramData 'noesar-evolution\launcher.conf'
}
if (Test-Path -LiteralPath $confFile -PathType Leaf) {
    foreach ($line in (Get-Content -LiteralPath $confFile)) {
        if ($line -match '^\s*(#|$)') { continue }
        $key, $value = $line -split '=', 2
        if ($null -ne $value -and $conf.ContainsKey($key)) { $conf[$key] = $value }
    }
}

$attempts = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------------------------------
# Rung 1 — a socket this process can already reach.
#
# Same candidate order as the POSIX launcher, and the same reason for it: these are the
# product's own variables, not a new vocabulary. AF_UNIX is what Node speaks here too — it
# is supported on Windows 10 build 17063 and later, which is the floor this rung declares.
# ---------------------------------------------------------------------------------------
$candidates = New-Object System.Collections.Generic.List[string]
foreach ($candidate in @(
    $env:NOESAR_TUI_SOCKET_PATH,
    $conf['socket'],
    $(if ($env:NOESAR_WORKSPACE) { Join-Path $env:NOESAR_WORKSPACE 'tui.sock' } else { '' }),
    (Join-Path $LauncherDir '..\.workspace\tui.sock')
)) {
    if ($candidate) { $candidates.Add($candidate) }
}

$foundSocket = ''
foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { $foundSocket = $candidate; break }
}

if ($foundSocket) {
    # Beside this file first, then the runtime root the product declares for itself — the
    # same two candidates, in the same order, as the POSIX launcher. The second exists
    # because a launcher reached through a link resolves to a directory that has no client
    # beside it, which is a real defect this phase found by running the POSIX half inside a
    # container rather than by reading it.
    $client = Join-Path $LauncherDir 'tui-client.mjs'
    if (-not (Test-Path -LiteralPath $client -PathType Leaf) -and $env:NOESAR_RUNTIME_ROOT) {
        $fallback = Join-Path $env:NOESAR_RUNTIME_ROOT 'tools\tui-client.mjs'
        if (Test-Path -LiteralPath $fallback -PathType Leaf) { $client = $fallback }
    }
    if (-not (Test-Path -LiteralPath $client -PathType Leaf)) {
        Write-Note "found the session socket at $foundSocket but the client is missing: $client"
        exit $ExitNoSession
    }
    $nodeBin = (Get-Command node -ErrorAction SilentlyContinue)
    if (-not $nodeBin) {
        Write-Note "found the session socket at $foundSocket but no 'node' on PATH to reach it with"
        exit $ExitNoSession
    }
    Write-Note "attaching via socket ($foundSocket)"
    & $nodeBin.Source $client $foundSocket
    exit $LASTEXITCODE
}
$attempts.Add('socket: none of the candidate paths is a live socket for this process')

# ---------------------------------------------------------------------------------------
# Rung 2 — the session is inside a container.
#
# No elevation branch here, and that is a decision rather than an omission: Windows has no
# sudoers rule to pin an argv against, so an installation that needs elevation grants it
# through the engine's own group (Docker Desktop's `docker-users`) and this launcher stays
# out of it. `elevate=sudo` in a configuration file is therefore refused rather than
# silently ignored — a setting that does nothing is worse than a setting that says so.
# ---------------------------------------------------------------------------------------
if ($conf['elevate'] -and $conf['elevate'] -ne 'none') {
    Write-Note "elevate='$($conf['elevate'])' is not supported on this platform; grant engine access through the engine's own group instead"
    exit $ExitUsage
}

$engineCandidates = if ($conf['engine']) { @($conf['engine']) } else { @('docker', 'podman', 'nerdctl') }
$engine = ''
foreach ($engineCandidate in $engineCandidates) {
    $engineCommand = Get-Command $engineCandidate -ErrorAction SilentlyContinue
    if (-not $engineCommand) {
        $attempts.Add("engine: '$engineCandidate' is not on PATH")
        continue
    }
    & $engineCommand.Source version *> $null
    if ($LASTEXITCODE -eq 0) { $engine = $engineCommand.Source; break }
    $attempts.Add("engine: '$engineCandidate' is installed but did not answer (daemon down, or this account may not talk to it)")
}

function Stop-NoSession {
    Write-Note 'no session found.'
    foreach ($attempt in $attempts) { [Console]::Error.WriteLine("  - $attempt") }
    # The browser is named FIRST and unconditionally — see the POSIX twin's
    # `no_session_help` for why the single line that used to be here was wrong twice over:
    # it named a file the reader may not have, and it made the specialist ssh recipe look
    # like the only way in.
    Write-Note ''
    Write-Note 'the session is also reachable in a browser, with nothing installed, from any'
    Write-Note 'device on this network:    http://<the-machine-running-it>:8100/'
    Write-Note ''
    Write-Note 'if the installation is not running yet, start it first. To put this launcher on'
    Write-Note 'another machine: deployment/container/install-coden-cli.sh (POSIX) or'
    Write-Note 'Install-CodenCli.ps1 (Windows) — neither needs root.'
    Write-Note 'The optional ssh recipe for a dedicated account is 08_INSTALLAZIONE.md §12.'
    exit $ExitNoSession
}

if (-not $engine) { Stop-NoSession }

# Found by the product label the image already carries, so nobody has to know its name.
if ($conf['container']) {
    $containers = @($conf['container'])
} else {
    $containers = @(& $engine ps --filter 'label=org.noesar.authority=reference-node' --filter 'status=running' --format '{{.Names}}' 2>$null |
        Where-Object { $_ -and $_.Trim() })
}

if ($containers.Count -eq 0) {
    $attempts.Add("container: '$engine' answered, but no running container carries label org.noesar.authority=reference-node")
    Stop-NoSession
}

# More than one match is not resolved by picking the first.
if ($containers.Count -gt 1) {
    Write-Note 'more than one running installation matched:'
    foreach ($name in $containers) { [Console]::Error.WriteLine("  - $name") }
    Write-Note "name the one this account opens with container=<name> in $confFile"
    exit $ExitAmbiguous
}

$remoteLauncher = if ($conf['remote_launcher']) { $conf['remote_launcher'] } else { '/opt/noesar/tools/coden-evolution' }
$ttyFlags = if ([Console]::IsInputRedirected) { @('-i') } else { @('-i', '-t') }

Write-Note "attaching via $engine ($($containers[0]))"
& $engine exec @ttyFlags $containers[0] $remoteLauncher
exit $LASTEXITCODE
