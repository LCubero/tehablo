# tehablo-tts (plugin para OpenCode)

Plugin de OpenCode V2 (`@opencode/plugin`) que conecta OpenCode con el servidor local HTTP de teHablo (`src/tehablo_server.py`).

## Qué incluye (Fase 1)

- Arranque automático del servidor Python de teHablo cuando `/health` no responde (sin apagarlo al descargar el plugin).
- Suscripción a `session.text.ended`, `session.execution.succeeded` (y `session.idle` por compatibilidad), leyendo solo la respuesta final de la sesión principal del proyecto actual (filtra subagentes con `parentID` y otras ubicaciones).
- Avisos (`/tts auto`, `/tts stop`, `/tts help` y errores) mediante `./rpc` + `./tui` (toast y modal nativos en el TUI sin inyectar mensajes al historial de la sesión).
- Deduplicación por `assistantMessageID` persistida en `ctx.storage`.
- Comando `/tts`:
  - `/tts play`: lee la última respuesta final del asistente.
  - `/tts stop`: detiene las lecturas de esta sesión.
  - `/tts auto`: activa o desactiva la lectura automática (inicia desactivada).
  - `/tts help`: muestra el estado actual y los subcomandos.
- Ajustes compartidos en `~/.tehablo/settings.json` (voz, modelo, volumen, velocidad, ritmo, audio local/SSH y diccionario).

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
