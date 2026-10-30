"""Technical speech normalization; plain script, no model or audio required."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from tehablo_tech import normalize_technical

# S1-S5: public speech-preparation behavior, including preserved boundaries.
RULE_CASES = [
    ('question opening', 'Alguna suena a pregunta? Y si es así, cuál?',
     '¿Alguna suena a pregunta? ¿Y si es así, cuál?'),
    ('question keeps existing opening', '¿Alguna suena a pregunta? Y si es así, ¿cuál?',
     '¿Alguna suena a pregunta? Y si es así, ¿cuál?'),
    ('question after statement', 'Listo. Seguimos? Vale 3.5?',
     'Listo. ¿Seguimos? ¿Vale 3.5?'),
    ('statement untouched', 'Hago los commits.', 'Hago los commits.'),
    ('emoji', '\u26a0\ufe0f No añadí OS. \u2705 listo \u274c fallo \U0001f680 \u2605 fin',
     'No añadí OS. listo fallo fin'),
    ('degrees', '25 °C, 25°C, -3 °F y 90°.',
     '25 grados celsius, 25 grados celsius, -3 grados fárenjait y 90 grados.'),
    ('S1', 'antes ' + '+' * 32 + ' === --- *** ___ ~~~ ### después C++ ++',
     'antes después C++ ++'),
    ('S1 Pi block', '++++++++++++++++. Siguiente acción. ++++++++++++++++. Fin.',
     'Siguiente acción. Fin.'),
    ('S2', 'API → ei pi ai, → listo', 'API, ei pi ai, listo'),
    ('S3', 'on/off feat/pi-tts docs/a.xyz /root/bin ./src/bin ../src/bin ~/bin/ bin/ 29/10/2026 1/2',
     'on eslash off feat eslash pi-tts a.xyz bin bin bin bin bin 29/10/2026 1/2'),
    ('S4', 'el modelo (spanish) carga (bien). (sí), vale',
     'el modelo, spanish, carga, bien. sí, vale'),
    ('S5', 'el commit 3862ef7 quedó', 'el commit quedó'),
]

CASES = [
    ('https://github.com/LCubero/tehablo', 'enlace a github punto com'),
    ('Visita https://www.example.org/a?q=1.', 'Visita enlace a example punto org.'),
    ('www.example.com, luego.', 'enlace a example punto com, luego.'),
    ('(https://example.org/x).', 'enlace a example punto org.'),
    ('src/tehablo_server.py', 'tehablo server punto pai'),
    ('docs/repo-harness/roadmap.md', 'roadmap punto eme de'),
    ('.pi/settings.json', 'settings punto yéison'),
    (r'E:\code\x', 'x'),
    ('feat/pi-tts', 'feat eslash pi-tts'),
    ('tehablo_server.py.', 'tehablo server punto pai.'),
    ('my-file.ts', 'my file punto te ese'),
    ('RH-W-0001', 'erre hache, doble ve, 0001'),
    ('ABC-12', 'a be ce, 12'),
    ('T1 y S3', 'te, 1 y ese, 3'),
    ('API JSON URL PR TTS HEAD README HOLA', 'API JSON URL PR TTS HEAD README HOLA'),
    ('abc1234 0123456789abcdef', ''),
    ('abcdefg 1234567 abc123 abc12345678901234567890123456789012345678ab',
     'abcdefg 1234567 abc123 abc12345678901234567890123456789012345678ab'),
    ('tehablo_server y pi-tts', 'tehablo server y pi-tts'),
    ('Hola, ¿cómo estás? Sin cambios.', 'Hola, ¿cómo estás? Sin cambios.'),
    ('3.5 v1.2 15.000 29/10/2026 1/2', '3.5 v1.2 15.000 29/10/2026 1/2'),
    ('preRH-W-0001extra', 'preRH-W-0001extra'),
    ('12,50 y (25,5)', '12,50 y, 25,5'),
    ('https://www.example.py/a_b.py.', 'enlace a example punto py.'),
    ('src/a.py, docs/b.md!', 'a punto pai, b punto eme de!'),
    ('ABC-12-XYZ-003.', 'a be ce, 12, equis ye zeta, 003.'),
    ('README.md fichero.unknown v1.2.3', 'README punto eme de fichero.unknown v1.2.3'),
    ('cherry-pick Wi-Fi pull request', 'cherry-pick Wi-Fi pull request'),
    ('abc1234.', '.'),
    ('1234abc' + 'a' * 33, ''),
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
    for rule, text, expected in RULE_CASES:
        got = normalize_technical(text)
        print(f'{rule}: {got!r}')
        if got != expected:
            failures += 1
            print(f'FAIL {rule} expected {expected!r}')
    for text, expected in CASES:
        got = normalize_technical(text)
        print(f'{text!r} -> {got!r}')
        if got != expected:
            failures += 1
            print(f'FAIL expected {expected!r}')
    total = len(CASES) + len(RULE_CASES)
    print(f'{total - failures}/{total} passed')
    return bool(failures)


if __name__ == '__main__':
    sys.exit(main())
