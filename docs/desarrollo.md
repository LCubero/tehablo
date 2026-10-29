# Desarrollo: archivos, pruebas, problemas conocidos y licencias

Detalle para quien trabaja en el código de tehablo. La guía de uso está en el [README](../README.md).

1. [Alternativas locales evaluadas](#alternativas-locales-evaluadas)
2. [Licencias y atribución](#licencias-y-atribución)
3. [Archivos del proyecto](#archivos-del-proyecto)
4. [Pruebas](#pruebas)
5. [Problemas conocidos](#problemas-conocidos)

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

El código de tehablo se distribuye bajo la licencia [MIT](../LICENSE). Los componentes de terceros conservan sus propias licencias:

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
| `pi-extension/tehablo-tts/`, `.pi/settings.json` | Extensión de Pi y su carga en este proyecto | Sí |
| `scripts/get_voices.py` | Descarga selectiva de voces | Sí |
| `tests/` | Pruebas ejecutables sin pytest | Sí |
| `samples/prueba-larga.txt` | Texto largo para `/leer` | Sí |
| `docs/` | Investigación y referencias | Sí |
| `LICENSE` | Licencia MIT del proyecto | Sí |
| `CHANGELOG.md`, `CONTRIBUTING.md` | Historial de cambios y cómo contribuir | Sí |
| `REPO-HARNESS.md`, `AGENTS.md` | Reglas para agentes de IA y su puntero | Sí |
| `.repo-harness/`, `.pi/prompts/`, `.pi/skills/repo-harness-*` | Harness de IA generado; `python .repo-harness/check.py` comprueba que esté al día | Sí |
| `.gitattributes` | Fija finales de línea LF en los archivos generados del harness | Sí |
| `docs/repo-harness/` | Estado actual, decisiones, hoja de ruta y uso del harness | Sí |
| `voices/ATTRIBUTION.txt` | Atribución de las referencias descargadas | Sí |
| `voices/*.wav` | Referencias recreables con `scripts/get_voices.py` | No, ignoradas |
| `pocket-out/`, `*.mp3` | Audio generado | No, ignorados; excepción: referencias `voices/*.mp3` |
| `.env` | Secretos locales | No, ignorado |
| `.venv*/`, `__pycache__/` | Entornos y caché Python | No, ignorados |

La tabla indica qué se debe versionar.
Ejecute los comandos desde la raíz del repositorio. Las aplicaciones y los scripts
usan siempre la raíz para `.env`, `voices/` y `pocket-out/`, independientemente
del directorio de trabajo. `/leer` conserva las rutas relativas al directorio actual.

## Pruebas

`tests/test_tech.py`, `tests/test_numbers.py`, `tests/test_lexicon.py`, `tests/test_speed.py` y `tests/test_server.py` comprueban el texto técnico, la conversión de números, el diccionario de pronunciación, el cambio de velocidad y el servidor HTTP sin modelo ni audio; terminan con código 0 si todos los casos pasan:

```powershell
.venv-pocket/Scripts/python tests/test_tech.py
.venv-pocket/Scripts/python tests/test_numbers.py
.venv-pocket/Scripts/python tests/test_lexicon.py
.venv-pocket/Scripts/python tests/test_speed.py
.venv-pocket/Scripts/python tests/test_server.py
```

La extensión de Pi tiene sus pruebas con `node:test` (Node 24, sin dependencias):

```powershell
node --test pi-extension/tehablo-tts/test/tts.test.ts pi-extension/tehablo-tts/test/lifecycle.test.ts pi-extension/tehablo-tts/test/controls.test.ts
```

### Verificación en Fedora

Se restauró un entorno nativo conservando el anterior como `.venv-pocket-windows`.
Se comprobaron Python 3.12.15, pocket-tts 4.0.1, Torch 2.15.0+cpu,
sounddevice 0.5.6 y Node 25.9.0, con kernel `7.2.13-200.fc44.x86_64`.
Las 57 dependencias resultaron compatibles; esto no garantiza futuras versiones
sin fijar de `requirements.txt` ni una instalación limpia en cualquier equipo.

Para repetir las suites sin modelo ni audio desde la raíz:

```bash
.venv-pocket/bin/python tests/test_tech.py
.venv-pocket/bin/python tests/test_numbers.py
.venv-pocket/bin/python tests/test_lexicon.py
.venv-pocket/bin/python tests/test_speed.py
.venv-pocket/bin/python tests/test_server.py
node --test pi-extension/tehablo-tts/test/*.test.ts
```

Todas pasaron (servidor: 8 pruebas; Node: 12). Además, sondas reales con `spanish`
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

## Problemas conocidos

| Síntoma | Causa | Solución |
|---|---|---|
| *"We could not download the weights for the model with voice cloning"* | Falta el token de Hugging Face | [Activar la clonación](../README.md#activar-la-clonación-de-voces-token-de-hugging-face) |
| Aviso de *symlinks* en Windows | La caché de Hugging Face no puede crear enlaces simbólicos | Inofensivo; solo usa algo más de disco. Se evita activando el Modo de desarrollador de Windows |
| No se puede pegar un texto largo en `src/tehablo_tts.py` | Límite de la consola de Windows | Usa `/leer archivo.txt` o la TUI |
| Error al cargar PortAudio en Linux | Puede faltar la biblioteca del sistema | Fedora: `sudo dnf install portaudio`; Debian/Ubuntu: `sudo apt install libportaudio2` (solo el de tu distribución) |
| Sin sonido, pero PortAudio carga | Puede ser el dispositivo seleccionado, el volumen o la ruta de salida del sistema | Revisa la salida predeterminada y el volumen; instalar PortAudio no resuelve todas las causas |
| Al cambiar de modelo había que pulsar Reproducir dos veces | El primer clic se descartaba mientras cargaba el modelo | **Corregido:** ahora queda en espera y suena en cuanto el modelo está listo |
| La primera ejecución tarda más de un minuto | Descarga del modelo | Solo pasa la primera vez |
| Las cifras como `15.000` sonaban incoherentes | Pocket TTS no convierte números a palabras | **Corregido:** `src/tehablo_numbers.py` los convierte antes de leer (solo con modelos en español) |
| Términos en inglés (`Python`, `YouTube`) leídos como español | El modelo usa reglas del español | **Corregido** para los términos de `pronunciaciones.json`; añade los que falten |
| Acento extranjero en español | Voz del catálogo no hispana | Usa `lola` o voces de `voices/` |
