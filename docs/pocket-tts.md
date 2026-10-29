# Pocket TTS: referencia, voces y posibilidades de mejora

**Conclusión:** Pocket TTS permite sintetizar y clonar voces localmente en CPU. Para mejorar el español, empieza por una referencia limpia y nativa, normaliza el texto y compara `spanish` con `spanish_24l`. Puedes añadir reglas en la aplicación, pero **no hay un diccionario fonético, SSML completo ni cambio automático de idioma disponibles en la versión local examinada**.

Este documento es investigación, no una implementación: no añade funciones a tehablo, no instala herramientas ni acredita pruebas auditivas nuevas.

### Cómo leer la evidencia

- **VERIFICADO:** comprobado en el paquete local **4.0.1**, código oficial o página citada. Una cifra publicada por un autor no equivale a una medición de tehablo.
- **REPORTE COMUNITARIO:** existe el comentario o experimento citado; no se ha reproducido aquí.
- **NO VERIFICADO / NO PROBADO:** procedencia, licencia, compatibilidad o resultado pendiente. No lo interpretes como una función disponible.
- Los enlaces a `main`, los modelos y los estados de incidencias cambian. **Vuelve a comprobar versiones, licencias y estado de cada PR antes de adoptar una solución.**

## Índice

1. [Qué es Pocket TTS](#1-qué-es-pocket-tts)
2. [Distribución, acceso y funcionamiento sin conexión](#2-distribución-acceso-y-funcionamiento-sin-conexión)
3. [Modelos e idiomas](#3-modelos-e-idiomas)
4. [Referencia de CLI y Python](#4-referencia-de-cli-y-python)
5. [Parámetros de calidad y velocidad](#5-parámetros-de-calidad-y-velocidad)
6. [Cómo mejorar la calidad y cuándo no compensa](#6-cómo-mejorar-la-calidad-y-cuándo-no-compensa)
7. [Catálogo de voces predefinidas](#7-catálogo-de-voces-predefinidas)
8. [Fuentes gratuitas de voces para español](#8-fuentes-gratuitas-de-voces-para-español)
9. [Control de la pronunciación: inglés, diccionarios y reglas](#9-control-de-la-pronunciación-inglés-diccionarios-y-reglas)
10. [Ecosistema y proyectos relacionados](#10-ecosistema-y-proyectos-relacionados)
11. [Limitaciones, licencias y riesgos](#11-limitaciones-licencias-y-riesgos)
12. [Catálogo de mejoras posibles](#12-catálogo-de-mejoras-posibles)
13. [Fuentes](#13-fuentes)

## 1. Qué es Pocket TTS

**VERIFICADO [1–5]:** es un proyecto de **Kyutai**, organización de investigación en IA. Su anuncio inicial está fechado el **13 de enero de 2026**. Es un TTS ligero, con generación progresiva de audio y clonación condicionada por una muestra de voz.

| Aspecto | Qué está documentado |
|---|---|
| Tamaño | Familia original de aproximadamente **100 millones de parámetros**; no todos los modelos actuales tienen ese tamaño. Las variantes 24l son mayores. |
| Objetivo | Inferencia en CPU, sin necesitar una GPU NVIDIA ni una API de pago. |
| Idiomas oficiales | Inglés, francés, alemán, portugués, italiano, español y neerlandés. Las etiquetas de la ficha HF no enumeran todos los idiomas del código actual. |
| Audio español local | Mono, **24 kHz**, latentes a **12,5 cuadros/s**: un cuadro corresponde a **80 ms**, según los YAML. |
| Código | MIT; conservar los avisos exigidos por la licencia. |
| Pesos | CC BY 4.0, con atribución; revisar además los términos de uso publicados por Kyutai. |
| Voz de referencia | Tiene derechos y licencia propios: MIT o CC BY de los pesos no sustituyen su permiso. |

### Arquitectura, sin confundir modelo y códec

**VERIFICADO en código y documentación de entrenamiento [5–6]:** un Transformer causal (FlowLM) usa texto y contexto de voz para producir representaciones continuas de audio. Un cabezal generativo de flujo/consistencia produce los siguientes latentes; Mimi los decodifica a audio. La receta oficial entrena un profesor de 24 capas y lo destila a un alumno de 6 capas. El muestreo LSD (*Lagrangian Self Distillation*) permite reducir pasos; existe también una variante inglesa con *drifting*.

El artículo **CALM, Continuous Audio Language Models** explica la familia de métodos: modelado autorregresivo de latentes continuos en vez de predecir una larga secuencia de códigos discretos. **No significa que cualquier detalle experimental de CALM sea idéntico a todos los checkpoints Pocket TTS.**

**Límite de verificación:** la URL solicitada del [informe técnico](https://kyutai.org/pocket-tts-technical-report/) devolvió una página sin cuerpo técnico legible mediante `curl`. Se contrastaron la arquitectura con el código, el README de entrenamiento y el artículo CALM; no se atribuyen cifras adicionales a ese informe inaccesible.

### Términos de uso

Kyutai prohíbe, entre otros usos, clonar o suplantar voces **sin consentimiento explícito y lícito**, fraude, desinformación, presentar audio generado como una grabación auténtica y contenido ilícito, dañino o invasivo de la privacidad [2–3]. Distingue la licencia CC BY de los pesos de estos términos publicados: no es una autorización general para imitar a cualquier persona.

## 2. Distribución, acceso y funcionamiento sin conexión

| Componente | Dónde está | Acceso verificado |
|---|---|---|
| Código Python | [GitHub](https://github.com/kyutai-labs/pocket-tts), [PyPI](https://pypi.org/project/pocket-tts/) | Instalación del paquete; los pesos se descargan aparte. |
| Pesos con clonación | [kyutai/pocket-tts](https://huggingface.co/kyutai/pocket-tts) | API HF: `gated: auto`. Debes aceptar las condiciones en la web y autenticar las descargas. |
| Pesos sin clonación | [kyutai/pocket-tts-without-voice-cloning](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning) | API HF: `gated: false`. Acceso gratuito sin aprobación; permite voces predefinidas, no codificar una referencia nueva. |
| Audios de voces | [kyutai/tts-voices](https://huggingface.co/kyutai/tts-voices) | Licencia por carpeta y, a veces, por archivo. |

Autenticación para el modelo con clonación, **después de aceptar sus condiciones**:

```console
hf auth login
```

También se puede proporcionar `HF_TOKEN` por el entorno. No escribas el token en código, ejemplos, repositorio o registros. El token no sustituye la aceptación de condiciones.

**VERIFICADO en `tts_model.py` y `utils.py`:** la carga intenta los pesos con clonación y puede recurrir a los pesos sin clonación si no tiene acceso. Por eso conseguir sintetizar con una voz de catálogo **no demuestra** que la clonación esté habilitada.

### Caché y uso sin conexión

- Rutas `hf://...`: `hf_hub_download`, caché estándar de Hugging Face, normalmente `~/.cache/huggingface/hub`; las variables de HF pueden cambiarla ([referencia](https://huggingface.co/docs/huggingface_hub/package_reference/environment_variables)). En Windows, `~` es tu perfil de usuario.
- Descargas HTTP/HTTPS gestionadas por Pocket TTS: `~/.cache/pocket_tts`, con nombre derivado de un hash de la URL.
- Después de descargar **todos** los pesos, tokenizadores y estados o audios necesarios, es posible trabajar sin red. Una voz o idioma nuevo todavía puede requerir una descarga. `HF_HUB_OFFLINE=1` afecta a HF, no convierte las URL HTTP genéricas en recursos locales.
- Para un despliegue reproducible, conserva versión del paquete, YAML, revisiones HF y referencias locales. El funcionamiento completamente desconectado **no se ensayó** en esta investigación.

## 3. Modelos e idiomas

**VERIFICADO:** inventario de los YAML instalados en 4.0.1, contrastado con la ayuda de la CLI. Los YAML españoles confirman 6 y 24 capas, respectivamente. No confundas un idioma con una voz o con una selección automática por frase.

| Familia | Configuraciones / valores de `--language` |
|---|---|
| Inglés, alias actual | `english` → `english_2026-10` |
| Inglés, versiones | `english_2026-01`, `english_2026-04`, `english_2026-09`, `english_2026-09_2`, `english_2026-10` |
| Inglés, profesores 24l adicionales | `english_2026-04_24l`, `english_2026-09_24l` (YAML instalados, no enumerados por la ayuda) |
| Inglés, otro muestreador | `english_drifting_26-09` |
| Inglés pequeño | `english_18m_2026-10`, `english_7m_2026-10`, `english_2m_2026-10` |
| Inglés pequeño con reward fine-tuning | `english_18m_refl_2026-10`, `english_7m_refl_2026-10`, `english_2m_refl_2026-10` |
| Francés | `french`, `french_24l` |
| Alemán | `german`, `german_24l` |
| Portugués | `portuguese`, `portuguese_24l` |
| Italiano | `italian`, `italian_24l` |
| **Español** | **`spanish`, `spanish_24l`** |
| Neerlandés | `dutch`, `dutch_24l` |

Según el README oficial [1], los ingleses pequeños tienen **18,2 M / 6,9 M / 1,9 M parámetros, incluido el decodificador**. Son alternativas para velocidad y memoria; **no son modelos españoles pequeños**. El sufijo `_refl` no garantiza una mejora en cualquier texto.

Las variantes 24l se presentan como modelos mayores, no destilados y todavía preliminares: cometen menos errores según el mantenedor, pero requieren más cálculo [7]. No hay una relación universal entre calidad y tiempo. Compara con el mismo texto y referencia; considera `--quantize` antes de descartar 24l por lentitud.

Voces predeterminadas según `default_parameters.py`: español `lola`, italiano `giovanni`, alemán `juergen`, portugués `rafael`, francés `estelle`, neerlandés `daan`; inglés y respaldo general `alba`. Para `--config` o `--checkpoint` personalizados se usa por defecto **el audio original de alba**, no su estado precalculado.

## 4. Referencia de CLI y Python

**VERIFICADO ejecutando las cuatro ayudas locales y leyendo `main.py`.** Los ejemplos son de referencia; no se ejecutaron generaciones de audio para este documento.

### Comandos y opciones

La raíz solo ofrece `generate`, `serve` y `export-voice`; opciones globales: `--help`, `--install-completion`, `--show-completion`. La instalación de completado puede modificar tu configuración de shell: no es necesaria para generar audio.

| Comando | Opciones y valores predeterminados |
|---|---|
| `generate` | `--text` (texto de ejemplo por idioma; `-` lee stdin), `--voice` (voz por idioma), `--quiet` / `-q` (false), `--language` (inglés si se omite), `--config` (sin valor), `--checkpoint` (sin valor), `--sampler-decode-steps` (1), `--temperature` (desde YAML, respaldo 0,3), `--noise-clamp` (None), `--eos-threshold` (desde YAML, respaldo −4), `--frames-after-eos` (automático), `--output-path` (`./tts_output.wav`; `-` escribe audio a stdout), `--device` (`cpu`), `--max-tokens` (50), `--quantize` / `--no-quantize` (false), `--help`. |
| `generate`, compatibilidad antigua | `--lsd-decode-steps`: opción **oculta y obsoleta**, sustituida por `--sampler-decode-steps`; el código aún la acepta y emite advertencia. |
| `serve` | `--host` (`localhost`), `--port` (8000), `--reload` / `--no-reload` (false), `--language`, `--config`, `--default-voice` (por idioma), `--quantize` / `--no-quantize` (false), `--help`. No expone los ajustes de muestreo de `generate`. |
| `export-voice AUDIO_PATH EXPORT_PATH` | Dos argumentos obligatorios; `--quiet` / `-q`, `--language`, `--config`, `--help`. La ayuda anuncia archivos o directorios; no se probó conversión por lotes. No ofrece `--checkpoint` ni `--quantize`. |

`--language` y `--config` son excluyentes. `--config` admite YAML local, HTTPS o `hf://repositorio/archivo.yaml@revision`. `--checkpoint` carga un checkpoint de entrenamiento `.pt` en lugar de los pesos del YAML; **no entrena el modelo**.

```console
pocket-tts generate --language spanish --voice lola --text "Hola, esto es una prueba." --output-path salida.wav
pocket-tts generate --language spanish_24l --quantize --voice mi-voz.wav --text "¿Puedes confirmar la fecha?"
pocket-tts export-voice --language spanish mi-voz.wav mi-voz-spanish.safetensors
pocket-tts generate --language spanish --voice mi-voz-spanish.safetensors --text "Reutilizo la referencia."
pocket-tts serve --language spanish --default-voice lola
```

En este proyecto también puedes anteponer `.venv-pocket/Scripts/python.exe -m pocket_tts` en lugar de `pocket-tts`. Conserva el modelo y los estados en memoria con `serve` para evitar recargarlos en cada prueba.

### HTTP oficial

**VERIFICADO en `main.py`:** `GET /` sirve la interfaz; `GET /health` devuelve salud; `POST /tts` acepta formulario `text`, más **uno** de `voice_url` o `voice_wav`. Responde WAV en streaming. `voice_url` admite nombre predefinido o URL HTTP/HTTPS/HF, no una ruta arbitraria del cliente.

```console
curl -X POST http://localhost:8000/tts -F "text=Hola, esto es una prueba." -F "voice_url=lola" --output salida.wav
```

No es la API OpenAI: esa compatibilidad la añaden otros servidores. Evita exponer el servicio en Internet sin controles adicionales de autenticación, descargas y límites de uso.

### API Python esencial

```python
from pocket_tts import TTSModel, export_model_state
import scipy.io.wavfile

model = TTSModel.load_model(language="spanish", quantize=False)
state = model.get_state_for_audio_prompt("mi-voz.wav", truncate=True)
audio = model.generate_audio(state, "Hola, esto es una prueba.")
scipy.io.wavfile.write("salida.wav", model.sample_rate, audio.cpu().numpy())
export_model_state(state, "mi-voz-spanish.safetensors")

# En una aplicación, consumir cada tensor conforme llega:
for chunk in model.generate_audio_stream(state, "Esta salida llega por fragmentos."):
    pass  # Enviar a tu reproductor o escritor de audio.
```

| Método / propiedad | Contrato relevante |
|---|---|
| `TTSModel.load_model(...)` | `language=None`, `config=None`, `temp=None`, `sampler_decode_steps=1`, `noise_clamp=None`, `eos_threshold=None`, `quantize=False`, `checkpoint=None`, `lsd_decode_steps=None` (obsoleto). No tiene argumento `device`. |
| `get_state_for_audio_prompt(audio_conditioning, truncate=False)` | Nombre predefinido, ruta, URL, `.safetensors` o tensor de audio `[canales, muestras]`. Procesar audio nuevo requiere pesos con clonación. |
| `generate_audio(state, text, max_tokens=50, frames_after_eos=None, copy_state=True)` | Devuelve un tensor PCM unidimensional completo. |
| `generate_audio_stream(...)` | Mismos ajustes, más `stop=None` (`threading.Event`); devuelve un iterador de tensores. |
| `export_model_state(state, path)` | Guarda el estado para no volver a codificar el audio. |
| `model.sample_rate` | Frecuencia que debes usar al guardar o reproducir. |
| `model.to(device)` | Movimiento PyTorch; CPU es el camino previsto. No supone soporte oficial completo de GPU. |

Conserva `copy_state=True` para reutilizar la referencia sin mutarla. Un estado exportado está ligado al modelo: **no asumas compatibilidad entre idiomas, 6l/24l o checkpoints**. Calcula y etiqueta estados por modelo y referencia.

## 5. Parámetros de calidad y velocidad

**VERIFICADO:** significado y predeterminados en docstrings/código [5]. **NO PROBADO:** los efectos auditivos concretos sobre tehablo. Cambia un parámetro cada vez y guarda texto, modelo, voz y tiempo.

| Parámetro Python / CLI | Predeterminado | Qué controla y qué esperar |
|---|---|---|
| `temp` / `--temperature` | `None` → recomendado del YAML; respaldo 0,3 | Diversidad del muestreo. Más alto puede aumentar variación y errores; más bajo no garantiza dicción correcta. |
| `sampler_decode_steps` / `--sampler-decode-steps` | 1 | Pasos del cabezal de muestreo. La docstring dice que más pasos pueden mejorar calidad a mayor coste; depende del modelo y su entrenamiento. |
| `lsd_decode_steps` | None | Alias antiguo del anterior; no es un segundo control independiente. |
| `noise_clamp` / `--noise-clamp` | None | Limita valores extremos del ruido de muestreo; sin valor, no los recorta. No es reducción de ruido del WAV de referencia. |
| `eos_threshold` / `--eos-threshold` | `None` → YAML; respaldo −4,0 | Umbral de fin de secuencia. Aumentarlo favorece continuar; puede evitar cortes, pero alargar o degradar el final. |
| `frames_after_eos` / `--frames-after-eos` | None, automático | Cuadros adicionales después de detectar EOS. En español, 80 ms por cuadro; demasiados pueden añadir artefactos. |
| `max_tokens` / `--max-tokens` | 50 | Objetivo de tokens de texto por fragmento, no límite total del documento ni de audio generado. Más contexto puede costar memoria o provocar omisiones. |
| `quantize` / `--quantize` | false | Cuantización dinámica int8 de capas del Transformer; reduce memoria y puede acelerar CPU según backend/hardware. No cuantiza todo Mimi ni todo el cabezal de flujo. |

**Detalle importante del automático de EOS:** las docstrings mencionan 1–3 cuadros, pero el código local primero toma `model_recommended_frames_after_eos`; si no existe, usa la estimación por longitud de `prepare_text_prompt` **más 2**. No tomes 1–3 como valor efectivo universal.

La [documentación de cuantización](https://github.com/kyutai-labs/pocket-tts/blob/main/docs/quantization.md) publica comparaciones favorables y una evaluación sin deterioro medible en sus condiciones. No son garantías para todas las voces o para esta CPU. Los requisitos de `torchao` difieren entre páginas oficiales: verifica la combinación exacta de versiones antes de instalar extras. Int8 dinámico no debe trasladarse sin más a CUDA.

## 6. Cómo mejorar la calidad y cuándo no compensa

### Orden recomendado de experimentación

1. **Referencia nativa y limpia.** Usa una sola persona, sin música, eco, saturación, otras voces ni cortes de sílabas. Una referencia inglesa puede inducir acento extranjero al hablar español.
2. **Texto preparado.** Convierte números, fechas, símbolos y abreviaturas al resultado hablado esperado. Revisa nombres y préstamos ingleses (§9).
3. **Modelo.** Compara `spanish` y `spanish_24l`, con y sin cuantización, sobre el mismo conjunto de frases.
4. **Principio y final.** Si hay truncamiento, ajusta `frames_after_eos` y después `eos_threshold`, sin asumir que curan el ataque de la primera palabra.
5. **Segmentación.** Evita párrafos enormes sin puntuación. Revisa las uniones y los fragmentos excesivamente cortos.
6. **Después, muestreo.** Prueba temperatura y pasos, midiendo coste y errores; no uses una receta universal.

### Preparar y limpiar la referencia

El README recomienda [Adobe Podcast Enhance](https://podcast.adobe.com/en/enhance); el repositorio de voces usa [ai-coustics](https://ai-coustics.com/) para archivos `_enhanced` [1,4]. Son servicios externos: **no se verificaron cuotas gratuitas, privacidad ni planes actuales**. No subas una voz ajena o confidencial sin permiso.

| Herramienta | Licencia verificada del código | Uso y cautela |
|---|---|---|
| [Resemble Enhance](https://github.com/resemble-ai/resemble-enhance) | MIT, archivo `LICENSE` | Limpieza/mejora. Recomendada por usuarios en #115; resultado no reproducido aquí. |
| [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) | `libDF/Cargo.toml`: MIT/Apache-2.0 | Supresión de ruido. El binario `deep-filter` documenta WAV de **48 kHz**; convierte la frecuencia si procede. |
| [Demucs](https://github.com/facebookresearch/demucs) | MIT, archivo `LICENSE` | Separación de fuentes, especialmente música/voz. No equivale a restaurar una voz sin pérdidas. |
| [RNNoise](https://github.com/xiph/rnnoise) | BSD de 3 cláusulas, `COPYING` | Supresión de ruido; puede alterar consonantes si se fuerza demasiado. |
| [Audacity](https://www.audacityteam.org/) | Licencia exacta no comprobada aquí | Recortar y limpiar manualmente; #115 describe su uso junto con RNNoise. |

La licencia del programa no certifica por sí sola la de sus pesos, dependencias o audios. **No se evaluó calidad ni compatibilidad de estas herramientas en este entorno.** Escucha siempre antes y después: una limpieza excesiva puede cambiar el timbre o borrar consonantes.

**Longitud:** 10–30 s es una pauta práctica, no un mínimo técnico demostrado. En #115 hay buenos resultados reportados con unos 10 s y entonación variada. El método Python solo trunca a **30 s si `truncate=True`**, y ese recorte se aplica al audio leído desde archivo; no es un recorte universal implícito de todo tensor. `export-voice` y la subida WAV del servidor lo activan. `end_on_pause` ajusta el final de la referencia a una pausa para evitar arranques espurios: es procesamiento interno, no un argumento público llamado `end_on_pause`.

Exportar `.safetensors` acelera **cargar la referencia**, no aumenta por sí mismo su calidad ni reduce necesariamente el coste de cada segundo sintetizado.

### Español corto: qué se sabe

**REPORTE COMUNITARIO, #174 abierta [7]:** «Alguna sugerencia.» se corta como «Alguna su»; aparecen ataques como «auna» y consonantes omitidas como «terminao». El mantenedor recomienda cuadros adicionales, ajustar el umbral y probar 24l, que comete menos errores. Más cuadros pueden arreglar un final y producir ruido sobrante en otra frase.

Otro experimento compartido por el padre de esta investigación describe elevar EOS de −4 hacia **0** para evitar colapso/silencio en frases muy cortas con 24l, **sin corregir el comienzo**. **NO REVALIDADO aquí ni probado en tehablo:** considéralo un punto de comparación, no el nuevo predeterminado.

```console
pocket-tts generate --language spanish_24l --voice lola --text "Alguna sugerencia." --frames-after-eos 8
```

El `8` anterior es un **ejemplo de experimento, no un valor validado**. Comprueba también una frase larga antes de conservarlo.

### Entrenamiento y fine-tuning: sí existen

**VERIFICADO [6]:** el repositorio oficial incluye `training/`, recetas desde cero, fine-tuning y destilación. Requiere audio con transcripciones y alineación temporal **por palabra**, tokenizador adecuado y GPU. El soporte oficial de entrenamiento es Linux; no se promete soporte Windows/macOS. No hace falta entrenar para clonar una voz de referencia.

`checkpoint=` solo permite escuchar un checkpoint `.pt` (usa EMA si está presente); no añade un entrenador a la CLI de producción. Para una GPU Turing de 8 GB no se verificó una receta de entrenamiento viable: no deduzcas esa posibilidad de que la inferencia funcione en CPU.

| Modelo español comunitario | Qué se ha comprobado | Qué no demuestra |
|---|---|---|
| [inferencekey/pocket-tts-spanish-24l-castilian](https://huggingface.co/inferencekey/pocket-tts-spanish-24l-castilian) | Ficha: base `spanish_24l`, unas **12 h** de una voz castellana, CC BY 4.0 y acceso condicionado. Propone `--config hf://inferencekey/pocket-tts-spanish-24l-castilian/config.yaml`. | El autor publica WER **0,000 base / 0,079 ajustado** y **7,1 / 7,5 s CPU por segundo de audio** en su prueba pequeña. El ajuste busca acento castellano, no mejora universal de inteligibilidad; esas velocidades no son de nuestro equipo. |
| [ipsilondev/pocket-tts-spanish-streaming_v2](https://huggingface.co/ipsilondev/pocket-tts-spanish-streaming_v2) | API confirma repositorio público con LoRA, pesos fusionados y ONNX, incluido int8. El autor lo vincula en #174 como ajuste de una versión anterior. | **Licencia no verificada:** no aparece `cardData` de licencia en la API consultada. No asumir uso comercial ni compatibilidad directa con 4.0.1. |

[Relato del fine-tuning castellano](https://dev.to/inferencekey/fine-tuning-pocket-tts-for-castilian-spanish-stop-at-step-600-and-judge-the-accent-by-ear-2a88): lectura complementaria del autor; no una evaluación independiente. Para modelos propios, usa audio de referencia y recalcula estados; las voces precalculadas oficiales no son intercambiables.

### Cuándo no merece la pena seguir ajustando

- Si necesitas pronunciación exacta, actuación emocional o voces consistentes en todos los textos, un modelo pequeño no ofrece garantías por aumentar pasos o bajar temperatura.
- Si 24l pierde el tiempo real necesario para tu aplicación, compara el beneficio auditivo con el coste de latencia.
- Si el problema es una referencia con música o un texto mal normalizado, entrenar es una solución desproporcionada.
- **Qwen3-TTS / Chatterbox:** considera evaluarlos si aceptas más recursos, instalación y latencia a cambio de otras capacidades. Consulta sus repositorios [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) y [Chatterbox](https://github.com/resemble-ai/chatterbox); licencias por checkpoint, rendimiento, VRAM y funcionamiento en una RTX 2080 **no se verificaron en esta investigación**.

## 7. Catálogo de voces predefinidas

**VERIFICADO:** catálogo completo de `_ORIGINS_OF_PREDEFINED_VOICES` local: **27 entradas**. Los nombres son alias, no descripciones fiables de nacionalidad. Idiomas según README/código; **acentos individuales no verificados**, salvo indicación expresa. Usar una voz inglesa con `spanish` no cambia el modelo a inglés.

En la tabla, las rutas abreviadas pertenecen a [`kyutai/tts-voices`](https://huggingface.co/kyutai/tts-voices/tree/main), excepto las que empiezan por `pocket-tts/`. Las licencias se contrastaron con el README de voces [4], no se dedujeron del nombre.

| Nombre | Archivo de origen | Idioma / acento | Licencia del audio |
|---|---|---|---|
| alba | `alba-mackenna/casual.wav` | Inglés; acento sin verificar | CC BY 4.0 |
| anna | `vctk/p228_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| vera | `vctk/p229_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| fantine | `vctk/p244_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| charles | `vctk/p254_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| paul | `vctk/p259_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| eponine | `vctk/p262_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| azelma | `vctk/p303_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| george | `vctk/p315_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| mary | `vctk/p333_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| jane | `vctk/p339_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| michael | `vctk/p360_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| eve | `vctk/p361_023_enhanced.wav` | Inglés; sin verificar | CC BY 4.0 |
| cosette | `expresso/ex04-ex02_confused_001_channel1_499s.wav` | Inglés; sin verificar | **CC BY-NC 4.0: no comercial** |
| jean | `ears/p010/freeform_speech_01_enhanced.wav` | Inglés; sin verificar | **CC BY-NC 4.0: no comercial** |
| marius | `voice-donations/Selfie.wav` | Inglés; sin verificar | CC0 |
| javert | `voice-donations/Butter.wav` | Inglés; sin verificar | CC0 |
| bill_boerst | `voice-zero/bill_boerst.wav` | Inglés; sin verificar | CC0 |
| peter_yearsley | `voice-zero/peter_yearsley.wav` | Inglés; sin verificar | CC0 |
| stuart_bell | `voice-zero/stuart_bell.wav` | Inglés; sin verificar | CC0 |
| caro_davy | `voice-zero/caro_davy.wav` | Inglés; sin verificar | CC0 |
| giovanni | `pocket-tts/common_voice_it_36520747-enhanced-v2.mp3` | Italiano; sin verificar | Procedencia Common Voice; licencia del archivo concreto sin verificar |
| **lola** | `pocket-tts/common_voice_es_19762977-enhanced-v2.mp3` | **Español**, acento sin verificar | Procedencia Common Voice; licencia del archivo concreto sin verificar |
| juergen | `pocket-tts/de-DE-juergen.mp3` | Alemán; archivo indica de-DE | Sin verificar |
| rafael | `pocket-tts/g-Vi8PgmSY0-enhanced-v2.wav` | **Portugués, no español** | Sin verificar; nombre compatible con un ID de YouTube, origen y derechos no confirmados |
| daan | `pocket-tts/cml_tts_nl_11290_9412_000030_0001.flac` | Neerlandés; sin verificar | CML-TTS CC BY 4.0; confirmar trazabilidad del archivo |
| estelle | `unmute-prod-website/developpeuse-3.wav` | Francés; sin verificar | CC0 según regla de «otras grabaciones propias» de esa carpeta |

Para reconstruir la URL exacta, consulta [`utils.py`](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/utils/utils.py). El paquete local fija revisiones: giovanni/lola/juergen/rafael `64ab7d24c479d736a83b8cc666c4a776fca30fda`, daan `2dd944b099d06bb9edbd221fef138685711d9bf0`, estelle `1fc7395b7e012e2bbebfca14b942a4ef62ccc899`. Los estados predefinidos provienen del repositorio **sin clonación**, por idioma; no son los WAV originales.

### Licencias de todas las carpetas documentadas de tts-voices

| Carpeta | Lo que declara su README |
|---|---|
| `voice-donations/` | CC0; voces voluntarias. No se garantiza que todas sean españolas. |
| `vctk/` | CC BY 4.0. |
| `expresso/` | CC BY-NC 4.0; solo no comercial. |
| `unmute-prod-website/` | Mixta: `ex04_narration_longform_00001.wav`, no comercial por Expresso; `p329_022.wav`, CC BY 4.0; otras grabaciones propias, CC0. **`degaulle-2.wav`: el propio README duda sobre su dominio público; no se considera verificado.** |
| `cml-tts/fr/` | CC BY 4.0, selección francesa. Que el corpus CML incluya español no significa que esta carpeta lo contenga. |
| `ears/` | **CC BY-NC 4.0**, no comercial. |
| `alba-mackenna/` | **CC BY 4.0**, incluidas las interpretaciones descritas. |
| `voice-zero/` | **CC0**, selección de Voice-Zero. |

## 8. Fuentes gratuitas de voces para español

> **Catálogo ampliado:** [voces-gratuitas.md](voces-gratuitas.md) reúne la búsqueda en Hugging Face, GitHub, OpenSLR, Mozilla, Kaggle y Reddit (incluye Perú, Puerto Rico y Venezuela sin descargar ZIP, Dave CC0 y Ald) y las fuentes que conviene evitar.

**Gratis no significa sin condiciones ni consentimiento automático para clonar una identidad.** «Comercial» en la tabla se refiere a la licencia del corpus, sujeto a sus condiciones, términos de acceso y derechos personales. No constituye asesoramiento jurídico.

Los tamaños son los **archivos publicados**, no descargas realizadas ni horas inferidas. No se descargó ningún corpus para esta documentación.

| Fuente oficial | Español / acento | Tamaño publicado | Licencia / comercial | Utilidad y cautela |
|---|---|---|---|---|
| [OpenSLR 61](https://www.openslr.org/61/) | Argentina, Buenos Aires; también mensajes meteorológicos es-ES | Femenino 1,2G; masculino 551M; meteorología 33M | CC BY-SA 4.0 / **sí, con condiciones** | Frases breves de voluntarios; no mezclar hablantes. |
| [OpenSLR 71](https://www.openslr.org/71/) | Chile | 585M + 859M | CC BY-SA 4.0 / sí, con condiciones | Índices separados por género. |
| [OpenSLR 72](https://www.openslr.org/72/) | Colombia | 801M + 810M | CC BY-SA 4.0 / sí, con condiciones | Ya contemplado por el script local. |
| [OpenSLR 73](https://www.openslr.org/73/) | Perú | 913M + 1,0G | CC BY-SA 4.0 / sí, con condiciones | Espejo HF equivalente no encontrado en la búsqueda realizada. |
| [OpenSLR 74](https://www.openslr.org/74/) | Puerto Rico | 214M, femenino | CC BY-SA 4.0 / sí, con condiciones | No asumir un subconjunto masculino; la página solo ofrece femenino. |
| [OpenSLR 75](https://www.openslr.org/75/) | Venezuela | 517M + 526M | CC BY-SA 4.0 / sí, con condiciones | Espejo HF equivalente no encontrado. |
| [CML-TTS, OpenSLR 146](https://www.openslr.org/146/) | Español; acentos individuales sin verificar | Archivo español **48G** | CC BY 4.0 / sí, con atribución | Audiolibros LibriVox, 24 kHz. No necesitas el archivo completo para evaluar una referencia si encuentras un acceso selectivo lícito. |
| [Common Voice es](https://commonvoice.mozilla.org/en/datasets), [acceso actual](https://github.com/common-voice/cv-dataset) | Múltiples acentos; calidad variable | Depende de la versión; no fijado aquí | CC0 según contexto del proyecto; **revalidar ficha de la edición y términos de acceso** / sí bajo CC0 | Filtrar clips validados del mismo `client_id`, sin intentar identificar a la persona. La página original requiere JavaScript; no se verificó una ficha es concreta actual. |
| [Kyutai voice donations](https://huggingface.co/kyutai/tts-voices/tree/main/voice-donations) | Español disponible por confirmar; catálogo multiorigen | README: **228 voces verificadas** en total, no españolas | CC0 / sí | Buscar y escuchar una referencia nativa; no inferir idioma por nombre. |
| [Dave 1.0, Mozilla Data Collective](https://mozilladatacollective.com/datasets/cmid4ir9100bgnu07du03svuc) | Español, un hablante; la descripción lo llama masculino, pero metadatos dicen género no reportado | **≈1,5 h; 85,24 MB**, WEBM | CC0-1.0 / sí; prohíbe intentar identificar al hablante | Grabado con Piper Recording Studio; sin validación ni posprocesamiento declarado. Acento preciso sin verificar. |
| [CSS10](https://github.com/Kyubyong/css10) | Español, lector Tux; acento sin verificar | **23:49:49**, según tabla del proyecto | LibriVox como origen; **licencia específica del paquete no verificada** / confirmar | Audiolibros segmentados; no confundir una licencia de código con la del audio. |
| [LibriVox](https://librivox.org/pages/public-domain/) | Buscar libros españoles y lectores concretos | Variable | Dominio público **en EE. UU.** / sí allí; comprobar tu jurisdicción | Narración expresiva; extraer una sola voz sin música ni introducciones mezcladas. Derechos de voz y consentimiento siguen siendo otra cuestión. |
| [VoxForge](https://www.voxforge.org/home/read) | Español, según contribuciones; alcance no verificado | Sin verificar | **GPL y versión aplicable sin verificar** / no concluir | La consulta no permitió confirmar condiciones del audio español. No priorizar para clonación comercial. |
| [M-AILABS](https://www.caito.de/2019/01/the-m-ailabs-speech-dataset/) | Español y catálogo actual sin verificar | Sin verificar | **Sin verificar** / no concluir | La página no devolvió contenido útil. Buscar licencia original antes de usar espejos. |
| [TEDx Spanish, OpenSLR 67](https://www.openslr.org/67/) | Varios expositores | **24 h; 2,3G** | **CC BY-NC-ND 4.0 / no comercial** | No es una fuente permisiva: además de NC, ND restringe compartir adaptaciones. Desaconsejada como referencia distribuible o comercial sin permiso adicional. |

### Qué hace ya `scripts/get_voices.py`

**VERIFICADO leyendo el script, sin ejecutarlo:** consulta clips mediante HF datasets-server para `ylacombe/google-argentinian-spanish`, `ylacombe/google-chilean-spanish` y `ylacombe/google-colombian-spanish`. Por defecto selecciona **3 hablantes por acento y género**, busca aproximadamente **15 s** por voz y escribe WAV y atribuciones en `voices/`. Concatena frases del mismo hablante con pausas; no garantiza mejora auditiva ni consentimiento específico de clonación.

**Posible extensión, no implementada:** agregar Perú, Puerto Rico y Venezuela. Las búsquedas HF por `google-peruvian-spanish`, `google-puerto-rican-spanish` y `google-venezuelan-spanish` devolvieron **listas vacías**; la búsqueda `ylacombe/google` solo confirmó los tres espejos españoles actuales. No inventes identificadores: haría falta verificar otro espejo o diseñar un lector selectivo de OpenSLR. Para Puerto Rico, manejar la ausencia de un archivo masculino.

### Extraer una buena muestra de 10–30 s

1. Comprueba licencia, consentimiento y restricciones de identificación; conserva la URL y atribución antes de recortar.
2. Elige una persona y una toma uniforme, preferiblemente nativa del acento que buscas. No unas varias identidades.
3. Recorta por pausas, sin eliminar ataques ni finales de palabra; evita música, compresión agresiva y reverberación.
4. Limpia solo si hace falta y compara la dicción tras el proceso. Revisa preguntas, afirmaciones y nombres difíciles.
5. Guarda WAV y metadatos; genera su `.safetensors` con **el mismo modelo** que usarás después.

## 9. Control de la pronunciación: inglés, diccionarios y reglas

**Respuesta directa:** puedes preparar palabras y reglas **antes** de llamar al modelo. No puedes indicarle hoy una pronunciación IPA o activar un diccionario fonético oficial en la CLI 4.0.1 examinada. Para que un tramo inglés use realmente un modelo inglés haría falta orquestar dos modelos o entrenar uno con datos mezclados.

### Cómo pasa el texto al modelo

**VERIFICADO en código [5,15]:** texto → normalización ligera y segmentación → tokens de subpalabras → embeddings → generación de audio. `prepare_text_prompt` quita espacios sobrantes, modifica caracteres según el YAML, puede poner mayúscula inicial y asegura puntuación terminal.

**Matiz respecto a explicaciones antiguas:** se soporta SentencePiece, pero los YAML actuales de español usan `tokenizer.json` con Hugging Face `tokenizers`, convertido del vocabulario SentencePiece con los mismos IDs. No es correcto afirmar que toda ejecución actual llama al runtime SentencePiece.

No hay una etapa G2P (grafemas a fonemas), entrada IPA, etiquetas de idioma, SSML general ni diccionario de pronunciación público en esta API local. La pronunciación se aprende en los pesos; **cambiar el tokenizador o agregar un token no enseña por sí solo una palabra**. Puedes enviar letras IPA como texto, pero no se interpretan como una orden fonética.

La segmentación intenta límites de oración (`.!?`, incluidos patrones de puntos suspensivos) y luego `,;:` para fragmentos largos. **El código local no ofrece un corte final garantizado por palabras:** puede conservar una oración demasiado larga y avisar que podría omitir palabras. `max_tokens=50` es un objetivo, no un techo estricto. Este detalle se comprobó frente a descripciones secundarias que simplifican el algoritmo.

### Términos ingleses dentro de una frase española

**REPORTE COMUNITARIO:** [#350](https://github.com/kyutai-labs/pocket-tts/issues/350), abierta al consultar, describe préstamos ingleses leídos según la ortografía alemana; su autor afirma observarlo también en español, francés, italiano, portugués y neerlandés. Reescribir «Meeting» como «Mieting» ayudó solo parcialmente. No es un estudio exhaustivo por idioma. [#206](https://github.com/kyutai-labs/pocket-tts/issues/206), ahora cerrada, documenta la ambigüedad de «live»; «lyve» es una reescritura propuesta, no un comando fonético.

| Estrategia | Cómo podría hacerse | Límites / estado |
|---|---|---|
| Diccionario ortográfico por idioma | Antes de sintetizar, sustituir términos: `software` → `sóftuer`, `email` → `imeil`, `Wi-Fi` → `uaifai`. | **IDEA NO PROBADA.** Son aproximaciones ilustrativas, no pronunciaciones aprobadas ni acento inglés auténtico. Deben probarse por modelo y contexto. |
| Reglas contextuales | Diferenciar el significado de «live», nombres propios, siglas y variantes regionales. Aplicar coincidencias por palabra, expresiones largas primero y sin reemplazos en cascada. | **IDEA NO IMPLEMENTADA** en tehablo. Un reemplazo global ingenuo puede dañar palabras normales o el texto mostrado. |
| Tramos con otro modelo | La aplicación interpreta `[en]...[/en]`, quita las marcas y sintetiza el tramo con `english`; el resto, con `spanish`. | **IDEA NO PROBADA.** Las marcas no son reconocidas por Pocket TTS. Requiere concatenar audio, igualar formato y calcular estado de la misma referencia por modelo. Puede haber saltos de prosodia, dos modelos en RAM y mayor latencia; clonación requiere pesos gated. |
| Referencia española nativa | Usarla con `spanish` o 24l. | Puede reducir acento extranjero de la voz; no garantiza que los préstamos se pronuncien en inglés. |
| Fine-tuning con code-switching | Datos con mezcla español/inglés, transcripciones y alineaciones; usar `training/`. | **IDEA NO PROBADA** para este proyecto. Más esfuerzo, GPU y evaluación; no basta un diccionario de palabras. |

### PR de diccionario: propuesta, no función instalada

**VERIFICADO consultando GitHub:** [PR #375](https://github.com/kyutai-labs/pocket-tts/pull/375) estaba **abierto, sin fusionar**. Propone JSON `{palabra: reescritura}`, coincidencia de palabras completas sin distinguir mayúsculas, entradas multipalabra, prioridad a la coincidencia más larga y una única pasada. Añade `pronunciations=` a `generate_audio` / `generate_audio_stream` y `--pronunciations lexicon.json` a `generate`; **no conecta `serve`**.

**No uses esos argumentos como si existieran en 4.0.1.** Mientras no se incorpore una versión compatible, un preprocesador propio puede aplicar la misma idea sin modificar Pocket TTS. No se ha implementado aquí ni se presupone que el PR haya sido aprobado.

Ejemplo de diccionario **conceptual, no validado acústicamente**:

```json
{"software": "sóftuer", "email": "imeil", "Wi-Fi": "uaifai"}
```

Conviene mantener dos textos: el original para mostrar y el normalizado para hablar; registrar qué reglas se aplicaron y permitir desactivarlas por documento.

### Números, fechas, siglas y símbolos

El mantenedor pide preprocesar números y fechas en [#174](https://github.com/kyutai-labs/pocket-tts/issues/174). Las reglas posibles incluyen:

| Entrada | Transformación orientativa, a decidir según contexto |
|---|---|
| `12,50 €` | «doce euros con cincuenta céntimos»; adaptar región/moneda. |
| `03/04/2026` | Decidir primero el orden día/mes; no adivinar una fecha ambigua. |
| `ONU`, `CPU` | Elegir lectura como palabra o nombres de letras («o ene u», «ce pe u»). Escribir `O-N-U` no garantiza deletreo correcto. |
| `20 km`, `50%` | «veinte kilómetros», «cincuenta por ciento». |
| URL, emojis, Markdown | Eliminar, describir o convertir selectivamente según el uso, conservando el original. |
| Versiones, teléfonos, identificadores | No tratarlos siempre como números cardinales; pueden requerir lectura por dígitos. |

[`num2words`](https://github.com/savoirfairelinux/num2words) tiene soporte español, confirmado en su README (`es`, `es_CO`, `es_CR`, `es_GT`, `es_VE`); su `COPYING` es **LGPL 2.1**. Puede ayudar con cardinales y monedas, pero no sustituye un analizador contextual de fechas, siglas o unidades. Integración y resultado **no probados**.

**Implementado en tehablo:** [`src/tehablo_numbers.py`](../src/tehablo_numbers.py) es un conversor propio, sin dependencias, que la TUI y la consola aplican antes de sintetizar cuando el modelo es `spanish` o `spanish_24l`. Cubre cardinales (`15.000` → «quince mil»), decimales (`25,5` → «veinticinco coma cinco», `3.5` → «tres punto cinco»), porcentajes, horas `HH:MM`, fechas `día/mes/año`, `₡` y `$`, negativos, teléfonos con guion (`8888-1234` → dos grupos) y lectura por dígitos para enteros de 13 o más cifras o con ceros iniciales. Convención: `.` separa miles y `,` marca decimales. No trata unidades (`km`), `€`, ordinales ni concordancia femenina («veintiuna personas» sale «veintiuno personas»). Pruebas: `tests/test_numbers.py`. FrontPocket y las conversaciones de #174 sirven como ejemplos comunitarios de preprocesamiento, no como una API estándar del modelo.

### Pausas y emociones

- **Pausas:** [#6](https://github.com/kyutai-labs/pocket-tts/issues/6) permanece abierta. Puntuación o «…» pueden influir, sin duración exacta. La alternativa externa es dividir en tramos y añadir silencio PCM (`torch.zeros`) al concatenarlos; los marcadores como `[2.0s]` deben ser interpretados por la aplicación y nunca enviados literalmente al modelo. **No se implementó aquí.**
- **SSML parcial propuesto:** [PR #242](https://github.com/kyutai-labs/pocket-tts/pull/242), **abierto y no fusionado**, propone `[pause:1]` y `<break time="1.5s"/>`. No equivale a soporte SSML completo ni está disponible por ello en el paquete instalado.
- **Emociones:** [#52](https://github.com/kyutai-labs/pocket-tts/issues/52) sigue abierta; el contexto aportado por el padre recoge que el mantenedor invita a usar el código de entrenamiento con un corpus emocional. No hay etiquetas oficiales `<happy>` / `<angry>` verificadas. Cambiar `temp` por fragmento sería un experimento de variación, **no un control semántico de emoción**. Una referencia expresiva puede influir en el estilo sin garantizar una emoción elegida.

## 10. Ecosistema y proyectos relacionados

**VERIFICADO** en el README oficial o API del repositorio, salvo advertencia. No se instalaron ni probaron estas integraciones. «Port» no garantiza los mismos idiomas, clonación, licencias de pesos ni resultados que Python 4.0.1.

| Proyecto | Para qué sirve | Estado de la comprobación |
|---|---|---|
| [Documentación oficial](https://kyutai-labs.github.io/pocket-tts/) | CLI, API, ejemplos y cuantización | Referencia principal junto con el código. |
| [xn-ptts / wasm-pocket-tts](https://github.com/gradium-ai/xn-ptts/tree/main/ptts-wasm) | Implementación Rust y navegador con WASM | Enlazada por el README oficial. Las releases oficiales también anuncian binarios Rust sin Python. |
| [KevinAHM/pocket-tts-onnx-export](https://github.com/KevinAHM/pocket-tts-onnx-export), [demo](https://huggingface.co/spaces/KevinAHM/pocket-tts-web) | Exportación ONNX y ejecución web | Existencia/enlace verificado; cobertura exacta de español, int8 y versiones actuales no probada. |
| [babybirdprd/pocket-tts](https://github.com/babybirdprd/pocket-tts) | Candle/Rust, WASM y enlaces Python | Enlazado oficialmente; compatibilidad no probada. |
| [vlapky/pocket-tts-js](https://github.com/vlapky/pocket-tts-js) | API de navegador, Web Worker, ONNX y clonación | API y LICENSE comprobados: código npm **MIT**; pesos y voces mantienen licencias independientes. |
| [pkalogiros/pocket-tts-raven](https://github.com/pkalogiros/pocket-tts-raven) | Runtime nativo/web | API confirma proyecto y licencia MIT; C++/WASM y paridad funcional requieren revisar su versión concreta. |
| [ai-joe-git/pocket-tts-server](https://github.com/ai-joe-git/pocket-tts-server) | Servidor de voz/chat con API compatible con OpenAI | API confirma descripción; **licencia no declarada por la API consultada**. No asumir MIT. |
| [teddybear082/pocket-tts-openai_streaming_server](https://github.com/teddybear082/pocket-tts-openai_streaming_server) | Streaming compatible con OpenAI, empaquetado Docker/ejecutable | Enlazado por el README oficial. |
| [FrontPocket](https://github.com/markd89/FrontPocket) | Interfaz, portapapeles, navegación por frases y preprocesamiento | Enlazado oficialmente; no evaluado aquí. |
| [Voice-Zero](https://github.com/OwenTyme/voice-zero) | Muestras limpias para clonación zero-shot | README actual: `voices/` CC0, trazabilidad por subcarpeta. #115 anunció **98 voces**: cifra histórica, **no recuento actual auditado**. El mantenedor trabaja con inglés; no es un banco español nativo garantizado. |
| [elisaul77/tts-hub](https://github.com/elisaul77/tts-hub) | Candidato mencionado en investigación previa | **NO VERIFICADO:** API devolvió `Not Found`; podría haberse movido, ser privado o no existir. No recomendar su instalación como comprobada. |
| [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [MLX](https://github.com/jishnuvenugopal/pocket-tts-mlx) | Integraciones multiplataforma o Apple Silicon | Enlazados por el README; comprobar funcionalidades y checkpoints soportados. |

Fuentes secundarias como [FluidInference](https://docs.fluidinference.com/tts/pocket-tts) pueden orientar sobre otras implementaciones. Para decidir qué acepta **este paquete**, manda la ayuda y el código de la versión instalada, no una explicación de un port o una propuesta pendiente.

## 11. Limitaciones, licencias y riesgos

### Límites técnicos conocidos

| Problema | Evidencia / precaución |
|---|---|
| Español corto truncado o ataque alterado | #174 **abierta**. EOS y cuadros ayudan al final, no garantizan arreglar consonantes ni comienzo. |
| Calidad dependiente de la referencia | #115: mantenedor confirma entrenamiento con corpus públicos y selección mejorable de voces; el modelo reproduce condiciones acústicas. Preferencias de usuarios frente a Kokoro no son un benchmark. |
| Palabras extranjeras y homógrafos | #350 abierta / #206 cerrada: no hay control fonético explícito disponible; las reescrituras pueden fallar. |
| Repeticiones | [#347](https://github.com/kyutai-labs/pocket-tts/issues/347), **abierta**, reporta finales repetidos («an hour an hour») incluso con voces oficiales. Bajar temperatura o cambiar EOS no fue una cura en ese reporte. |
| Clic de inicio o entre fragmentos | [PR #331](https://github.com/kyutai-labs/pocket-tts/pull/331), **abierto y no fusionado**, propone eliminar el primer cuadro decodificado. El código local ya incluye un pequeño fade-in y ajuste del prompt; no implica que incorpore ese PR ni que el problema esté resuelto en todo caso. |
| Pausas exactas, emociones y SSML | No disponibles como controles generales oficiales en la versión local; propuestas y trabajo externo en §9. |
| Texto largo | Se fragmenta, pero puede omitir o repetir palabras y cambiar prosodia en uniones. «Texto ilimitado» no es contexto acústico ilimitado ni memoria constante garantizada. |

**CPU es suficiente; GPU Turing no necesaria.** «Orientado a CPU» no significa «matemáticamente imposible en GPU»: `generate` ofrece `--device` y Python permite `.to("cuda")`. El README actual advierte que la mejora depende del equipo y que GPU no tiene soporte oficial completo; `serve` no expone dispositivo. No se prometen ventajas ni compatibilidad en una 2080 Super. Los binarios Rust oficiales se anuncian como CPU-only y no cargan checkpoints de entrenamiento.

### Licencias: tres capas distintas

1. **Programa:** MIT de Pocket TTS; conservar avisos al redistribuirlo.
2. **Pesos:** CC BY 4.0 y términos publicados de Kyutai; atribuir modelo y modificaciones cuando corresponda.
3. **Referencia:** cada grabación puede ser CC0, CC BY, CC BY-SA, NC, ND o tener derechos inciertos. Un embedding no debe usarse como supuesto mecanismo para borrar esas obligaciones.

**CC BY-SA:** permite uso comercial con condiciones de atribución, aviso de cambios y compartir adaptaciones distribuidas bajo la licencia aplicable. Al compartir una muestra recortada/limpiada, conserva su trazabilidad y analiza si es una adaptación. **No se afirma que todo audio sintético o todo el software quede automáticamente bajo ShareAlike:** la aplicación al embedding y a la salida requiere análisis jurídico del caso.

**NC:** no usar comercialmente sin autorización adicional. **ND:** no asumir permiso para distribuir adaptaciones. CC0/dominio público no elimina derechos de personalidad, privacidad ni la exigencia de consentimiento explícito para clonar establecida por Kyutai.

Buenas prácticas: documentar autorización del hablante, fuente exacta, licencia/revisión, cambios y propósito; etiquetar audio sintético; no imitar a una persona para engañar. No intentar identificar contribuyentes anónimos de corpus.

### Qué no se pudo verificar

- El contenido íntegro del informe técnico en su URL original mediante `curl`.
- Acento de cada voz; licencia y consentimiento específico de los archivos originales de lola, giovanni, juergen y rafael; que el último provenga realmente de YouTube.
- Licencia de ipsilondev, del servidor ai-joe y de los audios españoles de VoxForge/M-AILABS/CSS10; ficha actual específica de Common Voice es y sus condiciones de acceso.
- Espejos HF equivalentes para Perú/Puerto Rico/Venezuela; que tts-hub sea accesible públicamente.
- Beneficio auditivo/latencia real de reescrituras, modelos pequeños, mejoras de limpieza, fine-tuning o mezcla de modelos en tehablo; compatibilidad de GPU y despliegue offline completo.

## 12. Catálogo de mejoras posibles

**Solo documentación.** El esfuerzo es una estimación relativa (bajo/medio/alto), no un presupuesto ni una promesa. «Oficial» señala un mecanismo existente, no que tehablo ya lo exponga en su interfaz. Comprueba de nuevo los PR antes de planificar trabajo.

| Qué | Cómo | Esfuerzo | ¿Requiere tocar Pocket TTS? | Estado |
|---|---|---|---|---|
| Mejor voz española | Referencia nativa limpia y autorizada; comparar con lola | Bajo | No | **Oficial**: clonación con pesos autorizados |
| Cargar voces más rápido | `export-voice`, caché por modelo/referencia | Bajo | No | **Oficial** |
| Mejor modelo español | `spanish_24l`, comparar calidad y tiempo | Bajo | No | **Oficial**, preliminar |
| Menos RAM y posible aceleración | `quantize=True` / `--quantize` en CPU | Bajo | No | **Oficial**, depende de backend |
| Evitar recargar en cada frase | Mantener modelo/estado en memoria o `serve` | Bajo | No | **Oficial** |
| Menos cortes finales | Ajustar EOS/cuadros con batería corta y larga | Bajo | No | **Oficial**; ajuste concreto no probado |
| Menos omisiones largas | Puntuación, límites de fragmento y revisión de uniones | Medio | No | **Oficial** para chunking; política propia no probada |
| Números/fechas/monedas/siglas | Preprocesamiento contextual; posible num2words | Medio | No | **Números, fechas, horas, ₡/$ y % implementados** en `src/tehablo_numbers.py`; siglas y unidades pendientes |
| Diccionario inglés→reescritura | JSON antes de llamar al modelo, con excepciones | Medio | No | **Idea no probada** en tehablo |
| Diccionario en API/CLI nativa | Seguir `pronunciations=` / `--pronunciations` | Medio | Sí, si se adopta ese parche antes de publicarse | **PR abierto #375**, no disponible localmente |
| Inglés auténtico por tramos | Parser externo, modelo inglés y español, estados separados y concatenación | Alto | No | **Idea no probada** |
| Pausas de duración exacta | Dividir y añadir silencio PCM externamente | Medio | No | **Idea no probada** aquí; workaround comunitario |
| Pausas por etiquetas nativas | `[pause:1]` o SSML break parcial | Medio | Sí, para incorporar la propuesta pendiente | **PR abierto #242**, no fusionado |
| Menos clics en uniones | Evaluar fuente, fade-in y propuesta de descartar primer cuadro | Medio | Sí para el parche propuesto; no para posprocesado externo | **PR abierto #331**; eficacia local no probada |
| Emociones seleccionables | Corpus etiquetado y entrenamiento; no confundir temp con emoción | Alto | No necesariamente en entrenamiento existente; interfaz nueva pendiente | **Idea no probada**, issue #52 abierta |
| Acento castellano específico | Evaluar fine-tune inferencekey y permisos | Medio | No, `--config` | **Oficial** el mecanismo; modelo comunitario no probado |
| Inglés/español mezclados en un solo modelo | Fine-tuning con datos code-switched alineados | Alto | No necesariamente; usa infraestructura de entrenamiento | **Idea no probada** |
| Más acentos latinoamericanos | Verificar fuente/mirror, género y licencia; adaptar selector de voces | Medio | No; requeriría trabajo futuro en la aplicación | **Idea no probada** para pe/pr/ve |
| Ejecución web/ONNX | Evaluar ports, idioma, clonación y licencias concretas | Alto | No al Python oficial; cambia runtime/integración | **Idea no probada** en tehablo |
| API compatible con OpenAI | Evaluar servidor comunitario y seguridad | Medio | No | **Idea no probada** en tehablo |
| Verificación de calidad repetible | Corpus con préstamos, siglas, números, frases cortas/largas; escuchar y medir omisiones/tiempo | Medio | No | **Idea no probada**, siguiente paso aconsejado |

## 13. Fuentes

Las referencias numeradas respaldan lo indicado, no certifican una auditoría jurídica ni pruebas de ejecución de terceros.

1. [Pocket TTS: README oficial](https://github.com/kyutai-labs/pocket-tts), [PyPI](https://pypi.org/project/pocket-tts/), [documentación](https://kyutai-labs.github.io/pocket-tts/).
2. [Licencia del código](https://github.com/kyutai-labs/pocket-tts/blob/main/LICENSE), [usos prohibidos](https://github.com/kyutai-labs/pocket-tts#prohibited-use).
3. [Modelo HF](https://huggingface.co/kyutai/pocket-tts), [API con licencia y gating](https://huggingface.co/api/models/kyutai/pocket-tts), [sin clonación](https://huggingface.co/api/models/kyutai/pocket-tts-without-voice-cloning).
4. [README de tts-voices: licencias por carpeta](https://huggingface.co/kyutai/tts-voices/blob/main/README.md).
5. Código cotejado con el instalado 4.0.1: [CLI](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/main.py), [TTSModel](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/models/tts_model.py), [defaults](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/default_parameters.py), [voces/caché](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/utils/utils.py), [YAML](https://github.com/kyutai-labs/pocket-tts/tree/main/pocket_tts/config).
6. [Entrenamiento oficial](https://github.com/kyutai-labs/pocket-tts/blob/main/training/README.md), [CALM](https://arxiv.org/html/2509.06926v2), [anuncio fechado](https://kyutai.org/blog/2026-01-13-pocket-tts), [URL de informe técnico solicitada](https://kyutai.org/pocket-tts-technical-report/).
7. [#174: problemas de español y respuestas](https://github.com/kyutai-labs/pocket-tts/issues/174).
8. [#115: calidad, referencia acústica y propuestas de voces](https://github.com/kyutai-labs/pocket-tts/issues/115), [Voice-Zero](https://github.com/OwenTyme/voice-zero).
9. [Resemble Enhance LICENSE](https://github.com/resemble-ai/resemble-enhance/blob/main/LICENSE), [DeepFilterNet licencia](https://github.com/Rikorose/DeepFilterNet/blob/main/libDF/Cargo.toml), [Demucs LICENSE](https://github.com/facebookresearch/demucs/blob/main/LICENSE), [RNNoise COPYING](https://github.com/xiph/rnnoise/blob/master/COPYING).
10. OpenSLR [61](https://www.openslr.org/61/), [71](https://www.openslr.org/71/), [72](https://www.openslr.org/72/), [73](https://www.openslr.org/73/), [74](https://www.openslr.org/74/), [75](https://www.openslr.org/75/), [146](https://www.openslr.org/146/), [67](https://www.openslr.org/67/).
11. [Dave 1.0](https://mozilladatacollective.com/datasets/cmid4ir9100bgnu07du03svuc), [Common Voice datasets](https://github.com/common-voice/cv-dataset), [CSS10](https://github.com/Kyubyong/css10), [LibriVox y dominio público por jurisdicción](https://librivox.org/pages/public-domain/).
12. Búsquedas HF: [Perú](https://huggingface.co/api/datasets?search=google-peruvian-spanish), [Puerto Rico](https://huggingface.co/api/datasets?search=google-puerto-rican-spanish), [Venezuela](https://huggingface.co/api/datasets?search=google-venezuelan-spanish), [ylacombe/google](https://huggingface.co/api/datasets?search=ylacombe/google). Script local: [`scripts/get_voices.py`](../scripts/get_voices.py), leído sin modificar ni ejecutar.
13. [Fine-tune castellano](https://huggingface.co/inferencekey/pocket-tts-spanish-24l-castilian), [LoRA/ONNX español anterior](https://huggingface.co/ipsilondev/pocket-tts-spanish-streaming_v2).
14. [Cuantización oficial](https://github.com/kyutai-labs/pocket-tts/blob/main/docs/quantization.md), [caché HF](https://huggingface.co/docs/huggingface_hub/guides/manage-cache).
15. [Procesamiento de texto](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/models/text_chunking.py), [tokenizadores](https://github.com/kyutai-labs/pocket-tts/blob/main/pocket_tts/modules/text_conditioner.py), [num2words](https://github.com/savoirfairelinux/num2words), [LGPL 2.1](https://github.com/savoirfairelinux/num2words/blob/master/COPYING).
16. Pronunciación: [#350](https://github.com/kyutai-labs/pocket-tts/issues/350), [#206](https://github.com/kyutai-labs/pocket-tts/issues/206), [PR #375](https://github.com/kyutai-labs/pocket-tts/pull/375).
17. Pausas, emociones y artefactos: [#6](https://github.com/kyutai-labs/pocket-tts/issues/6), [PR #242](https://github.com/kyutai-labs/pocket-tts/pull/242), [#52](https://github.com/kyutai-labs/pocket-tts/issues/52), [#347](https://github.com/kyutai-labs/pocket-tts/issues/347), [PR #331](https://github.com/kyutai-labs/pocket-tts/pull/331).
