# tehablo

**Lee en voz alta las respuestas de Pi**, en español y en tu equipo. También puedes usarlo desde una TUI o una consola. Es gratis, funciona solo con CPU (sin GPU ni nube) y, después de la primera descarga, sin internet.

> **En desarrollo.** El proyecto todavía está en desarrollo y puede cambiar. Lo que falta está en la [hoja de ruta](docs/repo-harness/roadmap.md).

[Ver tehablo en uso](https://github.com/user-attachments/assets/65c14b22-f1ed-4736-b5c8-ffaa19c254a2)

## Consumo aproximado

| Recurso | Aproximación |
|---|---|
| Disco: entorno Python | 0,8–1,1 GB |
| Disco: modelos Pocket descargados | 1,2 GB en Windows; 0,9 GB en Fedora |
| Disco: modelo Phonon (opcional) | ~0,15 GB |
| RAM: Pocket `spanish` | ~1 GB |
| RAM: Pocket `spanish_24l` | ~1,8 GB |
| RAM: Phonon | ~0,3 GB |
| Procesador | Solo CPU; no usa GPU |

Son referencias, no requisitos mínimos: cambian con el modelo, el sistema y la cuantización. La RAM corresponde al modelo en uso; al apagar el servidor se libera. Consulta las [mediciones Windows/Fedora](docs/como-funciona.md#consumo-medido) y la [comparación con Phonon](docs/pruebas-de-voces.md#phonon-40m-es-frente-a-lola-spanish_24l-y-kokoro-2026-11-03-fedora).

## Instalación

Con [uv](https://docs.astral.sh/uv/) instalado, ejecuta desde la raíz del repositorio:

| Sistema | Comando |
|---|---|
| Linux / macOS | `./install.sh` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File install.ps1` |

Los scripts preparan el entorno, instalan las dependencias y comprueban Torch sin CUDA. En Linux indican cómo instalar PortAudio si falta. Los modelos se descargan al usarlos por primera vez.

Después instala la extensión en Pi con la **ruta absoluta** de tu repositorio:

```text
pi install <ruta>/pi-extension/tehablo-tts
```

Abre Pi o ejecuta `/reload`. La extensión se instala para todos tus proyectos y usa esta carpeta sin copiarla: no la muevas después de instalarla. Los instaladores muestran el comando con tu ruta.

Probado con audio en Windows y Fedora; macOS aún no está verificado. [Instalación manual y entornos por sistema](docs/desarrollo.md#instalación-manual).

## Uso en Pi

Pi empieza con el servidor **apagado**, en modo manual. Pulsa `[ ⏻ TTS ]` para cargar la voz; luego `[ ▶ ]` lee esa respuesta (o usa `/tts play`, que la enciende si hace falta). La voz inicial es `lola`, gratis y sin cuenta; si eliges otra, se recuerda.

### Barra de controles

| Estado | Barra |
|---|---|
| Apagado | `[ ⏻ TTS ] [ ≡ ]` |
| Cargando | `[ Cargando… ] [ ≡ ]` |
| Listo | `[ ▶ ] [ ▶ copiado ] [ ⋯ ]` |
| Controles abiertos | `[ ▶ ] [ ▶ copiado ] [ → ] : [ ≡ ] Vol [- 100% +] Vel [- 1.00x +] [ ⏻ ]` |
| Sonando | `[ ‖ ] [ ■ ] [ ⋯ ]` |
| En pausa | `[ ▶ ] [ ■ ] [ ⋯ ]` |

- `[ ▶ ]` lee esa respuesta; en pausa, continúa. `[ ■ ]` solo detiene.
- Para leer una selección, **cópiala primero** y pulsa `[ ▶ copiado ]`: Pi no ve la selección del ratón.
- `[ ⋯ ]` abre volumen, velocidad y ajustes; `[ → ]` los oculta.
- `[ ⏻ ]` apaga el servidor y libera el modelo, sin perder tus ajustes.
- Antes de la primera respuesta, la barra aparece sobre el editor sin el botón de leer respuesta.

### Comandos

| Comando | Acción |
|---|---|
| `/tts` | Enciende o apaga el servidor; apagar desactiva la lectura automática |
| `/tts auto` | Activa o desactiva la lectura de cada respuesta al terminar; al activarla enciende el servidor |
| `/tts play [n]` | Lee la última respuesta o la número `n` de la sesión, contando desde la primera |
| `/tts copy` | Lee el texto copiado |
| `/tts pause` | Pausa o continúa |
| `/tts stop` | Detiene la lectura |
| `/tts toolbar` | Muestra u oculta la barra y recuerda la elección; no desactiva la lectura ni los atajos |
| `/tts menu` | Abre los ajustes |
| `/tts dict` | Activa o desactiva el diccionario de pronunciación para la voz actual y lo recuerda |
| `/tts status` | Muestra el estado y la ayuda |

### Ajustes `[ ≡ ]`

Elige **voz**, **volumen**, **velocidad**, **lectura automática** y **atajos de teclado**, o enciende, apaga y reinicia el servidor. Usa clics o ↑↓, ←→, Enter y Esc.

La tabla muestra el estado de descarga, la RAM aproximada y **Dict** por voz. El diccionario adapta términos como «Python»; desactivarlo no cambia la lectura de números ni la limpieza del texto. Por defecto está apagado en Phonon y encendido en Pocket.

Los ajustes se guardan por usuario en `~/.tehablo/settings.json`. [Detalles de Pi, portapapeles y diagnóstico](docs/desarrollo.md#uso-en-pi).

## Voces

| Nombre | Modelo en Pi | ¿Cuenta? | Licencia de pesos / voz |
|---|---|---|---|
| [`lola`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/lola.mp3) (inicial), [`rafael`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/rafael.mp3) | Pocket `spanish` | No | CC BY 4.0 |
| [`Facundo`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Facundo.mp3), [`Santiago`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Santiago.mp3) (Argentina) | Pocket `spanish` | No | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Camila`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Camila.mp3), [`Javiera`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Javiera.mp3), [`Diego`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Diego.mp3) (Chile), [`Felipe`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Felipe.mp3) (Colombia) | Pocket `spanish` | No | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Regina`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Regina.mp3) (México), [`Iker`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Iker.mp3) (España) | Phonon 40M es | Gratis, solo para descargar | CC BY-NC 4.0: no comercial |

<details>
<summary><b>▶ Escuchar las voces aquí</b></summary>

**lola** · la de siempre · Pocket

<!-- Arrastra aquí lola.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**rafael** · España · Pocket

<!-- Arrastra aquí rafael.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Regina** · México · Phonon

<!-- Arrastra aquí Regina.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Iker** · España · Phonon

<!-- Arrastra aquí Iker.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Facundo** · Argentina · Pocket

<!-- Arrastra aquí Facundo.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Santiago** · Argentina · Pocket

<!-- Arrastra aquí Santiago.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Camila** · Chile · Pocket

<!-- Arrastra aquí Camila.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Javiera** · Chile · Pocket

<!-- Arrastra aquí Javiera.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Diego** · Chile · Pocket

<!-- Arrastra aquí Diego.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

**Felipe** · Colombia · Pocket

<!-- Arrastra aquí Felipe.mp4 (.repo-harness/tmp/videos/) y deja el enlace en su propia línea. -->

</details>

También puedes hacer clic en un nombre para escuchar una muestra de unos 6 s (archivos en [`docs/samples/`](docs/samples/), con el mismo volumen que en Pi).

Phonon es opcional: al elegirlo, los ajustes te guían para aceptar las condiciones de Hugging Face y pegar un token de solo lectura. El token queda en memoria durante esa sesión; después de descargarlo no hace falta. Si no carga, se usa `lola` y Pi avisa.

Clona solo voces que tengas permiso para usar. [Catálogo, clonación y atribución](docs/desarrollo.md#voces).

## TUI y consola

Ambas usan Pocket TTS. Ejecuta desde la raíz con el Python de tu entorno:

| Interfaz | Windows | Linux / macOS |
|---|---|---|
| TUI | `.venv-pocket\Scripts\python src/tehablo_tui.py` | `.venv-pocket/bin/python src/tehablo_tui.py` |
| Consola | `.venv-pocket\Scripts\python src/tehablo_tts.py` | `.venv-pocket/bin/python src/tehablo_tts.py` |

Si el instalador creó un entorno con sufijo de sistema, usa ese nombre.

- **TUI:** pega texto, elige voz, modelo y velocidad; pulsa **F5** para escuchar, **F6** para detener y **F7** para guardar.
- **Consola:** escribe texto y pulsa Enter; para un archivo usa `/leer archivo.txt`.

[Todos los atajos y comandos](docs/desarrollo.md#uso-tui).

## Más documentación

- [Cómo funciona y mediciones de recursos](docs/como-funciona.md)
- [Uso detallado, instalación manual, pruebas y problemas conocidos](docs/desarrollo.md)
- [Pronunciación y personalización del texto](docs/pronunciacion.md)
- [Pocket TTS: referencia, catálogo y mejoras posibles](docs/pocket-tts.md)
- [Fuentes de voces gratuitas](docs/voces-gratuitas.md) · [Otros motores gratuitos](docs/catalogo-gratuito.md)
- [Hoja de ruta](docs/repo-harness/roadmap.md) · [Cómo contribuir](CONTRIBUTING.md)
- [Mapa documental](docs/repo-harness/README.md) · [Guía del harness de IA](docs/repo-harness/usage.md)

Licencia del proyecto: [MIT](LICENSE).
