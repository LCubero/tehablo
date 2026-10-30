#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

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

if output=$("$env_dir/bin/python" -c 'import pocket_tts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None' 2>&1); then
    printf '%s\n' "$output"
else
    printf '%s\n' "$output" >&2
    if printf '%s\n' "$output" | grep -qi portaudio; then
        printf '%s\n' 'Falta PortAudio. Instálalo y vuelve a ejecutar este script:' >&2
        if command -v dnf >/dev/null 2>&1; then
            printf '%s\n' 'sudo dnf install portaudio' >&2
        elif command -v apt-get >/dev/null 2>&1; then
            printf '%s\n' 'sudo apt install libportaudio2' >&2
        else
            printf '%s\n' 'sudo dnf install portaudio      # Fedora' \
                'sudo apt install libportaudio2  # Debian / Ubuntu' >&2
        fi
    fi
    exit 1
fi
printf 'Listo: %s\n' "$env_dir"
printf 'Para iniciar: %s/bin/python src/tehablo_tui.py\n' "$env_dir"
printf '%s\n' 'Pi encuentra el entorno automáticamente. Los modelos se descargan en el primer uso.'
