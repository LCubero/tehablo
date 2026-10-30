"""Simplify technical text before the Spanish lexicon and number normalizer.

This is speech preparation, not a URL/path validator. Paths lose directories,
URLs lose everything but the host; mixed lowercase hexadecimal commit hashes
(7-40 characters) are omitted. Runs of three or more separator characters are
omitted, preserving C++. Arrows and parentheses become short comma pauses,
with redundant commas cleaned up. Non-path word slashes become "eslash";
numeric slashes stay intact for number normalization. Paths are recognized by
an extension, an explicit path prefix, a trailing slash, or backslashes.
Emoji are dropped, the degree sign is read, and questions missing an opening
¿ receive one at their sentence start.
Hyphens stay intact so configurable lexicon terms such as pi-tts still match.
"""
import re
import unicodedata
from urllib.parse import urlsplit


EXTENSIONS = {
    'py': 'pai', 'ts': 'te ese', 'js': 'jota ese', 'json': 'yéison',
    'md': 'eme de', 'txt': 'te equis te', 'wav': 'uve doble a uve',
    'mp3': 'eme pe tres', 'flac': 'flac', 'toml': 'te o eme ele',
    'yaml': 'yámel', 'yml': 'yámel', 'html': 'hache te eme ele',
    'css': 'ce ese ese', 'sh': 'ese hache', 'ps1': 'pe ese uno',
    'exe': 'e equis e', 'lock': 'loc',
}
LETTERS = dict(zip('ABCDEFGHIJKLMNOPQRSTUVWXYZ', (
    'a', 'be', 'ce', 'de', 'e', 'efe', 'ge', 'hache', 'i', 'jota',
    'ka', 'ele', 'eme', 'ene', 'o', 'pe', 'cu', 'erre', 'ese', 'te',
    'u', 'uve', 'doble ve', 'equis', 'ye', 'zeta',
)))
URL = re.compile(r'\b(?:https?://|www\.)[^\s<>\[\]()\"\x27`]+', re.IGNORECASE)
TOKEN = re.compile(r'[^\s<>\[\]()\"\x27`,;!?]+')
FILE = re.compile(r'(?<![\w.-])([\w-]+(?:\.[\w-]+)*)\.('
                  + '|'.join(EXTENSIONS) + r')(?!\w|\.\w)', re.IGNORECASE)
IDENTIFIER = re.compile(
    r'(?<![\w-])(?:[A-Z]{1,4}(?:-(?:[A-Z]{1,4}|[0-9]+))+|[A-Z]{1,4}[0-9]+)(?![\w-])')
HASH = re.compile(r'(?<![\w-])[0-9a-f]{7,40}(?![\w-])')


def _plain(text: str) -> str:
    def path(match):
        token = match.group()
        core = token.rstrip('.:')
        if not re.search(r'[/\\]', core) or re.fullmatch(r'[0-9/\\]+', core):
            return token
        parts = re.split(r'[/\\]', core.rstrip('/\\'))
        is_path = (core.startswith(('/', './', '../', '~/'))
                   or core.endswith('/') or '\\' in core
                   or re.search(r'\.[\w-]+$', parts[-1]))
        if is_path:
            return parts[-1] + token[len(core):]
        return re.sub(r'(?<=\w)/(?=\w)', ' eslash ', token)

    text = re.sub(r'[+\-=*_~#]{3,}', ' ', text)
    text = TOKEN.sub(path, text)
    text = FILE.sub(lambda m: re.sub(r'[_-]', ' ', m[1]) + ' punto '
                    + EXTENSIONS[m[2].lower()], text)

    def identifier(match):
        token = match.group()
        if not any(c.isdigit() for c in token):
            return token
        groups = re.findall(r'[A-Z]+|[0-9]+', token)
        return ', '.join(' '.join(LETTERS[c] for c in group)
                         if group.isalpha() else group for group in groups)

    text = IDENTIFIER.sub(identifier, text)
    text = HASH.sub(lambda m: '' if re.search('[a-f]', m[0])
                    and re.search('[0-9]', m[0]) else m[0], text)
    return re.sub(r'(?<=\w)_(?=\w)', ' ', text)


def _without_symbols(text: str) -> str:
    """Drop emoji and pictographic symbols (category So), their joiners and
    variation selectors; keep the degree sign for temperatures."""
    return ''.join(c for c in text if c == '°' or not (
        unicodedata.category(c) == 'So' or c in '\ufe0e\ufe0f\u200d\u20e3'
        or '\U0001f3fb' <= c <= '\U0001f3ff'))


def _degrees(text: str) -> str:
    """Read the degree sign: 25 °C -> 25 grados celsius, 90° -> 90 grados."""
    text = re.sub(r'\s*°\s*C\b', ' grados celsius', text)
    text = re.sub(r'\s*°\s*F\b', ' grados fárenjait', text)
    return re.sub(r'\s*°', ' grados', text)


def normalize_technical(text: str) -> str:
    """Prepare technical text, omitting noise and inserting natural pauses."""
    text = _without_symbols(text)
    text = _degrees(text)
    # Process URL-free spans separately: a host like www.example.py is not a file.
    pieces = []
    end = 0
    for match in URL.finditer(text):
        pieces.append(_plain(text[end:match.start()]))
        raw = match[0]
        core = raw.rstrip('.,;:!?')
        try:
            host = urlsplit(core if '://' in core else 'https://' + core).hostname
        except ValueError:
            host = None
        if host:
            host = re.sub(r'^www\.', '', host, flags=re.IGNORECASE)
            pieces.append('enlace a ' + host.replace('.', ' punto ') + raw[len(core):])
        else:
            pieces.append(raw)
        end = match.end()
    pieces.append(_plain(text[end:]))
    text = ''.join(pieces)
    text = re.sub(r'[→()]', ', ', text)
    text = re.sub(r'\s+,', ',', text)
    text = re.sub(r',\s+', ', ', text)
    text = re.sub(r',(?:\s*,)+\s*', ', ', text)
    text = re.sub(r',\s*([.;:!?])', r'\1', text)
    text = re.sub(r'([.;:!?])\s*,\s*', r'\1 ', text)
    text = re.sub(r'([.;:!?])(?:\s*\.)+', r'\1', text)
    text = re.sub(r'^[\s.,;:]+(?=\S)|,\s*$', '', text.strip())
    return _question_openings(re.sub(r'\s{2,}', ' ', text).strip())


def _question_openings(text: str) -> str:
    """Open each question that lacks ¿ at its sentence start; the Spanish model
    only uses question intonation with ¿ (owner listening test, 2026-10-30)."""
    return re.sub(r'(?:^|(?<=[.!?;:] ))(?=[^\s¿])((?:[^.!?;:¿]|\.(?!\s))*?\?)',
                  lambda m: '¿' + m[1], text)
