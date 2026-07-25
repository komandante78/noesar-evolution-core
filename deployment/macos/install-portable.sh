#!/usr/bin/env sh
set -eu
DESTINATION="${1:-$HOME/Library/Application Support/NOESAR Evolution}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
command -v node >/dev/null 2>&1 || {
  echo "Node.js 22 or newer is required. No package is installed automatically." >&2
  exit 1
}
mkdir -p "$DESTINATION"
chmod 0700 "$DESTINATION"
rm -rf "$DESTINATION/noesar"
mkdir -p "$DESTINATION/noesar/services" "$DESTINATION/noesar/apps"
cp "$ROOT/package.json" "$DESTINATION/noesar/package.json"
cp -R "$ROOT/services/reference-control-plane" "$DESTINATION/noesar/services/reference-control-plane"
cp -R "$ROOT/apps/webui-static" "$DESTINATION/noesar/apps/webui-static"

cat > "$DESTINATION/portable-start.sh" <<EOF
#!/usr/bin/env sh
export NOESAR_RUNTIME_ROOT="$DESTINATION/noesar"
export NOESAR_WORKSPACE="$DESTINATION/workspace"
exec node "$DESTINATION/noesar/services/reference-control-plane/src/server.mjs"
EOF
chmod 0755 "$DESTINATION/portable-start.sh"

echo "Installed to $DESTINATION"
echo "The Metal/Core ML bridge remains a separate authenticated host component."
