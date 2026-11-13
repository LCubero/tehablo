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
    # Download to .part first so a cut connection never leaves a broken client.
    curl -fsSL https://raw.githubusercontent.com/LCubero/tehablo/master/cliente/tehablo_cliente.py -o "$client.part"
    mv "$client.part" "$client"
fi
if [ "${1:-}" = --uninstall ]; then
    exec uv run --script "$client" "$@"
fi
# Absolute path: the printed command works from another directory too.
client="$(CDPATH= cd -- "${client%/*}" && pwd)/${client##*/}"
printf '%s\n' 'Cliente instalado'
printf "Para iniciar: uv run --script '%s'\n" "$client"
printf '%s\n' '1. Conexión SSH → elegir servidor.' \
    '2. Vincular servidor → pegar el código de /tts codigo.' \
    '3. Deja el cliente abierto para oír la voz.' \
    'Para salir: Salir o Esc.'
# curl | sh leaves stdin on the pipe: then ask through the terminal; never in captured or headless runs.
tty=
if [ -t 0 ]; then tty=/dev/stdin
elif [ -t 1 ] && { : < /dev/tty; } 2>/dev/null; then tty=/dev/tty
fi
if [ -n "$tty" ]; then
    printf '%s\n' 'Presiona Enter para abrir el cliente (Ctrl+C para salir)'
    IFS= read -r answer < "$tty" || exit 0
    exec uv run --script "$client" "$@" < "$tty"
fi
