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

# The notices, and the record that they were shown.
#
# Until this was added they reached only the people who installed with deployment/docker/run.sh:
# the graph has one caller for noesar_install_intro. A from-source installation went straight to
# copying, so the five points -- among them that this product answers with a language model, and
# that the password it starts with is the same on every installation in the world -- were never
# put in front of the person installing it.
#
# The port question the container path asks is deliberately left out: this installer does not
# choose the port, the launcher it writes does.
# shellcheck source=../lib/network-access.sh
. "$ROOT/deployment/lib/network-access.sh"
noesar_print_welcome "$ROOT" || exit 1
noesar_take_consent "$DESTINATION/workspace" "$(id -u):$(id -g)" || exit 1

mkdir -p "$DESTINATION" "$BIN_DIR"
chmod 0700 "$DESTINATION"
rm -rf "$DESTINATION/noesar"
mkdir -p "$DESTINATION/noesar/services" "$DESTINATION/noesar/apps"
cp "$ROOT/package.json" "$DESTINATION/noesar/package.json"
cp -R "$ROOT/services/reference-control-plane" "$DESTINATION/noesar/services/reference-control-plane"
cp -R "$ROOT/apps/webui-static" "$DESTINATION/noesar/apps/webui-static"
# Everything below is read from the installation at runtime, and none of it was ever copied by
# this script. Windows learned two of them on 2026-08-31 -- apps/shared and packages/, both
# ERR_MODULE_NOT_FOUND on a real machine -- and these portable installers never got that fix.
# The rest was measured on 2026-09-18: a fresh installation answers 500 on its own home page,
# because sector-modules.mjs opens schemas/industry-module-manifest.schema.json. Under 1 MB.
cp -R "$ROOT/apps/shared" "$DESTINATION/noesar/apps/shared"
cp -R "$ROOT/packages" "$DESTINATION/noesar/packages"
cp -R "$ROOT/schemas" "$DESTINATION/noesar/schemas"
cp -R "$ROOT/capabilities" "$DESTINATION/noesar/capabilities"
mkdir -p "$DESTINATION/noesar/docs"
cp -R "$ROOT/docs/governance" "$DESTINATION/noesar/docs/governance"

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

# The one thing a person cannot do without, and could not read anywhere: how to get in.
noesar_print_first_signin
