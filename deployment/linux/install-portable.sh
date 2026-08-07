#!/usr/bin/env sh
set -eu

DESTINATION="${1:-$HOME/.local/share/noesar-evolution}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)

command -v node >/dev/null 2>&1 || {
  echo "Node.js 22 or newer is required. No package is installed automatically." >&2
  exit 1
}

MAJOR=$(node -p 'process.versions.node.split(".")[0]')
test "$MAJOR" -ge 22 || {
  echo "Node.js 22 or newer is required." >&2
  exit 1
}

mkdir -p "$DESTINATION" "$BIN_DIR"
chmod 0700 "$DESTINATION"
rm -rf "$DESTINATION/noesar"
mkdir -p "$DESTINATION/noesar/services" "$DESTINATION/noesar/apps"
cp "$ROOT/package.json" "$DESTINATION/noesar/package.json"
cp -R "$ROOT/services/reference-control-plane" "$DESTINATION/noesar/services/reference-control-plane"
cp -R "$ROOT/apps/webui-static" "$DESTINATION/noesar/apps/webui-static"

cat > "$BIN_DIR/noesar-evolution" <<EOF
#!/usr/bin/env sh
export NOESAR_RUNTIME_ROOT="$DESTINATION/noesar"
export NOESAR_WORKSPACE="$DESTINATION/workspace"
exec node "$DESTINATION/noesar/services/reference-control-plane/src/server.mjs" "\$@"
EOF
chmod 0755 "$BIN_DIR/noesar-evolution"

# The session, in one word — for a from-source installation too.
#
# Until this was added, `coden_evolution` worked on a CONTAINER installation and did not
# exist on a from-source one: this installer wrote the server launcher and stopped there.
# The access is not a container feature, so the gap was in the installer, not the design.
#
# The whole of tools/*.mjs is copied rather than the four files the terminal client
# actually imports. `tui-import-closure.test.mjs` exists because a hand-kept copy list
# cannot track an import graph, and this project has already shipped a broken one twice;
# a glob cannot go stale the way a list does.
#
# The wrapper exports the two variables the launcher's FIRST rung reads. Without them a
# fresh shell has no NOESAR_WORKSPACE, rung 1 finds no socket, and the launcher falls
# through to hunting for a container that a from-source installation does not have.
mkdir -p "$DESTINATION/noesar/tools"
cp "$ROOT"/tools/*.mjs "$DESTINATION/noesar/tools/"
cp "$ROOT/tools/coden-evolution" "$DESTINATION/noesar/tools/coden-evolution"
chmod 0755 "$DESTINATION/noesar/tools/coden-evolution"

cat > "$BIN_DIR/coden_evolution" <<EOF
#!/usr/bin/env sh
export NOESAR_RUNTIME_ROOT="$DESTINATION/noesar"
export NOESAR_WORKSPACE="$DESTINATION/workspace"
exec "$DESTINATION/noesar/tools/coden-evolution" "\$@"
EOF
chmod 0755 "$BIN_DIR/coden_evolution"

echo "Installed launcher: $BIN_DIR/noesar-evolution"
echo "Installed session:  $BIN_DIR/coden_evolution   (type that one word to open it)"
echo "Persistent workspace: $DESTINATION/workspace"
