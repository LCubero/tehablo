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
terminal sin la etiqueta del agente (`OC | …` y `π - …` de Pi quedan en `…`). Si la tarea se llama igual que
el proyecto, solo se dice una vez: «tehablo: terminó.». Si un agente no tiene título,
se usa su nombre y, si tampoco, su tipo con el panel (`opencode p6`).

## Requisitos

- herdr 0.9.5 o posterior.
- El servidor de teHablo encendido. Si no responde, el plugin se calla: no lo arranca.
  Busca en los puertos 23765–23769; si defines `TEHABLO_PORT`, solo en ese.
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
`python.txt` dentro del mismo directorio, o define `TEHABLO_PYTHON`. Ambos lanzadores
respetan ese orden antes de buscar alternativas: `run.sh` prueba `python3` y `python`;
`run.cmd` prueba `python3`, `py` y `python`.

## Cómo funciona

herdr lanza un proceso por cada cambio de estado del panel, con el `pane_id` en
`HERDR_PLUGIN_EVENT_JSON`. El proceso:

1. Descarta el evento si su estado no es `done` ni `blocked`; después pide el detalle con
   `herdr agent get <panel>` y calla si el panel ya cambió a otro estado.
2. Ignora el panel enfocado, si `skip_focused` está activo.
3. Compara `completion_seq` con el último aviso de ese panel: sin eso, volver a mirar el
   panel repetiría el mismo aviso.
4. Añade el aviso a la cola, libera el bloqueo y espera la ventana.
5. Reclama el lote bajo un bloqueo breve, vacía esa cola y libera el bloqueo antes
   de hacer **una** llamada a `/speak`. Los demás procesos no vuelven a enviar ese lote
   ni reclaman el siguiente antes de tiempo: cada proceso solo reclama el lote al que se unió.

No hay demonio: herdr desaconseja procesos largos, así que el primer proceso que despierta
se lleva el lote. El bloqueo protege solo los cambios de la cola, nunca la espera ni
la petición HTTP. Al aceptar un nuevo aviso o reclamar un lote se descartan los
pendientes de más de 60 s, para no reproducir avisos huérfanos mucho después. Ese
margen supera la ventana máxima de 10 s y, en Windows, las dos esperas de bloqueo
de hasta 10 s. Si el equipo suspende el proceso más de un minuto, el aviso también
caduca; no se garantiza su entrega.
Con `window: 0`, cada evento se envía por separado, sin pasar por el lote.

El `id` de `/speak` es el panel, así que `/stop` corta el aviso de un agente sin silenciar
a los demás. La política es `wait`: espera a que termine la lectura en curso, pero si esa lectura está en pausa, el servidor la sustituye por el aviso.

## Pruebas

```sh
python tests/test_herdr_plugin.py          # lógica y procesos simultáneos, sin red ni audio
python herdr-plugin/notify.py --say "prueba de voz"   # usa el `lexicon` de config.json
HERDR_PLUGIN_EVENT_JSON='{"data":{"pane_id":"w1:p1"}}' python herdr-plugin/notify.py --dry-run   # imprime la frase sin tocar la cola ni hablar
```

Las pruebas usan procesos y bloqueos del sistema reales, pero controlan la espera
de agrupación con barreras después de encolar. Así verifican el lote y una llegada
durante la espera sin depender de que el planificador ejecute todos los procesos
dentro de una fracción de segundo.

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
- El envío es de un solo intento: si el servidor está apagado o rechaza la petición,
  ese lote se descarta, sin reintentos ni reproducción diferida al encenderlo.
- Las peticiones locales no usan proxies ni siguen redirecciones. Un código de
  emparejamiento que no tenga 32 caracteres hexadecimales en minúsculas se rechaza sin enviarlo.
  `/health` solo comprueba la identidad declarada: no autentica al dueño del puerto
  frente a otro proceso local malicioso.

## Activar o desactivar

```sh
herdr plugin disable tehablo.agent-voice   # deja de avisar
herdr plugin enable tehablo.agent-voice    # vuelve a avisar
```

El cambio vale al momento para todas las sesiones de herdr. Solo funciona en herdr de
terminal: herdr-app usa herdr-core (`hc`), que no tiene plugins; para Herdr App está
[`herdr-app-mod/`](../herdr-app-mod/README.md).

## Desinstalar

```sh
herdr plugin uninstall tehablo.agent-voice
```
