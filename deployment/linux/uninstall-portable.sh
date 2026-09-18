#!/usr/bin/env sh
set -eu
DESTINATION="${1:-$HOME/.local/share/noesar-evolution}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
# install-portable.sh writes TWO commands into $BIN_DIR. This removed one of them, and left
# `coden_evolution` on the PATH pointing at a tree the person believed was gone: it would have
# started, found the workspace, and worked. Measured 2026-09-18 while writing the install guide.
rm -f "$BIN_DIR/noesar-evolution" "$BIN_DIR/coden_evolution"
echo "Launchers removed: noesar-evolution, coden_evolution"
# Neither the program tree nor the data is deleted here, on purpose. Saying where they are is the
# difference between a decision and an omission: an uninstaller that leaves things behind in
# silence is one the person finds out about months later.
echo "Program tree was not deleted: $DESTINATION/noesar"
echo "Persistent data was not deleted: $DESTINATION/workspace"
