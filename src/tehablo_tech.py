"""Simplify technical text before the Spanish lexicon and number normalizer.

This is speech preparation, not a URL/path validator. Paths lose directories,
URLs lose everything but the host, and hashes intentionally lose their value.
Hyphens stay intact so configurable lexicon terms such as pi-tts still match.
"""
import re
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
        parts = re.split(r'[/\\]', core)
        if len(parts) < 2 or not parts[-1]:
            return token
        return parts[-1] + token[len(core):]

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
    text = HASH.sub(lambda m: 'un hash' if re.search('[a-f]', m[0])
                    and re.search('[0-9]', m[0]) else m[0], text)
    return re.sub(r'(?<=\w)_(?=\w)', ' ', text)


def normalize_technical(text: str) -> str:
    """Read URLs, basenames, file extensions, IDs and hashes in simplified Spanish."""
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
    return ''.join(pieces)
