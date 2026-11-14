# Pruebas de voces y modelos

Resultados propios de `RH-W-0005`: qué voces y modelos gratuitos probamos en teHablo, cuánto tardan, qué licencia tienen y si suenan igual o mejor que `lola`. Las fuentes sin probar están en el [catálogo maestro](catalogo-gratuito.md) y en [voces gratuitas](voces-gratuitas.md).

## Resumen (2026-10-30)

Opciones de voz que quedaron bien en las escuchas a ciegas con los ajustes de tehablo. Consumo medido en Windows con `samples/benchmark.txt` ([detalle](#consumo-2026-10-30-windows)). Sigue pendiente decidir sobre las alternativas no incorporadas; Phonon y las seis clonadas indicadas abajo ya están disponibles en Pi.

| Uso | Voz | Motor | RAM tras hablar | CPU del texto | ¿Token? | Escucha |
|---|---|---|---|---|---|---|
| Mejor calidad | `em_santa` (relatos), `ef_dora`, mezcla 70 % `em_santa` + 30 % `ef_dora` | Kokoro-82M | ~1,1 GiB | 49 s | No | Mejor que `lola` en tres escuchas |
| Mejor calidad | `F2` | Supertonic 3 | ~0,6 GiB | 46 s | No | Mejor que `lola` |
| Mejor calidad | `lola` con `spanish_24l` | Pocket TTS | ~1,8 GiB | 44 s | No | Muy bien: tranquila; genera a solo 1,02× tiempo real |
| Variedad LATAM | `ar-hombre-4310`, `cl-mujer-9334`, `co-hombre-9334`, `cl-hombre-3397`, `ar-hombre-7049`, `cl-mujer-8784` (clonadas de `voices/`; en Pi, desde 2026-11-04: `Facundo`, `Camila`, `Felipe`, `Diego`, `Santiago`, `Javiera`) | Pocket TTS | ~0,95 GiB | 17,5 s | Solo para crearlas | Iguales o mejores que `lola` |
| Equilibrio | `lola` | Pocket TTS | ~0,95 GiB | 17,5 s | No | Referencia: bien, algo robótica, tranquila |
| Más natural y menos consumo (uso no comercial) | `Regina` (mexicana), `Iker` (castellano) | Phonon 40M es | ~0,3 GiB (Fedora) | 8 s (Fedora) | Sí, para descargarlo | Mucho mejor que `lola` (2026-11-03) |
| Mínimo consumo | `carlfm` (`x_low`) | Piper | ~0,3 GiB | 3,6 s | No | Igual que `lola` |
| Mínimo consumo, uso personal | `miro` (licencia no comercial) | Piper (OpenVoiceOS) | ~0,3 GiB | 5,1 s | No | Bien: tranquila, ruido de fondo |

La [velocidad de Kokoro se midió de nuevo el 2026-11-13](#velocidad-de-kokoro-2026-11-13-windows), con texto entero y frase por frase para reducir la espera hasta el primer sonido.

## Cómo se prueba

- **Criterio:** solo sirve una voz que suene igual o mejor que `lola` (Pocket TTS `spanish`), sin token de Hugging Face y sin consumir mucho.
- **Texto con ajustes:** el mismo, pasado por el preprocesado de tehablo (texto técnico, diccionario y números):

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré tres errores en el servidor. ¿Quieres que haga el comít ahora, o prefieres revisarlo primero? El veintinueve de octubre de dos mil veintiséis terminamos la instalación, y todo funcionó en menos de cuarenta y cinco segundos.

- **Escucha:** a ciegas, con nombres neutros y `lola` mezclada entre los audios, en dos rondas: primero **sin ajustes** (el texto original, para ver si cada motor funciona solo) y después **con ajustes** de tehablo.
- **Texto sin ajustes:**

  > Hola, soy tu asistente de voz. Hoy revisé el código y encontré 3 errores en el servidor. ¿Quieres que haga el commit ahora, o prefieres revisarlo primero? El 29/10/2026 terminamos la instalación, y todo funcionó en menos de 45 segundos.
- **Valoración:** cada escucha se anota con un nivel y, si hace falta, los rasgos que se notaron (ver [cómo se anotan](#cómo-se-anotan-las-escuchas)).
- **Velocidad:** segundos de audio por segundo de generación, en Windows, CPU de 12 hilos, con el modelo ya cargado salvo donde se indica. Más de 1× es más rápido que el tiempo real.
- **Entorno de la prueba:** entornos temporales separados, sin instalar nada en el entorno del proyecto. No se conservan como evidencia recuperable; los resultados y límites están en esta guía.

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

| Motor | RAM tras cargar | RAM tras hablar (pico) | CPU al generar | CPU total del texto | Velocidad | Primer fragmento generado |
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

- **Primera frase generada:** generando frase por frase, Kokoro y Supertonic tienen lista la primera frase en menos de medio segundo; así se evita el silencio de 7–9 s que tenían generando el texto entero. No probado aún dentro del servidor de tehablo.
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
| `prasadvittaldev/pocket-tts-spanish-onnx-int4` | Pocket TTS español en ONNX int4 (106 MB, sin torch, incluye el codificador para clonar). Necesita el programa de `KevinAHM/pocket-tts-onnx-export`, que ya no existe en GitHub; no se probó. En su lugar se probó el [exportado ONNX de Kevin AHM](#pocket-tts-en-onnx-sin-pytorch-2026-11-13-windows) el 2026-11-13. |

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

## Phonon 40M es frente a `lola`, `spanish_24l` y Kokoro (2026-11-03, Fedora)

Objetivo de la persona responsable: «que suene muy real, natural y que no consuma mucho, ojala como maximo el doble de ahora, pero que podamos mantener el de ahora». Mismo texto (`samples/benchmark.txt`), sin los ajustes de tehablo, Ryzen 5 5600X con Fedora 44 ([datos](measurements/voces-fedora-2026-11-03.json)); valores de las ejecuciones 2 y 3.

| Opción | RAM tras hablar | CPU del texto | Primer fragmento | Velocidad | Escucha a ciegas |
|---|---|---|---|---|---|
| Pocket TTS `lola` (cuantizado, el actual) | 961 MiB | 10,6 s | 0,07 s | 6,4× | Muy bien: voz ligeramente quebrada, muy poco. |
| Pocket TTS `spanish_24l` con `lola` (cuantizado) | 1504 MiB (pico 2,3 GiB al cargar) | 20,9 s | 0,22 s | 2,5× | Muy bien: como `lola`, ligeramente mejor. |
| Kokoro `ef_dora` (ONNX int8) | 923 MiB | 39,4 s | sin streaming | 5,0× | Bien: algo ronca o sintética. |
| **Phonon 40M es `Regina`** (2 hilos) | **303 MiB** | **8,0 s** | **0,04 s** | **~11×** | **Mucho mejor que `lola`: muy natural; acento latino.** |
| **Phonon 40M es `Iker`** (2 hilos) | **~300 MiB** | **7,7 s** | **0,04 s** | **~11×** | **Mucho mejor que `lola`: natural; algo castellano.** |

Desde el 2026-11-12 teHablo usa Phonon con **1 hilo**: en una VM de 2 núcleos (i5-4300M) leyó tres frases al mismo ritmo que con 2 hilos (34–35 s), con unos 14 s de CPU frente a 17–18 s, picos de ~1,5 núcleos frente a ~1,9 y unos 40 MB menos de RAM.

- Phonon con todos los hilos (12) gasta ~40 s de CPU para el mismo texto; con 2 hilos, 8 s y genera más rápido. Hay que fijar los hilos. Con 4 hilos: 10,3 s y ~15×.
- Phonon no usa torch: importa en 0,1 s y carga en 0,1 s con el modelo en caché (75 MB, `q8`).
- Kokoro con ONNX int8 baja la RAM pero no la CPU (~36–39 s); en esta escucha quedó por debajo de su resultado de octubre (fp32 en Windows).
- Phonon dice que divide el texto por frases (la entonación no sigue entre frases) y que lee mal el texto en otros idiomas; no se comprobó todavía con los ajustes de tehablo ni con texto técnico.

## Volumen de las voces de la tabla (2026-11-04, Fedora)

Misma frase para cada voz, sin ajustes de volumen; una sola generación por voz (Pocket varía un poco entre lecturas, sobre todo los picos).

| Voz | Promedio (RMS) | Pico | Corrección `gain_db` |
|---|---|---|---|
| `lola` | −23,3 dBFS | −3,8 dBFS | 0 (referencia) |
| `rafael` | −25,2 | −4,9 | +2 |
| `Facundo` | −26,1 | −10,0 | +3 |
| `Santiago` | −24,7 | −4,6 | +1,5 |
| `Camila` | −25,6 | −4,8 | +2,5 |
| `Javiera` | −26,3 | −7,7 | +3 |
| `Diego` | −25,3 | −4,2 | +2 |
| `Felipe` | −24,1 | −1,1 | +1 |
| `Regina` | −23,0 | −6,1 | 0 |
| `Iker` | −22,3 | −4,1 | −1 |

Todas salían bajas (lo habitual en voz es −16 a −20 dBFS). La persona responsable escuchó `lola` a ×1, ×1,5 y ×2 y eligió ×1,8 como base; la corrección por voz las iguala a `lola` y los picos por encima de 0,8 se redondean (`soft_limit` en `src/tehablo_server.py`) en lugar de recortarse. Escuchado en Pi: «suena muy bien genial».

## Búsqueda de modelos nuevos (2026-11-05)

Búsqueda web, sin descargar ni probar nada. Datos tomados de las páginas de cada modelo; la licencia queda por confirmar en sus archivos.

| Modelo | Tamaño | CPU | Clonación | Licencia | Nota |
|---|---|---|---|---|---|
| NeuTTS Nano Spanish (Neuphonic, feb. 2026) | ~117 M parámetros activos; versiones GGUF Q8 y Q4 | Sí, «tiempo real o mejor» en portátil, sin cifra publicada | Sí, con 3 a 15 s de audio | NeuTTS Open License v1.0 (comprobada el 2026-11-13): uso gratis y redistribución con copia de la licencia; el uso comercial solo hasta 5 M USD de ingresos al año | Probado el 2026-11-13: suena bien, no incorporado ([resultados](#neutts-nano-spanish-frente-a-lola-y-regina-2026-11-13-windows)). Necesita `espeak-ng`; el audio lleva marca de agua inaudible (no lo descarta); solo trae la voz de ejemplo `mateo`. Antes se anotó que pide token de Hugging Face (ver [Descartados sin probar](#descartados-sin-probar)). |
| CuteTTS (OPPO) | ~230 M parámetros | Dice que sí, pero solo da cifras de GPU | Sí | Apache-2.0 (comprobada el 2026-11-13) | Español entre 5 idiomas. Probado el 2026-11-13: lento en CPU y mucha RAM, no incorporado ([resultados](#cutetts-2026-11-13-windows)). |
| Arm `pocket-tts-es-mix-precision` | 383 MB, 26 perfiles de voz | Optimizado para CPU Arm | No | CC BY 4.0 | No sirve: su motor solo se ofrece en un programa de acceso anticipado de Arm. |

El ajuste castellano de `inferencekey` (1,34 GB, `spanish_24l`) se probó el 2026-11-13 en Windows ([resultados](#ajuste-castellano-de-pocket-tts-2026-11-13-windows)). Ming-3.0-tts (0,5 B) aparece en clasificaciones, pero es más pesado. Licencia de NeuTTS Nano Spanish confirmada el 2026-11-13 en [su texto](https://github.com/neuphonic/neutts/blob/main/LICENSE) (NeuTTS Open License v1.0, 11 de diciembre de 2025): permite usarlo, modificarlo y redistribuirlo gratis entregando una copia de la licencia; el uso comercial, incluido el audio generado, solo vale por debajo de 5 M USD de ingresos al año. Para tehablo, gratis y sin venta, la licencia lo permite. La descarga sigue con acceso restringido: cuenta de Hugging Face y aceptar condiciones, como Phonon. Escuchado a ciegas el 2026-11-13 ([resultados](#neutts-nano-spanish-frente-a-lola-y-regina-2026-11-13-windows)).

## NeuTTS Nano Spanish frente a `lola` y `Regina` (2026-11-13, Windows)

Prueba aislada en una carpeta ignorada por Git, sin cambiar el entorno, las voces ni los ajustes del proyecto. CPU de este PC con Windows; texto técnico de prueba con números y fechas; voz de ejemplo `mateo`, semilla 42, 24 kHz.

| Versión | RAM máxima | Generación | Audio | Ritmo |
|---|---|---|---|---|
| PyTorch | ~4,6 GiB | 53,5 s | 17,5 s | ~3× más lento que el tiempo real |
| GGUF Q4 + decodificador ONNX, referencia precodificada | ~1,9 GiB | 10,9 s | 18,5 s | ~1,7× más rápido que el tiempo real |

Escucha a ciegas A/B/C (`lola`, `Regina`, NeuTTS): la persona responsable consideró que las tres suenan bien, y que Q4 suena igual que PyTorch. Como referencia, `lola` gasta ~0,95 GiB y `Regina` ~0,3 GiB (mediciones anteriores, con otro texto). Resultado: suena bien, pero usa más RAM que `lola` y `Regina`; no se incorpora. Los cuatro repositorios de NeuTTS en Hugging Face piden aceptar condiciones por separado.

## CuteTTS (2026-11-13, Windows)

Prueba aislada en una carpeta ignorada por Git, sin cambiar el entorno, las voces ni los ajustes del proyecto. Modelo `OPPOer/CuteTTS` (Apache-2.0, sin acceso restringido, ~1,2 GB), PyTorch 2.5.1 para CPU con 6 hilos, el mismo texto que NeuTTS, semilla 42, 24 kHz. Cargar el modelo tarda ~26 s.

| Voz | RAM máxima | Generación | Audio | Primer sonido |
|---|---|---|---|---|
| Propia del modelo, sin referencia | ~2,2 GiB | 76 s | 16 s | 12 s |
| Clonada de la referencia de `Facundo` | ~3,6 GiB | 130 s | 21 s | 35 s |
| Clonada de la referencia de `Camila` | ~3,3 GiB | 129 s | 21 s | 33 s |

Va unas 5 a 6 veces más lento que el tiempo real. Escucha directa de los tres audios, no a ciegas: la persona responsable consideró que no suenan lo bastante bien para tanta RAM. Resultado: no se incorpora.

## Ajuste castellano de Pocket TTS (2026-11-13, Windows)

Prueba aislada en una carpeta ignorada por Git, con entorno propio (`pocket-tts` 4.0.1, torch 2.15.0+cpu), sin cambiar el entorno, las voces ni los ajustes del proyecto. Modelo `inferencekey/pocket-tts-spanish-24l-castilian`, ajuste castellano de `spanish_24l` (1,34 GB, float32, CC BY 4.0, atribución a Kyutai e inferencekey). Descargado sin token de Hugging Face: la API indicó `gated: false` y el tokenizador procede del repositorio público `kyutai/pocket-tts-without-voice-cloning`. CPU del PC con Windows de la persona responsable, mismo texto que NeuTTS y CuteTTS y clonación desde copias PCM16 de las referencias consentidas de `Facundo` (`ar-hombre-4310.wav`) y `Camila` (`cl-mujer-9334.wav`). Cargar el modelo tarda ~7 s, con pico de RAM de ~2,9 GiB; preparar cada referencia de voz, ~4–5 s.

| Referencia | RAM al generar | Generación | Audio |
|---|---|---|---|
| `Facundo` | ~1,85 GiB | 20,4 s | 19,5 s |
| `Camila` | ~1,86 GiB | 21,6 s | 21,1 s |

Genera aproximadamente a tiempo real (~0,96–0,98×). Escucha directa, no a ciegas: la persona responsable consideró que suena bien con la referencia de `Facundo` y algo robótica con la de `Camila`. Como referencia, `lola` gasta ~0,95 GiB y `Regina` ~0,3 GiB (mediciones anteriores, con otro texto). Resultado: probado, no incorporado; decidir si se añade como opción queda pendiente junto con Kokoro, Supertonic y Piper.

## Pocket TTS en ONNX, sin PyTorch (2026-11-13, Windows)

Prueba aislada en una carpeta ignorada por Git, sin modificar el proyecto. Pocket TTS español (`spanish`, 6 capas), sin PyTorch, con ONNX Runtime 1.32.0 y Python 3.12 en la CPU del PC con Windows de la persona responsable. Modelo y código de inferencia de `KevinAHM/pocket-tts-onnx`, revisión `58a6d00cf13d239b6748cb0769f35c580a8f606c`, descargados sin token de Hugging Face. Las voces incluidas `lola` y `alba` devolvieron HTTP 401 (requieren cuenta) y se omitieron. Según la ficha: modelos CC BY 4.0 y código Apache 2.0; no se listó un archivo `LICENSE`.

Mismo texto que NeuTTS y CuteTTS, clonando desde copias PCM16 de las referencias consentidas de `Facundo` y `Camila`. El entorno y ambas versiones ocupan ~875 MB en disco. Cargar tarda menos de 2 s y consume ~0,3–0,6 GiB; el consumo alto aparece al clonar desde la grabación completa de referencia. Que `lola` use un estado de voz precalculado es una hipótesis sin verificar.

| Versión / referencia | RAM al generar | CPU del texto | Generación | Audio | Primer sonido |
|---|---|---|---|---|---|
| Comprimida (INT8), `Facundo` | ~3,4 GiB | 55 s | 7,9 s | 24,5 s | 0,16 s |
| Normal (FP32), `Facundo` | ~3,7 GiB | 53 s | 7,7 s | 18,9 s | 0,20 s |
| Comprimida (INT8), `Camila` | ~2,5 GiB | 63 s | 9,1 s | 28,1 s | 0,13 s |
| Normal (FP32), `Camila` | ~2,8 GiB | 56 s | 8,7 s | 18,7 s | 0,17 s |

La generación es más rápida que el tiempo real, pero consume más RAM que `lola` (~0,95 GiB en mediciones anteriores, con otro texto). Escucha directa, no a ciegas: la persona responsable valoró la versión comprimida con `Facundo` como demasiado lenta en el ritmo del habla, con palabras alargadas, y la de `Camila` como muy mala. Resultado global: peor sonido y consumo elevado; descartado, no incorporado.

## Velocidad de Kokoro (2026-11-13, Windows)

Prueba aislada en CPU del PC con Windows de la persona responsable, con `kokoro-onnx` 0.6.1 y onnxruntime 1.31.1, sin PyTorch ni token y sin descargar nada: se usaron modelos locales existentes. Mismo texto que NeuTTS y CuteTTS; una sola ejecución por configuración, sin calentamiento. El modelo normal `kokoro-v1.0.onnx` ocupa 325 MB, carga en 1,0–1,8 s y usa 0,42 GB tras cargar; el comprimido `kokoro-v1.0.int8.onnx`, 92 MB, ~1,2 s y 0,20 GB.

| Modelo | Voz | Forma | RAM (GB) | CPU del texto | Generación | Audio | Primer sonido |
|---|---|---|---|---|---|---|---|
| Normal | `ef_dora` | Texto entero | 0,79 | 24,4 s | 5,2 s | 16,0 s | — |
| Normal | `ef_dora` | Frase por frase | 0,60 | 25,6 s | 5,0 s | 16,2 s | 0,69 s |
| Normal | `em_santa` | Texto entero | 0,78 | 25,3 s | 5,0 s | 16,1 s | — |
| Normal | `em_santa` | Frase por frase | 0,60 | 25,9 s | 4,9 s | 16,7 s | 0,66 s |
| Comprimido | `ef_dora` | Texto entero | 0,60 | 23,8 s | 4,5 s | 15,8 s | — |
| Comprimido | `ef_dora` | Frase por frase | 0,38 | 23,4 s | 4,6 s | 16,2 s | 0,62 s |
| Comprimido | `em_santa` | Texto entero | 0,60 | 24,2 s | 4,8 s | 15,9 s | — |
| Comprimido | `em_santa` | Frase por frase | 0,39 | 25,2 s | 5,0 s | 16,8 s | 0,66 s |

Escucha directa, no a ciegas, de la versión comprimida frase por frase: `ef_dora` no terminó de convencer por un sonido algo extraño; `em_santa` volvió a gustar, con buen sonido y adecuada para relatos.

Resultado: Kokoro fue el motor con menos RAM y generación más rápida de los probados el 2026-11-13 (CuteTTS, ajuste castellano, NeuTTS y Pocket TTS ONNX). Generar frase por frase permite el primer sonido en ~0,6–0,7 s. Como referencia, `lola` usó ~0,95 GiB en una medición anterior con otro texto; no es una comparación directa. El 2026-10-30 Kokoro gastó ~2,8 veces más CPU que `lola`, dato que esta prueba no sustituye. No incorporado: la versión comprimida de `em_santa` frase por frase es la candidata más sólida hasta ahora; su incorporación sigue pendiente de decisión de la persona responsable.

## Klein-TTS (2026-11-13, Windows)

Prueba en CPU del PC con Windows de la persona responsable, con el mismo texto de las secciones anteriores. [Klein-TTS X1.5-Pro](https://huggingface.co/klein-ml/Klein-TTS-X1.5-Pro), de Klein ML, se publicó el 2026-11-03: 13,1 M de parámetros y modelo de 51 MB. Licencia Apache-2.0 verificada en `LICENSE`; sin token. El paquete `kleintts` necesita PyTorch CPU (carpeta de prueba de 986 MB); el `espeak-ng` incluido funcionó en Windows. No genera en streaming. Las variantes Flash no incluyen voces en español.

| Voz | RAM (GB) | CPU del texto | Generación | Audio |
|---|---|---|---|---|
| Lucia (mujer) | 0,48 | 9,5 s | 5,3 s | 16,2 s |
| Mateo (hombre) | 0,47 | 6,0 s | 1,8 s | 16,5 s |
| Diego (hombre) | 0,47 | 7,1 s | 2,3 s | 16,7 s |

Escucha directa, no a ciegas: las tres voces resultaron aceptables, pero roncas, con quiebres y algo de ruido; Diego suena prácticamente igual que Kokoro `em_santa`. La ficha declara entrenamiento por destilación con habla sintética; que proceda de Kokoro es una hipótesis sin verificar, no una procedencia demostrada.

Resultado: no incorporado; suena peor que Kokoro `em_santa`.

## ZONOS3-Mini (2026-11-13, no probado en Windows)

Revisión de [ZONOS3-Mini de Zyphra](https://huggingface.co/Zyphra/ZONOS3-Mini), publicado el 2026-11-11, sin token. Código de ejecución MIT verificado; pesos Apache-2.0 solo según la ficha. Los pesos cuantizados mínimos ocupan ~1,16 GB. Incluye las voces españolas Rodrigo y Ximena y controles expresivos como `mood.valence`, `mood.arousal` y `delivery.tempo`.

No se pudo probar en Windows: la dependencia `pyicu-wheels==2.14` no tiene rueda `win_amd64` y no hay binarios precompilados del motor. No se descargaron los pesos ni se midieron consumo, velocidad o calidad de voz.

Prueba en Linux el mismo día, en la máquina virtual de pruebas (Ubuntu, i5-4300M de 2 núcleos, 7,4 GB de RAM), con la referencia en PyTorch para CPU en una carpeta aparte, sin tocar la instalación de tehablo: al cargar el modelo la RAM llegó a 5,7 GiB sin terminar la carga, y la prueba se detuvo para no agotar la memoria. Ocupó 12 GB de disco (9,8 GB de modelos). No generó audio.

Resultado: descartado por RAM (más de 6 veces la de `lola` solo al cargar); no incorporado.

## em_santa clonada en otros motores (2026-11-13, Windows)

Prueba en CPU del PC con Windows de la persona responsable, con el mismo texto de las secciones anteriores y un WAV sintético de Kokoro `em_santa` como referencia (Apache-2.0). La RAM de las clonaciones incluye la carga y la preparación de la voz.

| Motor | RAM (GB) | CPU del texto | Generación | Audio | Primer sonido | Modelo (MB) |
|---|---|---|---|---|---|---|
| Kokoro original comprimido (referencia) | 0,39 | 25 s | 5,0 s | 16,8 s | 0,7 s | 92 |
| Ajuste castellano | 3,07 | 18,7 s | 15,1 s | 16,5 s | — | 1345 |
| Pocket sin PyTorch comprimido | 2,58 | 37,6 s | 5,4 s | 16,4 s | 0,13 s | 146 |
| Pocket sin PyTorch normal | 2,87 | 49,1 s | 8,0 s | 16,0 s | 0,19 s | 440 |

Pocket `spanish` (motor de `lola`) no estuvo disponible sin conexión: su tokenizador no estaba en el caché local y clonar desde audio requiere pesos con acceso restringido.

Resultado: clonaciones descartadas sin escucha por decisión de la persona responsable, porque consumen mucha más RAM que la voz original. Criterio: descartar motores o clones que aproximadamente dupliquen la RAM de la voz original. No incorporadas.

## Mezclas de Kokoro (2026-11-13, Windows)

Prueba aislada en una carpeta aparte, en CPU del PC con Windows de la persona responsable, con `kokoro-onnx` 0.6.1 y el modelo comprimido `kokoro-v1.0.int8.onnx` (92 MB en disco). Mismo texto de prueba, generado frase por frase; las voces se mezclaron mediante sumas ponderadas de sus vectores de estilo. Complementa la prueba de [mezclas de Kokoro y ajustes de Supertonic del 2026-10-30](#mezclas-de-kokoro-y-ajustes-de-supertonic-2026-10-30).

| Orden | Voz | RAM (GB) | CPU del texto | Generación | Audio | Primer sonido |
|---|---|---|---|---|---|---|
| 1 | `em_santa` original | 0,39 | 25 s | 5,0 s | 16,8 s | 0,66 s |
| 2 | 70 % `em_santa` + 30 % `em_alex` | 0,39 | 23,4 s | 4,4 s | 16,6 s | 0,62 s |
| 3 | 50 % `em_santa` + 50 % `em_alex` | 0,39 | 23,3 s | 4,4 s | 16,6 s | 0,58 s |
| 4 | 70 % `em_santa` + 30 % `ef_dora` | 0,39 | 24,0 s | 4,5 s | 16,5 s | 0,62 s |
| 5 | 85 % `em_santa` + 15 % `ef_dora` | 0,39 | 23,4 s | 4,3 s | 16,6 s | 0,57 s |

Resultado de la escucha directa, no a ciegas: las cinco opciones suenan bien y son muy similares. La persona responsable señaló la mezcla 50 % `em_santa` + 50 % `em_alex` como probable preferida, sin una diferencia clara frente a las demás. Mezclar no añade consumo de RAM, CPU ni espacio en disco. No incorporadas; la decisión sigue pendiente.

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
| Phonon 40M es (Gradium) | `ptts` MIT o Apache-2.0 | CC BY-NC 4.0, acceso restringido en Hugging Face (aceptar términos y token) | ~100 voces propias (`gradium/phonon-voices`, CC BY-NC 4.0); sin clonación en el modelo abierto | Solo uso no comercial; el uso comercial requiere hablar con Gradium. |

Licencias leídas de los archivos `LICENSE`, las fichas de Hugging Face y las `MODEL_CARD` de Piper; no es asesoría legal.

## Descartados sin probar

| Opción | Motivo |
|---|---|
| XTTS-v2, Silero, F5-Spanish | Licencia no comercial; F5 y XTTS además son pesados en CPU. MMS-TTS también es no comercial (CC BY-NC 4.0), pero se probó como referencia. |
| Edge TTS | Necesita internet; no es local. |
| Kitten TTS | Solo inglés, sin comprobar. |
