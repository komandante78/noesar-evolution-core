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
$env:NOESAR_SETUP_TOKEN_FILE = Join-Path $Workspace "config\first-owner-setup.token"
$env:NODE_ENV = "production"
# NOTE (BUILD_PREPARATION_V1): the pre-consolidation runtime-bin\runtime-preflight.mjs
# preflight check was never carried into this candidate and has no functional
# equivalent elsewhere in PRODUCT; it was removed rather than left as a guaranteed
# failure or replaced with fabricated logic. See BLOCKED_PATH_DECISION in
# REPORTS/BUILD_PREPARATION_V1/03_PATH_DECISIONS.tsv.
Set-Location $env:NOESAR_RUNTIME_ROOT
node "services\reference-control-plane\src\server.mjs"
