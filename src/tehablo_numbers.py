"""Spanish number normalization: turn digits into words before synthesis.

Pocket TTS has no text normalization, so "15.000" comes out as garbled audio.
normalize_numbers() rewrites dates, times, currency (₡, $), percentages,
phone numbers, negatives, decimals, integers and units after a number (5 s,
60 km/h, 2 GB) as Spanish words.
Conventions: "." groups thousands (15.000) and "," marks decimals (25,5);
a "." not followed by exactly three digits is read as "punto" (3.5).
"""

import re

_UNITS = (
    "cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece "
    "catorce quince dieciséis diecisiete dieciocho diecinueve veinte veintiuno "
    "veintidós veintitrés veinticuatro veinticinco veintiséis veintisiete "
    "veintiocho veintinueve"
).split()
_TENS = {3: "treinta", 4: "cuarenta", 5: "cincuenta", 6: "sesenta",
         7: "setenta", 8: "ochenta", 9: "noventa"}
_HUNDREDS = {1: "ciento", 2: "doscientos", 3: "trescientos", 4: "cuatrocientos",
             5: "quinientos", 6: "seiscientos", 7: "setecientos",
             8: "ochocientos", 9: "novecientos"}
_MONTHS = ("enero febrero marzo abril mayo junio julio agosto septiembre "
           "octubre noviembre diciembre").split()
_DIGITS_LIMIT = 10**12  # larger integers are read digit by digit

_NUM = r"\d{1,3}(?:\.\d{3})+(?:,\d+)?(?!\d)|\d+(?:[.,]\d+)?"

# Unit symbol -> (singular, plural, feminine). Only read right after a number;
# case matters (Mb is megabits, MB megabytes). Byte names are spelled as said.
# Left out on purpose because they collide with ordinary text after a number:
# A, B, t, mi ("a las 3 mi mamá") and the plain double quote.
_UNIT_GROUPS = {
    ("segundo", "segundos", False): "s seg segs",
    ("milisegundo", "milisegundos", False): "ms",
    ("microsegundo", "microsegundos", False): "µs μs us",
    ("nanosegundo", "nanosegundos", False): "ns",
    ("minuto", "minutos", False): "min mins",
    ("hora", "horas", True): "h hr hrs hs",
    ("día", "días", False): "d",
    ("metro", "metros", False): "m",
    ("kilómetro", "kilómetros", False): "km",
    ("centímetro", "centímetros", False): "cm",
    ("milímetro", "milímetros", False): "mm",
    ("micrómetro", "micrómetros", False): "µm μm",
    ("nanómetro", "nanómetros", False): "nm",
    ("metro cuadrado", "metros cuadrados", False): "m² m2",
    ("kilómetro cuadrado", "kilómetros cuadrados", False): "km² km2",
    ("centímetro cuadrado", "centímetros cuadrados", False): "cm² cm2",
    ("hectárea", "hectáreas", True): "ha",
    ("metro cúbico", "metros cúbicos", False): "m³ m3",
    ("centímetro cúbico", "centímetros cúbicos", False): "cm³ cm3 cc",
    ("pie", "pies", False): "ft",
    ("pulgada", "pulgadas", True): "in pulg ″",
    ("yarda", "yardas", True): "yd",
    ("kilómetro por hora", "kilómetros por hora", False): "km/h",
    ("metro por segundo", "metros por segundo", False): "m/s",
    ("milla por hora", "millas por hora", True): "mph",
    ("gramo", "gramos", False): "g",
    ("kilogramo", "kilogramos", False): "kg",
    ("miligramo", "miligramos", False): "mg",
    ("microgramo", "microgramos", False): "µg μg mcg",
    ("tonelada", "toneladas", True): "ton",
    ("libra", "libras", True): "lb lbs",
    ("onza", "onzas", True): "oz",
    ("litro", "litros", False): "l L lt lts",
    ("mililitro", "mililitros", False): "ml mL",
    ("centilitro", "centilitros", False): "cl cL",
    ("decilitro", "decilitros", False): "dl dL",
    ("galón", "galones", False): "gal",
    ("báit", "báits", False): "bytes",
    ("kilobáit", "kilobáits", False): "KB kB",
    ("megabáit", "megabáits", False): "MB",
    ("gigabáit", "gigabáits", False): "GB",
    ("terabáit", "terabáits", False): "TB",
    ("petabáit", "petabáits", False): "PB",
    ("kibibáit", "kibibáits", False): "KiB",
    ("mebibáit", "mebibáits", False): "MiB",
    ("gibibáit", "gibibáits", False): "GiB",
    ("tebibáit", "tebibáits", False): "TiB",
    ("kilobit", "kilobits", False): "kb Kb",
    ("megabit", "megabits", False): "Mb",
    ("gigabit", "gigabits", False): "Gb",
    ("kilobáit por segundo", "kilobáits por segundo", False): "KB/s kB/s",
    ("megabáit por segundo", "megabáits por segundo", False): "MB/s",
    ("gigabáit por segundo", "gigabáits por segundo", False): "GB/s",
    ("bit por segundo", "bits por segundo", False): "bps",
    ("kilobit por segundo", "kilobits por segundo", False): "kbps Kbps",
    ("megabit por segundo", "megabits por segundo", False): "Mbps",
    ("gigabit por segundo", "gigabits por segundo", False): "Gbps",
    ("hercio", "hercios", False): "Hz",
    ("kilohercio", "kilohercios", False): "kHz KHz",
    ("megahercio", "megahercios", False): "MHz",
    ("gigahercio", "gigahercios", False): "GHz",
    ("voltio", "voltios", False): "V",
    ("milivoltio", "milivoltios", False): "mV",
    ("kilovoltio", "kilovoltios", False): "kV",
    ("miliamperio", "miliamperios", False): "mA",
    ("miliamperio hora", "miliamperios hora", False): "mAh",
    ("vatio", "vatios", False): "W",
    ("kilovatio", "kilovatios", False): "kW",
    ("megavatio", "megavatios", False): "MW",
    ("vatio hora", "vatios hora", False): "Wh",
    ("kilovatio hora", "kilovatios hora", False): "kWh",
    ("ohmio", "ohmios", False): "Ω Ω",
    ("julio", "julios", False): "J",
    ("kilojulio", "kilojulios", False): "kJ",
    ("caloría", "calorías", True): "cal",
    ("kilocaloría", "kilocalorías", True): "kcal",
    ("libra por pulgada cuadrada", "libras por pulgada cuadrada", True): "psi",
    ("pascal", "pascales", False): "Pa",
    ("hectopascal", "hectopascales", False): "hPa",
    ("kilopascal", "kilopascales", False): "kPa",
    ("megapascal", "megapascales", False): "MPa",
    ("bar", "bares", False): "bar",
    ("atmósfera", "atmósferas", True): "atm",
    ("milímetro de mercurio", "milímetros de mercurio", False): "mmHg",
    ("decibelio", "decibelios", False): "dB",
    ("píxel", "píxeles", False): "px",
    ("punto", "puntos", False): "pt",
    ("punto por pulgada", "puntos por pulgada", False): "dpi",
    ("fotograma por segundo", "fotogramas por segundo", False): "fps",
    ("revolución por minuto", "revoluciones por minuto", True): "rpm",
}
UNIT_SYMBOLS = _UNITS_BY_SYMBOL = {symbol: names for names, symbols in _UNIT_GROUPS.items()
                    for symbol in symbols.split()}
_UNIT = (rf"(?<![\w.,])({_NUM})\s?("
         + "|".join(re.escape(s) for s in sorted(_UNITS_BY_SYMBOL, key=len, reverse=True))
         + r")(?![\w²³]|/\w)")


def _below_1000(n: int) -> str:
    hundreds, rest = divmod(n, 100)
    parts = []
    if hundreds:
        parts.append("cien" if n == 100 else _HUNDREDS[hundreds])
    if rest < 30:
        if rest:
            parts.append(_UNITS[rest])
    else:
        tens, unit = divmod(rest, 10)
        parts.append(_TENS[tens] + (f" y {_UNITS[unit]}" if unit else ""))
    return " ".join(parts)


def _apocope(words: str) -> str:
    """"veintiuno mil" -> "veintiún mil", "uno millón" -> "un millón"."""
    if words.endswith("veintiuno"):
        return words[:-len("veintiuno")] + "veintiún"
    if words == "uno" or words.endswith(" uno"):
        return words[:-3] + "un"
    return words


def _below_million(n: int) -> str:
    thousands, rest = divmod(n, 1000)
    parts = []
    if thousands == 1:
        parts.append("mil")
    elif thousands:
        parts.append(_apocope(_below_1000(thousands)) + " mil")
    if rest:
        parts.append(_below_1000(rest))
    return " ".join(parts)


def number_to_words(n: int) -> str:
    """Spanish words for an integer with |n| < 10**12."""
    if n < 0:
        return "menos " + number_to_words(-n)
    if n == 0:
        return "cero"
    if n >= _DIGITS_LIMIT:
        raise ValueError(f"number too large: {n}")
    millions, rest = divmod(n, 10**6)
    parts = []
    if millions == 1:
        parts.append("un millón")
    elif millions:
        parts.append(_apocope(_below_million(millions)) + " millones")
    if rest:
        parts.append(_below_million(rest))
    return " ".join(parts)


def _digits(s: str) -> str:
    return " ".join(_UNITS[int(d)] for d in s)


def _integer(s: str) -> str:
    """Digits (no separators) to words; leading zeros or huge values digit by digit."""
    if (len(s) > 1 and s[0] == "0") or len(s) > len(str(_DIGITS_LIMIT - 1)):
        return _digits(s)
    return number_to_words(int(s))


def _fraction(s: str) -> str:
    """Decimal part: leading zeros as "cero", the rest as a number (05 -> cero cinco)."""
    stripped = s.lstrip("0")
    zeros = ["cero"] * (len(s) - len(stripped))
    if stripped:
        zeros.append(_integer(stripped) if len(stripped) <= 3 else _digits(stripped))
    return " ".join(zeros)


def _number(token: str) -> str:
    """One _NUM token to words."""
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+(?:,\d+)?", token):
        whole, _, frac = token.partition(",")
        words = _integer(whole.replace(".", ""))
        return words + (f" coma {_fraction(frac)}" if frac else "")
    for sep, name in ((",", "coma"), (".", "punto")):
        if sep in token:
            whole, frac = token.split(sep)
            return f"{_integer(whole)} {name} {_fraction(frac)}"
    return _integer(token)


def _date(m: re.Match) -> str:
    day, month, year = (int(g) for g in m.groups())
    if not (1 <= day <= 31 and 1 <= month <= 12):
        return m.group(0)
    return f"{number_to_words(day)} de {_MONTHS[month - 1]} de {_integer(m.group(3))}"


def _score(m: re.Match) -> str:
    # A score must stand alone, not be a segment of a path or URL token.
    start, end = m.start(), m.end()
    while start > 0 and not m.string[start - 1].isspace():
        start -= 1
    while end < len(m.string) and not m.string[end].isspace():
        end += 1
    surroundings = m.string[start:m.start()] + m.string[m.end():end]
    if any(char in surroundings for char in ('/', '\\', ':')):
        return m.group(0)
    return f"{_integer(m.group(1))} de {_integer(m.group(2))}"


def _time(m: re.Match) -> str:
    hour = number_to_words(int(m.group(1)))
    if hour.endswith("uno"):
        hour = hour[:-1] + "a"  # "la una", "las veintiuna"
    minutes = int(m.group(2))
    return f"{hour} en punto" if minutes == 0 else f"{hour} y {number_to_words(minutes)}"


def _currency(m: re.Match) -> str:
    symbol, token = m.groups()
    singular, plural = ("colón", "colones") if symbol == "₡" else ("dólar", "dólares")
    words = _number(token)
    if "," in token or (token.count(".") == 1 and not re.search(r"\.\d{3}$", token)):
        return f"{words} {plural}"
    if words == "uno":
        return f"un {singular}"
    return f"{_apocope(words)} {plural}"


def _feminine(words: str) -> str:
    """Feminine agreement after the last million: veintiuna, doscientas."""
    head, tail = re.fullmatch(r"(.*\bmill(?:ón|ones) )?(.*)", words).groups()
    tail = re.sub(r"ientos\b", "ientas", tail)
    return (head or "") + re.sub(r"uno$", "una", tail)


def _unit(m: re.Match) -> str:
    token, symbol = m.groups()
    singular, plural, feminine = _UNITS_BY_SYMBOL[symbol]
    words = _number(token)
    if "," in token or (token.count(".") == 1 and not re.search(r"\.\d{3}$", token)):
        return f"{words} {plural}"  # decimals: plain number, plural unit
    if token == "1":
        return ("una " if feminine else "un ") + singular
    return f"{_feminine(words) if feminine else _apocope(words)} {plural}"


def _generic(m: re.Match) -> str:
    text, start, end = m.string, m.start(), m.end()
    words = _number(m.group(0))
    if start > 0 and text[start - 1].isalpha():
        words = " " + words
    if end < len(text) and text[end].isalpha():
        words += " "
    return words


def normalize_numbers(text: str) -> str:
    """Rewrite every number in Spanish text as words; text without digits is unchanged."""
    if not re.search(r"\d", text):
        return text
    text = re.sub(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{4}|\d{2})(?!\d)", _date, text)
    text = re.sub(r"(?<![\w/.,:+-])(\d+)/(\d+)(?![\w/]|[.,]\d)", _score, text)
    text = re.sub(r"(?<![\d:])([01]?\d|2[0-3]):([0-5]\d)(?![\d:])", _time, text)
    text = re.sub(rf"([₡$])\s?({_NUM})", _currency, text)
    text = re.sub(rf"({_NUM})\s?%", lambda m: f"{_number(m.group(1))} por ciento", text)
    text = re.sub(r"(?<=\d)-(?=\d)", ", ", text)
    text = re.sub(r"(?<![\w-])-(?=\d)", "menos ", text)
    text = re.sub(_UNIT, _unit, text)
    return re.sub(_NUM, _generic, text)
