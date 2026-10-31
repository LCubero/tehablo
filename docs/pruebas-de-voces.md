# Pruebas de voces y modelos

Resultados propios de `RH-W-0005`: qué voces y modelos gratuitos probamos en tehablo, cuánto tardan, qué licencia tienen y si suenan igual o mejor que `lola`. Las fuentes sin probar están en el [catálogo maestro](catalogo-gratuito.md) y en [voces gratuitas](voces-gratuitas.md).

## Cómo se prueba

- **Criterio:** solo sirve una voz que suene igual o mejor que `lola` (Pocket TTS `spanish`), sin token de Hugging Face y sin consumir mucho.
- **Texto con ajustes:** el mismo, pasado por el preprocesado de tehablo (texto técnico, diccionario y números):

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré tres errores en el servidor. ¿Quieres que haga el comít ahora, o prefieres revisarlo primero? El veintinueve de octubre de dos mil veintiséis terminamos la instalación, y todo funcionó en menos de cuarenta y cinco segundos.

- **Escucha:** a ciegas, con nombres neutros y `lola` mezclada entre los audios, en dos rondas: primero **sin ajustes** (el texto original, para ver si cada motor funciona solo) y después **con ajustes** de tehablo.
- **Texto sin ajustes:**

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré 3 errores en el servidor. ¿Quieres que haga el commit ahora, o prefieres revisarlo primero? El 29/10/2026 terminamos la instalación, y todo funcionó en menos de 45 segundos.
- **Velocidad:** segundos de audio por segundo de generación, en Windows, CPU de 12 hilos, con el modelo ya cargado salvo donde se indica. Más de 1× es más rápido que el tiempo real.
- **Dónde:** entornos aparte en `.repo-harness/tmp/voces/` (ignorado por Git); nada se instala en el entorno del proyecto.

## Resultados (2026-10-31, Windows)

| Motor | Voz | Acento | Velocidad | Tamaño en disco | ¿Token? | Escucha con ajustes |
|---|---|---|---|---|---|---|
| Pocket TTS `spanish` | `lola` (referencia) | sin verificar | 3,6× | 215 MB (pesos sin clonación) | No | referencia |
| Supertonic 3 | F1–F5, M1–M5 | sin verificar | 5,4–5,7× | 385 MB | No | ver abajo |
| Piper | `es_MX-claude-high` | México | ≥ 5,6× con carga | 63 MB | No | ver abajo |
| Piper | `es_MX-ald-medium` | México | ≥ 5,1× con carga | 63 MB | No | ver abajo |
| Piper | `es_ES-davefx-medium` | España | ≥ 3,8× con carga | 63 MB | No | ver abajo |
| Piper | `es_ES-sharvard-medium` | España | ≥ 4,4× con carga | 77 MB | No | ver abajo |
| Piper | `es_AR-daniela-high` | Argentina | ≥ 2,3× con carga | 114 MB | No | ver abajo |
| Chatterbox multilingüe | clona `voices/ar-mujer-610` | Argentina (referencia) | 0,16× | 3,0 GB | No | ver abajo |
| Chatterbox multilingüe | clona `voices/co-hombre-2121` | Colombia (referencia) | 0,19× | 3,0 GB | No | ver abajo |
| Kokoro-82M (`kokoro-onnx`) | `ef_dora`, `em_alex`, `em_santa` | sin verificar | 3,3–3,5× | 338 MB | No | ver abajo |
| Coqui VITS CSS10 (`sherpa-onnx`) | única | sin verificar | 19× | 68 MB | No | ver abajo |
| MMS-TTS `spa` de Meta (`sherpa-onnx`) | única | sin verificar | 4,1× | 109 MB | No | ver abajo |
| MeloTTS `ES` | única | España | 1,7× | 199 MB | No | ver abajo |
| Piper | `es_ES-carlfm-x_low` | España | ≥ 53× | 27 MB | No | ver abajo |
| Piper | `es_ES-mls_10246-low`, `es_ES-mls_9972-low` | España | — | — | No | ver abajo |

La velocidad de esta tabla es de la primera ronda (texto con ajustes); la de consumo, abajo, es la de referencia.

## Consumo (2026-10-31, Windows)

Mismo método y texto que la [tabla de consumo de lola](como-funciona.md#windows): `samples/benchmark.txt` (600 caracteres), un proceso nuevo por motor, modelos ya descargados y sin conexión, síntesis directa sin preprocesado ni reproducción, 3 generaciones (la primera incluye el calentamiento; Chatterbox, una). `lola` se midió con `scripts/measure_tts.py`; los demás, con los mismos campos ([datos](measurements/voces-windows-2026-10-31.json)). Equipo: Ryzen 5 5600X, 12 hilos, 32 GB.

| Motor | RAM tras cargar | RAM tras hablar (pico) | CPU al generar | CPU total del texto | Velocidad | Primer sonido |
|---|---|---|---|---|---|---|
| Pocket TTS `lola` | 772 MiB | 947 MiB (981) | 1,7 núcleos (15 %) | 17,5 s | 3,7× | 0,14 s |
| Supertonic 3 (`F1`) | 462 MiB | 584 MiB (591) | 6,3 núcleos (52 %) | 45,7 s | 5,8× | sin streaming |
| Piper `es_MX-claude-high` | 142 MiB | 363 MiB (364) | 5,7 núcleos (47 %) | 6,9 s | 31× | 0,22 s |
| Piper `es_ES-davefx-medium` | 137 MiB | 420 MiB (420) | 5,8 núcleos (48 %) | 6,0 s | 31× | 0,19 s |
| Kokoro-82M (`ef_dora`) | 399 MiB | 1127 MiB (1136) | 5,4 núcleos (45 %) | 49,3 s | 3,7× | sin streaming |
| Piper `es_ES-carlfm-x_low` | 113 MiB | 299 MiB (299) | 5,8 núcleos (48 %) | 3,6 s | 53× | 0,10 s |
| MeloTTS `ES` | 1316 MiB | 1239 MiB (1994) | 5,8 núcleos (48 %) | 87,6 s | 2,6× | sin streaming |
| Coqui VITS CSS10 | 135 MiB | 380 MiB (405) | 3,9 núcleos (33 %) | 6,4 s | 19× | sin streaming |
| MMS-TTS `spa` | 175 MiB | 410 MiB (434) | 3,9 núcleos (33 %) | 34,3 s | 4,5× | sin streaming |
| Chatterbox (clona `co-hombre-2121`) | 4487 MiB | 5758 MiB (7065) | 5,7 núcleos (48 %) | 1342 s | 0,2× | sin streaming |

- **CPU total del texto** es el gasto real: segundos de CPU sumando todos los núcleos para generar los ~36 s de audio. `lola` usa pocos núcleos durante más tiempo; Supertonic y Kokoro terminan antes porque ocupan casi la mitad del equipo, pero gastan 2,6–2,8 veces más CPU.
- **Sin streaming:** el motor entrega el audio completo de una vez, así que la primera palabra suena cuando termina toda la generación.
- **Importar librerías:** 0,01–0,3 s y 5–45 MiB en los motores ONNX, frente a ~4,7 s y 350 MiB de torch con `lola` (medido el 2026-10-30); Chatterbox, 7,2 s y 427 MiB; MeloTTS, 14,9 s y 795 MiB.
- Valores de las generaciones 2 y 3 (con el modelo caliente); una sola medición por motor y día.

Notas:

- **Piper** en la tabla de resultados se midió con la línea de comandos, que carga el modelo en cada frase; con el modelo cargado genera unas 35 veces más rápido que el tiempo real.
- **Coqui VITS CSS10** ignora los signos `¿`, `?`, `,` y `.` (no están en su vocabulario), así que lee sin pausas ni entonación de pregunta.
- **MeloTTS** no arrancó en el primer intento: le faltaba el diccionario `unidic` de MeCab. Con `python -m unidic download` (unos 500 MB) funcionó. También descarga diccionarios de NLTK en `%APPDATA%
ltk_data` si no se redirige esa carpeta.
- **Chatterbox** es 5–6 veces más lento que el tiempo real en CPU: no sirve para leer respuestas en vivo aunque suene bien. En la primera voz cortó la generación por repeticiones (`forcing EOS`), así que puede faltar el final. En Windows necesitó `setuptools<81` para cargar su marca de agua, y descarga datos en `~/.pkuseg` si no se redirige la carpeta de usuario.

## Escucha sin ajustes (2026-10-31)

Texto de prueba en markdown, como lo escribe el agente, con todo lo que resuelven los ajustes de tehablo (título, negritas, código, tabla, lista, emojis, flecha, paréntesis, separador, pregunta sin `¿`, inglés, siglas, ruta, rama, hash, `RH-W-0001`, URL, `on/off`, números, porcentaje y grados):

```text
## Resumen ✅

Listo, revisé el **pull request** en GitHub → encontré 3 bugs en el backend (el más grave está en `src/tehablo_server.py`, dentro de `tehablo_server`).

| Prueba | Resultado |
|---|---|
| test_tech | 53/53 |
| Servidor | 18/18 ⚠️ |

- Hice el commit abc1234 en la rama `feat/pi-tts` y abrí la tarea RH-W-0001.
- La API devuelve JSON; el README está en https://github.com/LCubero/tehablo.
- El script de Python procesó 15.000 líneas en 3.5 segundos, con la CPU al 45 % y a 25 °C.

===

Quieres que haga el merge y el deploy con Docker ahora? El modo automático queda on/off según el ajuste 🚀.
```

Veredicto de la persona responsable, a ciegas (número de escucha entre paréntesis):

| Voz | Veredicto sin ajustes |
|---|---|
| Coqui VITS CSS10 (03) | La mejor de la ronda. Su vocabulario no tiene símbolos, así que los omite todos (también la puntuación). |
| Piper `es_AR-daniela-high` (02) | Se salta algunos símbolos; mejor que las que leen todo. |
| Piper `es_ES-sharvard-medium` (06), `es_ES-davefx-medium` (08); Kokoro `em_alex` (04), `em_santa` (07), `ef_dora` (09) | Parecidas a 02 y 03. |
| Piper `es_MX-claude-high` (10) | Parecida a 02 y 03, un poco robótica. |
| Piper `es_MX-ald-medium` (01) | Lee todo, hasta los símbolos; la peor junto con `lola`. |
| `lola` (11) | Lee todo, también la tabla: sin ajustes no sirve para respuestas con markdown. |
| MMS-TTS `spa` (05) | Fatal. |
| Supertonic 3 | No genera: rechaza el selector de variación del emoji `⚠️` (`U+FE0F`). |

Conclusión: sin ajustes, `lola` es de las peores; los ajustes de tehablo son imprescindibles para Pocket TTS. La comparación justa entre motores es la ronda con ajustes.

## Escucha con ajustes (2026-10-31)

El mismo texto, pasado por todo el proceso de tehablo como en Pi (limpiador de la extensión y luego texto técnico, diccionario y números):

```text
Resumen . Listo, revisé el pul ricuést en guítjab, encontré tres bags en el bákend, el más grave está en tehablo sérver punto pai, dentro de tehablo sérver. Prueba, Resultado. test tech, cincuenta y tres de cincuenta y tres. Servidor, dieciocho de dieciocho . Hice el comít en la rama fit eslash pai ti ti es y abrí la tarea erre hache, doble ve, cero cero cero uno. La ei pi ai devuelve yéison; el rídmi está en enlace a guítjab punto com. El escrípt de páiton procesó quince mil líneas en tres punto cinco segundos, con la ci pi iu al cuarenta y cinco por ciento y a veinticinco grados celsius. ¿Quieres que haga el mérch y el diplói con dóquer ahora? El modo automático queda on eslash off según el ajuste .
```

Veredicto de la persona responsable, a ciegas, sin normalizar el volumen (número de escucha entre paréntesis):

| Voz | Veredicto con ajustes | Comparada con `lola` |
|---|---|---|
| Kokoro `ef_dora` (13) | Suena muy bien. | Mejor |
| Supertonic `F2` (16) | Suena muy bien, con un acento que no identifica. | Mejor |
| Kokoro `em_santa` (02) | Suena bien; buenísima para cuentos o relatos. | Mejor |
| Supertonic `M4` (07), `M2` (18); Kokoro `em_alex` (15) | Suena bien. | Mejor |
| Supertonic `F4` (14) | Algo acelerada, pero suena bien. | Mejor |
| Supertonic `M5` (04) | Bien, algo tranquila. | Mejor |
| Supertonic `F5` (17) | Tranquila, limpia, no está mal. | Mejor |
| Supertonic `F1` (05) | No está mal, muy ligeramente robótica. | Mejor |
| Supertonic `F3` (06) | No está mal; se notan las «s»; muy ligeramente robótica. | Mejor |
| Piper `es_ES-davefx-medium` (10) | No está mal. | Mejor |
| Piper `es_ES-sharvard-medium` (12) | No está mal, como española, muy ligeramente robótica. | Mejor |
| Coqui VITS CSS10 (11) | Como acelerada, pero no está tan mal. | Parecida |
| Supertonic `M3` (08) | Suena un poco raro, pero no tan mal. | Parecida |
| Piper `es_AR-daniela-high` (19) | Mucho volumen, con acento, algo acelerada; no está mal. | Parecida |
| `lola` (03) | Algo robótica. | referencia |
| Piper `es_MX-claude-high` (09) | Mucho volumen, algo robótica. | Parecida o peor |
| Supertonic `M1` (01) | No le gustó mucho. | Peor |
| MMS-TTS `spa` (20) | Suena muy mal; acento mal. | Peor |
| Piper `es_MX-ald-medium` (21) | Suena mal, parecida a la 20. | Peor |

La columna «comparada con `lola`» es una lectura de las notas, no una puntuación de la persona responsable.

Conclusión: con ajustes, varias voces suenan mejor que `lola`; las mejores son Kokoro `ef_dora` y Supertonic `F2`. Pero cruzado con el [consumo](#consumo-2026-10-31-windows), ninguna gana en todo: Kokoro y Supertonic gastan 2,6–2,8 veces más CPU que `lola` y no generan por partes (no suenan hasta terminar el texto); Piper es el más ligero, pero sus voces quedaron por debajo de las mejores. Límites: una sola escucha, un solo texto técnico y volumen sin normalizar (las voces más fuertes pueden parecer mejores o peores).

## Ronda final (2026-10-31)

Las tres mejores con ajustes y `lola`, con otro texto en tono de conversación, volumen igualado (mismo RMS, −20 dBFS) y a ciegas. Texto leído, ya con ajustes:

```text
Buenos días. Ya terminé de revisar tu proyecto y, la verdad, quedó bastante bien. Hay dos detalles pequeños: un test que falla a veces y un mensaje de error poco claro. ¿Quieres que los arregle ahora o prefieres descansar un rato? Si te parece, mañana a las nueve y treinta seguimos con el diplói en guítjab. Por cierto, ¡felicidades! Llevas veinticinco comíts esta semana.
```

| Puesto | Voz | Veredicto de la persona responsable | Primera frase lista | Texto completo, frase por frase |
|---|---|---|---|---|
| 1 | Kokoro `em_santa` | Suena muy buena, para todo; excelente para relatos o cuentos. | 0,35 s | 6,7 s |
| 2 | Kokoro `ef_dora` | Suena muy bien. | 0,31 s | 5,9 s |
| 3 | Supertonic `F2` | Suena bien; un poco de soplidos o ruido al final, nada mal. | 0,49 s | 6,3 s |
| 4 | `lola` | Ligeramente robótica, la menos buena, nada mal; algo lenta. | 0,78 s (0,12 s en streaming) | 8,7 s |

- **Primer sonido:** generando frase por frase, Kokoro y Supertonic tienen lista la primera frase en menos de medio segundo; así se evita el silencio de 7–9 s que tenían generando el texto entero. No probado aún dentro del servidor de tehablo.
- **Resultado:** en las dos escuchas a ciegas, Kokoro supera a `lola` y `lola` queda última o casi. Kokoro gasta más: ~1,1 GiB de RAM (frente a ~0,95 GiB) y unas 2,8 veces más CPU; no necesita torch ni token, y su modelo se descarga de GitHub.

## Voces que faltaban (2026-10-31)

Las voces de Piper en español sin escuchar y MeloTTS, con el texto de la ronda final, volumen igualado, a ciegas y con `lola`:

| Voz | Veredicto de la persona responsable |
|---|---|
| Piper `es_ES-carlfm-x_low` | Suena bien. |
| `lola` | Suena bien. |
| MeloTTS `ES` | Española, no está mal, ligeramente robótica. |
| Piper `es_ES-mls_9972-low` | Malísima: acento raro y errores. |
| Piper `es_ES-mls_10246-low` | Horrible. |

Piper `carlfm` empata con `lola` en la escucha y es la más ligera de todas las probadas: modelo de 27 MB, ~300 MiB de RAM, 3,6 s de CPU para el texto de referencia (5 veces menos que `lola`) y primer sonido en 0,10 s. Candidata para la versión lite (`RH-W-0025`). MeloTTS gasta más que `lola` en todo (1,2–2 GiB, 87,6 s de CPU).

## Mezclas de Kokoro y ajustes de Supertonic (2026-10-31)

Vistazo corto, con el texto de la ronda final, volumen igualado, a ciegas, junto a las originales y `lola`. Kokoro permite mezclar voces sumando sus estilos con pesos; Supertonic permite cambiar los pasos de calidad (`total_steps`, 8 por defecto) y la velocidad (`speed`, 1,05 por defecto).

| Voz | Veredicto de la persona responsable | CPU del texto |
|---|---|---|
| Kokoro `em_santa` (original) | La de los relatos; suena muy bien (la reconoció a ciegas). | — |
| Kokoro 70 % `em_santa` + 30 % `ef_dora` | Muy bien; parecida a la de los relatos, pero más normal. | — |
| Kokoro 50 % `em_santa` + 50 % `ef_dora` | Muy parecida a la anterior, menos de relato. | — |
| Kokoro 50 % `ef_dora` + 50 % `em_alex` | Muy bien; un poco de acento en «claro». | — |
| Supertonic `F2`, 8 pasos (original) | Muy bien. | 32,1 s |
| Supertonic `F2`, 16 pasos, velocidad 1,0 | Igual que la original. | 60,1 s |
| Supertonic `F2`, 4 pasos | Ruidos raros; sin ellos no estaría tan mal. | 17,5 s |
| `lola` | Algo robótica, pero no está mal. | — |

- **Mezclas:** sirven para tener más voces sin descargar nada; el peso de cada voz funciona como un dial entre el tono de relato de `em_santa` y uno más neutro.
- **Supertonic:** 8 pasos es el punto justo; duplicarlos dobla la CPU sin mejora audible y bajarlos a 4 iguala la CPU de `lola` pero mete ruido.
- `lola` vuelve a quedar como algo robótica, igual que en las rondas anteriores.

## Licencias

Cada opción tiene tres capas: el programa, el modelo y la voz con la que se entrenó o se clona.

| Motor | Programa | Modelo | Voces | Lo que importa |
|---|---|---|---|---|
| Pocket TTS | MIT | CC BY 4.0 y términos de Kyutai | `lola`: Common Voice, licencia del archivo sin verificar | Prohíbe clonar o suplantar sin consentimiento. |
| Supertonic 3 | MIT | OpenRAIL-M | 10 voces propias | Permite uso comercial con usos prohibidos: suplantar sin consentimiento y presentar el audio como real sin avisar que es generado. Proyecto archivado: sin actualizaciones. |
| Piper | GPL-3.0 (`piper-tts`) | por voz | `davefx` CC0; `carlfm` dominio público; `mls_*` CC BY 4.0; `ald` Unlicense; `claude` Apache-2.0; `sharvard` CC BY 3.0; `daniela` CC BY-SA 4.0 | Distribuir un programa que lo incluya obliga a GPL. |
| Kokoro-82M | `kokoro-onnx` MIT; usa `espeak-ng` (GPL-3.0) a través de `espeakng-loader` (MIT) | Apache-2.0 | voces propias del modelo | Uso comercial libre del modelo; `espeak-ng` es GPL-3.0, así que distribuir un programa que lo incluya tiene la misma condición que Piper. |
| MeloTTS | MIT | MIT | voz propia del modelo | Depende de torch, MeCab/`unidic` y NLTK. |
| Chatterbox | MIT | MIT | clona `voices/` (CC BY-SA 4.0) | Cada audio lleva una marca de agua inaudible (Perth). Publicar audio clonado de `voices/` exige atribución y misma licencia. |

Licencias leídas de los archivos `LICENSE`, las fichas de Hugging Face y las `MODEL_CARD` de Piper; no es asesoría legal.

## Descartados sin probar

| Opción | Motivo |
|---|---|
| Clonación de Pocket TTS, NeuTTS Nano Spanish, ajuste castellano de `inferencekey` | Piden token de Hugging Face (repositorios con acceso restringido). |
| XTTS-v2, Silero, F5-Spanish | Licencia no comercial; F5 y XTTS además son pesados en CPU. MMS-TTS también es no comercial (CC BY-NC 4.0), pero se probó como referencia. |
| Edge TTS | Necesita internet; no es local. |
| Kitten TTS | Solo inglés, sin comprobar. |
