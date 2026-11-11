# Desarrollo: archivos, pruebas, problemas conocidos y licencias

Guía de uso detallado, instalación y referencia para quien trabaja en teHablo. La presentación breve está en el [README](../README.md).

1. [Alternativas locales evaluadas](#alternativas-locales-evaluadas)
2. [Licencias y atribución](#licencias-y-atribución)
3. [Archivos del proyecto](#archivos-del-proyecto)
4. [Pruebas](#pruebas)
5. [Arranque en Windows: mediciones y límites](#arranque-en-windows-mediciones-y-límites)
6. [Problemas conocidos](#problemas-conocidos)
7. [Instalación manual](#instalación-manual)
8. [Uso en Pi](#uso-en-pi)
9. [Audio por SSH](#audio-por-ssh)
10. [TUI](#uso-tui), [consola](#uso-consola-simple) y [voces](#voces)

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

## Licencias y atribución

El código de teHablo se distribuye bajo la licencia [MIT](../LICENSE). Los componentes de terceros conservan sus propias licencias:

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
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── REPO-HARNESS.md               # reglas para agentes de IA
├── AGENTS.md                     # puntero a REPO-HARNESS.md
├── requirements.txt
├── pronunciaciones.json
├── .gitignore
├── .gitattributes
├── .env                      # local, nunca versionar
├── .repo-harness/            # manifest, checker, skills, prompts y reglas
├── .pi/                      # proyección de skills y prompts para Pi
├── src/
│   ├── tehablo_tui.py
│   ├── tehablo_tts.py
│   ├── tehablo_tech.py
│   ├── tehablo_numbers.py
│   ├── tehablo_lexicon.py
│   ├── tehablo_speed.py
│   └── tehablo_server.py
├── pi-extension/
│   └── tehablo-tts/          # extensión de Pi (TypeScript)
├── scripts/
│   └── get_voices.py
├── tests/
│   ├── test_tech.py
│   ├── test_numbers.py
│   ├── test_lexicon.py
│   ├── test_speed.py
│   ├── test_server.py
│   ├── test_tui_speed.py
│   ├── test_tui_smoke.py
│   └── test_tui_spanish_24l.py
├── samples/
│   └── prueba-larga.txt
├── docs/
│   ├── como-funciona.md
│   ├── pocket-tts.md
│   ├── pronunciacion.md
│   ├── voces-gratuitas.md
│   ├── catalogo-gratuito.md
│   ├── desarrollo.md
│   └── repo-harness/         # estado, decisiones, hoja de ruta y uso del harness
├── voices/
├── pocket-out/               # audio generado
└── .venv-pocket/
```

| Ruta | Propósito | ¿Versionar en Git? |
|---|---|---|
| `README.md`, `requirements.txt`, `.gitignore` | Guía, dependencias y exclusiones | Sí |
| `src/tehablo_tui.py` | Interfaz Textual | Sí |
| `src/tehablo_tts.py` | Consola simple | Sí |
| `src/tehablo_tech.py` | Lectura simplificada de URLs, rutas, archivos, identificadores y hashes antes del diccionario y los números | Sí |
| `tests/test_tech.py` | Casos de texto técnico sin modelo ni audio | Sí |
| `src/tehablo_numbers.py` | Conversión de números a palabras en español | Sí |
| `src/tehablo_lexicon.py`, `pronunciaciones.json` | Pronunciación de términos en inglés | Sí |
| `src/tehablo_speed.py` | Velocidad de la voz sin cambiar el tono (WSOLA con `audiotsm`) | Sí |
| `src/tehablo_server.py` | Servidor HTTP local (`127.0.0.1:8765`) que usa la extensión de Pi | Sí |
| `cliente/tehablo_cliente.py` | Cliente de audio SSH: espera conexiones en 127.0.0.1:18766 (RemoteForward), valida el código antes del WAV; menú, sounddevice y volumen (PEP 723, uv) | Sí |
| `receptor/` | Instaladores finos del cliente para [Audio por SSH](#audio-por-ssh); requieren uv, sin FFmpeg | Sí |
| `pi-extension/tehablo-tts/` | Extensión de Pi; se instala con `pi install <ruta>` (ver README) | Sí |
| `scripts/get_voices.py` | Descarga selectiva de voces | Sí |
| `tests/` | Pruebas ejecutables sin pytest | Sí |
| `samples/prueba-larga.txt` | Texto largo para `/leer` | Sí |
| `docs/` | Investigación y referencias | Sí |
| `LICENSE` | Licencia MIT del proyecto | Sí |
| `CHANGELOG.md`, `CONTRIBUTING.md` | Historial de cambios y cómo contribuir | Sí |
| `REPO-HARNESS.md`, `AGENTS.md` | Reglas para agentes de IA y su puntero | Sí |
| `.repo-harness/`, `.pi/prompts/`, `.pi/skills/repo-harness-*` | Harness de IA generado; `python .repo-harness/check.py` comprueba que esté al día | Sí |
| `.gitattributes` | Fija finales de línea LF en todos los archivos de texto, en Windows y Linux | Sí |
| `docs/repo-harness/` | Estado actual, decisiones, hoja de ruta y uso del harness | Sí |
| `voices/ATTRIBUTION.txt` | Atribución de las referencias descargadas | Sí |
| `voices/*.wav` | Referencias recreables con `scripts/get_voices.py` | No, ignoradas |
| `voices/*.safetensors` | Voces incluidas de la tabla, preparadas con `scripts/get_voices.py --prepare` (CC BY-SA 4.0) | Sí |
| `pocket-out/`, `*.mp3` | Audio generado | No, ignorados; excepciones: referencias `voices/*.mp3` y muestras `docs/samples/*.mp3` |
| `.env` | Secretos locales | No, ignorado |
| `.venv*/`, `__pycache__/` | Entornos y caché Python | No, ignorados |

La tabla indica qué se debe versionar.
Ejecute los comandos desde la raíz del repositorio. Las aplicaciones y los scripts
usan siempre la raíz para `.env`, `voices/` y `pocket-out/`, independientemente
del directorio de trabajo. `/leer` conserva las rutas relativas al directorio actual.

## Pruebas

`tests/test_install_voices.py` comprueba sin red ni audio la preparación de Pocket `spanish`, Lola y Rafael: ambos instaladores llaman a `scripts/prepare_pocket.py`, se reutiliza la caché de Hugging Face y los fallos no detienen las demás descargas. Necesita las dependencias Pocket instaladas:

```powershell
.venv-pocket/Scripts/python tests/test_install_voices.py
```

En Linux/macOS, usa `.venv-pocket/bin/python` con el mismo archivo de prueba.

`tests/test_tech.py`, `tests/test_numbers.py`, `tests/test_lexicon.py`, `tests/test_speed.py`, `tests/test_server.py`, `tests/test_startup.py`, `tests/test_console_imports.py`, `tests/test_quantize.py` `tests/test_cliente.py` y `tests/test_receptor.py` comprueban el texto técnico, la conversión de números, el diccionario de pronunciación, el cambio de velocidad, el servidor HTTP, los diagnósticos de arranque, la cuantización predeterminada y el cliente de audio por SSH (configuración, volumen, salidas, reconexión con audio falso en carpetas aisladas) y sus instaladores (uv falso; necesita `sh`) sin modelo ni audio; terminan con código 0 si todos los casos pasan:

```powershell
.venv-pocket/Scripts/python tests/test_tech.py
.venv-pocket/Scripts/python tests/test_numbers.py
.venv-pocket/Scripts/python tests/test_lexicon.py
.venv-pocket/Scripts/python tests/test_speed.py
.venv-pocket/Scripts/python tests/test_server.py
.venv-pocket/Scripts/python tests/test_startup.py
.venv-pocket/Scripts/python tests/test_console_imports.py
.venv-pocket/Scripts/python tests/test_quantize.py
.venv-pocket/Scripts/python tests/test_cliente.py
.venv-pocket/Scripts/python tests/test_receptor.py
```

En cada push, GitHub Actions (`.github/workflows/tests.yml`) ejecuta en Windows y Linux las 11 suites `test_tech.py`, `test_numbers.py`, `test_lexicon.py`, `test_speed.py`, `test_server.py`, `test_startup.py`, `test_console_imports.py`, `test_quantize.py`, `test_measure_tts.py`, `test_get_voices.py` y `test_listening_skill.py`, además de las de la extensión de Pi. `test_cliente.py`, `test_receptor.py` y `test_install_voices.py` se ejecutan manualmente. La CI no descarga modelos ni usa audio, así que no sustituye las pruebas de integración ni la escucha.

La extensión de Pi tiene sus pruebas con `node:test` (Node 24, sin dependencias):

```powershell
node --test pi-extension/tehablo-tts/test/*.test.ts
```

### Verificación en Fedora

Se restauró un entorno nativo conservando el anterior como `.venv-pocket-windows`.
Se comprobaron Python 3.12.15, pocket-tts 4.0.1, Torch 2.15.0+cpu,
sounddevice 0.5.6 y Node 25.9.0, con kernel `7.2.13-200.fc44.x86_64`.
Las 57 dependencias resultaron compatibles; esto no garantiza versiones futuras
dentro de los límites de `requirements.txt` ni una instalación limpia en cualquier equipo.

Para repetir las suites sin modelo ni audio desde la raíz:

```bash
.venv-pocket/bin/python tests/test_tech.py
.venv-pocket/bin/python tests/test_numbers.py
.venv-pocket/bin/python tests/test_lexicon.py
.venv-pocket/bin/python tests/test_speed.py
.venv-pocket/bin/python tests/test_server.py
.venv-pocket/bin/python tests/test_startup.py
.venv-pocket/bin/python tests/test_console_imports.py
.venv-pocket/bin/python tests/test_quantize.py
node --test pi-extension/tehablo-tts/test/*.test.ts
```

Todas pasaron en esa restauración del 2026-10-29 (servidor: 8 pruebas; Node: 12; hoy son más). Además, sondas reales con `spanish`
y `lola` generaron audio finito a 24 kHz; la salida predeterminada recibió 57599
fotogramas no nulos sin avisos en los callbacks. El transporte `ServerClient`
sin modificar eligió `.venv-pocket/bin/python` y completó arranque, reproducción,
pausa, continuación, parada y cierre del proceso propio. Una repetición con
`HF_HUB_OFFLINE=1` reutilizó el modelo en caché y entregó 67199 fotogramas no nulos;
esa variable no equivale a aislamiento de red completo.

Estas sondas no midieron audibilidad ni calidad mediante escucha o captura del
sonido del sistema. No verificaron la interfaz completa de Pi, la TUI ni
`spanish_24l`. Las suites anteriores no sustituyen esas comprobaciones reales.

### Pruebas de integración TUI

Las demás son scripts de integración de Textual, no pruebas de pytest. **Reproducen audio
por los altavoces** y requieren el entorno instalado, un dispositivo de salida
y los modelos/voces disponibles (la primera carga puede descargarlos).

```powershell
.venv-pocket/Scripts/python tests/test_tui_smoke.py
.venv-pocket/Scripts/python tests/test_tui_spanish_24l.py
.venv-pocket/Scripts/python tests/test_tui_speed.py
```

En Linux/macOS, use `.venv-pocket/bin/python` en todos los comandos.

- `tests/test_tui_smoke.py`: carga `spanish`, selecciona `rafael`, genera y guarda
  en `pocket-out/`. El registro debe incluir `listo:` y el guardado.
- `tests/test_tui_spanish_24l.py`: cambia a `spanish_24l`, pulsa F5 durante la carga
  y comprueba en el registro la reproducción pendiente y el rechazo de un segundo
  F5. Debe aparecer una sola línea `listo:` de audio y `model_name: spanish_24l`.
- `tests/test_tui_speed.py`: genera la misma frase a 1x y a 1,5x desde el selector
  de velocidad; termina con código 0 si el audio a 1,5x dura alrededor de 1,5 veces menos.

Los scripts imprimen los registros para inspección; su código de salida por sí
solo no acredita estos resultados.

---

## Arranque en Windows: mediciones y límites

### Comprobación manual y registro real

El propietario confirmó que toda la etiqueta responde al clic, incluidas letras
y espacios, y que apagar y volver a encender funciona en la misma sesión.
El propietario indicó que el primer arranque tardó más que el segundo, sin
medir sus duraciones. No es una pareja medida en frío/caliente ni necesariamente
el primer inicio tras arrancar Windows. No se estableció una causa relacionada con la caché.

Como antecedente, el README registraba una medición puntual del 2026-10-30:
el servidor en Windows tardó unos 5 s en responder, antes de cargar el modelo.
No es una comparación controlada con la siguiente medición.

Tras `/reload` y un arranque, el registro real mostró:

| Etapa o evento | Resultado observado |
|---|---|
| Importaciones del servidor | 0.240 s |
| Importaciones de TTS | 5.258 s |
| Escucha HTTP | `Listening on http://127.0.0.1:8765` |
| Carga del modelo `spanish` | 0.617 s |

Las tres etapas medidas suman **6.115 s**; no incluyen creación del proceso
Python, sondeo de la interfaz ni audio. No son el tiempo total hasta oír la voz.
El archivo `logs/tehablo-server.log` se sobrescribe en cada arranque; estos
resultados se conservan aquí para futuras comparaciones.

### Perfil de importaciones separado

Después se ejecutó una sonda de solo importación de `src/tehablo_tts.py` con
el Python de `.venv-pocket-windows`, opciones `-B -X importtime` y variables
`PYTHONDONTWRITEBYTECODE=1`, `HF_HUB_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1`.
Terminó con código 0, sin stderr ajeno al perfil, sin cargar modelos, descargar
ni reproducir audio. Sus tiempos acumulados fueron:

| Ruta importada | Acumulado |
|---|---|
| `torch` | 1.827688 s |
| `torch._inductor.cpp_builder` | 1.413053 s |
| `scipy.signal._support_alternative_backends` | 0.848566 s |
| `sounddevice` | 0.289156 s |

**Son acumulados anidados que se solapan: no se suman.** Este perfil separado
no atribuye exactamente los 5.258 s del registro anterior ni explica la diferencia
percibida entre arranques. La duración externa de un trabajo tampoco equivale
al tiempo exacto transcurrido dentro de Python.

### Importaciones exclusivas de consola

Una comparación separada con `.venv-pocket-windows/Scripts/python.exe -B`
midió tres parejas en procesos Python nuevos: antes, 6.838/5.634/5.874 s;
con `scipy.io.wavfile` diferido a `App.save` y `sounddevice` a `App.speak`,
5.468/5.114/5.537 s. La mediana de las diferencias por pareja fue 0.520 s;
las tres favorecieron el cambio. Se conserva únicamente esa modificación:
NumPy, Pocket TTS y sus dependencias internas permanecen intactos.

Se ejecutó el código original y el candidato en memoria, con el mismo nombre
`tehablo_tts`, ruta y `__file__`; el reloj cubrió compilación e importaciones,
no la creación del proceso. Se alternó el orden de las parejas, sin vaciar
cachés: no garantiza arranque en frío ni una mejora equivalente del servidor.
Ambas variantes omitieron solamente la llamada a `_load_dotenv` para no leer
secretos locales. Se usaron `PYTHONDONTWRITEBYTECODE=1`, `HF_HUB_OFFLINE=1`,
`HF_HUB_DISABLE_TELEMETRY=1` y `TRANSFORMERS_OFFLINE=1`, sin modelo ni audio.
La salida estándar, stderr vacío y código 0 de `--help` coincidieron en los
seis procesos. No son los 5.258 s del registro real anterior.

Seis pruebas de consola con modelo, dispositivo y escritura simulados verifican
importación diferida, guardado con/sin audio, muestras reproducidas, flujo vacío
e interrupción. La revisión final ejecutó juntas las seis de consola, seis de
arranque y las 18 de servidor: 30 pruebas aprobadas, sin exclusiones, con los
temporales dirigidos a `.repo-harness/tmp/`. También pasaron las tres de
cuantización en la comprobación del cambio. No se comprobó escucha física ni
se volvió a medir el arranque real del servidor.

En un arranque real posterior al cambio, el registro mostró 0.202 s de
importaciones del servidor, 5.588 s de TTS y 0.685 s de carga del modelo
(6.475 s entre las etapas medidas). No confirmó una aceleración frente a los
6.115 s anteriores. No es una comparación controlada ni demuestra por sí sola
una regresión; el ahorro del experimento de importación no se puede trasladar
al arranque real como resultado garantizado.

### Alcance y entorno

En el momento de estas mediciones, `.pi/settings.json` registraba la extensión local `../pi-extension/tehablo-tts`
y se usaba el entorno Python local existente. Desde el 2026-11-04 se instala con `pi install <ruta>/pi-extension/tehablo-tts`; el repositorio ya no la registra. No se inspeccionó el registro global:
estas mediciones no demuestran una instalación global faltante ni justifican
reinstalar. La importación diferida evaluada arriba no modifica la instalación. Los diagnósticos añadidos ocupan unas nueve líneas de
código, sin cambios de API, planificación, dependencias ni harness. La validación
comunicada para ese cambio fue de 6 pruebas de arranque y 18 de servidor;
no sustituye una comparación controlada de tiempos ni una prueba de escucha.

---

## Problemas conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| *"We could not download the weights for the model with voice cloning"* | Falta el token de Hugging Face | [Activar la clonación](#activar-la-clonación-de-voces-token-de-hugging-face) |
| Aviso de *symlinks* en Windows | La caché de Hugging Face no puede crear enlaces simbólicos | Inofensivo; solo usa algo más de disco. Se evita activando el Modo de desarrollador de Windows |
| No se puede pegar un texto largo en `src/tehablo_tts.py` | Límite de la consola de Windows | Usa `/leer archivo.txt` o la TUI |
| Error al cargar PortAudio en Linux | Puede faltar la biblioteca del sistema | Fedora: `sudo dnf install portaudio`; Debian/Ubuntu: `sudo apt install libportaudio2` (solo el de tu distribución) |
| Sin sonido, pero PortAudio carga | Puede ser el dispositivo seleccionado, el volumen o la ruta de salida del sistema | Revisa la salida predeterminada y el volumen; instalar PortAudio no resuelve todas las causas |
| Al cambiar de modelo había que pulsar Reproducir dos veces | El primer clic se descartaba mientras cargaba el modelo | **Corregido:** ahora queda en espera y suena en cuanto el modelo está listo |
| La primera ejecución tarda más de un minuto | Descarga del modelo | Solo pasa la primera vez |
| Las cifras como `15.000` sonaban incoherentes | Pocket TTS no convierte números a palabras | **Corregido:** `src/tehablo_numbers.py` los convierte antes de leer (solo con modelos en español) |
| Términos en inglés (`Python`, `YouTube`) leídos como español | El modelo usa reglas del español | **Corregido** para los términos de `pronunciaciones.json`; añade los que falten |
| Acento extranjero en español | Voz del catálogo no hispana | Usa `lola` o voces de `voices/` |

---

## Instalación manual

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

En Linux, instala PortAudio si falta, usando solo el comando de tu distribución:
```bash
sudo dnf install portaudio      # Fedora
sudo apt install libportaudio2  # Debian / Ubuntu
```

El entorno `.venv-pocket` no se puede copiar entre sistemas operativos: créalo en cada equipo. Con dual boot sobre la misma carpeta, deja un entorno por sistema: la extensión busca primero `.venv-pocket` y después `.venv-pocket-windows`, `.venv-pocket-linux` o `.venv-pocket-macos`, según el sistema (`Scripts/python.exe` en Windows, `bin/python` en Linux y macOS). Si no encuentra ninguno, el aviso muestra las rutas que probó. Ejecuta los comandos desde la raíz del repositorio.

Comprobación básica en Linux (importaciones y Torch sin CUDA; no prueba el audio):
```bash
.venv-pocket/bin/python -c 'import pocket_tts, sounddevice, torch; print(torch.__version__); assert torch.version.cuda is None'
```

La combinación comprobada en Fedora y los límites de la prueba están en [Desarrollo](desarrollo.md#verificación-en-fedora).

## Uso en Pi

Pi empieza con la voz marcada `"default": true` en [`src/voice_table.json`](../src/voice_table.json): hoy `lola` (Pocket `spanish`), la mejor que funciona gratis y sin cuenta. Si aparece una mejor que se pueda distribuir, se cambia esa marca. La voz que elijas en la ventana de ajustes se guarda, y el servidor arranca directamente con ella en las sesiones siguientes.

Phonon 40M es (`Regina`, `Iker`) es opcional. Sus pesos son **CC BY-NC 4.0** (no comercial) y requieren una cuenta gratis de Hugging Face, aceptar las condiciones en <https://huggingface.co/gradium/phonon-40m-es> y un token para la primera descarga: la ventana `[ ≡ ]` lo pide al elegir una de esas voces (o usa `hf auth login`). Token recomendado: *Fine-grained* con el preset **Read-Only** (solo lectura: no puede escribir ni borrar); el permiso que usa la descarga es *Read contents of gated repos you can access*. No hace falta *Write*, *Inference* ni *Full Access*. Ya descargado, funciona desde caché sin token. Si eliges Phonon y falta el paquete, el acceso o la caché, el servidor registra el motivo y usa Pocket `spanish` con `lola`; Pi avisa qué voz no cargó, y `/health` muestra el modelo real y esa voz en `fallback`.

La voz se elige en la ventana (`[ ≡ ]` o `/tts menu`); cada voz ya trae su modelo. El servidor acepta `--model` y `--voice`. Las voces de `voices/` solo son para Pocket.

La extensión [`pi-extension/tehablo-tts/`](../pi-extension/tehablo-tts/) lee las respuestas finales del agente con la voz local. Se instala una vez para todos tus proyectos con la ruta absoluta de esa carpeta; Pi la usa desde ahí, sin copiarla, porque necesita el servidor y el entorno de este repositorio:

```bash
pi install E:\ruta\a\tehablo\pi-extension\tehablo-tts   # Windows
pi install /ruta/a/tehablo/pi-extension/tehablo-tts       # Linux / macOS
```

Después abre Pi o ejecuta `/reload`. `pi list` la muestra y `pi remove <ruta>` la quita. Si usas `gentle-shell` por separado (con su propia carpeta), instálala ahí con `gentle-shell install <ruta>`. Al terminar, `install.sh` e `install.ps1` muestran los dos comandos con la ruta de tu equipo.

### Barra de controles

| Estado | Barra |
|---|---|
| Apagado | `[ ⏻ TTS ] [ ≡ ]` |
| Cargando | `[ Cargando… ] [ ≡ ]` |
| Listo | `[ ▶ ] [ ▶ copiado ] [ ≡ ] [ ⋯ ]` |
| Controles abiertos | `[ ▶ ] [ ▶ copiado ] [ ≡ ] [ → ] :  [ ⏻ ]  Vol [- 100% +]  Vel [- 1.10x +]  [ ✗ auto ]` |
| Sonando | `[ ‖ ] [ ■ ] [ ≡ ] [ ⋯ ]` |
| En pausa | `[ ▶ ] [ ■ ] [ ≡ ] [ ⋯ ]` |
| Preparando copiado | `[ ■ ] Preparando… [ ≡ ] [ ⋯ ]` |
| En espera | `[ ■ ] En espera [ ≡ ] [ ⋯ ]` |

Significado de los iconos (aunque se vean como cuadros):

| Icono | Significado |
|---|---|
| `⏻ TTS` | Encender TTS |
| `▶` | Leer o continuar |
| `▶ copiado` | Leer el texto copiado |
| `‖` | Pausar |
| `■` | Detener o cancelar la lectura en espera |
| `⋯` | Abrir controles |
| `→` | Cerrar controles |
| `⏻` | Apagar el servidor |
| `≡` | Abrir o cerrar ajustes |
| `✗ auto` / `✓ auto` | Lectura automática desactivada / activada |

- `[ ▶ ]` lee esa respuesta; en pausa, continúa. `[ ‖ ]` y el botón de continuar solo actúan sobre tu lectura actual, nunca la de otra sesión. `[ ■ ]` detiene solo las lecturas de esa respuesta (la que suena y las que esperan); si hay otra en espera, empieza. `/tts stop` y el atajo de detener cancelan solo tus lecturas, actuales y en espera.
- `[ ⋯ ]` abre volumen y velocidad; `[ → ]` los oculta. `[ ≡ ]` abre ajustes antes de `[ ⋯ ]` en la barra cerrada y antes de `[ ⏻ ]` en la abierta, también en modo Texto.
- Con varias sesiones de Pi abiertas, todas usan el mismo servidor: encenderlo o apagarlo en una lo hace en todas, y la barra de las demás lo muestra en unos segundos. Cada lectura nueva decide si interrumpe o espera, según sus ajustes. Empezar otro turno o cerrar la sesión cancela solo sus lecturas, sin vaciar la cola de otras sesiones. El [ciclo del servidor](#servidor-y-ajustes-guardados) detalla el apagado por inactividad.
- Antes de la primera respuesta, la barra aparece sobre el editor: con el servidor encendido y audio local, muestra `TTS` sin acción en el lugar del botón de leer respuesta, con el mismo ancho para que los botones no se muevan al llegar la respuesta. En Audio: SSH muestra `TTS SSH [ ≡ ] [ ⋯ ]`; apagada, `[ ⏻ TTS SSH ] [ ≡ ]` (mismas posiciones en modo Texto).


  Los avisos cortos (barra visible, indicador, lectura automática, Dict, «Suena la lectura en espera.») aparecen unos 4 s al final de la barra, abierta o cerrada, en gris tenue y como `// Barra visible.`, sin ocupar otra línea. Con la barra oculta salen como aviso normal con «TTS teHablo: ». Los errores, los usos incorrectos y `/tts status` siempre salen como aviso normal.

  **`[ ⏻ TTS ]`** arranca el servidor y carga el modelo antes de escuchar; mientras tanto, la barra de estado muestra `TTS manual · cargando`; con el servidor apagado muestra `TTS off`, y luego `TTS manual` o `TTS auto`. Las pruebas de código cubren clics en toda su superficie (corchetes, símbolo, letras y espacios normales); la persona responsable confirmó el clic físico en toda la etiqueta en Windows y en el corchete y las letras en Linux, y apagar y volver a encender en ambos. `[ ▶ ]`, `[ ▶ copiado ]`, `/tts play` y el modo automático también lo arrancan si hace falta.
- **Volumen y velocidad:** `[ ⋯ ]` muestra **Vol** (10–150 %, pasos de 10 %, inicial 100 %) y **Vel** (0.50x–1.50x, pasos de 0.05x, inicial 1.00x) en todas las barras; `[ → ]` los oculta. `[-` baja y `+]` sube, con clics. Las flechas de **Volumen** y **Velocidad** en `/tts menu` usan los mismos pasos y muestran el valor guardado. Todas las voces suenan más fuerte que antes: el servidor sube la salida ×1,8 (elegido por escucha) y corrige cada voz de la tabla para que suenen parecido (`gain_db` en `src/voice_table.json`); los picos fuertes se redondean en lugar de recortarse. El volumen cambia incluso el audio en reproducción; la velocidad afecta a los siguientes trozos generados, no al audio ya almacenado. Los límites se mantienen sin error.
- **Apagar y liberar el modelo:** `[ ⏻ ]` aparece solo en los controles abiertos, después de `[ ≡ ]`. Detiene la lectura y cierra el servidor compartido para liberar sus recursos; los ajustes guardados se mantienen. `[ ⏻ TTS ]` permite encenderlo otra vez sin cerrar Pi. No equivale a `[ ■ ]` (solo detener) ni a `/tts toolbar` (ocultar la barra). `/tts` hace lo mismo que `[ ⏻ TTS ]` y `[ ⏻ ]`: enciende o apaga el servidor.
- **Lo copiado:** lee el portapapeles donde corre Pi; en Linux sin escritorio (por ejemplo, un servidor SSH) el botón no aparece. Pi no ve lo que seleccionas con el ratón (esa selección es de la terminal), así que primero cópialo (`Ctrl+Shift+C` en la terminal) y pulsa `[ ▶ copiado ]`: lo lee en esa barra, con pausa y detener. No añade dependencias: usa `Get-Clipboard` en Windows, `pbpaste` en macOS y `wl-paste` (paquete `wl-clipboard`) o `xclip` en Linux; si falta, lo avisa.
- **Automático:** `/tts auto` o el botón `[ ✗ auto ]` / `[ ✓ auto ]` de los controles abiertos activan o desactivan la lectura de cada respuesta al terminar (si el servidor está apagado, lo enciende). El botón es también el indicador: `✓` activa, `✗` apagada (por defecto). Con los controles cerrados, la barra muestra `auto` al final solo mientras está activa, y un clic en esa palabra la desactiva. Apagar el servidor también vuelve al modo manual; reiniciarlo no.
- **Ventana de ajustes `[ ≡ ]`:** visible también con los controles cerrados, antes de `[ ⋯ ]`, y antes de `[ ⏻ ]` con los controles abiertos. Pulsar `[ ≡ ]` con la ventana abierta la cierra. Abre una ventana centrada que se usa con clics o con el teclado (↑↓ elegir, ←→ cambiar, Enter, Esc cerrar):
  - **Voz** y `[ Cambiar ]`: una tabla con *Voz*, *Estado* (descargada, para descargar o con cuenta) *RAM aprox.* (lo que ocupa aproximadamente el modelo de esa voz: ~0,3 GB Phonon, ~1 GB Pocket) y *Dict* (si se aplica el diccionario de pronunciación `pronunciaciones.json` a esa voz: un clic en «sí»/«no» o ←→ sobre la fila lo cambia y se guarda; es el mismo ajuste que `/tts dict`); la voz activa lleva `●` y se ve en amarillo. Primero las descargadas, luego las que se descargan sin cuenta y al final las que piden una cuenta gratis de Hugging Face (Phonon), marcadas con `*`. Al elegir una de cuenta sin token, la ventana muestra los 4 pasos (un clic en cada dirección la abre en el navegador) y un campo para pegarlo (se ve como `•••`). El token no se guarda en ningún archivo: solo hace falta para descargar la voz, así que queda en memoria durante esa sesión de Pi y el servidor se reinicia para usarlo; ya descargada, la voz funciona sin él. Un `HF_TOKEN` en el entorno o en `.env` también sirve. Al abrir la ventana con el servidor apagado o cargando, el estado de cada voz se actualiza solo cuando el servidor está listo.
  - **Volumen**, **Velocidad** y **Lectura automática**.
  - **Si llega otra lectura: Detener / Esperar**: interrumpir o poner en cola ([detalle](#cola-de-lecturas)).
  - **Barra de controles**: mostrar u ocultar, como `/tts toolbar`.
  - **Iconos: Símbolos / Texto**: símbolos por defecto; Texto usa etiquetas ASCII para terminales que muestran cuadros. Cambia con clic, ←→ o Enter, se guarda en `icons` (`symbols` / `text`) y redibuja las barras inmediatamente. Se comparte entre sesiones como los demás ajustes; un archivo antiguo sin la clave o un valor inválido usa `symbols`.
  - **Atajos de teclado**: activarlos y `[ Editar ]` para asignar Ctrl o Alt + letra o número a encender/apagar, lectura automática, escuchar, pausar/seguir, detener, abrir ajustes y leer lo copiado. No acepta combinaciones que ya usa Pi.
  - **Servidor**: `[ Encender ]` (con `[ Reiniciar ]` en gris) o `[ Apagar ]` y `[ Reiniciar ]`.

### Comandos

| Comando | Acción |
|---|---|
| `/tts` | Enciende o apaga el servidor para todas las sesiones; apagar desactiva la lectura automática |
| `/tts auto` | Activa o desactiva la lectura de cada respuesta al terminar; al activarla enciende el servidor. En los controles abiertos, el botón `[ ✗ auto ]` / `[ ✓ auto ]` hace lo mismo y muestra el estado; con la barra cerrada, `auto` aparece al final mientras está activa y un clic lo desactiva |
| `/tts play [n]` | Lee la última respuesta o la número `n` de la sesión, contando desde la primera |
| `/tts copy` | Lee el texto copiado |
| `/tts pause` | Pausa o continúa solo la lectura actual de esta sesión, igual que el atajo de pausa |
| `/tts stop` | Detiene las lecturas de esta sesión, actuales y en espera; conserva las de otras sesiones |
| `/tts toolbar` | Muestra u oculta la barra y recuerda la elección; no desactiva la lectura ni los atajos |
| `/tts indicator` | Muestra u oculta el indicador de estado (TTS off, TTS manual, TTS auto) en la barra lateral o el pie de Pi; se recuerda y se comparte entre sesiones |
| `/tts menu` | Abre los ajustes |
| `/tts dict` | Activa o desactiva el diccionario de pronunciación para la voz actual y lo recuerda |
| `/tts status` | Muestra el estado y la ayuda (código oculto) |
| `/tts codigo` | Muestra el código para vincular el cliente de la PC por SSH; no lo compartas |
| `/tts ayuda` | Muestra la ayuda, un comando por línea con su explicación |

Los argumentos de `/tts` se autocompletan con sus explicaciones, incluida `ayuda`. Un comando no reconocido muestra un aviso «Comando no reconocido: /tts …» seguido de la misma ayuda que `/tts ayuda` y `/tts status`.

### Ajustes `[ ≡ ]` (menú)

La navegación con **↑↓** es circular en el menú principal y las listas de voces, atajos y dispositivos: desde el primero, **↑** lleva al último; desde el último, **↓** vuelve al primero. Moverse no aplica ninguna selección. Al volver de un submenú, queda seleccionada la opción del menú principal desde la que entraste.

Elige **Audio: Local / SSH**, **Salida: nombre / Predeterminada** (en Local; en SSH se elige en el cliente), **voz**, **volumen**, **velocidad**, **lectura automática**, **atajos de teclado** e **indicador de estado**, o enciende, apaga y reinicia el servidor. Usa clics o ↑↓, ←→, Enter y Esc.

En **Salida**, pulsa **Enter** o haz clic en el nombre para abrir la lista: **↑↓** mueve la selección, **Enter** la aplica y vuelve, y **Esc** cancela sin cambiarla. **←→** en la fila principal sigue cambiando la salida como antes.

Los dispositivos se consultan al abrir los ajustes, incluso con el TTS apagado, sin arrancar la síntesis. En el submenú, **Refrescar (R)** vuelve a consultar las listas filtrada y completa; úsalo después de conectar o desconectar una salida. La consulta no interrumpe una lectura ni cambia la salida elegida.

La lista de **Salida** usa de inicio el mismo filtro que el cliente SSH: salidas de la API de audio predeterminada, sin duplicados. En el submenú, **Mostrar ocultos** permite ver también las salidas de las otras API; pulsa **Tab** y **Enter**, o haz clic, para alternarlo. Solo cambia la lista, no la salida elegida, y se restablece al cerrar los ajustes. El nombre guardado se conserva aunque no figure en la lista; los nombres largos se acortan solo en pantalla.

Si la **Salida** elegida no está conectada, la lectura usa la predeterminada del sistema y Pi muestra un aviso. La elección se conserva: al reconectar el dispositivo, vuelve a usarse en la siguiente lectura. En Windows no cambia de salida a mitad de una lectura; en Linux (Fedora), el sistema puede migrar la salida mientras está sonando. Con **Predeterminada**, cada lectura usa la salida predeterminada actual.


### Servidor y ajustes guardados

La extensión arranca sola el servidor local [`src/tehablo_server.py`](../src/tehablo_server.py) (`127.0.0.1:8765`, se cambia con `TEHABLO_PORT`) y no lo apaga al cerrar o recargar una sesión de Pi: solo cancela sus lecturas. El servidor se apaga solo tras unos 30 s sin peticiones de ninguna sesión; `[ ⏻ ]` o `/tts` lo apagan para todas. En ejecuciones manuales, `--idle-exit SECONDS` cambia ese plazo (30 por defecto; `0` lo desactiva). Necesita el entorno `.venv-pocket` (o `.venv-pocket-<sistema>`) instalado. Los ajustes se guardan en tu carpeta de usuario, `~/.tehablo/settings.json` (`C:\Users\<usuario>\.tehablo\settings.json` en Windows), así que cada usuario y cada sistema de un dual boot tiene los suyos; se comparten entre sesiones y se actualizan en unos segundos, incluido el indicador de estado; la lectura automática es por sesión y no se guarda. La primera vez se parte del antiguo `tehablo-settings.json` del proyecto, si existe, sin cambiarlo. Los mensajes y errores del servidor se guardan en `logs/tehablo-server.log`, que se reescribe en cada arranque; si el servidor no responde a tiempo, el aviso indica esa ruta. Si el modelo no carga, Pi muestra el error en lugar de quedarse en «cargando»; también avisa si una lectura falla (por ejemplo, sin dispositivo de audio) o si se pierde la conexión con el servidor. La selección y recuperación de dispositivos se describe en [Uso en Pi](#uso-en-pi). Por seguridad, el servidor rechaza peticiones de páginas web (cabecera `Origin`, 403) y los `POST` que no declaran JSON (415).

El registro incluye líneas `Startup:` con segundos por etapa: importaciones del servidor, importaciones de TTS y carga del modelo (sin repetir el tiempo de importación de TTS). Sirven para comparar próximos arranques, no para diagnosticar retrospectivamente la demora ni atribuirla a la caché. No miden la creación del proceso Python ni el inicio de la reproducción. Guarda el registro antes de volver a arrancar: se sobrescribe. Las [mediciones de arranque en Windows y sus límites](desarrollo.md#arranque-en-windows-mediciones-y-límites) quedan documentadas para futuras comparaciones.

### Iconos en modo texto

Solo cambia las etiquetas de la barra, no los controles ni los avisos `// texto`. La ventana de ajustes conserva su presentación habitual. Antes de la primera respuesta, con audio local, `TTS` ocupa el mismo ancho que `[ |> ]`, igual que en el modo Símbolos con `[ ▶ ]`.

| Estado | Barra en Texto |
|---|---|
| Apagado | `[ TTS ] [ = ]` |
| Cargando | `[ Cargando... ] [ = ]` |
| Listo, cerrada | `[ \|> ] [ \|> copiado ] [ = ] [ ... ]` |
| Listo, abierta | `[ \|> ] [ \|> copiado ] [ = ] [ <- ] :  [ off ]  Vol [- 100% +]  Vel [- 1.00x +]  [ x auto ]` |
| Sonando, cerrada | `[ \|\| ] [ [] ] [ = ] [ ... ]` |
| Sonando, abierta | `[ \|\| ] [ [] ] [ = ] [ <- ] :  [ off ]  Vol [- 100% +]  Vel [- 1.00x +]  [ v auto ]` |
| En pausa, cerrada | `[ \|> ] [ [] ] [ = ] [ ... ]` |
| Preparando | `[ [] ] Preparando... [ = ] [ ... ]` |
| En espera (cola) | `[ [] ] En espera [ = ] [ ... ]` |
| Auto activo, cerrada, con aviso | `[ \|> ] [ \|> copiado ] [ = ] [ ... ] auto  // Lectura automática: sí` |

`[ x auto ]` indica lectura automática desactivada; `[ v auto ]`, activada, tanto en reposo como durante una lectura. Toda la etiqueta, incluidos espacios y corchetes, responde al clic.

### Cola de lecturas

**Si llega otra lectura** permite elegir **Detener** (predeterminado: corta la actual y reproduce la nueva, sin borrar la cola) o **Esperar** (guarda hasta 10 lecturas, en orden de llegada, sin generar su audio todavía; suena un bip suave sobre la lectura actual al entrar otra en la cola, y una pausa de unos 0,6 s seguida del mismo bip y «Siguiente lectura.» con la misma voz antes de empezar cada lectura en espera). Se aplica a `[ ▶ ]`, `[ ▶ copiado ]`, `/tts play [n]`, `/tts copy` y al modo automático, también entre sesiones. Si llega una lectura con **Esperar** y la actual está en pausa, se cancela la pausada y su tarjeta vuelve a `[ ▶ ]`: empieza la primera que ya esperaba, o la nueva si no había cola, con la misma pausa, bip y «Siguiente lectura.». La nueva queda al final si había otras esperando. **Detener** no cambia. Una lectura en espera comienza cuando termina, se cancela o falla la actual; al empezar una de esta sesión, Pi avisa: «TTS teHablo: Suena la lectura en espera.». Si la cola está llena, muestra una advertencia.

Pausa, continuar, detener, `/tts stop`, los atajos y cerrar la sesión actúan sobre sus propias lecturas; apagar el servidor afecta a todas. Véase el [alcance de los controles en Pi](#uso-en-pi).

## Audio por SSH

Pi y teHablo corren en el servidor; el **cliente teHablo** reproduce la voz en tu computadora. Usa **uv** para ejecutar Python con sounddevice; no necesita FFmpeg. En esa computadora, ejecuta:

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/LCubero/tehablo/master/receptor/install.ps1 | iex
```

**Linux / macOS:**
```sh
curl -fsSL https://raw.githubusercontent.com/LCubero/tehablo/master/receptor/install.sh | sh
```

Si falta uv, muestra el comando oficial para instalarlo y se detiene sin cambios. Después abre un menú en la terminal que se usa con el ratón o el teclado: recepción on/off, salida de audio, volumen, vincular servidor (código de `/tts codigo`), conectar la voz por SSH, desinstalar y salir. Muestra «Listo para recibir» / «Recibiendo voz»; los ajustes se guardan en `~/.tehablo/cliente.json`. La voz solo llega mientras el cliente está abierto.

**Conexión SSH** lista tus sesiones abiertas, sin leer `~/.ssh/config`; **Otra…** permite pegar tu comando. Primero intenta abrir un canal oculto con los mismos datos de conexión, sin editar archivos ni reconectar Pi. Si SSH pide contraseña o la frase de tu clave, el cliente la pide en un campo oculto y abre el canal con el mecanismo estándar de OpenSSH (`SSH_ASKPASS`, OpenSSH 8.4 o más; en Windows, 8.6 o más): no se guarda ni se escribe en ningún archivo, y se prueba una sola vez por intento. **Esc** muestra el comando para otra terminal. Si hay que confirmar la huella del servidor, o tu OpenSSH es más antiguo, muestra directamente ese comando; teHablo nunca acepta claves de servidor automáticamente.

Deja esa terminal abierta mientras quieras oír la voz; **Ctrl+C** cierra el canal. El menú sigue disponible y la sesión original de Pi permanece abierta. **Canal SSH en ejecución** solo indica un proceso abierto, no autenticación ni reenvío confirmados; **Recibiendo voz** indica recepción real. El canal oculto permite **Detener voz** desde el menú. Salir o desinstalar cierra el canal propio. Las sesiones que ya llevan la voz no abren otro.

Si tienes Python de [python.org](https://www.python.org/downloads/) (3.10 o más), el cliente lo usa; si no, `uv` descarga uno. En Windows, el lanzador del Python de `uv` no lleva firma digital y algunos antivirus (por ejemplo Norton CyberCapture) lo analizan cada vez que abres el cliente; con el Python oficial (`winget install Python.Python.3.13`) el lanzador va firmado.

`RemoteForward 18766 127.0.0.1:18766` lleva cada lectura al receptor, que espera en 127.0.0.1:18766 sin sondeos ni tráfico en reposo.
Viaja cifrada por tu conexión SSH; el puerto remoto escucha en loopback por defecto (no cambies `GatewayPorts`). Este reenvío no permite controlar teHablo ni el servidor desde tu computadora.
El receptor exige un código: en Pi elige **Audio: SSH** y ejecuta `/tts codigo`, o en `/tts menu`, a la derecha de **Audio: SSH**: **Ver** lo muestra en su ventana y **Copiar** copia el código sin mostrarlo. Al elegir una conexión SSH sin código asociado, el cliente lo pide oculto antes de abrir el canal (también si esa sesión ya tiene reenvío); si el servidor no reconoce el código guardado de esa conexión (por ejemplo, un servidor reinstalado en la misma dirección), lo vuelve a pedir. Recuerda el usuario, destino literal y puerto; no resuelve alias ni lee la configuración SSH. **Vincular servidor** permite cambiar el código de la conexión seleccionada; sin selección añade un código general, igual que `uv run cliente/tehablo_cliente.py --codigo CODIGO`. Mientras el canal propio está en ejecución, solo se acepta el código de esa conexión; en modo manual se acepta la lista guardada. Al cambiar un código se elimina el anterior solo si ninguna otra conexión ni vinculación general lo usa; los códigos guardados antes de este cambio se conservan como generales. Sin él muestra «Sin vincular» y no reproduce. El código se guarda en `~/.tehablo/ssh-codigo` en el servidor (0600 en POSIX); quien lo conozca, incluido un administrador, puede enviar sonido. El mismo código también protege la API HTTP local de teHablo.
Si conservas `LocalForward 18765 127.0.0.1:8765`, ya no hace falta: puedes quitarlo a mano; el cliente nunca lo borra.

En Pi, elige **Audio: SSH**. La guía de instalación aparece solo hasta que un cliente se autentique por primera vez; después, al activarlo, solo confirma «Audio por SSH activado.». Si falla, se detiene esa lectura y Pi dice la causa: «Sin cliente de audio por SSH: abre el cliente en tu computadora y elige esta sesión SSH.» (no contestó ningún cliente), «El cliente de tu computadora no está vinculado con este servidor: …» (el código no coincide; usa **Vincular servidor**) o «Se cortó el audio por SSH: revisa el cliente en tu computadora.». Mantén abierto el cliente mientras quieras oír la voz. Desde un clon: `./install.sh --cliente` o `.\install.ps1 -Cliente` (también aceptan `--receptor` / `-Receptor`). La salida y el volumen del cliente son independientes de los de Pi.

### Hacerlo a mano

1. En tu computadora, instala [uv](https://docs.astral.sh/uv/getting-started/installation/) y abre el cliente: `uv run cliente/tehablo_cliente.py` desde el clon. En Linux puede hacer falta PortAudio (`sudo apt install libportaudio2` o `sudo dnf install portaudio`).
2. En **otra terminal de tu computadora**, abre el canal; sustituye usuario/servidor y conserva tus opciones habituales (`-p`, `-i`, `-J`):
   ```sh
   ssh -N -R 18766:127.0.0.1:18766 usuario@servidor
   ```
   **Lo hago a mano** (o el fallo de autenticación del canal oculto) muestra el comando de la conexión seleccionada, sin comando remoto; en Windows, cópialo en **PowerShell**. No hace falta editar la configuración SSH.
3. En Pi (servidor), elige **Audio: SSH** y ejecuta `/tts codigo` (o **Copiar** junto a **Audio: SSH** en `/tts menu`). En el cliente, usa **Vincular servidor**: este código de voz no es la contraseña SSH.
4. Tras la contraseña, esa terminal no muestra nada más: es normal, el canal está abierto. Deja abiertos el cliente, esa terminal y tu sesión de Pi. **Ctrl+C** en la terminal del canal lo cierra.

PuTTY: **Connection › SSH › Tunnels** → Source port `18766`, Destination `127.0.0.1:18766`, **Remote**, **Add**. En Termius/MobaXterm, crea el mismo reenvío remoto. Si prefieres un reenvío fijo, puedes añadir tú `RemoteForward 18766 127.0.0.1:18766` bajo tu `Host` en `~/.ssh/config`; el cliente no lee ni modifica ese archivo.

Para desinstalar desde un clon: `sh receptor/install.sh --uninstall` o `.\receptor\install.ps1 -Uninstall`. Sin clon, vuelve a descargar el script y pásale `--uninstall` (`sh -s -- --uninstall`) o `-Uninstall` (`& ([scriptblock]::Create((irm https://raw.githubusercontent.com/LCubero/tehablo/master/receptor/install.ps1))) -Uninstall`). Quita a mano la línea `RemoteForward 18766 127.0.0.1:18766` del Host correspondiente en `~/.ssh/config`.

Solo para la extensión de Pi: no cubre TUI ni consola, no funciona con mosh ni teléfonos. Necesita SSH con reenvío de puertos permitido y el puerto 18766 libre en ambos extremos. macOS está escrito pero no probado.

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

| Nombre | Modelo en Pi | Peso de la voz | RAM en uso | Disponibilidad | Licencia de pesos / voz |
|---|---|---|---|---|---|
| [`lola`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/lola.mp3) (inicial), [`rafael`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/rafael.mp3) | Pocket `spanish` | Lola 5,3 MB; Rafael 6,0 MB | ~1 GB | Las descarga el instalador, sin cuenta | CC BY 4.0 (Kyutai; origen de las grabaciones sin verificar) |
| [`Facundo`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Facundo.mp3), [`Santiago`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Santiago.mp3) (Argentina) | Pocket `spanish` | 9,2–11,5 MB | ~1 GB | Incluidas en el repositorio | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Camila`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Camila.mp3), [`Javiera`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Javiera.mp3), [`Diego`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Diego.mp3) (Chile), [`Felipe`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Felipe.mp3) (Colombia) | Pocket `spanish` | 9,2–11,5 MB | ~1 GB | Incluidas en el repositorio | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Regina`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Regina.mp3) (México), [`Iker`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Iker.mp3) (España) | Phonon 40M es | 0,25 MB cada una, dentro del modelo | ~0,3 GB | Descarga gratis al elegirlas, con cuenta¹ | CC BY-NC 4.0: no comercial |

¹ Phonon necesita una cuenta gratis de Hugging Face.

El modelo se descarga una vez y lo comparten todas sus voces: Pocket `spanish` 209 MB (instalador), Phonon 72 MB (al elegirlo). Pesos medidos en Docker el 2026-11-07; RAM medida en Fedora.

Haz clic en un nombre para escuchar una muestra de unos 6 s (archivos en [`docs/samples/`](samples/), con el mismo volumen que en Pi).


| Tipo | Cuáles | ¿Necesita token? |
|---|---|---|
| **Catálogo** incluido | `lola` (única nativa en español), `rafael` y unas 25 más con timbre de otros idiomas | No |
| **Incluidas** en `voices/` | `Facundo`, `Santiago` (Argentina), `Camila`, `Javiera`, `Diego` (Chile) y `Felipe` (Colombia), elegidas por escucha (CC BY-SA 4.0, ver `voices/ATTRIBUTION.txt`) | No |
| **Referencias WAV** en `voices/` | Argentina, Chile y Colombia, mujer y hombre (`scripts/get_voices.py`), para crear otras voces | Para clonarlas, no para descargarlas |
| **Propias** | Cualquier `.wav`, `.mp3` o `.flac` limpio de 10 a 30 s en `voices/` (F8 para recargar) | Sí |

> ⚠️ Clona solo voces que tengas permiso para usar. `cosette` del catálogo es solo para uso no comercial.

Listado y licencias: [docs/pocket-tts.md](pocket-tts.md#7-catálogo-de-voces-predefinidas). Más fuentes: [docs/voces-gratuitas.md](voces-gratuitas.md).

### Activar la clonación de voces (token de Hugging Face)

1. Crea una cuenta gratuita en <https://huggingface.co> y acepta las condiciones en <https://huggingface.co/kyutai/pocket-tts>.
2. Crea un token **Read** en <https://huggingface.co/settings/tokens>.
3. Ejecuta `.\.venv-pocket\Scripts\hf auth login` y pega el token, o añade `HF_TOKEN=hf_...` a `.env`.

Solo hace falta para la primera descarga; después funciona sin internet.

Las voces incluidas ya vienen procesadas en `voices/<nombre>.safetensors` (unos 11 MB cada una): cargan al instante y no piden token. Solo para recrearlas desde los WAV hace falta el token: `python scripts/get_voices.py` descarga las referencias y `python scripts/get_voices.py --prepare` las vuelve a preparar.

## Qué se puede agregar, modificar o aprovechar

**Sin tocar código:**
- **Pronunciación de términos en inglés:** edita [`pronunciaciones.json`](../pronunciaciones.json) (`"Python": "páiton"`). Incluye Git y Pi (`feat`, `master`, `origin`, `pi-tts`); se recarga solo. Cómo escribir cada entrada: [docs/pronunciacion.md](pronunciacion.md).
- **Texto técnico en español:** las URLs se leen como «enlace a dominio», las rutas solo por su último segmento y los archivos con su extensión; una barra entre palabras se lee «eslash» (`on/off`). Identificadores como `RH-W-0001` se deletrean y los hashes de commit se omiten. Los separadores (`+++`, `===`) no se leen, y las flechas (`→`, `->`, `=>`) y los paréntesis se convierten en una pausa corta. Los símbolos se leen: `=` «igual a», `<` «menor que», `>=` o `≥` «mayor o igual que», `≈` o `~14` «aproximadamente», `1,7×` «veces», `3×4` «por», y `#350` se lee «número 350». En Pi, las tablas se leen fila por fila (celdas separadas por pausas) y los puntajes como `53/53` se leen «53 de 53». Las unidades tras un número se leen completas: tiempo (`ms`, `s`, `min`, `h`), longitud (`m`, `km`, `in`, `ft`), superficie (`m²`, `m2`, `ha`), volumen (`l`, `ml`, `cc`, `gal`), peso (`kg`, `lb`, `ton`), velocidad (`km/h`, `MB/s`), datos (`MB`, `GiB`, `Mbps`), frecuencia (`GHz`), electricidad (`V`, `mA`, `kWh`), presión (`hPa`, `bar`, `psi`), sonido (`dB`), energía (`kcal`) y pantalla (`px`, `fps`), con «un/una» y femenino donde toca («una hora», «doscientas kilocalorías»). Todo esto ocurre antes de aplicar el diccionario y los números.
- **Voces nuevas:** copia grabaciones en `voices/`, o descarga más con `scripts/get_voices.py --speakers 5`.
- **Calidad:** prueba `spanish_24l`, o una referencia de voz más limpia.

**Con código, ideas documentadas:**
- Siglas en el conversor de números, pausas exactas.
- Lista completa con esfuerzo estimado: [docs/pocket-tts.md](pocket-tts.md#12-catálogo-de-mejoras-posibles).
- Otros motores y recursos gratuitos: [docs/catalogo-gratuito.md](catalogo-gratuito.md).
