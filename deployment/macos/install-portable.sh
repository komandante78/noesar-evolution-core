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

# The session, in one word. Written NEXT TO portable-start.sh rather than into a directory
# on PATH, because this installer deliberately does not touch PATH on macOS and one
# installer must not have two opinions about that. The whole of tools/*.mjs is copied for
# the reason `tui-import-closure.test.mjs` was written: a hand-kept list of the terminal
# client's imports cannot track the import graph, and a glob cannot go stale.
#
# The default destination on this platform contains a space (`Application Support`), which
# is why every path below is quoted and why the launcher's own candidate list is read a
# whole line at a time — a split on whitespace here would be a defect visible on exactly
# one operating system.
mkdir -p "$DESTINATION/noesar/tools"
cp "$ROOT"/tools/*.mjs "$DESTINATION/noesar/tools/"
cp "$ROOT/tools/coden-evolution" "$DESTINATION/noesar/tools/coden-evolution"
chmod 0755 "$DESTINATION/noesar/tools/coden-evolution"

cat > "$DESTINATION/coden_evolution" <<EOF
#!/usr/bin/env sh
export NOESAR_RUNTIME_ROOT="$DESTINATION/noesar"
export NOESAR_WORKSPACE="$DESTINATION/workspace"
exec "$DESTINATION/noesar/tools/coden-evolution" "\$@"
EOF
chmod 0755 "$DESTINATION/coden_evolution"

echo "Installed to $DESTINATION"
echo "Open the session with: \"$DESTINATION/coden_evolution\""
echo "Or in a browser, with nothing installed: http://localhost:8100/"
echo "The Metal/Core ML bridge remains a separate authenticated host component."
