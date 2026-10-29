# Cómo escribir pronunciaciones en inglés

Guía para añadir o corregir entradas de [`pronunciaciones.json`](../pronunciaciones.json). El modelo español de Pocket TTS lee todo con reglas del español, así que cada entrada se escribe **como suena el inglés leído en español**. El objetivo es que se entienda, no una transcripción fonética perfecta.

Cómo se aplica el diccionario (mayúsculas, palabras completas, plural con `s`): [`src/tehablo_lexicon.py`](../src/tehablo_lexicon.py) y [Pocket TTS](pocket-tts.md).

## Reglas

1. **Inglés americano leído en español latinoamericano** (con seseo: `c`, `s` y `z` suenan igual). `Python` → `páiton`.
2. **Minúsculas y tilde española en la sílaba fuerte** cuando las reglas del español no la pondrían solas: `páiton`, `yéison`, `guítjab`. No uses mayúsculas para marcar el acento: Pocket TTS no pasa el texto a minúsculas (solo pone en mayúscula la primera letra, `pocket_tts/models/text_chunking.py`), y no se ha comprobado cómo lee una sílaba en mayúsculas.
3. **Sin guiones, AFI ni signos.** Una palabra se escribe junta (`kubernétis`); no se ha comprobado si un guion genera una pausa.
4. **Siglas deletreadas: nombre inglés de cada letra, separado por espacios**, con la [tabla de letras](#letras-en-inglés). `API` → `ei pi ai`. Si la sigla se dice como palabra, se escribe como palabra: `JSON` → `yéison`.
5. **El plural sale solo.** El diccionario añade la `s` (`routers` → `ráuters`); crea una entrada de plural solo si suena distinto.
6. **Una entrada se confirma escuchándola.** Prueba la frase en la TUI o con Pi antes de darla por buena; el texto escrito no garantiza el sonido.

## Letras en inglés

| Letra | Se escribe | Letra | Se escribe | Letra | Se escribe |
|---|---|---|---|---|---|
| A | ei | J | yei | S | es |
| B | bi | K | kei | T | ti |
| C | si (o ci) | L | el | U | iu |
| D | di | M | em | V | vi |
| E | i | N | en | W | dábliu |
| F | ef | O | ou | X | eks |
| G | yi | P | pi | Y | uái |
| H | eich | Q | kiu | Z | zi |
| I | ai | R | ar | | |

En español `b` y `v` suenan igual, así que `B` y `V` pueden confundirse; lo mismo `C` y `Z`. Si una sigla queda ambigua, decide escuchándola.

## Sonidos del inglés

| Sonido inglés | Se escribe | Ejemplo |
|---|---|---|
| `th` sonora | `d` | `the` → `de` |
| `th` sorda | `z` | `think` → `zink` |
| `sh` | `sh` | `shell` → `shel` |
| `j` de `job`, `g` de `giant` | `y` | `JavaScript` → `yavascrípt` |
| `w` | `u` | `Swift` → `suift` |
| `ee` larga | `i` | `free` → `fri` |
| diptongo `ai` | `ai` | `type` → `taip` |
| diptongo `ei` | `ei` | `base` → `beis` |
| diptongo `ou` | `ou` | `Go` → `gou` |
| `h` aspirada | `j` | `GitHub` → `guítjab` |

No fuerces palabras simples ni términos que en español ya se dicen bien.

## Decisiones y pendientes

- **Aplicado (2026-10-29, decisión de la persona responsable):** `API` → `ei pi ai`, `CPU` → `ci pi iu`; se quitó `APIs` porque el plural sale solo (`ei pi ais`).
- **Aplicado:** pasaron al inglés `PHP`, `HTML`, `CSS`, `SQL`, `XML`, `npm`, `URL`, `GPU`, `SSD`, `HDMI`, `PR`, `TTS`, `pi-tts`, `CI` y `CLI`; se añadieron términos comunes de desarrollo, Git, GitHub, CI/CD y gestión de proyectos.
- **Se mantienen en español** porque así se dicen: `USB`, `PDF`, `CD`.
- **Se omiten** términos que el español ya lee bien (`token`, `Bash`, `Vim`, `log`) y los que coinciden con palabras españolas comunes: el diccionario cambia la palabra en cualquier texto.
- **Pendiente:** las extensiones de archivo de [`src/tehablo_tech.py`](../src/tehablo_tech.py) siguen con letras del español (`html` → `hache te eme ele`). Ninguna entrada se ha confirmado todavía escuchándola (`RH-W-0002` de la [hoja de ruta](repo-harness/roadmap.md)).

## Fuentes

- Regla de reescritura, convenciones de sonidos y términos técnicos: basadas en la skill `wk-en-pronun-tico-ld9` («pronunciación a lo tico», MIT) de Luis Diego Cubero Chavarría, adaptadas aquí para un modelo de voz.
- Nombres de las letras en inglés: [UNAM, CCH — Spelling](https://portalacademico.cch.unam.mx/ingles1/gettingPersonalInformation/spelling).
- Buenas prácticas de diccionarios de pronunciación (reescritura, probar cada entrada, repetir pruebas al cambiar de modelo o voz): [ElevenLabs](https://elevenlabs.io/blog/pronunciation-dictionary-guide), [Mahimai](https://mahimai.ca/learn/100x/tts/tts-pronunciation-control).
