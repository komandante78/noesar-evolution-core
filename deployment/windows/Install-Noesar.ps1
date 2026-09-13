param([string]$Destination = "$env:LOCALAPPDATA\NOESAR-Evolution")
$ErrorActionPreference = "Stop"
$Node = Get-Command node -ErrorAction SilentlyContinue
if (-not $Node) {
  throw "Node.js 22 or newer is required. This installer does not install packages."
}
$Major = [int](& node -p "process.versions.node.split('.')[0]")
if ($Major -lt 22) { throw "Node.js 22 or newer is required." }

$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
$NoesarRoot = Join-Path $Destination "noesar"
New-Item -ItemType Directory -Force -Path (Join-Path $NoesarRoot "services") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $NoesarRoot "apps") | Out-Null
Copy-Item -Force (Join-Path $Root "package.json") $NoesarRoot

# Reinstalling must replace the program tree, not grow one inside it. `Copy-Item -Recurse`
# onto a destination that already exists copies the source *into* it, so the second run
# produced services\reference-control-plane\reference-control-plane and every run after
# that nested one level deeper. Reproduced with real PowerShell on 2026-07-27 before this
# was changed.
#
# The destination is removed first so a file dropped by an older version does not survive
# the upgrade. Only the two directories this installer itself writes are removed, and each
# is required to sit under $NoesarRoot before anything is deleted -- a -Recurse -Force
# remove aimed at the wrong path by a bad -Destination is not a mistake worth risking.
function Install-Tree {
  param([string]$Source, [string]$Target, [string]$Guard)
  $resolvedGuard = [System.IO.Path]::GetFullPath($Guard)
  $resolvedTarget = [System.IO.Path]::GetFullPath($Target)
  if (-not $resolvedTarget.StartsWith($resolvedGuard)) {
    throw "refusing to install outside $resolvedGuard"
  }
  if (Test-Path $resolvedTarget) {
    Remove-Item -Recurse -Force $resolvedTarget
  }
  Copy-Item -Recurse -Force $Source $resolvedTarget
}

Install-Tree -Source (Join-Path $Root "services\reference-control-plane") `
  -Target (Join-Path $NoesarRoot "services\reference-control-plane") -Guard $NoesarRoot
# apps/ WHOLE, not apps\webui-static. The control plane imports apps/shared/coden/*.js as
# well — measured on real Windows on 2026-08-31, second start, ERR_MODULE_NOT_FOUND on
# agent-commands.js — and naming one subdirectory is the hand-kept list this installer
# already refuses for tools/. 1.5 MB, both directories.
Install-Tree -Source (Join-Path $Root "apps") `
  -Target (Join-Path $NoesarRoot "apps") -Guard $NoesarRoot

# The control plane imports from packages/ — verified-acquisition today, through
# model-transport.mjs. Without this the server threw ERR_MODULE_NOT_FOUND on its first
# start, and had done so for every Windows installation ever attempted; measured on real
# Windows on 2026-08-31, which is also the first time anyone ran this installer.
#
# The WHOLE tree, not the one package in use, for the same reason the tools copy is whole:
# a hand-kept list of imports does not track the import graph. 412 KB, all four packages.
Install-Tree -Source (Join-Path $Root "packages") `
  -Target (Join-Path $NoesarRoot "packages") -Guard $NoesarRoot
Copy-Item -Force (Join-Path $Root "deployment\windows\Start-Noesar.ps1") $Destination
# Measured 2026-09-13, first real end-to-end run of this installer: Show-FirstOwnerToken.ps1
# reads the setup token from $Workspace, which only exists AFTER this install runs, and the
# script was not being copied here -- so the one tool that reveals the token needed to
# finish setup was unreachable the moment a person deleted the source checkout.
$tokenHelper = Join-Path $Root "deployment\windows\Show-FirstOwnerToken.ps1"
if (Test-Path $tokenHelper) { Copy-Item -Force $tokenHelper $Destination }

# The session, in one word — for a from-source installation on this platform too. Until
# this was added the word existed only on a container installation, and only in its POSIX
# dialect; a person who installed from source on Windows had the server and no way into
# the session but the browser.
#
# The whole of tools\*.mjs is copied for the reason `tui-import-closure.test.mjs` was
# written: a hand-kept list of the terminal client's imports cannot track the import graph.
$ToolsRoot = Join-Path $NoesarRoot "tools"
New-Item -ItemType Directory -Force -Path $ToolsRoot | Out-Null
Copy-Item -Force (Join-Path $Root "tools\*.mjs") $ToolsRoot
Copy-Item -Force (Join-Path $Root "tools\coden-evolution.ps1") (Join-Path $ToolsRoot "coden-evolution.ps1")

# The wrapper exports the two variables the launcher's first rung reads; without them a
# fresh shell has no NOESAR_WORKSPACE and rung 1 finds no socket to attach to.
@"
`$env:NOESAR_RUNTIME_ROOT = '$NoesarRoot'
`$env:NOESAR_WORKSPACE    = '$(Join-Path $Destination "workspace")'
& '$(Join-Path $ToolsRoot "coden-evolution.ps1")' @args
"@ | Set-Content -Path (Join-Path $Destination "coden_evolution.ps1") -Encoding UTF8

Write-Host "Installed to $Destination"
# Start-Noesar.ps1 is copied above and was never named here, so nothing in this output
# started anything. It prints the address it serves, which is why no port appears below:
# the previous line named 8100 — the port the Unraid container is published on, not the one
# this launcher listens to — and sent people to an address where nothing answers.
Write-Host "Start it with: $(Join-Path $Destination 'Start-Noesar.ps1')"
Write-Host "It prints the address to open in a browser."
Write-Host "Or work in the terminal: $(Join-Path $Destination 'coden_evolution.ps1')"
