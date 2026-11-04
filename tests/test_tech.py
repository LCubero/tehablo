"""Technical speech normalization; plain script, no model or audio required."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from tehablo_tech import normalize_technical

# S1-S5: public speech-preparation behavior, including preserved boundaries.
RULE_CASES = [
    ('long explicit IDs', '#12340007 issue 10000000 PR #12345678 commit 12345678',
     'terminación en cero cero cero siete issue terminación en cero cero cero cero PR terminación en cinco seis siete ocho commit terminación en cinco seis siete ocho'),
    ('structured long IDs', 'ABC-12345678 RH-W-12340007',
     'a be ce, terminación en cinco seis siete ocho erre hache, doble ve, terminación en cero cero cero siete'),
    ('marked test IDs', 'prueba ID 12345678 test #12345678 run ID: 12345678 feat ID 12345678 feature ID 12345678',
     'prueba ID terminación en cinco seis siete ocho test terminación en cinco seis siete ocho run ID: terminación en cinco seis siete ocho feat ID terminación en cinco seis siete ocho feature ID terminación en cinco seis siete ocho'),
    ('ID threshold', '#9999999 #10000000 #00000007 #00010000000',
     'número 9999999 terminación en cero cero cero cero número 00000007 terminación en cero cero cero cero'),
    ('counts and plain numbers', 'tests 12345678 passed; test 12345678/12345678 passed; 12345678; resultado=12345678; $12345678; 12345678kg; 12345678%',
     'tests 12345678 passed; test 12345678/12345678 passed; 12345678; resultado igual a 12345678; $12345678; 12345678kg; 12345678%'),
    ('ID quantity exclusions', 'issue 12345678/2; PR 12345678.5; #12345678,5; test ID 12345678 kg; commit 12345678%; issue 12345678 + 2',
     'issue 12345678/2; PR 12345678.5; número 12345678,5; test ID 12345678 kg; commit 12345678%; issue 12345678 + 2'),
    ('file names with long IDs', 'Respaldo `20261103T204945-0600-close-01a1a42f.md`, notas-12345678.txt y informe-2026.md.',
     'Respaldo `archivo Markdown terminado en a cuatro dos efe`, archivo texto terminado en cinco seis siete ocho y informe 2026 punto eme de.'),
    ('file types with long IDs', 'a-12345678.pdf b-12345678.html c-12345678.py d-12345678.wav informe.pdf',
     'archivo pe de efe terminado en cinco seis siete ocho archivo hache te eme ele terminado en cinco seis siete ocho archivo Python terminado en cinco seis siete ocho archivo uve doble a uve terminado en cinco seis siete ocho informe punto pe de efe'),
    ('labelled hash still omitted', 'commit 12345678abc issue 12345678abc', 'commit issue'),
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
    ('comparison symbols', 'Si x = 5, a < b, c > d, e <= f, g >= h, i != j, k == l.',
     'Si equis igual a 5, a menor que b, c mayor que d, e menor o igual que f, g mayor o igual que h, i distinto de j, k igual a l.'),
    ('math symbols', 'Va de ≥ 1 a ≤ 9, ≈ 3, ± 2 y ≠ 0.',
     'Va de mayor o igual que 1 a menor o igual que 9, aproximadamente 3, más o menos 2 y distinto de 0.'),
    ('times and approximately', 'Es 1,7× más rápido, 2x mejor, 3×4 o 3 × 4, en ~14 s.',
     'Es 1,7 veces más rápido, 2 veces mejor, 3 por 4 o 3 por 4, en aproximadamente 14 s.'),
    ('lone x is the letter', 'Si x > y, entonces X = 2 x 3 en 0x1F o xml.',
     'Si equis mayor que y, entonces equis igual a 2 por 3 en 0x1F o xml.'),
    ('issue numbers', 'Ver #350 y el issue #174.', 'Ver número 350 y el issue número 174.'),
    ('symbols left alone', 'C# y C++ en 0x1F, error=None.', 'C# y C++ en 0x1F, error igual a None.'),
    ('arrows as pauses', 'a -> b => c', 'a, b, c'),
    ('speed units keep their slash', 'A 60 km/h, 60km/h, 3 m/s o 120 MB/s.',
     'A 60 km/h, 60km/h, 3 m/s o 120 MB/s.'),
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
    (r'E:\code\x', 'equis'),  # a lone x is spelled; the model skips it
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
              'exe':'e equis e', 'lock':'loc', 'pdf':'pe de efe'}
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
