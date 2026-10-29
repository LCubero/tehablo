# tehablo

Convierte texto en voz en español, en tu equipo y gratis. Usa **Pocket TTS** (Kyutai), que funciona solo con CPU: no necesita GPU, nube ni cuenta. Probado en Windows y, para servidor y transporte de la extensión, en Fedora con salida de audio real. macOS no se ha verificado.

El uso principal es **leer en voz alta las respuestas de [Pi](#uso-en-pi)**. La TUI y la consola sirven para probar voces, modelo y velocidad.

1. [Cómo funciona](#cómo-funciona)
2. [Qué usa](#qué-usa)
3. [Cuánto gasta](#cuánto-gasta)
4. [Instalación](#instalación)
5. [Uso en Pi](#uso-en-pi)
6. [Uso: TUI](#uso-tui)
7. [Uso: consola simple](#uso-consola-simple)
8. [Voces](#voces)
9. [Qué se puede agregar, modificar o aprovechar](#qué-se-puede-agregar-modificar-o-aprovechar)
10. [Más documentación](#más-documentación)

---

## Cómo funciona

| Paso | Qué hace | Ejemplo |
|---|---|---|
| 1. Texto técnico | Simplifica URLs, rutas, archivos e identificadores | `src/tehablo_server.py` → *tehablo sérver punto pai* |
| 2. Términos en inglés | Los cambia por cómo suenan ([`pronunciaciones.json`](pronunciaciones.json)) | `Python` → *páiton* |
| 3. Números | Los convierte a palabras | `15.000` → *quince mil* |
| 4. Pocket TTS | Genera la voz a trozos | — |
| 5. Velocidad | Cambia el ritmo sin cambiar el tono | — |
| 6. Altavoz | Suena mientras se genera lo siguiente | — |

- La preparación del texto y la velocidad son código propio y casi no gastan. Pocket TTS es el paso pesado.
- El audio empieza a sonar enseguida (en menos de 1 s), sin esperar a que termine todo el texto.
- Internet solo hace falta la primera vez, para descargar los modelos.

Detalle completo: [docs/como-funciona.md](docs/como-funciona.md).

## Qué usa

| Pieza | Para qué | Licencia |
|---|---|---|
| **Pocket TTS** (Kyutai) | Modelo de IA que genera la voz | Código MIT, pesos CC BY 4.0 |
| **PyTorch** solo CPU | Ejecuta el modelo | BSD |
| **Textual** | Interfaz de la TUI | MIT |
| **sounddevice** | Salida al altavoz | MIT |
| **audiotsm** | Velocidad sin cambiar el tono | MIT |
| **numpy / scipy** | Cálculo y guardado de audio `.wav` | BSD |

## Cuánto gasta

Medido en un Ryzen 5 5600X con 32 GB de RAM y Windows, con un texto de unos 36 s de audio.

| | `spanish` (rápido) | `spanish_24l` (más calidad) |
|---|---|---|
| RAM | ~870 MB (pico ~1 GB al cargar) | ~1,8 GB (pico ~2,3 GB) |
| CPU | ~1,8 núcleos (~15 %) | ~1,2 núcleos (~10 %) |
| Velocidad | 3,7 veces más rápido que tiempo real | 1,2 veces |
| GPU | No la usa | No la usa |

En disco: unos 813 MB el entorno de Python y 1,2 GB los modelos descargados.

## Instalación

Requisitos: Python 3.10 a 3.14 y [`uv`](https://docs.astral.sh/uv/).

**Windows (PowerShell):**
```powershell
uv venv .venv-pocket --python 3.12
uv pip install --python .venv-pocket\Scripts\python.exe -r requirements.txt `
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
```

**Linux / macOS:**
```bash
uv venv .venv-pocket --python 3.12
uv pip install --python .venv-pocket/bin/python -r requirements.txt \
  --extra-index-url https://download.pytorch.org/whl/cpu --index-strategy unsafe-best-match
```

En Linux, instala PortAudio si falta, usando solo el comando de tu distribución (no hace falta en macOS):
```bash
sudo dnf install portaudio      # Fedora
sudo apt install libportaudio2  # Debian / Ubuntu
```

El entorno `.venv-pocket` no se puede copiar entre sistemas operativos: créalo en cada equipo. Si vienes de Windows y solo existe `.venv-pocket/Scripts/python.exe`, conserva ese entorno con otro nombre antes de crear el de Linux; la extensión necesita `.venv-pocket/bin/python`. Ejecuta los comandos desde la raíz del repositorio.

Comprobación básica en Linux (importaciones y Torch sin CUDA; no prueba el audio):
```bash
.venv-pocket/bin/python -c 'import pocket_tts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None'
```

La combinación comprobada en Fedora y los límites de la prueba están en [Desarrollo](docs/desarrollo.md#verificación-en-fedora).

## Uso en Pi

La extensión [`pi-extension/tehablo-tts/`](pi-extension/tehablo-tts/) lee las respuestas finales del agente con la voz local. Se carga sola al abrir Pi dentro de este repositorio (`.pi/settings.json`), después de aceptar la confianza del proyecto y ejecutar `/reload`. Para usarla en otros proyectos, añade la ruta absoluta de esa carpeta a `extensions` en tu configuración de Pi.

- **Manual (por defecto):** cada respuesta muestra `[ ▶ Escuchar ]`. Mientras suena aparecen **⏸ Pausar** / **▶ Continuar** y **■ Detener**.
- **Volumen y velocidad:** junto a Escuchar/Pausar aparecen **Vol − / Vol +** (10–150 %, pasos de 10 %, inicial 100 %) y **Vel − / Vel +** (0.75, 0.9, 1, 1.1, 1.25 y 1.5x), con el valor actual entre botones. Solo clics, sin atajos de teclado. El volumen cambia incluso el audio en reproducción; la velocidad afecta a los siguientes trozos generados, no al audio ya almacenado. Los límites se mantienen sin error.
- **Automático:** `/tts auto on` lee cada respuesta al terminar; `/tts auto off` vuelve al modo manual.

| Comando | Acción |
|---|---|
| `/tts` | Estado y ayuda |
| `/tts on` / `/tts off` | Activa o desactiva los controles |
| `/tts play [n]` | Lee la respuesta `n` (o la última) |
| `/tts pause` / `/tts resume` / `/tts stop` | Controla la lectura |
| `/tts voice [nombre]` | Lista o cambia la voz |
| `/tts model [spanish\|spanish_24l]` | Cambia el modelo |
| `/tts speed [0.75-1.5]` | Cambia la velocidad |

La extensión arranca sola el servidor local [`src/tehablo_server.py`](src/tehablo_server.py) (`127.0.0.1:8765`, se cambia con `TEHABLO_PORT`) y lo apaga al cerrar Pi. Necesita el entorno `.venv-pocket` instalado. Los ajustes duran solo la sesión.

## Uso: TUI

```powershell
.\.venv-pocket\Scripts\python src/tehablo_tui.py      # Windows
.venv-pocket/bin/python src/tehablo_tui.py            # Linux / macOS
```

Escribe o pega el texto, elige **voz**, **modelo** (`spanish` o `spanish_24l`) y **velocidad** (0,75x a 1,5x), y pulsa **F5**.

| Tecla | Acción |
|---|---|
| **F5** | Generar y reproducir |
| **F6** | Detener |
| **F7** | Guardar el último audio en `pocket-out/` (con la velocidad elegida) |
| **F8** | Recargar la lista de voces |
| **Ctrl+Q** | Salir |

## Uso: consola simple

```powershell
.\.venv-pocket\Scripts\python src/tehablo_tts.py [--voice lola] [--language spanish]
```

Escribe texto y pulsa Enter. Comandos: `/leer archivo.txt`, `/multi`, `/voz <nombre|archivo>`, `/voces`, `/modelo <idioma>`, `/guardar [nombre]`, `/salir`. Para textos largos, usa `/leer` o la TUI.

## Voces

| Tipo | Cuáles | ¿Necesita token? |
|---|---|---|
| **Catálogo** incluido | `lola` (única nativa en español), `rafael` y unas 25 más con timbre de otros idiomas | No |
| **Descargadas** en `voices/` | Argentina, Chile y Colombia, mujer y hombre (`scripts/get_voices.py`) | Sí |
| **Propias** | Cualquier `.wav`, `.mp3` o `.flac` limpio de 10 a 30 s en `voices/` (F8 para recargar) | Sí |

> ⚠️ Clona solo voces que tengas permiso para usar. `cosette` del catálogo es solo para uso no comercial.

Listado y licencias: [docs/pocket-tts.md](docs/pocket-tts.md#7-catálogo-de-voces-predefinidas). Más fuentes: [docs/voces-gratuitas.md](docs/voces-gratuitas.md).

### Activar la clonación de voces (token de Hugging Face)

1. Crea una cuenta gratuita en <https://huggingface.co> y acepta las condiciones en <https://huggingface.co/kyutai/pocket-tts>.
2. Crea un token **Read** en <https://huggingface.co/settings/tokens>.
3. Ejecuta `.\.venv-pocket\Scripts\hf auth login` y pega el token, o añade `HF_TOKEN=hf_...` a `.env`.

Solo hace falta para la primera descarga; después funciona sin internet.

## Qué se puede agregar, modificar o aprovechar

**Sin tocar código:**
- **Pronunciación de términos en inglés:** edita [`pronunciaciones.json`](pronunciaciones.json) (`"Python": "páiton"`). Incluye Git y Pi (`feat`, `master`, `origin`, `pi-tts`); se recarga solo. Cómo escribir cada entrada: [docs/pronunciacion.md](docs/pronunciacion.md).
- **Texto técnico en español:** las URLs se leen como «enlace a dominio», las rutas solo por su último segmento y los archivos con su extensión; una barra entre palabras se lee «eslash» (`on/off`). Identificadores como `RH-W-0001` se deletrean y los hashes de commit se omiten. Los separadores (`+++`, `===`) no se leen, y las flechas `→` y los paréntesis se convierten en una pausa corta. En Pi, las tablas se leen fila por fila (celdas separadas por pausas) y los puntajes como `53/53` se leen «53 de 53». Todo esto ocurre antes de aplicar el diccionario y los números.
- **Voces nuevas:** copia grabaciones en `voices/`, o descarga más con `scripts/get_voices.py --speakers 5`.
- **Calidad:** prueba `spanish_24l`, o una referencia de voz más limpia.

**Con código, ideas documentadas:**
- Cuantización para gastar menos RAM, unidades y siglas en el conversor de números, pausas exactas, servidor o API local.
- Lista completa con esfuerzo estimado: [docs/pocket-tts.md](docs/pocket-tts.md#12-catálogo-de-mejoras-posibles).
- Otros motores y recursos gratuitos: [docs/catalogo-gratuito.md](docs/catalogo-gratuito.md).

## Más documentación

- [Cómo funciona y qué recursos usa](docs/como-funciona.md)
- [Pocket TTS: referencia, voces, pronunciación y mejoras](docs/pocket-tts.md)
- [Desarrollo: archivos, pruebas, problemas conocidos y licencias](docs/desarrollo.md)
- [Cómo contribuir](CONTRIBUTING.md) · [Guía del harness de IA](docs/repo-harness/usage.md)

Licencia del proyecto: [MIT](LICENSE).
