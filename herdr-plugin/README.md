# teHablo en herdr

Aviso hablado cuando un agente de [herdr](https://herdr.dev) termina o queda esperando.
Sin leer el mensaje del agente: herdr conoce su estado, no su texto.

## Qué se oye

| Situación | Frase |
| --- | --- |
| Un agente termina | «tehablo, PRs para issues 8 y 9: terminó.» |
| Un agente espera respuesta | «tehablo, PRs para issues 8 y 9: te espera.» |
| Dos o más terminan juntos | «Terminaron tehablo, A; dockhand, B.» |
| Termina uno y otro espera | «tehablo, A: terminó. dockhand, B: te espera.» |

El proyecto es la etiqueta del espacio de trabajo en herdr; la tarea es el título del
terminal sin la etiqueta del agente (`OC | …` queda en `…`). Si un agente no tiene título,
se usa su nombre y, si tampoco, su tipo con el panel (`opencode p6`).

## Requisitos

- herdr 0.9.5 o posterior.
- El servidor de teHablo encendido. Si no responde, el plugin se calla: no lo arranca.
- `~/.tehablo/ssh-codigo` con el código de emparejamiento, el mismo que usa el resto de
  los clientes.

## Instalación

```sh
herdr plugin install LCubero/tehablo/herdr-plugin
```

Para probar una copia local antes de publicar:

```sh
herdr plugin link /ruta/a/tehablo/herdr-plugin
herdr plugin list
```

## Configuración

Opcional, en `herdr plugin config-dir tehablo.agent-voice`, archivo `config.json`:

| Clave | Por defecto | Qué hace |
| --- | --- | --- |
| `skip_focused` | `true` | No habla del panel que ya estás mirando. |
| `window` | `2.0` | Segundos que espera para juntar varios avisos en una frase. `0` desactiva la agrupación. |
| `lexicon` | `true` | Pasa el texto por el léxico de pronunciación de teHablo. |

Si `python` en `PATH` es el alias de Microsoft Store, escribe la ruta del intérprete en
`python.txt` dentro del mismo directorio, o define `TEHABLO_PYTHON`. `run.cmd` y `run.sh`
prueban las dos cosas antes de caer en `python3`, `py` y `python`.

## Cómo funciona

herdr lanza un proceso por cada cambio de estado del panel, con el `pane_id` en
`HERDR_PLUGIN_EVENT_JSON`. El proceso:

1. Pide el detalle con `herdr agent get <panel>` y descarta `working`, `idle` y `unknown`.
2. Ignora el panel enfocado, si `skip_focused` está activo.
3. Compara `completion_seq` con el último aviso de ese panel: sin eso, volver a mirar el
   panel repetiría el mismo aviso.
4. Espera la ventana y hace **una** llamada a `/speak` con todos los avisos juntos.

No hay demonio: herdr desaconseja procesos largos, así que el primer proceso que despierta
se lleva el lote. Un archivo de bloqueo en el directorio de estado evita que dos hablen a
la vez, y el bloqueo se libera solo si un proceso muere.

El `id` de `/speak` es el panel, así que `/stop` corta el aviso de un agente sin silenciar
a los demás. La política es `wait`: nunca interrumpe una lectura en curso.

## Pruebas

```sh
python tests/test_herdr_plugin.py          # lógica de decisión, sin red
python herdr-plugin/notify.py --say "prueba de voz"
HERDR_PLUGIN_EVENT_JSON='{"data":{"pane_id":"w1:p1"}}' python herdr-plugin/notify.py --dry-run
```

La prueba de voz real solo la puede hacer la persona responsable, con herdr abierto:
dos agentes en proyectos distintos, uno termina y se oye la frase con proyecto y tarea;
el panel enfocado calla; un agente bloqueado usa la otra frase; tres seguidos producen una
sola frase.

## Límites

- No lee el mensaje del agente. `herdr agent read` devuelve la pantalla, con spinner y
  barras de interfaz: inservible para voz.
- No arranca el servidor de teHablo.
- `focused` es del panel y con varios monitores puede no coincidir con lo que ves; por eso
  el filtro se puede desactivar.
- Con varios avisos agrupados, `/stop` corta el turno del primer panel de la frase.

## Desinstalar

```sh
herdr plugin uninstall tehablo.agent-voice
```
