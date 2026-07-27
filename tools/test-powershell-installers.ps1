# SPDX-License-Identifier: AGPL-3.0-or-later
# Parses every first-party PowerShell script with the real PowerShell parser.
#
# tools/test-cross-platform-installers.mjs reports the Windows installers as
# "STATIC ONLY -- no PowerShell on this host": it matches them with regular expressions and
# says so honestly. A regex cannot tell a script that parses from one that does not, so a
# `.ps1` with a syntax error would have passed every check this repository had.
#
# Run through the published PowerShell image; nothing is installed on the host:
#   docker run --rm -v "$PWD":/repo -w /repo mcr.microsoft.com/powershell:latest \
#     pwsh -NoProfile -File tools/test-powershell-installers.ps1
#
# This parses. It does not execute: the installers target Windows paths and Docker Desktop,
# and running them under Linux PowerShell would prove nothing about either.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$targets = @(
    'deployment/windows',
    'hardware-probes'
)

$files = @()
foreach ($target in $targets) {
    $full = Join-Path $root $target
    if (Test-Path $full) {
        $files += Get-ChildItem -Path $full -Recurse -Filter *.ps1 -File
    }
}

if ($files.Count -eq 0) {
    Write-Host 'POWERSHELL_PARSE=FAIL reason=no-scripts-found'
    exit 1
}

$failures = 0
foreach ($file in $files) {
    $errors = $null
    $tokens = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $file.FullName, [ref]$tokens, [ref]$errors) | Out-Null
    $relative = $file.FullName.Substring($root.Length).TrimStart('/', '\')
    if ($errors.Count -gt 0) {
        $failures++
        Write-Host "PARSE_FAIL $relative"
        foreach ($e in ($errors | Select-Object -First 3)) {
            Write-Host ("   line {0}: {1}" -f $e.Extent.StartLineNumber, $e.Message)
        }
    }
    else {
        Write-Host "PARSE_OK $relative"
    }
}

Write-Host ''
Write-Host "POWERSHELL_PARSE_FILES=$($files.Count)"
Write-Host "POWERSHELL_PARSE_FAILURES=$failures"
Write-Host "POWERSHELL_EXECUTED=false reason=windows-only-cmdlets-and-paths"
if ($failures -gt 0) {
    Write-Host 'POWERSHELL_PARSE=FAIL'
    exit 1
}
Write-Host 'POWERSHELL_PARSE=PASS'
exit 0
