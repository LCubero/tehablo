#!/bin/sh
set -eu
for arg in "$@"; do
    case "$arg" in
        --uninstall) ;;
        *) printf '%s\n' 'Uso: install.sh [--uninstall]' >&2; exit 2 ;;
    esac
done
# Also works via curl | sh. Never change anything before checking uv.
if ! command -v uv >/dev/null 2>&1; then
    printf '%s\n' 'Falta uv. Instalalo y vuelve a ejecutar:' \
        'curl -LsSf https://astral.sh/uv/install.sh | sh' >&2
    exit 1
fi
base="$HOME/.local/share/tehablo-cliente"
client="$base/tehablo_cliente.py"
# $0 is a file only when invoked from a clone, not when piped into sh.
case "$0" in
    */*) candidate="${0%/*}/../cliente/tehablo_cliente.py"
         if [ -f "$candidate" ]; then client="$candidate"; fi ;;
esac
if [ ! -f "$client" ]; then
    mkdir -p "$base"
    curl -fsSL https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py -o "$client"
fi
exec uv run --script "$client" "$@"
