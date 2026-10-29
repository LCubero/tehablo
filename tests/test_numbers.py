"""Checks Spanish number normalization; no audio, no model, no pytest needed.

From the repo root: .venv-pocket/Scripts/python tests/test_numbers.py
Linux/macOS: .venv-pocket/bin/python tests/test_numbers.py
Exit code 0 means every case passed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from tehablo_numbers import normalize_numbers, number_to_words

WORDS = [
    (0, "cero"),
    (1, "uno"),
    (15, "quince"),
    (16, "dieciséis"),
    (21, "veintiuno"),
    (22, "veintidós"),
    (30, "treinta"),
    (45, "cuarenta y cinco"),
    (100, "cien"),
    (101, "ciento uno"),
    (500, "quinientos"),
    (999, "novecientos noventa y nueve"),
    (1000, "mil"),
    (1500, "mil quinientos"),
    (1987, "mil novecientos ochenta y siete"),
    (2026, "dos mil veintiséis"),
    (15000, "quince mil"),
    (21000, "veintiún mil"),
    (100000, "cien mil"),
    (1000000, "un millón"),
    (2500000, "dos millones quinientos mil"),
    (1000000000, "mil millones"),
]

TEXTS = [
    ("Hola, ¿cómo estás?", "Hola, ¿cómo estás?"),
    ("Cuesta 15.000 colones.", "Cuesta quince mil colones."),
    ("Tengo 3 gatos.", "Tengo tres gatos."),
    ("53/53", "cincuenta y tres de cincuenta y tres"),
    ("test 44/44 passed", "test cuarenta y cuatro de cuarenta y cuatro passed"),
    ("1/2", "uno de dos"),
    ("0/10", "cero de diez"),
    ("/53/53 archivo/44/44 https://example.org/1/2",
     "/cincuenta y tres/cincuenta y tres archivo/cuarenta y cuatro/cuarenta y cuatro https://example.org/uno/dos"),
    ("3.5/2 1/2,5 12:30", "tres punto cinco/dos uno/dos coma cinco doce y treinta"),
    ("Son 1.500.000 personas.", "Son un millón quinientos mil personas."),
    ("Nací en 1987.", "Nací en mil novecientos ochenta y siete."),
    ("Hace 25,5 grados.", "Hace veinticinco coma cinco grados."),
    ("Mide 3.5 metros.", "Mide tres punto cinco metros."),
    ("Vale 0,05.", "Vale cero coma cero cinco."),
    ("Subió un 30%.", "Subió un treinta por ciento."),
    ("Son las 14:30.", "Son las catorce y treinta."),
    ("A las 9:05 y a las 14:00.", "A las nueve y cinco y a las catorce en punto."),
    ("Hoy es 29/10/2026.", "Hoy es veintinueve de octubre de dos mil veintiséis."),
    ("Cuesta ₡15.000.", "Cuesta quince mil colones."),
    ("Cuesta ₡1.", "Cuesta un colón."),
    ("Son $20 o $1.", "Son veinte dólares o un dólar."),
    ("Llama al 8888-1234.", "Llama al ocho mil ochocientos ochenta y ocho, mil doscientos treinta y cuatro."),
    ("Hace -5 grados.", "Hace menos cinco grados."),
    ("Código 1234567890123.", "Código uno dos tres cuatro cinco seis siete ocho nueve cero uno dos tres."),
]


def main() -> int:
    failures = 0
    for n, expected in WORDS:
        got = number_to_words(n)
        if got != expected:
            failures += 1
            print(f"FAIL number_to_words({n}): {got!r} != {expected!r}")
    for text, expected in TEXTS:
        got = normalize_numbers(text)
        if got != expected:
            failures += 1
            print(f"FAIL normalize_numbers({text!r}):\n  got      {got!r}\n  expected {expected!r}")
    total = len(WORDS) + len(TEXTS)
    print(f"{total - failures}/{total} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
