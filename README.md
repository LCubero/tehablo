# teHablo

**Lee en voz alta las respuestas de Pi**, en español y en tu equipo. También puedes usarlo desde una TUI o una consola. Es gratis, funciona solo con CPU (sin GPU ni nube) y, después de la primera descarga, sin internet.

teHablo puede sonar en tu computadora aunque Pi esté en un VPS: consulta [Audio por SSH](#audio-por-ssh). Por defecto el sonido sale donde corre Pi.

> **En desarrollo.** El proyecto todavía está en desarrollo y puede cambiar. Lo que falta está en la [hoja de ruta](docs/repo-harness/roadmap.md).


https://github.com/user-attachments/assets/ddaaee48-467e-4d6e-a643-2af885896b61


## Consumo aproximado

| Modelo | Espacio en disco | RAM |
|---|---|---|
| Entorno Python | 0,8–1,1 GB | — |
| Pocket `spanish` | 0,9–1,2 GB² | ~1 GB |
| Pocket `spanish_24l` | (incluido arriba) | ~1,8 GB |
| Phonon¹ | ~0,15 GB | ~0,3 GB |

Todo funciona solo con CPU, sin GPU.

¹ Necesita una cuenta gratis de Hugging Face.

² Los dos modelos Pocket juntos: 1,2 GB en Windows y 0,9 GB en Fedora.

Son referencias, no requisitos mínimos: cambian con el modelo, el sistema y la cuantización. La RAM corresponde al modelo en uso; al apagar el servidor se libera. Consulta las [mediciones Windows/Fedora](docs/como-funciona.md#consumo-medido) y la [comparación con Phonon](docs/pruebas-de-voces.md#phonon-40m-es-frente-a-lola-spanish_24l-y-kokoro-2026-11-03-fedora).

<details>
<summary><b>▶ Escuchar las voces aquí</b></summary>

> 🔇 GitHub muestra los videos silenciados: pulsa el altavoz del reproductor para escuchar.

| Voz | Modelo | Peso de la voz | RAM en uso | Disponibilidad |
|---|---|---|---|---|
| Lola, Rafael | Pocket | Lola 5,3 MB; Rafael 6,0 MB | ~1 GB | Descargadas por el instalador, sin cuenta |
| Facundo, Santiago, Camila, Javiera, Diego, Felipe | Pocket | 9,2–11,5 MB | ~1 GB | Incluidas en el repositorio |
| Regina, Iker | Phonon | 0,25 MB cada una, dentro del modelo | ~0,3 GB | Descarga al elegirlas, con cuenta gratis de Hugging Face¹ |

¹ Necesita una cuenta gratis de Hugging Face.

El modelo se descarga una vez y lo comparten todas sus voces: Pocket `spanish` 209 MB (instalador), Phonon 72 MB (al elegirlo). Pesos medidos en Docker el 2026-11-07; RAM medida en Fedora.

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

Los scripts preparan el entorno, instalan las dependencias, comprueban Torch sin CUDA y descargan Pocket `spanish`, Lola y Rafael sin cuenta. Si falla una descarga, avisan y continúan; vuelve a ejecutar el instalador para reintentar. En Linux indican cómo instalar PortAudio si falta. Los demás modelos se descargan al usarlos por primera vez.

Después instala la extensión en Pi con la **ruta absoluta** de tu repositorio:

```text
pi install <ruta>/pi-extension/tehablo-tts
```

Abre Pi o ejecuta `/reload`. La extensión se instala para todos tus proyectos y usa esta carpeta sin copiarla: no la muevas después de instalarla. Los instaladores muestran el comando con tu ruta.

Probado con audio en Windows y Fedora; macOS aún no está verificado. [Instalación manual y entornos por sistema](docs/desarrollo.md#instalación-manual).

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

Si tienes Python de [python.org](https://www.python.org/downloads/) (3.10 o más), el cliente lo usa; si no, `uv` descarga uno. En Windows, el lanzador del Python de `uv` no lleva firma digital y algunos antivirus (por ejemplo Norton CyberCapture) lo analizan cada vez que abres el cliente; es seguro, y con el Python oficial (`winget install Python.Python.3.13`) el lanzador va firmado.

`RemoteForward 18766 127.0.0.1:18766` lleva cada lectura al receptor, que espera en 127.0.0.1:18766 sin sondeos ni tráfico en reposo.
Viaja cifrada por tu conexión SSH; el puerto remoto escucha en loopback por defecto (no cambies `GatewayPorts`). Este reenvío no permite controlar teHablo ni el servidor desde tu computadora.
El receptor exige un código: en Pi elige **Audio: SSH** y ejecuta `/tts codigo`. Al elegir una conexión SSH sin código asociado, el cliente lo pide oculto antes de abrir el canal (también si esa sesión ya tiene reenvío). Recuerda el usuario, destino literal y puerto; no resuelve alias ni lee la configuración SSH. **Vincular servidor** permite cambiar el código de la conexión seleccionada; sin selección añade un código general, igual que `uv run cliente/tehablo_cliente.py --codigo CODIGO`. Mientras el canal propio está en ejecución, solo se acepta el código de esa conexión; en modo manual se acepta la lista guardada. Al cambiar un código se elimina el anterior solo si ninguna otra conexión ni vinculación general lo usa; los códigos guardados antes de este cambio se conservan como generales. Sin él muestra «Sin vincular» y no reproduce. El código se guarda en `~/.tehablo/ssh-codigo` en el servidor (0600 en POSIX); quien lo conozca, incluido un administrador, puede enviar sonido. El mismo código también protege la API HTTP local de teHablo.
Si conservas `LocalForward 18765 127.0.0.1:8765`, ya no hace falta: puedes quitarlo a mano; el cliente nunca lo borra.

En Pi, elige **Audio: SSH**. La guía de instalación aparece solo hasta que un cliente se autentique por primera vez; después, al activarlo, solo confirma «Audio por SSH activado.». Si no hay receptor o se desconecta, se detiene esa lectura y Pi avisa: «Sin receptor de audio por SSH: abre el cliente en tu computadora.». Mantén abierto el cliente mientras quieras oír la voz. Desde un clon: `./install.sh --cliente` o `.\install.ps1 -Cliente` (también aceptan `--receptor` / `-Receptor`). La salida y el volumen del cliente son independientes de los de Pi.

### Hacerlo a mano

1. En tu computadora, instala [uv](https://docs.astral.sh/uv/getting-started/installation/) y abre el cliente: `uv run cliente/tehablo_cliente.py` desde el clon. En Linux puede hacer falta PortAudio (`sudo apt install libportaudio2` o `sudo dnf install portaudio`).
2. En **otra terminal de tu computadora**, abre el canal; sustituye usuario/servidor y conserva tus opciones habituales (`-p`, `-i`, `-J`):
   ```sh
   ssh -N -R 18766:127.0.0.1:18766 usuario@servidor
   ```
   **Lo hago a mano** (o el fallo de autenticación del canal oculto) muestra el comando de la conexión seleccionada, sin comando remoto; en Windows, cópialo en **PowerShell**. No hace falta editar la configuración SSH.
3. En Pi (servidor), elige **Audio: SSH** y ejecuta `/tts codigo`. En el cliente, usa **Vincular servidor**: este código de voz no es la contraseña SSH.
4. Tras la contraseña, esa terminal no muestra nada más: es normal, el canal está abierto. Deja abiertos el cliente, esa terminal y tu sesión de Pi. **Ctrl+C** en la terminal del canal lo cierra.

PuTTY: **Connection › SSH › Tunnels** → Source port `18766`, Destination `127.0.0.1:18766`, **Remote**, **Add**. En Termius/MobaXterm, crea el mismo reenvío remoto. Si prefieres un reenvío fijo, puedes añadir tú `RemoteForward 18766 127.0.0.1:18766` bajo tu `Host` en `~/.ssh/config`; el cliente no lee ni modifica ese archivo.

Para desinstalar desde un clon: `sh receptor/install.sh --uninstall` o `.\receptor\install.ps1 -Uninstall`. Sin clon, vuelve a descargar el script y pásale `--uninstall` (`sh -s -- --uninstall`) o `-Uninstall` (`& ([scriptblock]::Create((irm https://raw.githubusercontent.com/LCubero/tehablo/master/receptor/install.ps1))) -Uninstall`). Quita a mano la línea `RemoteForward 18766 127.0.0.1:18766` del Host correspondiente en `~/.ssh/config`.

Solo para la extensión de Pi: no cubre TUI ni consola, no funciona con mosh ni teléfonos. Necesita SSH con reenvío de puertos permitido y el puerto 18766 libre en ambos extremos. macOS está escrito pero no probado.

## Uso en Pi

Pi empieza con el servidor **apagado**, en modo manual. Pulsa `[ ⏻ TTS ]` para cargar la voz; luego `[ ▶ ]` lee esa respuesta (o usa `/tts play`, que la enciende si hace falta). La voz inicial es `lola`, gratis y sin cuenta; si eliges otra, se recuerda.

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
- Para leer una selección, **cópiala primero** y pulsa `[ ▶ copiado ]`: Pi no ve la selección del ratón. Lee el portapapeles donde corre Pi; en Linux sin escritorio (por ejemplo, un servidor SSH) el botón no aparece.
- `[ ⋯ ]` abre volumen y velocidad; `[ → ]` los oculta. `[ ≡ ]` abre ajustes antes de `[ ⋯ ]` en la barra cerrada y antes de `[ ⏻ ]` en la abierta, también en modo Texto.
- `[ ⏻ ]` apaga el servidor y libera el modelo, sin perder tus ajustes.
- Con varias sesiones de Pi abiertas, todas usan el mismo servidor: encenderlo o apagarlo en una lo hace en todas, y la barra de las demás lo muestra en unos segundos. Cada lectura nueva decide si interrumpe o espera, según sus ajustes. Empezar otro turno o cerrar la sesión cancela solo sus lecturas, sin vaciar la cola de otras sesiones. Cerrar o recargar una sesión nunca apaga el servidor compartido; se apaga solo unos 30 s después de que ninguna sesión de Pi lo use. `[ ⏻ ]` o `/tts` lo siguen apagando para todas.
- Antes de la primera respuesta, la barra aparece sobre el editor sin el botón de leer respuesta. En Audio: SSH muestra `TTS SSH [ ≡ ] [ ⋯ ]`; apagada, `[ ⏻ TTS SSH ] [ ≡ ]` (mismas posiciones en modo Texto).

### Comandos

| Comando | Acción |
|---|---|
| `/tts` | Enciende o apaga el servidor; apagar desactiva la lectura automática |
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
| `/tts codigo` | Muestra el código para vincular el cliente de la PC; no lo compartas |

### Ajustes `[ ≡ ]` (menú)

Elige **Audio: Local / SSH**, **Salida: nombre / Predeterminada** (en Local; en SSH se elige en el cliente), **voz**, **volumen**, **velocidad**, **lectura automática**, **atajos de teclado** e **indicador de estado**, o enciende, apaga y reinicia el servidor. Usa clics o ↑↓, ←→, Enter y Esc.

**Iconos: Símbolos / Texto** conserva los símbolos actuales por defecto. Elige **Texto** si ves cuadros: usa etiquetas ASCII como `[ TTS ]`, `[ |> ]`, `[ || ]`, `[ [] ]`, `[ off ]` y `[ = ]` (ajustes). Se guarda, se comparte entre sesiones y actualiza las barras al cambiarla; [tabla completa](docs/desarrollo.md#iconos-en-modo-texto).

**Si llega otra lectura** permite elegir **Detener** (predeterminado: interrumpe la actual) o **Esperar** (lee en orden, con un aviso sonoro). Se aplica a las lecturas manuales, copiadas y automáticas, también entre sesiones; [límites y casos especiales](docs/desarrollo.md#cola-de-lecturas).

**Barra de controles** muestra u oculta la barra, con el mismo aviso y efecto que `/tts toolbar`: la lectura y los atajos siguen funcionando. Ambas opciones se guardan al cambiarlas.

La tabla muestra el estado de descarga, la RAM aproximada y **Dict** por voz. El diccionario adapta términos como «Python»; desactivarlo no cambia la lectura de números ni la limpieza del texto. Por defecto está apagado en Phonon y encendido en Pocket.

Los ajustes se guardan por usuario en `~/.tehablo/settings.json` y se comparten entre todas las sesiones de Pi: audio Local/SSH, voz/modelo, volumen, velocidad, Dict por voz, atajos, política de lectura, iconos, barra y caché de voces. Los cambios aparecen en unos segundos en la barra y en los ajustes abiertos, sin `/reload`, incluso con el servidor apagado. Solo la **lectura automática** es de cada sesión: empieza desactivada y no se guarda. [Detalles de Pi, portapapeles y diagnóstico](docs/desarrollo.md#uso-en-pi).

## Voces

| Nombre | Modelo en Pi | ¿Incluida? | Licencia de pesos / voz |
|---|---|---|---|
| [`lola`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/lola.mp3) (inicial), [`rafael`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/rafael.mp3) | Pocket `spanish` | No: las descarga el instalador, sin cuenta | CC BY 4.0 |
| [`Facundo`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Facundo.mp3), [`Santiago`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Santiago.mp3) (Argentina) | Pocket `spanish` | Sí | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Camila`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Camila.mp3), [`Javiera`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Javiera.mp3), [`Diego`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Diego.mp3) (Chile), [`Felipe`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Felipe.mp3) (Colombia) | Pocket `spanish` | Sí | Pesos CC BY 4.0; voces CC BY-SA 4.0 |
| [`Regina`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Regina.mp3) (México), [`Iker`](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Iker.mp3) (España) | Phonon 40M es | No, gratis para descarga¹ | CC BY-NC 4.0: no comercial |

¹ Necesita una cuenta gratis de Hugging Face.

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
