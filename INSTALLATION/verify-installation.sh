#!/usr/bin/env bash
set -euo pipefail
PORT="${NOESAR_PORT:-8088}"
CONTAINER="${NOESAR_CONTAINER:-noesar-evolution}"

docker container inspect "$CONTAINER" >/dev/null
curl -fsS "http://127.0.0.1:${PORT}/healthz" | tee /tmp/noesar-health.json
printf '\n'
docker inspect "$CONTAINER" --format 'CONTAINER_STATUS={{.State.Status}} HEALTH={{if .State.Health}}{{.State.Health.Status}}{{else}}not-configured{{end}} RESTARTS={{.RestartCount}}'
echo "INSTALLATION_VERIFY=PASS"
