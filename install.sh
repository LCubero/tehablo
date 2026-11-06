#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

if [[ "${1:-}" == --receptor ]]; then
    shift
    exec sh receptor/install.sh "$@"
fi

if ! command -v uv >/dev/null 2>&1; then
    printf '%s\n' 'Falta uv. Instálalo con:' \
        'curl -LsSf https://astral.sh/uv/install.sh | sh' \
        'Documentación: https://docs.astral.sh/uv/' >&2
    exit 1
fi

env_dir=.venv-pocket
if [[ -e "$env_dir" && ! -f "$env_dir/bin/python" ]]; then
    if [[ "$(uname -s)" == Darwin ]]; then
        env_dir=.venv-pocket-macos
    else
        env_dir=.venv-pocket-linux
    fi
fi
if [[ ! -f "$env_dir/bin/python" ]]; then
    uv venv "$env_dir" --python 3.12
fi
uv pip install --python "$env_dir/bin/python" -r requirements.txt \
    --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match

if output=$("$env_dir/bin/python" -c 'import pocket_tts, ptts, torch; print(torch.__version__); assert torch.version.cuda is None' 2>&1); then
    printf '%s\n' "$output"
else
    printf '%s\n' "$output" >&2
    exit 1
fi
# PortAudio is only needed to play on this machine; a server without sound can use Audio: SSH.
if ! output=$("$env_dir/bin/python" -c 'import sounddevice' 2>&1); then
    if printf '%s\n' "$output" | grep -qi portaudio; then
        printf '%s\n' 'Aviso: falta PortAudio, así que la voz no puede sonar en este equipo.' \
            'Si usas Pi aquí por SSH, elige Audio: SSH en los ajustes de Pi (README, Audio por SSH).' \
            'Para que suene en este equipo, instálalo y vuelve a ejecutar este script:'
        if command -v dnf >/dev/null 2>&1; then
            printf '%s\n' 'sudo dnf install portaudio'
        elif command -v apt-get >/dev/null 2>&1; then
            printf '%s\n' 'sudo apt install libportaudio2'
        else
            printf '%s\n' 'sudo dnf install portaudio      # Fedora' \
                'sudo apt install libportaudio2  # Debian / Ubuntu'
        fi
    else
        printf '%s\n' "$output" >&2
        exit 1
    fi
fi
printf '%s\n' 'Audio por SSH (en tu PC): ./install.sh --receptor'
printf 'Listo: %s\n' "$env_dir"
printf 'Para iniciar: %s/bin/python src/tehablo_tui.py\n' "$env_dir"
extension="$PWD/pi-extension/tehablo-tts"
printf '%s\n' 'Los modelos se descargan en el primer uso.' \
    'Para usarlo en Pi (una vez, para todos tus proyectos):' \
    "  pi install \"$extension\"" \
    "  (o con gentle-shell: gentle-shell install \"$extension\")" \
    'Voz opcional más natural en Pi: Phonon 40M es (Regina, Iker; acceso restringido, uso no comercial).' \
    '  Acepta los términos en https://huggingface.co/gradium/phonon-40m-es y elígela en los ajustes de Pi (/tts menu):' \
    '  pide el token solo para descargarla y no lo guarda.'
