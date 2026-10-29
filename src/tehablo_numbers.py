"""Spanish number normalization: turn digits into words before synthesis.

Pocket TTS has no text normalization, so "15.000" comes out as garbled audio.
normalize_numbers() rewrites dates, times, currency (₡, $), percentages,
phone numbers, negatives, decimals and integers as Spanish words.
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
    if (len(s) > 1 and s[0] == "0") or int(s) >= _DIGITS_LIMIT:
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
    return re.sub(_NUM, _generic, text)
