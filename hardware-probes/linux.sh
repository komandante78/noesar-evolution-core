#!/usr/bin/env sh
set -eu
printf '{"platform":"linux","cpu":'
if command -v lscpu >/dev/null 2>&1; then
  lscpu -J 2>/dev/null || printf 'null'
else
  printf 'null'
fi
printf ',"memory_kb":'
awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || printf 'null'
printf ',"nvidia":'
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi --query-gpu=index,name,memory.total,driver_version --format=csv,noheader,nounits | python3 -c 'import csv,json,sys; print(json.dumps(list(csv.reader(sys.stdin))))'
else
  printf '[]'
fi
printf ',"rocm":'
if command -v rocminfo >/dev/null 2>&1; then printf 'true'; else printf 'false'; fi
printf ',"openvino":'
if python3 -c 'import openvino' >/dev/null 2>&1; then printf 'true'; else printf 'false'; fi
printf '}\n'
