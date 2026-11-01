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
    # Units after a number are read in full, with Spanish gender and number.
    ("listen 4.03s ready 5.86s error=None",
     "listen cuatro punto cero tres segundos ready cinco punto ochenta y seis segundos error=None"),
    ("Tardó 1 s, luego 21 s y 1.000 s.", "Tardó un segundo, luego veintiún segundos y mil segundos."),
    ("Faltan 1 h, 21 h o 2 h.", "Faltan una hora, veintiuna horas o dos horas."),
    ("Responde en 250 ms, 3 min o 7 d.",
     "Responde en doscientos cincuenta milisegundos, tres minutos o siete días."),
    ("Mide 1 m, 5 cm, 2 mm y 42 km.", "Mide un metro, cinco centímetros, dos milímetros y cuarenta y dos kilómetros."),
    ("Corre a 60 km/h o 3 m/s.", "Corre a sesenta kilómetros por hora o tres metros por segundo."),
    ("Pesa 2,5 kg, 1 g y 500 mg.", "Pesa dos coma cinco kilogramos, un gramo y quinientos miligramos."),
    ("Lleva 1 L, 1,5 l y 250 ml.", "Lleva un litro, uno coma cinco litros y doscientos cincuenta mililitros."),
    ("Son 80 m² y 1 m³.", "Son ochenta metros cuadrados y un metro cúbico."),
    ("Ocupa 1,1 GB, 1 MB, 512 KB y 2 TB.",
     "Ocupa uno coma uno gigabáits, un megabáit, quinientos doce kilobáits y dos terabáits."),
    ("Red de 100 Mbps y 4 GiB de RAM.", "Red de cien megabits por segundo y cuatro gibibáits de RAM."),
    ("CPU a 3 GHz y audio a 44,1 kHz.", "CPU a tres gigahercios y audio a cuarenta y cuatro coma uno kilohercios."),
    ("Usa 5 V, 500 mA, 65 W y 1 kWh.",
     "Usa cinco voltios, quinientos miliamperios, sesenta y cinco vatios y un kilovatio hora."),
    ("Tiene 200 kcal.", "Tiene doscientas kilocalorías."),
    ("Un margen de 16 px a 60 fps.", "Un margen de dieciséis píxeles a sesenta fotogramas por segundo."),
    ("Hace -5 V.", "Hace menos cinco voltios."),
    ("Pantalla de 27 in, 1 in o 15 pulg.", "Pantalla de veintisiete pulgadas, una pulgada o quince pulgadas."),
    ("Mide 3 ft, 1 yd y 2 ha.", "Mide tres pies, una yarda y dos hectáreas."),
    ("Son 50 m2, 3 km2, 10 cm2, 2 m3 y 5 cm3.",
     "Son cincuenta metros cuadrados, tres kilómetros cuadrados, diez centímetros cuadrados, dos metros cúbicos y cinco centímetros cúbicos."),
    ("Caben 2 lt, 3 lts, 33 cl, 5 dl, 1 gal y 250 cc.",
     "Caben dos litros, tres litros, treinta y tres centilitros, cinco decilitros, un galón y doscientos cincuenta centímetros cúbicos."),
    ("Carga 1 ton y 500 µg.", "Carga una tonelada y quinientos microgramos."),
    ("Esperé 30 segs, 5 mins y 2 hs.", "Esperé treinta segundos, cinco minutos y dos horas."),
    ("Presión de 1 atm, 2 bar, 1013 hPa, 100 kPa, 3 MPa, 120 mmHg y 32 psi.",
     "Presión de una atmósfera, dos bares, mil trece hectopascales, cien kilopascales, tres megapascales, ciento veinte milímetros de mercurio y treinta y dos libras por pulgada cuadrada."),
    ("Suena a 85 dB.", "Suena a ochenta y cinco decibelios."),
    ("Copia a 120 MB/s, 1 GB/s y 500 KB/s.",
     "Copia a ciento veinte megabáits por segundo, un gigabáit por segundo y quinientos kilobáits por segundo."),
    # Letters that only look like units stay as they are.
    ("Son 5 sillas, 3 mesas y 2 litros.", "Son cinco sillas, tres mesas y dos litros."),
    ("Tiene 200 kcal y 21 h.", "Tiene doscientas kilocalorías y veintiuna horas."),
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
