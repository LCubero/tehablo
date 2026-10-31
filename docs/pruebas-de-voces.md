# Pruebas de voces y modelos

Resultados propios de `RH-W-0005`: qué voces y modelos gratuitos probamos en tehablo, cuánto tardan, qué licencia tienen y si suenan igual o mejor que `lola`. Las fuentes sin probar están en el [catálogo maestro](catalogo-gratuito.md) y en [voces gratuitas](voces-gratuitas.md).

## Resumen (2026-10-30)

Opciones de voz que quedaron bien en las escuchas a ciegas con los ajustes de tehablo. Consumo medido en Windows con `samples/benchmark.txt` ([detalle](#consumo-2026-10-30-windows)). Todavía no hay decisión sobre cuáles se incorporan.

| Uso | Voz | Motor | RAM tras hablar | CPU del texto | ¿Token? | Escucha |
|---|---|---|---|---|---|---|
| Mejor calidad | `em_santa` (relatos), `ef_dora`, mezcla 70 % `em_santa` + 30 % `ef_dora` | Kokoro-82M | ~1,1 GiB | 49 s | No | Mejor que `lola` en tres escuchas |
| Mejor calidad | `F2` | Supertonic 3 | ~0,6 GiB | 46 s | No | Mejor que `lola` |
| Mejor calidad | `lola` con `spanish_24l` | Pocket TTS | ~1,8 GiB | 44 s | No | Muy bien: tranquila; genera a solo 1,02× tiempo real |
| Variedad LATAM | `ar-hombre-4310`, `cl-mujer-9334`, `co-hombre-9334`, `cl-hombre-3397`, `ar-hombre-7049`, `cl-mujer-8784` (clonadas de `voices/`) | Pocket TTS | ~0,95 GiB | 17,5 s | Solo para crearlas | Iguales o mejores que `lola` |
| Equilibrio | `lola` | Pocket TTS | ~0,95 GiB | 17,5 s | No | Referencia: bien, algo robótica, tranquila |
| Mínimo consumo | `carlfm` (`x_low`) | Piper | ~0,3 GiB | 3,6 s | No | Igual que `lola` |
| Mínimo consumo, uso personal | `miro` (licencia no comercial) | Piper (OpenVoiceOS) | ~0,3 GiB | 5,1 s | No | Bien: tranquila, ruido de fondo |

Pendiente de probar: NeuTTS Nano Spanish y el ajuste castellano de `inferencekey` (con token), Pocket TTS en ONNX int4 y la velocidad de Kokoro. Kokoro y Supertonic no generan por partes: hay que generarlos frase por frase (primera frase en ~0,3–0,5 s).

## Cómo se prueba

- **Criterio:** solo sirve una voz que suene igual o mejor que `lola` (Pocket TTS `spanish`), sin token de Hugging Face y sin consumir mucho.
- **Texto con ajustes:** el mismo, pasado por el preprocesado de tehablo (texto técnico, diccionario y números):

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré tres errores en el servidor. ¿Quieres que haga el comít ahora, o prefieres revisarlo primero? El veintinueve de octubre de dos mil veintiséis terminamos la instalación, y todo funcionó en menos de cuarenta y cinco segundos.

- **Escucha:** a ciegas, con nombres neutros y `lola` mezclada entre los audios, en dos rondas: primero **sin ajustes** (el texto original, para ver si cada motor funciona solo) y después **con ajustes** de tehablo.
- **Texto sin ajustes:**

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré 3 errores en el servidor. ¿Quieres que haga el commit ahora, o prefieres revisarlo primero? El 29/10/2026 terminamos la instalación, y todo funcionó en menos de 45 segundos.
- **Valoración:** cada escucha se anota con un nivel y, si hace falta, los rasgos que se notaron (ver [cómo se anotan](#cómo-se-anotan-las-escuchas)).
- **Velocidad:** segundos de audio por segundo de generación, en Windows, CPU de 12 hilos, con el modelo ya cargado salvo donde se indica. Más de 1× es más rápido que el tiempo real.
- **Dónde:** entornos aparte en `.repo-harness/tmp/voces/` (ignorado por Git); nada se instala en el entorno del proyecto.

### Cómo se anotan las escuchas

Las valoraciones resumen lo que dijo la persona responsable al escuchar a ciegas, con un vocabulario fijo para poder comparar entre rondas. Formato: `Nivel: rasgos`.

| Nivel | Significado |
|---|---|
| Muy bien | Natural y sin defectos que molesten. |
| Bien | Natural, con algún rasgo leve. |
| Aceptable | Se puede usar, pero se notan defectos. |
| Mal | Los defectos estorban la escucha. |
| Muy mal | No sirve: se entiende mal o suena muy artificial. |

| Rasgo | Significado |
|---|---|
| tranquila | Tono calmado, sin energía. |
| lenta / acelerada | Ritmo más lento o más rápido de lo natural. |
| robótica / sintética | Se nota que es voz generada. |
| volumen alto | Suena más fuerte que las demás (solo en rondas sin volumen igualado). |
| acento español / marcado / extraño / no identificado | Acento de España, muy notorio, incorrecto o que no se reconoce. |
| sibilantes marcadas | Las «s» se oyen demasiado. |
| ruido de fondo, soplidos, temblor | Sonidos que no son la voz. |
| sonidos extraños | Ruidos o sílabas que no corresponden al texto. |
| omite palabras, errores de pronunciación | No lee el texto completo o lo lee mal. |
| ideal para relatos | Tono narrativo, apto para cuentos o audiolibros. |

Sin nivel cuando la escucha no lo indicó.

## Resultados (2026-10-30, Windows)

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

## Consumo (2026-10-30, Windows)

Mismo método y texto que la [tabla de consumo de lola](como-funciona.md#windows): `samples/benchmark.txt` (600 caracteres), un proceso nuevo por motor, modelos ya descargados y sin conexión, síntesis directa sin preprocesado ni reproducción, 3 generaciones (la primera incluye el calentamiento; Chatterbox, una). `lola` se midió con `scripts/measure_tts.py`; los demás, con los mismos campos ([datos](measurements/voces-windows-2026-10-30.json)). Equipo: Ryzen 5 5600X, 12 hilos, 32 GB.

| Motor | RAM tras cargar | RAM tras hablar (pico) | CPU al generar | CPU total del texto | Velocidad | Primer sonido |
|---|---|---|---|---|---|---|
| Pocket TTS `lola` | 772 MiB | 947 MiB (981) | 1,7 núcleos (15 %) | 17,5 s | 3,7× | 0,14 s |
| Pocket TTS `spanish_24l` con `lola` | 1638 MiB | 1848 MiB (2279) | 1,3 núcleos (11 %) | 44,2 s | 1,02× | 0,57 s |
| Supertonic 3 (`F1`) | 462 MiB | 584 MiB (591) | 6,3 núcleos (52 %) | 45,7 s | 5,8× | sin streaming |
| Piper `es_MX-claude-high` | 142 MiB | 363 MiB (364) | 5,7 núcleos (47 %) | 6,9 s | 31× | 0,22 s |
| Piper `es_ES-davefx-medium` | 137 MiB | 420 MiB (420) | 5,8 núcleos (48 %) | 6,0 s | 31× | 0,19 s |
| Kokoro-82M (`ef_dora`) | 399 MiB | 1127 MiB (1136) | 5,4 núcleos (45 %) | 49,3 s | 3,7× | sin streaming |
| Piper `es_ES-carlfm-x_low` | 113 MiB | 299 MiB (299) | 5,8 núcleos (48 %) | 3,6 s | 53× | 0,10 s |
| Piper `miro` (OpenVoiceOS) | — | 327 MiB | 6,0 núcleos | 5,1 s | 36× | 0,16 s |
| Piper `carlfm-high` (friyin) | — | 373 MiB | 5,9 núcleos | 29,7 s | 6,4× | 0,97 s |
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
- **MeloTTS** no arrancó en el primer intento: le faltaba el diccionario `unidic` de MeCab. Con `python -m unidic download` (unos 500 MB) funcionó. También descarga diccionarios de NLTK en `%APPDATA%\nltk_data` si no se redirige esa carpeta.
- **Chatterbox** es 5–6 veces más lento que el tiempo real en CPU: no sirve para leer respuestas en vivo aunque suene bien. En la primera voz cortó la generación por repeticiones (`forcing EOS`), así que puede faltar el final. En Windows necesitó `setuptools<81` para cargar su marca de agua, y descarga datos en `~/.pkuseg` si no se redirige la carpeta de usuario.

## Escucha sin ajustes (2026-10-30)

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

Valoración a ciegas (número de escucha entre paréntesis):

| Voz | Valoración sin ajustes |
|---|---|
| Coqui VITS CSS10 (03) | Bien, la mejor de la ronda: omite todos los símbolos, también la puntuación, porque no están en su vocabulario. |
| Piper `es_AR-daniela-high` (02) | Bien: omite algunos símbolos; mejor que las que los leen todos. |
| Piper `es_ES-sharvard-medium` (06), `es_ES-davefx-medium` (08); Kokoro `em_alex` (04), `em_santa` (07), `ef_dora` (09) | Bien: similares a 02 y 03. |
| Piper `es_MX-claude-high` (10) | Bien: similar a 02 y 03, algo robótica. |
| Piper `es_MX-ald-medium` (01) | Mal: lee todos los símbolos. |
| `lola` (11) | Mal: lee todos los símbolos y la tabla; sin ajustes no sirve para respuestas con markdown. |
| MMS-TTS `spa` (05) | Muy mal. |
| Supertonic 3 | No genera: rechaza el selector de variación del emoji `⚠️` (`U+FE0F`). |

Conclusión: sin ajustes, `lola` es de las peores; los ajustes de tehablo son imprescindibles para Pocket TTS. La comparación justa entre motores es la ronda con ajustes.

## Escucha con ajustes (2026-10-30)

El mismo texto, pasado por todo el proceso de tehablo como en Pi (limpiador de la extensión y luego texto técnico, diccionario y números):

```text
Resumen . Listo, revisé el pul ricuést en guítjab, encontré tres bags en el bákend, el más grave está en tehablo sérver punto pai, dentro de tehablo sérver. Prueba, Resultado. test tech, cincuenta y tres de cincuenta y tres. Servidor, dieciocho de dieciocho . Hice el comít en la rama fit eslash pai ti ti es y abrí la tarea erre hache, doble ve, cero cero cero uno. La ei pi ai devuelve yéison; el rídmi está en enlace a guítjab punto com. El escrípt de páiton procesó quince mil líneas en tres punto cinco segundos, con la ci pi iu al cuarenta y cinco por ciento y a veinticinco grados celsius. ¿Quieres que haga el mérch y el diplói con dóquer ahora? El modo automático queda on eslash off según el ajuste .
```

Valoración a ciegas, sin igualar el volumen (número de escucha entre paréntesis):

| Voz | Valoración con ajustes | Comparada con `lola` |
|---|---|---|
| Kokoro `ef_dora` (13) | Muy bien. | Mejor |
| Supertonic `F2` (16) | Muy bien: acento no identificado. | Mejor |
| Kokoro `em_santa` (02) | Bien: ideal para relatos. | Mejor |
| Supertonic `M4` (07), `M2` (18); Kokoro `em_alex` (15) | Bien. | Mejor |
| Supertonic `F4` (14) | Bien: algo acelerada. | Mejor |
| Supertonic `M5` (04) | Bien: algo tranquila. | Mejor |
| Supertonic `F5` (17) | Aceptable: tranquila, sin ruido. | Mejor |
| Supertonic `F1` (05) | Aceptable: ligeramente robótica. | Mejor |
| Supertonic `F3` (06) | Aceptable: ligeramente robótica, sibilantes marcadas. | Mejor |
| Piper `es_ES-davefx-medium` (10) | Aceptable. | Mejor |
| Piper `es_ES-sharvard-medium` (12) | Aceptable: acento español, ligeramente robótica. | Mejor |
| Coqui VITS CSS10 (11) | Aceptable: algo acelerada. | Parecida |
| Supertonic `M3` (08) | Aceptable: sonido algo extraño. | Parecida |
| Piper `es_AR-daniela-high` (19) | Aceptable: volumen alto, acento marcado, algo acelerada. | Parecida |
| `lola` (03) | Algo robótica. | Referencia |
| Piper `es_MX-claude-high` (09) | Volumen alto, algo robótica. | Parecida o peor |
| Supertonic `M1` (01) | Mal. | Peor |
| MMS-TTS `spa` (20) | Muy mal: acento extraño. | Peor |
| Piper `es_MX-ald-medium` (21) | Mal: similar a la 20. | Peor |

La columna «comparada con `lola`» es una lectura de las notas, no una puntuación de la persona responsable.

Conclusión: con ajustes, varias voces suenan mejor que `lola`; las mejores son Kokoro `ef_dora` y Supertonic `F2`. Pero cruzado con el [consumo](#consumo-2026-10-30-windows), ninguna gana en todo: Kokoro y Supertonic gastan 2,6–2,8 veces más CPU que `lola` y no generan por partes (no suenan hasta terminar el texto); Piper es el más ligero, pero sus voces quedaron por debajo de las mejores. Límites: una sola escucha, un solo texto técnico y volumen sin normalizar (las voces más fuertes pueden parecer mejores o peores).

## Ronda final (2026-10-30)

Las tres mejores con ajustes y `lola`, con otro texto en tono de conversación, volumen igualado (mismo RMS, −20 dBFS) y a ciegas. Texto leído, ya con ajustes:

```text
Buenos días. Ya terminé de revisar tu proyecto y, la verdad, quedó bastante bien. Hay dos detalles pequeños: un test que falla a veces y un mensaje de error poco claro. ¿Quieres que los arregle ahora o prefieres descansar un rato? Si te parece, mañana a las nueve y treinta seguimos con el diplói en guítjab. Por cierto, ¡felicidades! Llevas veinticinco comíts esta semana.
```

| Puesto | Voz | Valoración | Primera frase lista | Texto completo, frase por frase |
|---|---|---|---|---|
| 1 | Kokoro `em_santa` | Muy bien: sirve para todo, ideal para relatos. | 0,35 s | 6,7 s |
| 2 | Kokoro `ef_dora` | Muy bien. | 0,31 s | 5,9 s |
| 3 | Supertonic `F2` | Bien: soplidos leves al final. | 0,49 s | 6,3 s |
| 4 | `lola` | Aceptable: ligeramente robótica, algo lenta. | 0,78 s (0,12 s en streaming) | 8,7 s |

- **Primer sonido:** generando frase por frase, Kokoro y Supertonic tienen lista la primera frase en menos de medio segundo; así se evita el silencio de 7–9 s que tenían generando el texto entero. No probado aún dentro del servidor de tehablo.
- **Resultado:** en las dos escuchas a ciegas, Kokoro supera a `lola` y `lola` queda última o casi. Kokoro gasta más: ~1,1 GiB de RAM (frente a ~0,95 GiB) y unas 2,8 veces más CPU; no necesita torch ni token, y su modelo se descarga de GitHub.

## Voces que faltaban (2026-10-30)

Las voces de Piper en español sin escuchar y MeloTTS, con el texto de la ronda final, volumen igualado, a ciegas y con `lola`:

| Voz | Valoración |
|---|---|
| Piper `es_ES-carlfm-x_low` | Bien. |
| `lola` | Bien. |
| MeloTTS `ES` | Aceptable: acento español, ligeramente robótica. |
| Piper `es_ES-mls_9972-low` | Muy mal: acento extraño, errores de pronunciación. |
| Piper `es_ES-mls_10246-low` | Muy mal. |

Piper `carlfm` empata con `lola` en la escucha y es la más ligera de todas las probadas: modelo de 27 MB, ~300 MiB de RAM, 3,6 s de CPU para el texto de referencia (5 veces menos que `lola`) y primer sonido en 0,10 s. Candidata para la versión lite (`RH-W-0025`). MeloTTS gasta más que `lola` en todo (1,2–2 GiB, 87,6 s de CPU).

## Mezclas de Kokoro y ajustes de Supertonic (2026-10-30)

Vistazo corto, con el texto de la ronda final, volumen igualado, a ciegas, junto a las originales y `lola`. Kokoro permite mezclar voces sumando sus estilos con pesos; Supertonic permite cambiar los pasos de calidad (`total_steps`, 8 por defecto) y la velocidad (`speed`, 1,05 por defecto).

| Voz | Valoración | CPU del texto |
|---|---|---|
| Kokoro `em_santa` (original) | Muy bien: ideal para relatos (reconocida a ciegas). | — |
| Kokoro 70 % `em_santa` + 30 % `ef_dora` | Muy bien: similar a la original, más neutra. | — |
| Kokoro 50 % `em_santa` + 50 % `ef_dora` | Muy bien: similar a la anterior, menos de relato. | — |
| Kokoro 50 % `ef_dora` + 50 % `em_alex` | Muy bien: acento leve en «claro». | — |
| Supertonic `F2`, 8 pasos (original) | Muy bien. | 32,1 s |
| Supertonic `F2`, 16 pasos, velocidad 1,0 | Muy bien: igual que la original. | 60,1 s |
| Supertonic `F2`, 4 pasos | Mal: sonidos extraños; sin ellos sería aceptable. | 17,5 s |
| `lola` | Aceptable: algo robótica. | — |

- **Mezclas:** sirven para tener más voces sin descargar nada; el peso de cada voz funciona como un dial entre el tono de relato de `em_santa` y uno más neutro.
- **Supertonic:** 8 pasos es el punto justo; duplicarlos dobla la CPU sin mejora audible y bajarlos a 4 iguala la CPU de `lola` pero mete ruido.
- `lola` vuelve a quedar como algo robótica, igual que en las rondas anteriores.

## Voces de la comunidad en Hugging Face (2026-10-30)

Búsqueda en Hugging Face de voces en español públicas (sin token), con el texto de la ronda final, volumen igualado, a ciegas y con `lola`:

| Voz | Valoración | Licencia |
|---|---|---|
| Piper `miro` (`OpenVoiceOS/pipertts_es-ES_miro`), hombre, España | Bien: tranquila, ruido de fondo. | CC BY-NC-ND 4.0: no comercial |
| Piper `carlfm-high` (`friyin/vits-piper-es_ES-carlfm-high`) | Bien: ligeramente robótica, algo acelerada. | dataset de dominio público |
| `lola` | Bien: algo lenta. | — |

- `carlfm-high` sonó peor que `carlfm-x_low` (que empató con `lola`) y gasta 8 veces más CPU (29,7 s frente a 3,6 s): la versión pequeña es mejor opción.
- `miro` es casi tan ligera como `carlfm-x_low` (5,1 s de CPU, 327 MiB), pero su licencia no permite uso comercial.

Descartadas sin escuchar:

| Opción | Motivo |
|---|---|
| `juangonp/kokoro-spanish-onnx` | Su archivo de voces usa `pickle` (cargarlo puede ejecutar código) y no se abrió; su modelo genera exactamente el mismo audio que Kokoro oficial. |
| Voces de `HirCoir` (astra, elena, lilith, dark, yahir, towi, capybara) | Piden token y aprobación del autor. |
| Imitaciones de personas o personajes (Cortana, Veritasium, Lucas Melor, «1 peso de salsa», GLaDOS) | Clones sin consentimiento demostrado; chocan con los términos de uso de voz. |
| `prasadvittaldev/pocket-tts-spanish-onnx-int4` | Pocket TTS español en ONNX int4 (106 MB, sin torch, incluye el codificador para clonar). Necesita el programa de `KevinAHM/pocket-tts-onnx-export`, que ya no existe en GitHub; no se probó. |

## `lola` con `spanish_24l` (2026-10-30)

El modelo grande de Pocket TTS (24 capas) con `lola`, frente a `lola` normal, Kokoro `em_santa` y Supertonic `F2`; texto de la ronda final, volumen igualado y a ciegas:

| Voz | Valoración |
|---|---|
| Supertonic `F2` | Muy bien. |
| `lola` con `spanish_24l` | Muy bien: tranquila, algo lenta. |
| Kokoro `em_santa` | Muy bien: ideal para relatos. |
| `lola` con `spanish` | Bien: tranquila, algo lenta; la más débil de las cuatro. |

`spanish_24l` mejora a `lola` y queda al nivel de las mejores, pero es la opción más pesada de las útiles: ~1,8 GiB de RAM (pico 2,3 GiB), 44,2 s de CPU para el texto de referencia y solo 1,02× tiempo real en este equipo (`scripts/measure_tts.py`, [datos](measurements/voces-windows-2026-10-30.json)); en un equipo más lento podría no generar al ritmo de la reproducción.

## Voces de `voices/` clonadas con Pocket TTS (2026-10-30)

Con token de Hugging Face (términos de `kyutai/pocket-tts` aceptados; token de solo lectura en `.env`, ignorado por Git), cada una de las 18 referencias de `voices/` se convirtió en un estado `.safetensors` con `spanish` (unos 2–4 s por voz, una sola vez). **Verificado:** un estado exportado carga y habla con los pesos **sin clonación** y **sin token**, así que el token solo hace falta para crear la voz.

**Hallazgo:** `scripts/get_voices.py` guarda las referencias como WAV en coma flotante de 32 bits (`astype(np.float32)`), y Pocket TTS solo lee WAV PCM (`wave.Error: unknown format: 3`); por eso las 18 voces nunca se habrían podido usar tal como están. Para la prueba se convirtieron copias a 16 bits; `voices/` y el script no se tocaron.

Tres escuchas a ciegas con `lola` y volumen igualado: texto técnico **sin ajustes**, el mismo **con ajustes** y el texto de conversación de la ronda final (con ajustes). Mismo consumo que `lola`: mismo motor y modelo.

| Voz | Técnico sin ajustes | Técnico con ajustes | Conversación |
|---|---|---|---|
| `ar-hombre-4310` | Mal | Bien: tranquila | Muy bien |
| `ar-hombre-5223` | Muy mal: sonidos extraños | Bien: tranquila | Aceptable: tranquila; falla en «, ¡felicidades!» |
| `ar-hombre-7049` | Muy mal: sonidos extraños suaves | Bien: algo lenta | Muy bien |
| `ar-mujer-5223` | Mal | Bien: ligeramente robótica | Bien |
| `ar-mujer-610` | Muy mal: sonidos extraños | Aceptable: algo sintética | Bien, cerca de muy bien |
| `ar-mujer-8421` | Muy mal: sonidos extraños | Aceptable | Aceptable |
| `cl-hombre-3397` | Muy mal: sonidos extraños suaves | Bien: algo tranquila | Muy bien |
| `cl-hombre-7508` | Muy mal: sonidos extraños suaves | Bien: muy tranquila, algo lenta | Bien: muy tranquila, algo lenta |
| `cl-hombre-8784` | Mal | Bien: algo tranquila | Bien, cerca de muy bien |
| `cl-mujer-7508` | Mal | Mal: ruido o temblor en la voz | Bien: sonido extraño muy leve al final |
| `cl-mujer-8784` | Muy mal: sonidos extraños | Muy bien: algo tranquila | Bien |
| `cl-mujer-9334` | Mal | Bien | Muy bien |
| `co-hombre-2121` | Muy mal: sonidos extraños | Bien: tranquila | Bien |
| `co-hombre-8784` | Muy mal: sonidos extraños suaves | Aceptable: algo lenta | Aceptable: omite palabras |
| `co-hombre-9334` | Mal | Bien: tranquila | Muy bien: algo tranquila |
| `co-mujer-1523` | Muy mal: sonidos extraños | Mal | Aceptable: sonido algo extraño |
| `co-mujer-2484` | Mal | Bien | Bien |
| `co-mujer-9334` | Mal | Bien: tranquila | Aceptable: muy tranquila |
| `lola` | Mal | Bien | Bien: tranquila |

- **Sin ajustes**, todas (también `lola`) leen la tabla y los símbolos; 10 de 19 hacen además sonidos extraños seguidos después de la tabla, hasta «La API» (zona con hash, rama y `RH-W-0001`). Los ajustes de tehablo son imprescindibles para Pocket TTS.
- **Con ajustes**, las clonadas más consistentes en las dos escuchas: `ar-hombre-4310`, `cl-mujer-9334`, `co-hombre-9334`, `cl-hombre-3397`, `ar-hombre-7049` y `cl-mujer-8784`. Las más débiles: `co-mujer-1523`, `co-hombre-8784` (omite palabras; su audio fue el más corto) y `cl-mujer-7508` (ruido o temblor).
- Casi todas suenan tranquilas. La persona responsable echa de menos voces o modos alegres y entusiastas (registrado en `RH-W-0018`, para otro momento).

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
