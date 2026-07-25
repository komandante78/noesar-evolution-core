$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
py (Join-Path $ScriptDir "releasectl.py") verify
