# tehablo-tts (plugin para OpenCode)

Plugin de OpenCode V2 (`@opencode/plugin`) que conecta OpenCode con el servidor local HTTP de teHablo (`src/tehablo_server.py`).

## Qué incluye (Fase 1)

- Arranque automático del servidor Python de teHablo cuando `/health` no responde (sin apagarlo al descargar el plugin).
- Suscripción a `session.text.ended`, `session.execution.succeeded` (y `session.idle` por compatibilidad), leyendo solo la respuesta final de la sesión principal del proyecto actual (filtra subagentes con `parentID` y otras ubicaciones).
- Avisos (`/tts auto`, `/tts stop`, `/tts help` y errores) mediante `./rpc` + `./tui` (toast y modal nativos en el TUI sin inyectar mensajes al historial de la sesión).
- Deduplicación por `assistantMessageID` persistida en `ctx.storage`.
- Comando `/tts`:
  - `/tts menu`: abre un menú nativo del TUI para leer, detener, activar/desactivar la lectura automática y consultar ayuda y estado. Cerrar con Escape no ejecuta ninguna acción. Los subcomandos siguen disponibles.
  - `/tts play`: lee la última respuesta final del asistente.
  - `/tts stop`: detiene las lecturas de esta sesión.
  - `/tts auto`: activa o desactiva la lectura automática (inicia desactivada).
  - `/tts help`: muestra el estado actual y los subcomandos.
- Ajustes compartidos en `~/.tehablo/settings.json` (voz, modelo, volumen, velocidad, ritmo, audio local/SSH y diccionario).

El menú requiere el TUI de OpenCode con diálogos de selección y el canal RPC del plugin. No añade mensajes al historial ni arranca el servidor al abrirse. Si se cambia de sesión o se descarga el plugin mientras está abierto, la selección pendiente no ejecuta acciones. Esta interfaz no incluye un menú para OpenCode Desktop.

`/tts menu` no admite argumentos: muestra un aviso si se añaden opciones o acciones. La observación de la sesión usa el entorno reactivo de Solid del TUI (`solid-js`, dependencia par); volver a la sesión original no reactiva una selección invalidada.

Los cuatro controles **Leer última respuesta**, **Detener lectura**, **Activar/desactivar lectura automática** y **Ayuda y estado** envían su única llamada `control` con la ubicación del TUI capturada al abrir el menú, cuando está disponible. Si el cliente no proporciona una ubicación utilizable, conservan los valores predeterminados anteriores. Un rechazo no provoca un segundo intento sin ubicación. Las consultas de voces no cambian por este ajuste; tampoco los subcomandos directos ni los avisos de las acciones. La ruta explícita alcanzó la instancia mostrada por `/tts status` y el control Auto del menú se comprobó en el TUI: activación y desactivación desde el menú, con la respuesta siguiente leída.

Si una acción del menú falla con un rechazo estructurado, el aviso muestra su mensaje y tipo disponibles, sin volcar solicitudes, cabeceras ni otros campos del objeto. Si no hay datos legibles, lo indica expresamente. Este diagnóstico no cambia la ejecución de la acción ni demuestra que el fallo esté resuelto.

Los métodos RPC declaran explícitamente su esquema de salida para OpenCode 2.3.0: los controles y la selección confirman con `null`. Esto no cambia las acciones ni sus avisos. Tras actualizar el plugin, usa `/reload` y comprueba **Ayuda y estado**: debe abrirse sin el aviso `rpc.internal`. La prueba real en el TUI sigue siendo necesaria; las pruebas locales no ejecutan el codificador interno de OpenCode.

### Elegir una voz local

En `/tts menu`, elige **Elegir voz local** y luego una voz. El selector consulta el catálogo del servidor y muestra únicamente pares de voz y modelo ya descargados; vuelve a comprobar su disponibilidad antes de aplicar la selección. No inicia el servidor, descarga recursos ni reproduce audio. Si el servidor no está disponible, muestra un aviso y no cambia los ajustes.

La consulta RPC de voces locales declara el error esperado `server_unavailable` para conservar el aviso de servidor no disponible al cruzar el transporte de OpenCode. No devuelve una lista vacía para ocultar ese fallo. Esta corrección no cambia la selección, ni resuelve por sí sola un aviso `rpc.unavailable` de OpenCode. Tras `/reload`, comprueba el aviso con el servidor apagado; las pruebas de manejadores no ejecutan el codificador del host.

La selección se aplica mediante `/config` y después guarda juntos el modelo y la voz en `~/.tehablo/settings.json`, conservando las demás claves, incluidas las desconocidas. Un rechazo del servidor no guarda la selección. Si falla el guardado después de aplicar la voz, el aviso distingue ese estado parcial. Los ajustes dañados se rechazan, no se reemplazan por valores predeterminados.

Escape, salir de la sesión o descargar el plugin cancela una selección pendiente. Cambiar de modelo utiliza el comportamiento existente del servidor: vacía las lecturas en espera y vuelve a cargar el motor. Las pruebas reales de representación y audio en OpenCode siguen pendientes de aceptación conjunta.

## Pruebas locales sin audio

Desde la raíz del repositorio (Node 24+):

```sh
node --test opencode-plugin/tehablo-tts/test/*.test.ts
```

## Uso en tu OpenCode local

1. Prepara el entorno Python de teHablo desde la raíz del repositorio (`./install.sh` en Linux/macOS o `install.ps1` en Windows).
2. Registra el plugin en tu `opencode.json` (por ejemplo, `~/.config/opencode/opencode.json`) apuntando a esta carpeta y, si lo usas fuera del clon, indicando `tehabloRoot`:

```json
{
  "plugins": [
    {
      "package": "D:/ruta/a/tehablo/opencode-plugin/tehablo-tts",
      "options": {
        "tehabloRoot": "D:/ruta/a/tehablo"
      }
    }
  ]
}
```
