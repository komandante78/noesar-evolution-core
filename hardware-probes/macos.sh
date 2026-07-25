#!/usr/bin/env sh
set -eu
printf '{"platform":"macos","hardware":'
system_profiler SPHardwareDataType -json 2>/dev/null || printf 'null'
printf ',"metal_devices":'
system_profiler SPDisplaysDataType -json 2>/dev/null || printf 'null'
printf '}\n'
