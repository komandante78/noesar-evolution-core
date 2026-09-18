param(
  # Where this launcher was installed: its OWN directory, never a fixed path.
  #
  # The default used to be one fixed directory under the user profile -- not repeated here,
  # because the cross-platform check reads this file for exactly that string. Install-Noesar.ps1
  # copies this launcher into whatever -Destination it was given, so every installation that was
  # not the default one carried a launcher that started a DIFFERENT installation. Measured on
  # 2026-09-18: installed into a second directory, ran the launcher sitting in it, and the
  # process that came up was the older tree in the first one -- the address printed, the server
  # answered, and nothing in the output said it was the wrong product.
  #
  # $PSScriptRoot is the one value that is correct for every destination, the default included.
  [string]$InstallRoot = $PSScriptRoot,
  [string]$Workspace = (Join-Path $PSScriptRoot "workspace"),
  [int]$Port = 8088
)
$ErrorActionPreference = "Stop"
$env:NOESAR_RUNTIME_ROOT = Join-Path $InstallRoot "noesar"

# An installation that starts the wrong tree in silence is worse than one that refuses: the
# person has no way to see it. If there is no entrypoint under $InstallRoot, say so and stop.
$Entrypoint = Join-Path $env:NOESAR_RUNTIME_ROOT "services\reference-control-plane\src\server.mjs"
if (-not (Test-Path $Entrypoint)) {
  throw "No installation found at $InstallRoot (expected $Entrypoint). Run the Start-Noesar.ps1 that Install-Noesar.ps1 placed in the installation directory, or pass -InstallRoot."
}

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
