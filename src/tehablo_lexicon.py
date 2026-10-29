"""Pronunciation lexicon: respell English terms so Spanish models read them well.

Pocket TTS reads every word with Spanish rules ("Python" -> "pi-ton").
pronunciaciones.json at the repo root maps a term to how it should sound,
written with Spanish spelling: {"Python": "páiton"}. Matching ignores case,
needs whole words ("Pythonista" is untouched) and also covers a plain "s"
plural ("routers" -> "ráuters"). Longer terms win ("GitHub" before "Git").
The file is reloaded automatically when it changes.
"""

import json
import re
from pathlib import Path


def _pattern(lexicon: dict[str, str]) -> re.Pattern | None:
    if not lexicon:
        return None
    terms = sorted(lexicon, key=len, reverse=True)
    alternatives = "|".join(re.escape(t) for t in terms)
    return re.compile(rf"(?<!\w)({alternatives})(s?)(?!\w)", re.IGNORECASE)


def apply_lexicon(text: str, lexicon: dict[str, str]) -> str:
    """Replace every lexicon term in text; see the module docstring for matching rules."""
    pattern = _pattern(lexicon)
    if pattern is None:
        return text
    lookup = {k.lower(): v for k, v in lexicon.items()}
    return _substitute(pattern, lookup, text)


def _substitute(pattern: re.Pattern, lookup: dict[str, str], text: str) -> str:
    def replace(m: re.Match) -> str:
        term, plural = m.groups()
        return lookup[term.lower()] + plural

    return pattern.sub(replace, text)


class Lexicon:
    """pronunciaciones.json loaded lazily and reloaded when its modification time changes.

    A missing file means an empty lexicon. An invalid file keeps the last good
    version and sets `error` to a Spanish message for the user; a valid file clears it.
    """

    def __init__(self, path: Path):
        self.path = Path(path)
        self.error: str | None = None
        self._mtime: int | None = None
        self._lookup: dict[str, str] = {}
        self._pattern: re.Pattern | None = None

    def apply(self, text: str) -> str:
        self._reload_if_changed()
        if self._pattern is None:
            return text
        return _substitute(self._pattern, self._lookup, text)

    def _reload_if_changed(self) -> None:
        try:
            mtime = self.path.stat().st_mtime_ns
        except FileNotFoundError:
            self._mtime, self._lookup, self._pattern, self.error = None, {}, None, None
            return
        if mtime == self._mtime:
            return
        self._mtime = mtime
        name = self.path.name
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.error = f"{name} no es JSON válido: {exc}"
            return
        if not isinstance(data, dict):
            self.error = f'{name} debe ser un objeto {{"palabra": "pronunciación"}}'
            return
        for key, value in data.items():
            if not isinstance(value, str):
                self.error = f"{name}: el valor de '{key}' debe ser texto"
                return
        self._lookup = {k.lower(): v for k, v in data.items() if k.strip()}
        self._pattern = _pattern({k: v for k, v in data.items() if k.strip()})
        self.error = None
