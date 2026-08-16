#!/usr/bin/env bash
# WHITEOUT - launcher for macOS / Linux hosts.
#
# The bundled runtime in runtime/node is the Windows build, so on other platforms
# this falls back to a system Node (18+). The game itself is pure ESM with zero
# npm dependencies, so any modern Node will run it.

set -e
cd "$(dirname "$0")"

if [ -x "runtime/node/bin/node" ]; then
  NODE="runtime/node/bin/node"
elif command -v node >/dev/null 2>&1; then
  NODE="node"
  echo ""
  echo "  Note: using your system Node ($(node --version))."
  echo "  The bundled runtime/node folder is the Windows build."
  echo ""
else
  echo ""
  echo "  No Node runtime found."
  echo "  Install Node 18+ from https://nodejs.org, or run start.bat on Windows"
  echo "  where the bundled runtime works out of the box."
  echo ""
  exit 1
fi

exec "$NODE" server/index.js "$@"
