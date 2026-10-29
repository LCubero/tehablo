# Cómo funciona tehablo y qué recursos usa

Todo se ejecuta **en el equipo local**: sin API, sin nube, sin cuenta, sin coste por uso y **sin GPU**. Solo usa CPU y RAM.

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
1. Diccionario de inglés   pronunciaciones.json + src/tehablo_lexicon.py   "Python" → "páiton"
   │
   ▼
2. Números a palabras      src/tehablo_numbers.py                          "15.000" → "quince mil"
   │
   ▼
3. Pocket TTS              modelo de IA de Kyutai                          parte el texto en frases y
   │                                                                       genera el audio a trozos de ~80 ms
   ▼
4. Velocidad               src/tehablo_speed.py (solo TUI)                 cambia el ritmo sin cambiar el tono
   │
   ▼
5. Altavoz                 sounddevice                                     suena mientras se genera lo siguiente
```

- Los pasos 1 y 2 solo se aplican con los modelos `spanish` y `spanish_24l`.
- Los pasos 1, 2 y 4 son código propio y casi no consumen recursos.
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

---

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
