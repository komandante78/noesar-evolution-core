# The workspace of the installation this script sits in. The default is $PSScriptRoot for the
# same reason as in Start-Noesar.ps1: Install-Noesar.ps1 copies this file into its -Destination,
# so a fixed path made every non-default installation read another installation's workspace.
param([string]$Workspace = (Join-Path $PSScriptRoot "workspace"))
$Path = Join-Path $Workspace "config\first-owner-setup.token"
if (-not (Test-Path $Path)) {
  throw "No setup token is present. Setup may already be complete."
}
Get-Content -Raw $Path
