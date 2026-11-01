# Cómo escribir pronunciaciones en inglés

Guía para añadir o corregir entradas de [`pronunciaciones.json`](../pronunciaciones.json). El modelo español de Pocket TTS lee todo con reglas del español, así que cada entrada se escribe **como suena el inglés leído en español**. El objetivo es que se entienda, no una transcripción fonética perfecta.

Cómo se aplica el diccionario (mayúsculas, palabras completas, plural con `s`): [`src/tehablo_lexicon.py`](../src/tehablo_lexicon.py) y [Pocket TTS](pocket-tts.md).

## Reglas

1. **Inglés americano leído en español latinoamericano** (con seseo: `c`, `s` y `z` suenan igual). `Python` → `páiton`.
2. **Minúsculas y tilde española en la sílaba fuerte** cuando las reglas del español no la pondrían solas: `páiton`, `yéison`, `guítjab`. No uses mayúsculas para marcar el acento: Pocket TTS no pasa el texto a minúsculas (solo pone en mayúscula la primera letra, `pocket_tts/models/text_chunking.py`), y no se ha comprobado cómo lee una sílaba en mayúsculas.
3. **Sin guiones, AFI ni signos.** Una palabra se escribe junta (`kubernétis`); no se ha comprobado si un guion genera una pausa.
4. **Siglas deletreadas: nombre inglés de cada letra, separado por espacios**, con la [tabla de letras](#letras-en-inglés). `API` → `ei pi ai`. Si la sigla se dice como palabra, se escribe como palabra: `JSON` → `yéison`.
5. **El plural sale solo.** El diccionario añade la `s` (`routers` → `ráuters`); crea una entrada de plural solo si suena distinto.
6. **Una entrada se confirma escuchándola.** Prueba la frase en la TUI o con Pi antes de darla por buena; el texto escrito no garantiza el sonido. La escritura es para el TTS, no para una persona: vale una forma rara como `güíllet` si suena mejor.
7. **Cada entrada es una excepción de esa palabra.** Que `feature` gane con `fítcher` o `dashboard` con `dáschbord` no autoriza cambiar todos los `-ture` por `-tcher` ni los `sh` por `sch`.

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

Con la voz `lola` ganaron, escuchando, formas que no siguen la tabla: `sch` por `sh` (`dashboard` → `dáschbord`), `tch` por `ch` (`feature` → `fítcher`), `rr` (`deferred` → `diférrd`) y `güi` con `ll` (`widget` → `güíllet`). Son variantes que vale la pena probar, no reglas: `session` ganó con `sh` y sin tilde (`seshion`).

### Qué ve el modelo

El modelo español no lee letras: parte el texto en piezas de su tokenizador (4000 piezas, `tokenizer.json` del modelo `spanish`). Comprobado el 2026-10-31:

- **No hay pieza para `sh`, `sch`, `tch`, `w` ni `k`.** `seshion` llega como `se·s·hi·on`, `dáschbord` como `d·á·s·ch·bor·d` y `fítcher` como `fí·t·che·r`.
- **`w`, `k` y `ü` caen a bytes sueltos** (`chek` → `che` + byte de `k`; `wídyet` empieza con el byte de `w`): son letras casi ausentes del español con que aprendió el modelo.
- **Sí hay piezas españolas** como `ch`, `lle`, `que`, `gui` y `th`.
- **`gui` suena «gi» y `güi` suena «güi»**, como en español: por eso `güíllet` ganó a `guillet` y `guíllet` (la misma adaptación que «whisky» → «güisqui»).

Hipótesis: suena mejor la escritura armada con piezas españolas (`ch`, `lle`, `que`, `güi`) que la que usa letras que caen a bytes (`w`, `k`). Escucha del 2026-10-31: **para la `w` se confirmó**: `wídyet` sonó mal y `uídyet`, que solo cambia la `w` por `u`, sonó mucho mejor. **Para la `k` no**: `chek`/`chec` y `kiú`/`quiú` sonaron casi iguales. **La `z` no da la /z/ inglesa**: con seseo suena como `s`, y `propóusd` (`prop·ó·us·d`) ganó a `propóuzd` (`prop·ó·u·z·d`); escribe `s`. En `widget`, `güíllet` siguió ganando, aunque `güíyet` sonó cerca (la `y` no sonó como `i`). **No escribas `w`**: usa `u` o `güi`. Para ver las piezas de una palabra, usa el comando de la skill [`tehablo-pronunciacion`](../.pi/skills/tehablo-pronunciacion/SKILL.md).

## Cómo probar variantes

1. **Hasta 5 variantes por palabra, cambiando una cosa por vez:** tilde, `ch`/`tch`, `sh`/`sch`, `r`/`rr`, `y`/`ll`, `u`/`gu`/`gü`.
2. **Una palabra por envío, con una pausa corta entre ellas** al comparar. Si se envía una lista, termina con una palabra de relleno (`listo`): el 2026-10-31 el modelo perdió la última palabra de una lista de 15 y la misma palabra sonó bien sola.
3. **Sola y dentro de una frase** (`Abre el dáschbord.`): una forma que gana sola puede fallar en contexto.
4. **Anota la ganadora y con cuáles se comparó** en [Decisiones y pendientes](#decisiones-y-pendientes).

El procedimiento de escucha con un agente (preguntar antes de reproducir, cuadro con la palabra y la pronunciación usada) está en la skill [`tehablo-pronunciacion`](../.pi/skills/tehablo-pronunciacion/SKILL.md).

## Decisiones y pendientes

- **Aplicado (2026-10-29, decisión de la persona responsable):** `API` → `ei pi ai`, `CPU` → `ci pi iu` (el 2026-10-31 `CPU` pasó a `ce pe u`, ver abajo); se quitó `APIs` porque el plural sale solo (`ei pi ais`).
- **Aplicado:** pasaron al inglés `PHP`, `HTML`, `CSS`, `SQL`, `XML`, `npm`, `URL`, `GPU`, `SSD`, `HDMI`, `PR`, `TTS`, `pi-tts`, `CI` y `CLI`; se añadieron términos comunes de desarrollo, Git, GitHub, CI/CD y gestión de proyectos.
- **Aplicado (2026-10-29, decisión de la persona responsable):** `speed` → `espid`, `close` → `clous`, `CRLF` → `si ar el ef` y otros 14 términos de desarrollo y del harness.
- **Se mantienen en español** porque así se dicen: `USB`, `PDF`, `CD`; también `dual`, que es palabra española («dual que suene dual y ya»).
- **Se omiten** términos que el español ya lee bien (`token`, `Bash`, `Vim`, `log`) y los que coinciden con palabras españolas comunes: el diccionario cambia la palabra en cualquier texto.
- **Aplicado (2026-10-31, escuchado y elegido por la persona responsable):** siglas deletreadas con letras del español `CPU` → `ce pe u`, `GPU` → `ge pe u`, `NTFS` → `ene te efe ese`, `UTC` → `u te ce`, `WAV` → `doble ve a uve`, `WSL` → `doble ve ese ele`, `RTX` → `erre te equis` («deletreado en español, por favor»); quedan en inglés `VM` → `vi em` y `VRAM` → `vi ram`. Como palabra: `ONNX` → `ónix`, `RAM` → `ram`, `CUDA` → `cuda`. Términos elegidos entre variantes: `check` → `chek`, `pocket` → `páquet`, `completed` → `complítid`, `deferred` → `diférrd`, `proposed` → `propóusd` (escuchada otra vez el 2026-10-31 frente a `propóuzd`, que proponía la guía privada: ganó `propóusd`), `dataset` → `déiraset`; también `checkpoint`, `config`, `install`, `health`, `low`, `medium`, `high`, `hub` y `Pocket TTS`. Una `x` sola se lee «equis» (el modelo la omitía). `OS` no se añadió porque cambiaría el «os» del español.
- **Aplicado (2026-10-31, guía de la persona responsable, escuchado):** `thread` → `tred`, `queue` → `kiú`, `heap` → `jíp`, `deadline` → `dédlain`, `prompt` → `prómpt`, `payload` → `péiloud`, `template` → `témplet`, `default` → `difólt`, `module` → `mádyul`, `parser` → `párser`, `component` → `compóunent`; elegidos entre variantes: `widget` → `güíllet` (frente a `wídyet`, `guíyet`, `guiyet`, `wuiyet`, `wuidyet`, `guillet`, `guíllet`, `wuillet`, `wuíllet` y `quíllet`), `feature` → `fítcher` (frente a `fícher`), `session` → `seshion` (frente a `séshen`, `séchion` y `sésshion`), `dashboard` → `dáschbord` (frente a `dáshbord`, `dáshboord`, `dáshboard`, `dáschboard`, `dáschboord` y `dáshbordd`). Los plurales (`widgets`) salen solos por la regla 5 y no se escucharon.
- **Pendiente (2026-10-31):** la persona responsable indicó que las siglas se deletrean en español y el inglés queda para palabras y nombres («muchas siglas son solo deletrear en español, lo de ingles es solo para las palabras o nombres de terminos»). Falta decidir si eso se aplica a todas las siglas que siguen con letras inglesas (`API`, `TTS`, `PR`, `URL`, `HTTP`, `SSH`, `MIT`, `GPL`, `ID` y otras); hasta entonces la regla 4 no cambia.
- **Pendiente:** las extensiones de archivo de [`src/tehablo_tech.py`](../src/tehablo_tech.py) siguen con letras del español (`html` → `hache te eme ele`). Ninguna entrada se ha confirmado todavía escuchándola (`RH-W-0002` de la [hoja de ruta](repo-harness/roadmap.md)).

## Fuentes

- Regla de reescritura, convenciones de sonidos y términos técnicos: basadas en la skill `wk-en-pronun-tico-ld9` («pronunciación a lo tico», MIT) de Luis Diego Cubero Chavarría, adaptadas aquí para un modelo de voz.
- Reglas 6 y 7, variantes para la voz `lola` y cómo probarlas: guía privada de la persona responsable (`Pocket_TTS_Lola_Guia.md`, 2026-10-31). Sus propuestas de CMUdict, G2P y análisis gramatical no se adoptaron: tehablo usa un diccionario de excepciones.
- Nombres de las letras en inglés: [UNAM, CCH — Spelling](https://portalacademico.cch.unam.mx/ingles1/gettingPersonalInformation/spelling).
- Buenas prácticas de diccionarios de pronunciación (reescritura, probar cada entrada, repetir pruebas al cambiar de modelo o voz): [ElevenLabs](https://elevenlabs.io/blog/pronunciation-dictionary-guide), [Mahimai](https://mahimai.ca/learn/100x/tts/tts-pronunciation-control).
