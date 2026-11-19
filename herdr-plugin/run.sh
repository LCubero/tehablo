#!/bin/sh
# Resolve a Python interpreter and run notify.py.
set -u
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PY=

try() {
  [ -n "$1" ] || return 1
  command -v "$1" >/dev/null 2>&1 || return 1
  "$1" -c 'import sys' >/dev/null 2>&1 || return 1
  PY=$1
}

try "${TEHABLO_PYTHON:-}" || true

if [ -z "$PY" ] && [ -n "${HERDR_PLUGIN_CONFIG_DIR:-}" ] && [ -f "$HERDR_PLUGIN_CONFIG_DIR/python.txt" ]; then
  hint=$(head -n 1 "$HERDR_PLUGIN_CONFIG_DIR/python.txt" | tr -d '\r')
  hint=$(printf '%s' "$hint" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
  try "$hint" || true
fi

if [ -z "$PY" ]; then
  try python3 || try python || true
fi

if [ -z "$PY" ]; then
  echo "tehablo-herdr: no Python interpreter found. Set TEHABLO_PYTHON or write its path to python.txt in the plugin config directory." >&2
  exit 1
fi

exec "$PY" "$here/notify.py" "$@"
