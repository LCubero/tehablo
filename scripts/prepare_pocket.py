"""Prepare public Pocket Spanish assets in the same Hugging Face cache as Pocket."""


def fetch(uri):
    from huggingface_hub import hf_hub_download, try_to_load_from_cache
    owner, repo, rest = uri.removeprefix('hf://').split('/', 2)
    filename, _, revision = rest.partition('@')
    repo = f'{owner}/{repo}'
    revision = revision or None
    cached = try_to_load_from_cache(repo, filename, revision=revision)
    if isinstance(cached, str):
        return cached
    return hf_hub_download(repo, filename, revision=revision, token=False)


def assets():
    import yaml
    from pocket_tts.utils.config import CONFIGS_DIR
    from pocket_tts.utils.utils import get_predefined_voice
    config = yaml.safe_load((CONFIGS_DIR / 'spanish.yaml').read_text(encoding='utf-8'))
    # Same order as Pocket's loader, so the server finds this exact bundle and never downloads a second one.
    return [('Pocket spanish', (config['weights_path'], config['weights_path_without_voice_cloning'])),
            ('tokenizer spanish', config['flow_lm']['lookup_table']['tokenizer_path']),
            *[(name, get_predefined_voice('spanish', name)) for name in ('lola', 'rafael')]]


def main(installer=False):
    import sys
    # Installers collect notices from stdout; download progress stays on stderr.
    notices = sys.stdout if installer else sys.stderr
    try:
        pending = assets()
    except Exception:
        print('Aviso: no se pudo preparar Pocket spanish; vuelve a ejecutar el instalador.', file=notices)
        return
    for name, uris in pending:
        for uri in uris if isinstance(uris, tuple) else (uris,):
            try:
                fetch(uri)
                print(f'Preparado: {name}')
                break
            except Exception:
                continue
        else:
            print(f'Aviso: no se pudo descargar {name}; vuelve a ejecutar el instalador.', file=notices)


if __name__ == '__main__':
    import sys
    main(installer='--installer' in sys.argv[1:])
