# tehablo

Síntesis de voz (texto a voz) en español, local y gratuita, con **Pocket TTS**: un modelo que funciona solo con CPU en Windows, Linux y macOS.

## Índice

- [Pocket TTS: referencia, voces, pronunciación y mejoras posibles](docs/pocket-tts.md)
- [Voces gratuitas en español para clonar](docs/voces-gratuitas.md)
- [Catálogo maestro de recursos gratuitos para TTS en español](docs/catalogo-gratuito.md)

1. [Resumen](#resumen)
2. [Alternativas locales evaluadas](#alternativas-locales-evaluadas)
3. [Pocket TTS: qué es](#pocket-tts-qué-es)
4. [Instalación](#instalación)
5. [Uso: TUI](#uso-tui)
6. [Uso: consola simple](#uso-consola-simple)
7. [Voces](#voces)
8. [Activar la clonación de voces (token de Hugging Face)](#activar-la-clonación-de-voces-token-de-hugging-face)
9. [Licencias y atribución](#licencias-y-atribución)
10. [Archivos del proyecto](#archivos-del-proyecto)
11. [Pruebas](#pruebas)
12. [Problemas conocidos](#problemas-conocidos)

---

## Resumen

| Pregunta | Respuesta |
|---|---|
| ¿Qué motor usa? | **Pocket TTS** (Kyutai), local y gratuito, solo con CPU. |
| ¿Habla español? | Sí: modelos `spanish` y `spanish_24l`. |
| ¿Puedo usar distintas voces? | Sí: catálogo incluido y clonación desde un `.wav` (requiere token de Hugging Face). |
| ¿Funciona en Windows, Linux y macOS? | Sí (Python + PyTorch para CPU). Probado solo en Windows. |

---

## Alternativas locales evaluadas

Equipo de referencia: Ryzen 5 5600X, 32 GB de RAM, RTX 2080 Super con 8 GB.

| Motor | Necesita | Voces | Licencia | Nota |
|---|---|---|---|---|
| **Pocket TTS** (Kyutai) | **Solo CPU** | Catálogo + clonación | Código MIT, pesos CC BY 4.0 | **Elegido** |
| Piper (`es_AR-daniela`, `es_ES`, `es_MX`) | Solo CPU | 8 voces fijas en español | Varía según la voz | Muy ligero, algo robótico |
| Kokoro-82M | Solo CPU | 3 voces en español | Apache 2.0 | Sin acentos latinoamericanos |
| Chatterbox Multilingual | GPU de 4 a 6 GB, o CPU lento | Clonación | MIT | Alta calidad |
| Qwen3-TTS VoiceDesign | GPU de unos 6 GB | Voces creadas por descripción + clonación | Apache 2.0 | Crea voces a partir de una descripción. Sin probar en una 2080 (no soporta `bf16`) |
| VoxCPM2 | GPU de 6 a 8 GB | Voces por descripción + clonación | Apache 2.0 | Sin probar |
| XTTS-v2 / F5-TTS | CPU o GPU | Clonación | ❌ No comercial | Descartados por la licencia |

---

## Pocket TTS: qué es

- Modelo de texto a voz de **Kyutai**, de unos 100 millones de parámetros, pensado para **CPU**.
- Idiomas: inglés, francés, alemán, portugués, italiano, **español** y neerlandés.
- Modelos de español: `spanish` (rápido) y `spanish_24l` (más calidad, más lento).
- **Clona voces** a partir de un `.wav` de 10 a 30 s.
- Genera el audio en streaming, así que empieza a sonar enseguida.
- Repositorio: <https://github.com/kyutai-labs/pocket-tts> · Modelo: <https://huggingface.co/kyutai/pocket-tts> · Voces: <https://huggingface.co/kyutai/tts-voices>

**Rendimiento medido en este equipo (CPU):**

| Modelo | Audio | Tiempo de generación | Velocidad |
|---|---|---|---|
| `spanish` | 10,2 s | 2,9 s | 3,6 veces más rápido que tiempo real |
| `spanish_24l` | 9,3 s | 9,1 s | 1,0 veces (casi tiempo real) |
| `spanish`, texto de 1.556 caracteres | 100 s | 100 s, reproduciendo mientras genera | — |

La primera ejecución descarga el modelo. Después carga en 1 o 2 segundos.

**Cómo se reparte Pocket TTS:** el **código** está en GitHub y se instala con `pip`. Los **pesos** del modelo están en Hugging Face y se descargan la primera vez que se usa. Hay dos versiones de los pesos:
- **Sin clonación:** descarga libre. Basta para usar las voces del catálogo.
- **Con clonación:** protegida. Necesita aceptar condiciones y un token (ver [Activar la clonación](#activar-la-clonación-de-voces-token-de-hugging-face)).

---

## Instalación

Requisitos: Python 3.10 a 3.14 y [`uv`](https://docs.astral.sh/uv/). Se usa PyTorch **solo CPU** (unos 200 MB, frente a los 3 GB de la versión con CUDA).

**Windows (PowerShell):**
```powershell
cd E:\code\02-Proyectos\tehablo
uv venv .venv-pocket --python 3.12
uv pip install --python .venv-pocket\Scripts\python.exe -r requirements.txt `
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
```

**Linux / macOS:**
```bash
uv venv .venv-pocket --python 3.12
uv pip install --python .venv-pocket/bin/python -r requirements.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
# Solo en Linux, para el audio:
sudo apt install libportaudio2
```

El entorno `.venv-pocket` **no se puede copiar** entre sistemas operativos: hay que crearlo de nuevo en cada equipo.

---

## Uso: TUI

```powershell
.\.venv-pocket\Scripts\python src/tehablo_tui.py      # Windows
.venv-pocket/bin/python src/tehablo_tui.py            # Linux / macOS
```

1. Espera a que el registro de abajo diga *"Modelo 'spanish' listo"*.
2. Escribe o pega texto en el cuadro grande. Admite textos largos.
3. Elige la **voz** (primer desplegable) y el **modelo** (segundo desplegable).
4. Pulsa **F5** o **Reproducir**.

| Tecla / botón | Acción |
|---|---|
| **F5** / Reproducir | Genera y reproduce el texto |
| **F6** / Detener | Corta la generación y la reproducción |
| **F7** / Guardar | Guarda el **último** audio en `pocket-out/<voz>-<fecha-hora>.wav`. Si se detuvo a mitad, guarda la parte que sonó |
| **F8** | Recarga la lista de voces (después de añadir archivos a `voices/`) |
| **Ctrl+Q** | Salir |

En el desplegable, las voces aparecen como `[archivo] …` (de la carpeta `voices/`, por clonación) o `[catalogo] …` (incluidas en Pocket TTS).

---

## Uso: consola simple

Alternativa sin interfaz: [`src/tehablo_tts.py`](src/tehablo_tts.py).

```powershell
.\.venv-pocket\Scripts\python src/tehablo_tts.py [--voice lola] [--language spanish]
```

| Comando | Acción |
|---|---|
| *(texto)* + Enter | Genera y reproduce |
| `/leer archivo.txt` | Lee un archivo de texto (útil para textos largos) |
| `/multi` | Pegar varias líneas; termina con una línea vacía |
| `/voz <nombre\|archivo>` | Cambia de voz (nombre del catálogo, `.wav` para clonar o `.safetensors`) |
| `/voces` | Lista las voces del catálogo |
| `/modelo <idioma>` | Recarga el modelo (`spanish`, `spanish_24l`, …) |
| `/guardar [nombre]` | Guarda el último audio en `pocket-out/` |
| `/salir` | Termina |

### Números

Con los modelos `spanish` y `spanish_24l`, la TUI y la consola convierten los números a palabras antes de leerlos, porque Pocket TTS no sabe leer cifras. Ejemplos: `15.000` → *quince mil*, `25,5` → *veinticinco coma cinco*, `30%` → *treinta por ciento*, `14:30` → *catorce y treinta*, `29/10/2026` → *veintinueve de octubre de dos mil veintiséis*, `₡15.000` → *quince mil colones*, `$20` → *veinte dólares*. El punto separa miles y la coma marca decimales. Detalles y límites: [docs/pocket-tts.md](docs/pocket-tts.md#números-fechas-siglas-y-símbolos).

La consola de Windows puede cortar las líneas muy largas al pegarlas. En ese caso, usa `/leer` o la TUI.

Texto de prueba largo: [`samples/prueba-larga.txt`](samples/prueba-larga.txt). Ejemplo: `/leer samples/prueba-larga.txt`. Las rutas de `/leer` se resuelven desde el directorio de trabajo actual.

---

## Voces

### Catálogo incluido (funciona sin token)

| Voces | Origen | Licencia |
|---|---|---|
| `lola` | Common Voice (es). **Única voz nativa en español** | Probablemente CC0 (sin verificar) |
| `rafael` | Voz por defecto del portugués | Sin verificar |
| `eve`, `anna`, `vera`, `fantine`, `charles`, `paul`, `eponine`, `azelma`, `george`, `mary`, `jane`, `michael` | Corpus VCTK (inglés británico) | CC BY 4.0 |
| `marius`, `javert` | Donaciones de voz a Kyutai | CC0 |
| `cosette` | Expresso | ⚠️ **Solo uso no comercial** |
| `alba`, `jean`, `giovanni`, `estelle`, `juergen`, `daan`, `bill_boerst`, `peter_yearsley`, `stuart_bell`, `caro_davy` | Varios | Sin verificar |

Las voces que no son españolas hablan español con su timbre original y probablemente con algo de acento extranjero.

### Voces en español para clonar (`voices/`, requieren token)

[`scripts/get_voices.py`](scripts/get_voices.py) descarga fragmentos breves de hablantes nativos desde los corpus de Google para el español latinoamericano (a través de la API de filas de Hugging Face, sin bajar los datasets completos, que ocupan más de 1 GB) y los une en un `.wav` de unos 15 a 25 s por hablante.

```powershell
.\.venv-pocket\Scripts\python scripts/get_voices.py                # 3 hablantes por país y género
.\.venv-pocket\Scripts\python scripts/get_voices.py --speakers 5   # más voces
```

| País | Corpus | Mujer | Hombre |
|---|---|---|---|
| Argentina | OpenSLR 61 | 3 | 3 |
| Chile | OpenSLR 71 | 3 | 3 |
| Colombia | OpenSLR 72 | 3 | 3 |

Los nombres de los archivos siguen el patrón `<país>-<mujer|hombre>-<id_hablante>.wav`. Los créditos quedan en `voices/ATTRIBUTION.txt`.

### Añadir voces propias

Copia un `.wav`, `.mp3` o `.flac` **limpio** (sin ruido ni música) de 10 a 30 s en `voices/` y pulsa **F8** en la TUI. El modelo copia también la calidad de la grabación.

> ⚠️ Clona solo voces que tengas permiso para usar: la tuya, la de alguien que lo autorice o datasets con licencia abierta. Las condiciones de Pocket TTS prohíben *"voice impersonation or cloning without explicit and lawful consent"*.

### Más fuentes gratuitas de voces en español

| Fuente | Contenido | Licencia |
|---|---|---|
| OpenSLR 73/74/75 | Perú, Puerto Rico, Venezuela (corpus de Google) | CC BY-SA 4.0 |
| CML-TTS (OpenSLR 146) | Narración de audiolibros en español | CC BY 4.0 |
| Mozilla Common Voice (es) | Miles de hablantes de muchos países | CC0 |
| Kyutai voice-donations | 228 voces donadas, pocas o ninguna en español | CC0 |

---

## Activar la clonación de voces (token de Hugging Face)

Sin este paso, las voces de `voices/` dan el error *"We could not download the weights for the model with voice cloning"*. Las del catálogo funcionan igual.

1. Crea una cuenta gratuita en <https://huggingface.co>.
2. Acepta las condiciones en <https://huggingface.co/kyutai/pocket-tts>.
3. Crea un token de tipo **Read** en <https://huggingface.co/settings/tokens>.
4. Elige **una** de estas dos formas de dárselo al programa:

| Forma | Cómo | Ámbito |
|---|---|---|
| **Comando (recomendado)** | `.\.venv-pocket\Scripts\hf auth login` y pega el token | Todo el equipo; queda fuera del proyecto |
| **`.env`** | Añade `HF_TOKEN=hf_...` a `.env` | Solo este proyecto; `src/tehablo_tui.py` y `src/tehablo_tts.py` leen `.env` al arrancar |

El token solo hace falta para la **primera descarga**. Después, los pesos quedan en la caché y todo funciona sin internet.

---

## Licencias y atribución

| Componente | Licencia | Obligación |
|---|---|---|
| Código de Pocket TTS | MIT | — |
| Pesos de Pocket TTS | CC BY 4.0 | Citar a Kyutai |
| Voces VCTK del catálogo | CC BY 4.0 | Citar VCTK |
| Voces `voices/` (corpus de Google, OpenSLR) | CC BY-SA 4.0 | Citar la fuente; las obras derivadas, con la misma licencia |
| `cosette` (Expresso) | CC BY-NC 4.0 | Solo uso no comercial |

Atribución sugerida: *"Voz sintetizada con Kyutai Pocket TTS (CC BY 4.0). Voz de referencia: <corpus> (<licencia>)."*

---

## Archivos del proyecto

```text
tehablo/
├── README.md
├── requirements.txt
├── .gitignore
├── .env                      # local, nunca versionar
├── src/
│   ├── tehablo_tui.py
│   ├── tehablo_tts.py
│   └── tehablo_numbers.py
├── scripts/
│   └── get_voices.py
├── tests/
│   ├── test_numbers.py
│   ├── test_tui_smoke.py
│   └── test_tui_spanish_24l.py
├── samples/
│   └── prueba-larga.txt
├── docs/
│   ├── pocket-tts.md
│   ├── voces-gratuitas.md
│   └── catalogo-gratuito.md
├── voices/
├── pocket-out/               # audio generado
└── .venv-pocket/
```

| Ruta | Propósito | ¿Versionar en Git? |
|---|---|---|
| `README.md`, `requirements.txt`, `.gitignore` | Guía, dependencias y exclusiones | Sí |
| `src/tehablo_tui.py` | Interfaz Textual | Sí |
| `src/tehablo_tts.py` | Consola simple | Sí |
| `src/tehablo_numbers.py` | Conversión de números a palabras en español | Sí |
| `scripts/get_voices.py` | Descarga selectiva de voces | Sí |
| `tests/` | Pruebas ejecutables sin pytest | Sí |
| `samples/prueba-larga.txt` | Texto largo para `/leer` | Sí |
| `docs/` | Investigación y referencias | Sí |
| `voices/ATTRIBUTION.txt` | Atribución de las referencias descargadas | Sí |
| `voices/*.wav` | Referencias recreables con `scripts/get_voices.py` | No, ignoradas |
| `pocket-out/`, `*.mp3` | Audio generado | No, ignorados; excepción: referencias `voices/*.mp3` |
| `.env` | Secretos locales | No, ignorado |
| `.venv*/`, `__pycache__/` | Entornos y caché Python | No, ignorados |

La tabla indica qué se debe versionar; todavía no se ha creado ningún commit.
Ejecute los comandos desde la raíz del repositorio. Las aplicaciones y los scripts
usan siempre la raíz para `.env`, `voices/` y `pocket-out/`, independientemente
del directorio de trabajo. `/leer` conserva las rutas relativas al directorio actual.

## Pruebas

`tests/test_numbers.py` comprueba la conversión de números a palabras sin modelo ni audio; termina con código 0 si todos los casos pasan:

```powershell
.venv-pocket/Scripts/python tests/test_numbers.py
```

Las demás son scripts de integración de Textual, no pruebas de pytest. **Reproducen audio
por los altavoces** y requieren el entorno instalado, un dispositivo de salida
y los modelos/voces disponibles (la primera carga puede descargarlos).

```powershell
.venv-pocket/Scripts/python tests/test_tui_smoke.py
.venv-pocket/Scripts/python tests/test_tui_spanish_24l.py
```

En Linux/macOS, use `.venv-pocket/bin/python` en ambos comandos.

- `tests/test_tui_smoke.py`: carga `spanish`, selecciona `rafael`, genera y guarda
  en `pocket-out/`. El registro debe incluir `listo:` y el guardado.
- `tests/test_tui_spanish_24l.py`: cambia a `spanish_24l`, pulsa F5 durante la carga
  y comprueba en el registro la reproducción pendiente y el rechazo de un segundo
  F5. Debe aparecer una sola línea `listo:` de audio y `model_name: spanish_24l`.

Los scripts imprimen los registros para inspección; su código de salida por sí
solo no acredita estos resultados.

---

## Problemas conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| *"We could not download the weights for the model with voice cloning"* | Falta el token de Hugging Face | [Activar la clonación](#activar-la-clonación-de-voces-token-de-hugging-face) |
| Aviso de *symlinks* en Windows | La caché de Hugging Face no puede crear enlaces simbólicos | Inofensivo; solo usa algo más de disco. Se evita activando el Modo de desarrollador de Windows |
| No se puede pegar un texto largo en `src/tehablo_tts.py` | Límite de la consola de Windows | Usa `/leer archivo.txt` o la TUI |
| Sin sonido en Linux | Falta PortAudio | `sudo apt install libportaudio2` |
| Al cambiar de modelo había que pulsar Reproducir dos veces | El primer clic se descartaba mientras cargaba el modelo | **Corregido:** ahora queda en espera y suena en cuanto el modelo está listo |
| La primera ejecución tarda más de un minuto | Descarga del modelo | Solo pasa la primera vez |
| Las cifras como `15.000` sonaban incoherentes | Pocket TTS no convierte números a palabras | **Corregido:** `src/tehablo_numbers.py` los convierte antes de leer (solo con modelos en español) |
| Acento extranjero en español | Voz del catálogo no hispana | Usa `lola` o voces de `voices/` |
