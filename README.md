# teHablo

**Lee en voz alta las respuestas de Pi**, en español y en tu equipo. También puedes usarlo desde una TUI o una consola. Es gratis, funciona solo con CPU (sin GPU ni nube) y, después de la primera descarga, sin internet.

> **En desarrollo.** El proyecto todavía está en desarrollo y puede cambiar. Lo que falta está en la [hoja de ruta](docs/repo-harness/roadmap.md).


https://github.com/user-attachments/assets/ddaaee48-467e-4d6e-a643-2af885896b61


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

<details>
<summary><b>▶ Escuchar las voces aquí</b></summary>

> 🔇 GitHub muestra los videos silenciados: pulsa el altavoz del reproductor para escuchar.

| Voz | Modelo | Peso de la voz | RAM en uso | ¿Cuenta? |
|---|---|---|---|---|
| Lola, Rafael | Pocket | 5–6 MB (se descarga) | ~1 GB | No |
| Facundo, Santiago, Camila, Javiera, Diego, Felipe | Pocket | 10–12 MB (incluida) | ~1 GB | No |
| Regina, Iker | Phonon | dentro del modelo | ~0,3 GB | Solo para descargar |

El modelo se descarga una vez y lo comparten todas sus voces: Pocket `spanish` 219 MB, Phonon 144 MB. Pesos medidos en Windows; RAM medida en Fedora.

**Lola** · la de siempre · Pocket

https://github.com/user-attachments/assets/cb9ec0aa-0ccc-4104-a309-1a17ae2fb6d5


**Rafael** · España · Pocket

https://github.com/user-attachments/assets/db843874-b49a-4a1a-9106-8032db1b9c84


**Regina** · México · Phonon

https://github.com/user-attachments/assets/03e02dc6-7ede-4499-b85e-f8dd64d81e07


**Iker** · España · Phonon

https://github.com/user-attachments/assets/f0bac7f9-5182-4f02-a975-b3946e65ecc9


**Facundo** · Argentina · Pocket

https://github.com/user-attachments/assets/23782567-b111-4253-943c-414fb36a9c6b


**Santiago** · Argentina · Pocket

https://github.com/user-attachments/assets/9dc2ac02-4b7f-4ffd-9e5b-5174c409c38f


**Camila** · Chile · Pocket

https://github.com/user-attachments/assets/19f07f13-be0c-42ae-b54c-d95b520dc00a


**Javiera** · Chile · Pocket

https://github.com/user-attachments/assets/ffbd2396-c67b-412d-8ac3-702e31c4c99c


**Diego** · Chile · Pocket

https://github.com/user-attachments/assets/34025bfe-438a-47f2-b0ef-4af05b3ee493


**Felipe** · Colombia · Pocket

https://github.com/user-attachments/assets/d44264cc-69c8-4a47-89f2-b24463895593


</details>

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
| En espera | `[ ■ ] En espera [ ⋯ ]` |

- `[ ▶ ]` lee esa respuesta; en pausa, continúa. `[ ■ ]` detiene y vacía la cola; en una barra **En espera**, cancela solo esa lectura.
- Para leer una selección, **cópiala primero** y pulsa `[ ▶ copiado ]`: Pi no ve la selección del ratón.
- `[ ⋯ ]` abre volumen, velocidad y ajustes; `[ → ]` los oculta.
- `[ ⏻ ]` apaga el servidor y libera el modelo, sin perder tus ajustes.
- Con varias sesiones de Pi abiertas, todas usan el mismo servidor: encenderlo o apagarlo en una lo hace en todas, y la barra de las demás lo muestra en unos segundos. Cada lectura nueva decide si interrumpe o espera, según sus ajustes. Empezar otro turno cancela solo las lecturas de esa sesión; cerrar la sesión conserva el comportamiento anterior.
- Antes de la primera respuesta, la barra aparece sobre el editor sin el botón de leer respuesta.

### Comandos

| Comando | Acción |
|---|---|
| `/tts` | Enciende o apaga el servidor; apagar desactiva la lectura automática |
| `/tts auto` | Activa o desactiva la lectura de cada respuesta al terminar; al activarla enciende el servidor |
| `/tts play [n]` | Lee la última respuesta o la número `n` de la sesión, contando desde la primera |
| `/tts copy` | Lee el texto copiado |
| `/tts pause` | Pausa o continúa |
| `/tts stop` | Detiene la lectura actual y vacía la cola compartida |
| `/tts toolbar` | Muestra u oculta la barra y recuerda la elección; no desactiva la lectura ni los atajos |
| `/tts menu` | Abre los ajustes |
| `/tts dict` | Activa o desactiva el diccionario de pronunciación para la voz actual y lo recuerda |
| `/tts status` | Muestra el estado y la ayuda |

### Ajustes `[ ≡ ]`

Elige **voz**, **volumen**, **velocidad**, **lectura automática** y **atajos de teclado**, o enciende, apaga y reinicia el servidor. Usa clics o ↑↓, ←→, Enter y Esc.

**Si llega otra lectura** permite elegir **Detener** (predeterminado: corta la actual y reproduce la nueva, sin borrar la cola) o **Esperar** (guarda hasta 10 lecturas, en orden de llegada, sin generar su audio todavía). Se aplica a `[ ▶ ]`, `[ ▶ copiado ]`, `/tts play [n]`, `/tts copy` y al modo automático, también entre sesiones. Una lectura en espera comienza cuando termina, se cancela o falla la actual; al empezar una de esta sesión, Pi avisa: «TTS teHablo: Suena la lectura en espera.». Si la cola está llena, muestra una advertencia.

**Barra de controles** muestra u oculta la barra, con el mismo aviso y efecto que `/tts toolbar`: la lectura y los atajos siguen funcionando. Ambas opciones se guardan al cambiarlas.

La tabla muestra el estado de descarga, la RAM aproximada y **Dict** por voz. El diccionario adapta términos como «Python»; desactivarlo no cambia la lectura de números ni la limpieza del texto. Por defecto está apagado en Phonon y encendido en Pocket.

Los ajustes se guardan por usuario en `~/.tehablo/settings.json`. [Detalles de Pi, portapapeles y diagnóstico](docs/desarrollo.md#uso-en-pi).

## Voces

| Nombre | Modelo en Pi | ¿Cuenta? | Licencia de pesos / voz |
|---|---|---|---|
| [`lola`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/lola.mp3) (inicial), [`rafael`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/rafael.mp3) | Pocket `spanish` | No | CC BY 4.0 |
| [`Facundo`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Facundo.mp3), [`Santiago`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Santiago.mp3) (Argentina) | Pocket `spanish` | No | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Camila`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Camila.mp3), [`Javiera`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Javiera.mp3), [`Diego`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Diego.mp3) (Chile), [`Felipe`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Felipe.mp3) (Colombia) | Pocket `spanish` | No | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Regina`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Regina.mp3) (México), [`Iker`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Iker.mp3) (España) | Phonon 40M es | Gratis, solo para descargar | CC BY-NC 4.0: no comercial |

Haz clic en un nombre para escuchar una muestra de unos 6 s (archivos en [`docs/samples/`](docs/samples/), con el mismo volumen que en Pi).

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
