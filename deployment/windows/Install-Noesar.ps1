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
Install-Tree -Source (Join-Path $Root "apps\webui-static") `
  -Target (Join-Path $NoesarRoot "apps\webui-static") -Guard $NoesarRoot
Copy-Item -Force (Join-Path $Root "deployment\windows\Start-Noesar.ps1") $Destination
Write-Host "Installed to $Destination"
