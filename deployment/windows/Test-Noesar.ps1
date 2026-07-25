param([int]$Port = 8088)
$ErrorActionPreference = "Stop"
$result = Invoke-RestMethod "http://127.0.0.1:$Port/healthz"
if ($result.status -ne "healthy" -or -not $result.local) {
  throw "NOESAR health verification failed."
}
$result | ConvertTo-Json -Depth 4
