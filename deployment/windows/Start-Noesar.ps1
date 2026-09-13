param(
  [string]$InstallRoot = "$env:LOCALAPPDATA\NOESAR-Evolution",
  [string]$Workspace = "$env:LOCALAPPDATA\NOESAR-Evolution\workspace",
  [int]$Port = 8088
)
$ErrorActionPreference = "Stop"
$env:NOESAR_RUNTIME_ROOT = Join-Path $InstallRoot "noesar"
$env:NOESAR_WORKSPACE = $Workspace
$env:NOESAR_HOST = "127.0.0.1"
$env:NOESAR_PORT = "$Port"
$env:NOESAR_ALLOWED_HOSTS = "localhost,127.0.0.1,::1"
$env:NOESAR_SECURE_COOKIES = "false"
$env:NOESAR_RELEASE_CHANNEL = "development"
$env:NOESAR_AUTHORITY_MODE = "reference-node"
$env:NOESAR_DATA_PLANE = "reference-json"
$env:NODE_ENV = "production"
# NOTE: the pre-consolidation runtime-bin\runtime-preflight.mjs preflight check was never
# carried into this candidate and has no functional equivalent elsewhere in the product; it
# was removed rather than left as a guaranteed failure or replaced with fabricated logic.
# This used to end with a citation of a build-preparation report the repository does not
# contain — a dangling reference inside a script that ships to other people. The fact is
# kept; the pointer nobody can follow is gone, and the path is not repeated even here,
# because the test now checks for its absence and a comment naming it would fail that.

# The address is printed HERE because $Port lives here. The installer used to print one of
# its own and it was wrong (8100, this project's Unraid container mapping) — one value, one
# place, and the place is where the value is decided.
Write-Host "NOESAR Evolution is starting on http://127.0.0.1:$Port/"
Set-Location $env:NOESAR_RUNTIME_ROOT
node "services\reference-control-plane\src\server.mjs"
