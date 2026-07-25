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
Copy-Item -Recurse -Force (Join-Path $Root "services\reference-control-plane") (Join-Path $NoesarRoot "services\reference-control-plane")
Copy-Item -Recurse -Force (Join-Path $Root "apps\webui-static") (Join-Path $NoesarRoot "apps\webui-static")
Copy-Item -Force (Join-Path $Root "deployment\windows\Start-Noesar.ps1") $Destination
Write-Host "Installed to $Destination"
