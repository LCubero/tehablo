# tehablo

> **En desarrollo.** El proyecto todavía está en desarrollo y puede cambiar. Lo que falta está en la [hoja de ruta](docs/repo-harness/roadmap.md).

Convierte texto en voz en español, en tu equipo y gratis. Usa **Pocket TTS** (Kyutai), que funciona solo con CPU: no necesita GPU, nube ni cuenta. Probado en Windows y en Linux (Fedora), con salida de audio real y [mediciones de consumo](#cuánto-gasta) en ambos. macOS no se ha verificado.

El uso principal es **leer en voz alta las respuestas de [Pi](#uso-en-pi)**. La TUI y la consola sirven para probar voces, modelo y velocidad.

[tehablo_preview.webm](https://github.com/user-attachments/assets/65c14b22-f1ed-4736-b5c8-ffaa19c254a2)


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
| 3. Números | Los convierte a palabras, con su unidad | `15.000` → *quince mil*, `5,86 s` → *cinco coma ochenta y seis segundos* |
| 4. Pocket TTS | Genera la voz a trozos | — |
| 5. Velocidad | Cambia el ritmo sin cambiar el tono | — |
| 6. Altavoz | Suena mientras se genera lo siguiente | — |

- La preparación del texto y la velocidad son código propio y casi no gastan. Pocket TTS es el paso pesado.
- Con el modelo ya cargado, el audio empieza a sonar sin esperar a que termine todo el texto. El arranque puede tardar varios segundos; las mediciones y sus límites se detallan en [desarrollo](docs/desarrollo.md#arranque-en-windows-mediciones-y-límites).
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

Mismo equipo: Ryzen 5 5600X (12 hilos) con 32 GB de RAM, voz `lola` y un texto de unos 36 s de audio.

**Windows:**

| | `spanish` (rápido) | `spanish_24l` (más calidad) |
|---|---|---|
| RAM | ~870 MB (pico ~1 GB) | ~1,8 GB (pico ~2,3 GB) |
| CPU | ~1,8 núcleos (~15 %) | ~1,2 núcleos (~10 %) |
| Velocidad | 3,7 veces más rápido que tiempo real | 1,2 veces |
| Primer audio | ~0,16 s | ~0,55 s |
| GPU | No la usa | No la usa |

En disco: unos 813 MB el entorno de Python y 1,2 GB los modelos descargados.

**Linux (Fedora 44):**

| | `spanish` (rápido) | `spanish_24l` (más calidad) |
|---|---|---|
| RAM | ~970 MB (pico ~1,1 GB) | ~1,9 GB (pico ~2,4 GB) |
| CPU | ~1,7 núcleos (~14 %) | ~1,2 núcleos (~10 %) |
| Velocidad | 4,3 veces más rápido que tiempo real | 1,3 veces |
| Primer fragmento generado (modelo cargado, sin reproducir) | ~0,12 s | ~0,44 s |
| GPU | No la usa | No la usa |

En disco: unos 1087 MB el entorno de Python y 0,9 GB los modelos descargados.

Esa tabla es sin cuantizar. En Linux el modelo se carga **cuantizado** por defecto: genera ~1,7 veces más rápido con `spanish` y ~1,9 con `spanish_24l`, sin diferencia audible en una prueba a ciegas, y tarda ~0,5–1,5 s más en cargar. En Windows sigue sin cuantizar, porque allí era más lento. `TEHABLO_QUANTIZE=0` lo desactiva y `TEHABLO_QUANTIZE=1` lo fuerza; cualquier otro valor se ignora.

Método, valores exactos y cómo repetir la medición: [docs/como-funciona.md](docs/como-funciona.md#consumo-medido).

## Instalación

Con [`uv`](https://docs.astral.sh/uv/) instalado, ejecuta desde la raíz del repositorio:

**Linux / macOS:**
```bash
./install.sh
```

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

Los scripts crean o reutilizan el entorno compatible con tu sistema, instalan las dependencias y comprueban las importaciones y Torch sin CUDA; si falta PortAudio, el script de Linux indica cómo instalarlo. Los modelos se descargan en el primer uso.

### Instalación manual

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

El entorno `.venv-pocket` no se puede copiar entre sistemas operativos: créalo en cada equipo. Con dual boot sobre la misma carpeta, deja un entorno por sistema: la extensión busca primero `.venv-pocket` y después `.venv-pocket-windows`, `.venv-pocket-linux` o `.venv-pocket-macos`, según el sistema (`Scripts/python.exe` en Windows, `bin/python` en Linux y macOS). Si no encuentra ninguno, el aviso muestra las rutas que probó. Ejecuta los comandos desde la raíz del repositorio.

Comprobación básica en Linux (importaciones y Torch sin CUDA; no prueba el audio):
```bash
.venv-pocket/bin/python -c 'import pocket_tts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None'
```

La combinación comprobada en Fedora y los límites de la prueba están en [Desarrollo](docs/desarrollo.md#verificación-en-fedora).

## Uso en Pi

La extensión [`pi-extension/tehablo-tts/`](pi-extension/tehablo-tts/) lee las respuestas finales del agente con la voz local. Se carga sola al abrir Pi dentro de este repositorio (`.pi/settings.json`), después de aceptar la confianza del proyecto y ejecutar `/reload`. Para usarla en otros proyectos, añade la ruta absoluta de esa carpeta a `extensions` en tu configuración de Pi.

- **Manual (por defecto):** cada respuesta muestra una barra de controles que se usa con clics:

  | Estado | Barra |
  |---|---|
  | Apagado | `[ ⏻ TTS ]` |
  | Cargando | `[ Cargando… ]` (no se puede pulsar) |
  | Listo | `[ ▶ Escuchar ] [ ⋯ ]` |
  | Listo, controles abiertos | `[ ▶ Escuchar ] [ → ]  Vol [- 100% +]  Vel [- 1.00x +] [ ⏻ ]` |
  | Sonando | `[ ‖ ] [ ■ ] [ ⋯ ]` |
  | En pausa | `[ ▶ ] [ ■ ] [ ⋯ ]` |

  **`[ ⏻ TTS ]`** arranca el servidor y carga el modelo antes de escuchar; mientras tanto, la barra de estado muestra `TTS manual · cargando`. Las pruebas de código cubren clics en toda su superficie (corchetes, símbolo, letras y espacios normales); el problema del clic físico en el host sigue sin resolverse. Escuchar, `/tts play` y el modo automático también lo arrancan si hace falta.
- **Volumen y velocidad:** `[ ⋯ ]` muestra **Vol** (10–150 %, pasos de 10 %, inicial 100 %) y **Vel** (1.00x, 1.10x, 1.15x, 1.25x y 1.50x; `/tts speed` sigue aceptando 0.75–1.5) en todas las barras; `[ → ]` los oculta. `[-` baja y `+]` sube. Solo clics, sin atajos de teclado. El volumen cambia incluso el audio en reproducción; la velocidad afecta a los siguientes trozos generados, no al audio ya almacenado. Los límites se mantienen sin error.
- **Apagar y liberar el modelo:** `[ ⏻ ]` aparece solo al final de los controles abiertos, después del último `+]`. Detiene la lectura y cierra el servidor propio para liberar sus recursos; reinicia los controles y vuelve al modo manual. `[ ⏻ TTS ]` permite encenderlo otra vez sin cerrar Pi. No equivale a `[ ■ ]` (solo detener) ni a `/tts off` (desactivar los controles).
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

La extensión arranca sola el servidor local [`src/tehablo_server.py`](src/tehablo_server.py) (`127.0.0.1:8765`, se cambia con `TEHABLO_PORT`) y lo apaga al cerrar Pi. Necesita el entorno `.venv-pocket` (o `.venv-pocket-<sistema>`) instalado. Los ajustes duran solo la sesión. Los mensajes y errores del servidor se guardan en `logs/tehablo-server.log`, que se reescribe en cada arranque; si el servidor no responde a tiempo, el aviso indica esa ruta. Si el modelo no carga, Pi muestra el error en lugar de quedarse en «cargando»; también avisa si una lectura falla (por ejemplo, sin dispositivo de audio) o si se pierde la conexión con el servidor. Cada lectura usa la salida de audio predeterminada del sistema en ese momento: si cambias a audífonos o Bluetooth, la siguiente lectura ya suena ahí; la que está sonando termina en la salida anterior. Por seguridad, el servidor rechaza peticiones de páginas web (cabecera `Origin`, 403) y los `POST` que no declaran JSON (415).

El registro incluye líneas `Startup:` con segundos por etapa: importaciones del servidor, importaciones de TTS y carga del modelo (sin repetir el tiempo de importación de TTS). Sirven para comparar próximos arranques, no para diagnosticar retrospectivamente la demora ni atribuirla a la caché. No miden la creación del proceso Python ni el inicio de la reproducción. Guarda el registro antes de volver a arrancar: se sobrescribe. Las [mediciones de arranque en Windows y sus límites](docs/desarrollo.md#arranque-en-windows-mediciones-y-límites) quedan documentadas para futuras comparaciones.

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
- **Texto técnico en español:** las URLs se leen como «enlace a dominio», las rutas solo por su último segmento y los archivos con su extensión; una barra entre palabras se lee «eslash» (`on/off`). Identificadores como `RH-W-0001` se deletrean y los hashes de commit se omiten. Los separadores (`+++`, `===`) no se leen, y las flechas (`→`, `->`, `=>`) y los paréntesis se convierten en una pausa corta. Los símbolos se leen: `=` «igual a», `<` «menor que», `>=` o `≥` «mayor o igual que», `≈` o `~14` «aproximadamente», `1,7×` «veces», `3×4` «por», y `#350` se lee «número 350». En Pi, las tablas se leen fila por fila (celdas separadas por pausas) y los puntajes como `53/53` se leen «53 de 53». Las unidades tras un número se leen completas: tiempo (`ms`, `s`, `min`, `h`), longitud (`m`, `km`, `in`, `ft`), superficie (`m²`, `m2`, `ha`), volumen (`l`, `ml`, `cc`, `gal`), peso (`kg`, `lb`, `ton`), velocidad (`km/h`, `MB/s`), datos (`MB`, `GiB`, `Mbps`), frecuencia (`GHz`), electricidad (`V`, `mA`, `kWh`), presión (`hPa`, `bar`, `psi`), sonido (`dB`), energía (`kcal`) y pantalla (`px`, `fps`), con «un/una» y femenino donde toca («una hora», «doscientas kilocalorías»). Todo esto ocurre antes de aplicar el diccionario y los números.
- **Voces nuevas:** copia grabaciones en `voices/`, o descarga más con `scripts/get_voices.py --speakers 5`.
- **Calidad:** prueba `spanish_24l`, o una referencia de voz más limpia.

**Con código, ideas documentadas:**
- Siglas en el conversor de números, pausas exactas.
- Lista completa con esfuerzo estimado: [docs/pocket-tts.md](docs/pocket-tts.md#12-catálogo-de-mejoras-posibles).
- Otros motores y recursos gratuitos: [docs/catalogo-gratuito.md](docs/catalogo-gratuito.md).

## Más documentación

- [Cómo funciona y qué recursos usa](docs/como-funciona.md)
- [Pocket TTS: referencia, voces, pronunciación y mejoras](docs/pocket-tts.md)
- [Desarrollo: archivos, pruebas, problemas conocidos y licencias](docs/desarrollo.md)
- [Hoja de ruta: trabajo pendiente y prioridades](docs/repo-harness/roadmap.md)
- [Cómo contribuir](CONTRIBUTING.md) · [Guía del harness de IA](docs/repo-harness/usage.md)

Licencia del proyecto: [MIT](LICENSE).
