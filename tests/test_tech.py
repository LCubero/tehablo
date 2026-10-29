"""Technical speech normalization; plain script, no model or audio required."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from tehablo_tech import normalize_technical

CASES = [
    ('https://github.com/LCubero/tehablo', 'enlace a github punto com'),
    ('Visita https://www.example.org/a?q=1.', 'Visita enlace a example punto org.'),
    ('www.example.com, luego.', 'enlace a example punto com, luego.'),
    ('(https://example.org/x).', '(enlace a example punto org).'),
    ('src/tehablo_server.py', 'tehablo server punto pai'),
    ('docs/repo-harness/roadmap.md', 'roadmap punto eme de'),
    ('.pi/settings.json', 'settings punto yéison'),
    (r'E:\code\x', 'x'),
    ('feat/pi-tts', 'pi-tts'),
    ('tehablo_server.py.', 'tehablo server punto pai.'),
    ('my-file.ts', 'my file punto te ese'),
    ('RH-W-0001', 'erre hache, doble ve, 0001'),
    ('ABC-12', 'a be ce, 12'),
    ('T1 y S3', 'te, 1 y ese, 3'),
    ('API JSON URL PR TTS HEAD README HOLA', 'API JSON URL PR TTS HEAD README HOLA'),
    ('abc1234 0123456789abcdef', 'un hash un hash'),
    ('abcdefg 1234567 abc123 abc12345678901234567890123456789012345678ab',
     'abcdefg 1234567 abc123 abc12345678901234567890123456789012345678ab'),
    ('tehablo_server y pi-tts', 'tehablo server y pi-tts'),
    ('Hola, ¿cómo estás? Sin cambios.', 'Hola, ¿cómo estás? Sin cambios.'),
    ('3.5 v1.2 15.000 29/10/2026 1/2', '3.5 v1.2 15.000 29/10/2026 1/2'),
    ('preRH-W-0001extra', 'preRH-W-0001extra'),
    ('https://www.example.py/a_b.py.', 'enlace a example punto py.'),
    ('src/a.py, docs/b.md!', 'a punto pai, b punto eme de!'),
    ('ABC-12-XYZ-003.', 'a be ce, 12, equis ye zeta, 003.'),
    ('README.md fichero.unknown v1.2.3', 'README punto eme de fichero.unknown v1.2.3'),
    ('cherry-pick Wi-Fi pull request', 'cherry-pick Wi-Fi pull request'),
    ('abc1234.', 'un hash.'),
    ('1234abc' + 'a' * 33, 'un hash'),
]
EXTENSIONS = {'py':'pai', 'ts':'te ese', 'js':'jota ese', 'json':'yéison',
              'md':'eme de', 'txt':'te equis te', 'wav':'uve doble a uve',
              'mp3':'eme pe tres', 'flac':'flac', 'toml':'te o eme ele',
              'yaml':'yámel', 'yml':'yámel', 'html':'hache te eme ele',
              'css':'ce ese ese', 'sh':'ese hache', 'ps1':'pe ese uno',
              'exe':'e equis e', 'lock':'loc'}
CASES += [(f'name.{ext}', f'name punto {spoken}') for ext, spoken in EXTENSIONS.items()]


def main():
    failures = 0
    for text, expected in CASES:
        got = normalize_technical(text)
        print(f'{text!r} -> {got!r}')
        if got != expected:
            failures += 1
            print(f'FAIL expected {expected!r}')
    print(f'{len(CASES) - failures}/{len(CASES)} passed')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
