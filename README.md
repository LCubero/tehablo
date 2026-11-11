# teHablo

**Lee en voz alta las respuestas de Pi**, en español y en tu equipo. Gratis, solo CPU (sin GPU ni nube) y sin internet después de descargar los modelos. También tiene TUI y consola.

> **En desarrollo.** Consulta la [hoja de ruta](docs/repo-harness/roadmap.md).

https://github.com/user-attachments/assets/4527a564-a6a9-40f7-b7d9-340f3d686f34


- Voces de España y Latinoamérica, con Pocket TTS y Phonon opcional.
- Lectura manual o automática, texto copiado y velocidad sin cambiar el tono.
- Números y términos técnicos adaptados al español; clonación con permiso.

<details>
<summary>Escuchar las voces</summary>

GitHub silencia los videos: activa el altavoz. Cada nombre enlaza una muestra corta.

| Voz / muestra | Video |
|---|---|
| [Lola](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/lola.mp3) | [Escuchar](https://github.com/user-attachments/assets/cb9ec0aa-0ccc-4104-a309-1a17ae2fb6d5) |
| [Rafael](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/rafael.mp3) | [Escuchar](https://github.com/user-attachments/assets/db843874-b49a-4a1a-9106-8032db1b9c84) |
| [Regina](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Regina.mp3) | [Escuchar](https://github.com/user-attachments/assets/03e02dc6-7ede-4499-b85e-f8dd64d81e07) |
| [Iker](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Iker.mp3) | [Escuchar](https://github.com/user-attachments/assets/f0bac7f9-5182-4f02-a975-b3946e65ecc9) |
| [Facundo](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Facundo.mp3) | [Escuchar](https://github.com/user-attachments/assets/23782567-b111-4253-943c-414fb36a9c6b) |
| [Santiago](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Santiago.mp3) | [Escuchar](https://github.com/user-attachments/assets/9dc2ac02-4b7f-4ffd-9e5b-5174c409c38f) |
| [Camila](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Camila.mp3) | [Escuchar](https://github.com/user-attachments/assets/19f07f13-be0c-42ae-b54c-d95b520dc00a) |
| [Javiera](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Javiera.mp3) | [Escuchar](https://github.com/user-attachments/assets/ffbd2396-c67b-412d-8ac3-702e31c4c99c) |
| [Diego](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Diego.mp3) | [Escuchar](https://github.com/user-attachments/assets/34025bfe-438a-47f2-b0ef-4af05b3ee493) |
| [Felipe](https://cdn.jsdelivr.net/gh/LCubero/tehablo@master/docs/samples/Felipe.mp3) | [Escuchar](https://github.com/user-attachments/assets/d44264cc-69c8-4a47-89f2-b24463895593) |

</details>

## Instalación

Instala [uv](https://docs.astral.sh/uv/) y clona el repositorio:

```sh
git clone https://github.com/LCubero/tehablo.git
cd tehablo
```

Desde esa carpeta, ejecuta el instalador de tu sistema:

| Sistema | Comando |
|---|---|
| Linux / macOS | `./install.sh` |
| Windows (PowerShell) | `powershell -ExecutionPolicy Bypass -File install.ps1` |

Prepara Python, Torch solo CPU, Pocket `spanish`, Lola y Rafael sin cuenta. Si falla una descarga, vuelve a ejecutarlo. En Linux indica cómo instalar PortAudio si falta.

Instala la extensión con la **ruta absoluta** del clon (sustituye la de ejemplo):

```text
pi install E:/ruta/a/tehablo/pi-extension/tehablo-tts
pi install /ruta/a/tehablo/pi-extension/tehablo-tts
```

Usa la primera en Windows o la segunda en Linux/macOS. Abre Pi o ejecuta `/reload`. Se instala para todos tus proyectos y enlaza esta carpeta: **no muevas el clon**. El instalador muestra el comando con tu ruta.

Audio probado en Windows y Fedora; macOS aún no verificado. [Instalación manual](docs/desarrollo.md#instalación-manual).

## Uso en Pi

Empieza apagado y en modo manual, con `lola` o la voz que hayas guardado.

| Comando | Acción |
|---|---|
| `/tts play` | Enciende si hace falta y lee la última respuesta |
| `/tts auto` | Activa o desactiva la lectura automática |
| `/tts stop` | Detiene tus lecturas |
| `/tts menu` | Elige voz, salida, volumen y velocidad |

[Controles, comandos y ajustes completos](docs/desarrollo.md#uso-en-pi).

## Audio por SSH

Si Pi corre en un servidor, el cliente teHablo puede reproducir la voz en tu computadora mediante SSH cifrado. Por defecto suena donde corre Pi. [Instalar y vincular el cliente](docs/desarrollo.md#audio-por-ssh).

## Consumo aproximado

| Qué | Aproximado |
|---|---|
| GPU | No la usa: funciona solo con CPU |
| CPU al leer | ~1–2 núcleos mientras genera la voz |
| RAM con el servidor encendido | Pocket `spanish` (Lola, Rafael y las voces latinoamericanas) **~1 GB**; `spanish_24l` **~1,8 GB**; Phonon (Regina, Iker) **~0,3 GB** |
| Disco | Entorno Python **0,8–1,1 GB**; modelos Pocket **0,9–1,2 GB**; Phonon **~0,15 GB** |
| Internet | Solo para instalar y descargar voces; después funciona sin conexión |

Son referencias, no mínimos; varían según sistema y cuantización. Apagar el servidor libera el modelo. [Mediciones Windows/Fedora](docs/como-funciona.md#consumo-medido) · [Comparación con Phonon](docs/pruebas-de-voces.md#phonon-40m-es-frente-a-lola-spanish_24l-y-kokoro-2026-11-03-fedora).

## Voces y licencias

Pocket: pesos y Lola/Rafael **CC BY 4.0** (Kyutai; el origen de sus grabaciones no está verificado); las seis voces latinoamericanas incluidas, **CC BY-SA 4.0**. Phonon es opcional: requiere cuenta gratis de Hugging Face para descargar y sus pesos son **CC BY-NC 4.0 (no comercial)**. Clona solo voces que tengas permiso para usar. [Voces, acceso y atribución](docs/desarrollo.md#voces).

Código del proyecto: [MIT](LICENSE).

## Guías

- [Uso detallado, TUI, consola y diagnóstico](docs/desarrollo.md)
- [Cómo funciona y recursos](docs/como-funciona.md)
- [Pronunciación](docs/pronunciacion.md) · [Fuentes de voces](docs/voces-gratuitas.md)
