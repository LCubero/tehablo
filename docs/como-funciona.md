# Cómo funciona tehablo y qué recursos usa

Todo se ejecuta **en el equipo local**: sin API externa, sin nube, sin cuenta, sin coste por uso y **sin GPU**. Solo usa CPU y RAM.

## Índice

1. [Recorrido del texto al pulsar F5](#recorrido-del-texto-al-pulsar-f5)
2. [Componentes](#componentes)
3. [Consumo medido](#consumo-medido)
4. [Lo que no usa](#lo-que-no-usa)
5. [Por qué funciona así](#por-qué-funciona-así)

---

## Recorrido del texto al pulsar F5

```text
Texto escrito
   │
   ▼
0. Texto técnico         src/tehablo_tech.py                             "src/tehablo_server.py" → "tehablo sérver punto pai"
   │
   ▼
1. Diccionario de inglés   pronunciaciones.json + src/tehablo_lexicon.py   "Python" → "páiton"
   │
   ▼
2. Números a palabras      src/tehablo_numbers.py                          "15.000" → "quince mil"
   │
   ▼
3. Pocket TTS              modelo de IA de Kyutai                          parte el texto en frases y
   │                                                                       genera el audio a trozos de ~80 ms
   ▼
4. Velocidad               src/tehablo_speed.py (TUI y Pi)                 cambia el ritmo sin cambiar el tono
   │
   ▼
5. Altavoz                 sounddevice                                     suena mientras se genera lo siguiente
```

- Los pasos 0, 1 y 2 solo se aplican con los modelos `spanish` y `spanish_24l`.
- Los pasos 0, 1, 2 y 4 son código propio y casi no consumen recursos.
- El paso 3 es la parte pesada.

---

## Componentes

| Pieza | Para qué | Licencia |
|---|---|---|
| **Pocket TTS** (Kyutai) | Modelo de IA que genera la voz | Código MIT, pesos CC BY 4.0 |
| **PyTorch**, versión solo CPU | Motor que ejecuta el modelo | BSD |
| **Textual** | Interfaz de la TUI | MIT |
| **sounddevice** | Salida de audio al altavoz | MIT |
| **audiotsm** | Velocidad sin cambio de tono (WSOLA) | MIT |
| **numpy / scipy** | Cálculo de audio y guardado `.wav` | BSD |

---

## Consumo medido

### Windows

Medido el 2026-10-29 en el equipo de referencia: Ryzen 5 5600X (12 hilos), 32 GB de RAM y Windows. Texto de 600 caracteres, unos 36 s de audio, voz `lola`.

| Recurso | `spanish` (rápido) | `spanish_24l` (más calidad) |
|---|---|---|
| Tamaño del modelo | 110 M parámetros | 336 M parámetros |
| RAM en uso | ~870 MB (pico ~1 GB al cargar) | ~1,8 GB (pico ~2,3 GB al cargar)* |
| CPU | ~1,8 núcleos (~15 % del equipo) | ~1,2 núcleos (~10 % del equipo) |
| Velocidad | 36,5 s de audio en 9,9 s (3,7× tiempo real) | 36,3 s de audio en 30,2 s (1,2× tiempo real) |
| Primer sonido | ~0,16 s | ~0,55 s |
| GPU | No la usa | No la usa |

\* Medido en el mismo proceso después de liberar `spanish`; puede incluir unos 100–200 MB residuales.

| Elemento | Tamaño | Ubicación |
|---|---|---|
| Entorno Python | 813 MB | `.venv-pocket/` |
| Modelos descargados | 1,2 GB | `%USERPROFILE%\.cache\huggingface\hub` |

Otros datos:

- La TUI mantiene **un solo modelo cargado a la vez**: al cambiar de modelo, se libera el anterior.
- El cambio de velocidad cuesta alrededor de **1 s de CPU por cada 100 s de audio**.
- Los pasos 1 y 2 tardan milisegundos.

#### Arranque, reposo y cuantización (2026-10-30)

Mismo equipo, `spanish`, `pocket-tts` 4.0.1 y Torch 2.15.0+cpu ([datos](measurements/windows-2026-10-30.json)):

| Medida | Resultado |
|---|---|
| Importar librerías (torch, pocket_tts) | ~4,7 s, 350 MiB |
| Cargar el modelo | ~0,7–0,9 s |
| Servidor responde a `/health` desde arranque en frío | ~4,8–5,3 s |
| Servidor listo para hablar | ~6,0–7,9 s |
| RAM del servidor listo, en reposo | ~779 MiB |
| RAM después de hablar (sonando, en pausa, detenido y 60 s quieto) | ~843 MiB; no baja |
| CPU en reposo | ~0,2 % de un núcleo |
| `quantize=True` | RAM tras cargar 820 MiB (sin: 776), pico igual (985), 2,4× tiempo real (sin: 3,1×) |

- Casi toda la espera inicial es importar librerías, no cargar el modelo.
- En reposo el servidor casi no usa CPU, pero conserva la RAM del modelo hasta cerrarse.
- En este equipo la cuantización no ahorra memoria de forma clara y genera más lento.
- La extensión espera a que el servidor responda mientras su proceso siga vivo, sin límite fijo de tiempo; si el proceso se cierra, avisa al momento y remite a `logs/tehablo-server.log`. Antes esperaba solo ~7,5 s, y en Fedora un arranque tardó ~8,5 s.

---

### Fedora

Medido el **2026-10-29 (fecha local del equipo, UTC−06:00)**: Ryzen 5 5600X,
12 hilos lógicos, 32 GB de RAM, Fedora 44, kernel 7.2.13-200.fc44.x86_64.
Python 3.12.15, pocket-tts 4.0.1 y Torch 2.15.0+cpu; ambos modelos usaron
1 hilo intraop y 6 interop de Torch. Voz `lola`, 600 caracteres, 24 kHz.

Hechos verificados en [la evidencia original de ambos modelos](measurements/fedora-2026-10-29.json).
Los valores de generación son **mediana (mínimo–máximo) de tres repeticiones**,
incluida la primera con calentamiento; carga y preparación de voz son una
observación por proceso, no medianas.

| Medida | `spanish` | `spanish_24l` |
|---|---|---|
| Audio generado por repetición | 36,80 s; 883200 muestras | 35,68 s; 856320 muestras |
| Generación, s | 8,646 (8,542–8,877) | 28,314 (28,044–28,598) |
| Velocidad, × tiempo real | 4,257 (4,145–4,308) | 1,260 (1,248–1,272) |
| Primer fragmento, s | 0,121 (0,121–0,135) | 0,441 (0,428–0,466) |
| CPU media, núcleos equivalentes | 1,716 (1,713–1,729) | 1,220 (1,219–1,222) |
| CPU, % de los 12 hilos | 14,30 (14,28–14,41) | 10,16 (10,16–10,18) |
| RAM residente tras generar, MiB | 925,62 (906,96–931,02) | 1806,62 (1803,87–1806,62) |
| Pico acumulado del proceso, MiB | 1024,00 (1024,00–1024,00) | 2321,43 (2321,43–2321,43) |
| Carga desde caché, s | 0,576 | 1,671 |
| Preparación de voz, s | 0,000687 | 0,001448 |
| RAM residente tras cargar, MiB | 816,07 | 1681,43 |

| Elemento | Tamaño | Ubicación |
|---|---|---|
| Entorno Python | 1087 MB | `.venv-pocket/` |
| Modelos descargados | 0,9 GB (`spanish`, `spanish_24l` y voces) | `~/.cache/huggingface/hub` |

La carga excluye los imports de Python; la generación excluye carga y preparación
de voz. La descarga inicial autorizada de los archivos faltantes de `spanish_24l`
se completó antes del ensayo y no está incluida. No se vació la caché del SO.
El servidor de la extensión que ya existía no se detuvo: la memoria
registrada corresponde **solo al proceso de medición**, no al consumo total del
equipo. El pico incluye imports, carga y generación; la RAM residente es una
lectura al final de cada fase, no el máximo durante ella.

No es una prueba de reproducción ni de latencia audible: el primer fragmento es
solo la primera entrega del generador. Tampoco mide pausa, parada, reposo ni el
dispositivo de audio; no entrega optimizaciones ni ajustes nuevos de recursos
([alcance pendiente de RH-W-0003](repo-harness/roadmap.md#rh-w-0003-revisar-consumo-carga-a-demanda-y-espera-de-arranque)).

### Método reproducible en Fedora

El [script de medición](../scripts/measure_tts.py) y el
[texto fijo](../samples/benchmark.txt) permiten repetir el ensayo.

Desde la raíz del repositorio, con los pesos y la voz ya disponibles en caché:

```bash
HF_HUB_OFFLINE=1 .venv-pocket/bin/python scripts/measure_tts.py \
  --model spanish --text samples/benchmark.txt \
  --output .repo-harness/tmp/fedora-measurements/spanish.json
HF_HUB_OFFLINE=1 .venv-pocket/bin/python scripts/measure_tts.py \
  --model spanish_24l --text samples/benchmark.txt \
  --output .repo-harness/tmp/fedora-measurements/spanish_24l.json
```

- Cada comando carga un modelo en un proceso nuevo y genera tres veces el mismo
  texto de 600 caracteres con `lola`, semilla 1234 y velocidad sin modificar.
  `--runs` permite entre 1 y 10 repeticiones; `--help` describe las opciones.
- La primera generación incluye el calentamiento; las siguientes reutilizan el
  modelo. La carga parte de archivos en caché, sin vaciar la caché del sistema.
- El tiempo al primer fragmento **no es latencia audible**: no se reproduce audio.
  Se mide síntesis directa, sin interfaz, preprocesamiento ni ajuste de velocidad.
- RAM residente: `/proc/self/statm`; pico del proceso: `ru_maxrss`, incluidos
  imports, carga y generación. Se expresan en MiB (1024² bytes), no en MB decimales.
  CPU media: segundos de CPU / segundos transcurridos; el porcentaje del equipo
  divide además por los procesadores lógicos.
- El JSON conserva versiones, equipo, hash del texto y cada repetición. El script
  fuerza el modo offline de Hugging Face y falla si faltan archivos; no descarga.
  Este modo no constituye aislamiento de red a nivel del sistema operativo.

## Lo que no usa

| Cosa | Detalle |
|---|---|
| API o nube | El texto no sale del equipo |
| Cuenta o suscripción | Sin coste ni límite de caracteres |
| GPU | Se instala PyTorch solo CPU (~200 MB frente a ~3 GB con CUDA); funciona en equipos sin tarjeta gráfica |
| Internet | Solo en la primera ejecución, para descargar los modelos; después funciona sin conexión |

La única excepción es la **clonación de voces** de `voices/`. Requiere un token gratuito de Hugging Face para la primera descarga de los pesos con clonación. Ver [README](../README.md#activar-la-clonación-de-voces-token-de-hugging-face).

---

## Por qué funciona así

- **Solo CPU:** el modelo es pequeño (100–300 millones de parámetros, frente a miles de millones en los modelos de chat) y genera el audio poco a poco. No necesita una GPU.
- **Empieza a sonar enseguida:** el texto se divide en frases y cada trozo de audio va al altavoz en cuanto está listo. Detalles en [pocket-tts.md](pocket-tts.md).
- **Números e inglés reescritos antes:** el modelo lee letras con reglas del español. No interpreta "15.000" ni reconoce que "Python" es inglés, y no acepta fonemas. Por eso tehablo reescribe el texto antes de enviarlo.
- **Velocidad aplicada al audio:** Pocket TTS no tiene una opción de velocidad. La TUI estira o comprime el audio generado con WSOLA, que conserva el tono.
