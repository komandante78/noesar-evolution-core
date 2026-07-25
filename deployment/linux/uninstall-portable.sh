#!/usr/bin/env sh
set -eu
DESTINATION="${1:-$HOME/.local/share/noesar-evolution}"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
rm -f "$BIN_DIR/noesar-evolution"
echo "Launcher removed."
echo "Persistent data was not deleted: $DESTINATION"
