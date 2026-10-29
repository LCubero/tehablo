"""Checks the English-term pronunciation lexicon; no audio, no model, no pytest needed.

From the repo root: .venv-pocket/Scripts/python tests/test_lexicon.py
Linux/macOS: .venv-pocket/bin/python tests/test_lexicon.py
Exit code 0 means every case passed.
"""

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))

from tehablo_lexicon import Lexicon, apply_lexicon
from tehablo_numbers import normalize_numbers

SAMPLE = {
    "Python": "páiton",
    "Git": "guit",
    "GitHub": "guítjab",
    "C++": "si plas plas",
    "Node.js": "nod yei es",
    "Wi-Fi": "uaifái",
    "router": "ráuter",
    "Windows": "güíndous",
}

APPLY = [
    ("Hola, ¿cómo estás?", "Hola, ¿cómo estás?"),
    ("Aprendo Python.", "Aprendo páiton."),
    ("aprendo PYTHON y python", "aprendo páiton y páiton"),
    ("Subo el código a GitHub con Git.", "Subo el código a guítjab con guit."),
    ("Un gitano y un Pythonista.", "Un gitano y un Pythonista."),
    ("Uso C++ y Node.js.", "Uso si plas plas y nod yei es."),
    ("El Wi-Fi del router falla.", "El uaifái del ráuter falla."),
    ("Tengo dos routers.", "Tengo dos ráuters."),
]

failures = 0
checks = 0


def check(label: str, got, expected) -> None:
    global failures, checks
    checks += 1
    if got != expected:
        failures += 1
        print(f"FAIL {label}:\n  got      {got!r}\n  expected {expected!r}")


def write(path: Path, data, stamp: int) -> None:
    text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False)
    path.write_text(text, encoding="utf-8")
    os.utime(path, ns=(stamp, stamp))


def main() -> int:
    for text, expected in APPLY:
        check(f"apply_lexicon({text!r})", apply_lexicon(text, SAMPLE), expected)
    check("empty lexicon", apply_lexicon("Python", {}), "Python")
    check("lexicon then numbers", normalize_numbers(apply_lexicon("Windows 11 y 2 routers", SAMPLE)),
          "güíndous once y dos ráuters")

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "pronunciaciones.json"
        s = 10**18

        lex = Lexicon(path)
        check("missing file -> unchanged", lex.apply("Aprendo Python."), "Aprendo Python.")
        check("missing file -> no error", lex.error, None)

        write(path, {"Python": "páiton"}, s)
        check("loads file", lex.apply("Aprendo Python."), "Aprendo páiton.")

        write(path, {"Python": "páiton", "Docker": "dóquer"}, 2 * s)
        check("reloads on change", lex.apply("Python y Docker"), "páiton y dóquer")

        write(path, "{ roto", 3 * s)
        check("invalid JSON keeps last good", lex.apply("Python y Docker"), "páiton y dóquer")
        check("invalid JSON reports error",
              (lex.error or "").startswith("pronunciaciones.json no es JSON válido"), True)

        write(path, {"Python": 5}, 4 * s)
        lex.apply("x")
        check("non-string value reports error", lex.error,
              "pronunciaciones.json: el valor de 'Python' debe ser texto")

        write(path, ["Python"], 5 * s)
        lex.apply("x")
        check("non-object reports error", lex.error,
              "pronunciaciones.json debe ser un objeto {\"palabra\": \"pronunciación\"}")

        write(path, {"Python": "páiton"}, 6 * s)
        check("fixed file clears error", (lex.apply("Python"), lex.error), ("páiton", None))

    shipped_path = ROOT / "pronunciaciones.json"
    shipped = Lexicon(shipped_path)
    for source, expected in [
        ('Pi y pi-tts', 'pai y pai ti ti es'),
        ('feat master origin', 'fit máster óriyin'),
        ('commits branchs branches', 'comíts bránchs branches'),
        ('PR TTS README', 'pi ar ti ti es rídmi'),
        ('API APIs CPU', 'ei pi ai ei pi ais ci pi iu'),
        ('merge', 'mérch'),
        ('reload', 'rilóud'),
        ('HTML CSS SQL URL GPU CLI', 'eich ti em el si es es es kiu el iu ar el yi pi iu si el ai'),
        ('USB PDF CD', 'u ese be pe de efe ce de'),
        ('HTTPS SSH localhost', 'eich ti ti pi es es es eich lócal joust'),
        ('array string null async await', 'arréi estring nal eisínc euéit'),
        ('YAML Markdown PostgreSQL MySQL', 'yámel márkdaun póustgres mái es kiu el'),
        ('GPT ChatGPT Linux', 'yi pi ti chat yi pi ti línux'),
        ('amend revert worktree submodule', 'eménd rivért uórktri sabmódiul'),
        ('Actions pipeline runner reviews', 'ácshons páiplain ráner riviús'),
        ('dependencies deployment changelog', 'dipéndensis diplóiment chéinchlog'),
    ]:
        check(f'new shipped terms: {source}', shipped.apply(source), expected)
    text = shipped.apply(
        "Programo en Python y JavaScript, lo subo a GitHub y lo comparto por WhatsApp, "
        "YouTube y email desde el Wi-Fi."
    )
    check("shipped file has no error", shipped.error, None)
    for word in ("Python", "JavaScript", "GitHub", "WhatsApp", "YouTube", "email", "Wi-Fi"):
        check(f"shipped file rewrites {word}", word.lower() in text.lower(), False)
    terms = json.loads(shipped_path.read_text(encoding="utf-8"))
    check("shipped file has at least 100 terms", len(terms) >= 100, True)
    lowered = [k.lower() for k in terms]
    check("shipped file has no duplicate terms", len(lowered) == len(set(lowered)), True)

    print(f"{checks - failures}/{checks} passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
