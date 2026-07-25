param([string]$Workspace = "$env:LOCALAPPDATA\NOESAR-Evolution\workspace")
$Path = Join-Path $Workspace "config\first-owner-setup.token"
if (-not (Test-Path $Path)) {
  throw "No setup token is present. Setup may already be complete."
}
Get-Content -Raw $Path
