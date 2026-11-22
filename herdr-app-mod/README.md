# teHablo voice alerts for Herdr App

A compact status bar for [Herdr App](https://github.com/herdrdev/herdr-app) that announces when an agent finishes or waits for input.

The bar shows whether the local teHablo server is available, the last alert outcome, and a persistent mute control. It works with any agent Herdr App recognizes, including Pi and OpenCode.

## Behavior

- Announces transitions to `done` and `blocked`.
- Names the Herdr space and the agent task.
- Stays silent for the focused agent.
- Groups status changes that happen within two seconds.
- Never starts teHablo and never retries or replays a skipped alert.
- Keeps the mute choice in Herdr App's local mod storage.

## Requirements

- Herdr App 0.1.16 or later.
- A running teHablo server on one of its standard local ports.
- The pairing code at `~/.tehablo/ssh-codigo`.

## Install a local checkout

Herdr App does not attach new mods to its read-only shipped layouts. Clone the
shipped `main` layout first; the command switches to the editable clone:

```sh
herdr-app do layout.clone '{"name":"main","as":"tehablo"}'
```

Then copy or link this folder as `tehablo-voice` inside Herdr App's mod directory:

```text
~/.config/herdr-app/mods/tehablo-voice
```

Herdr App watches that directory. Because the active `tehablo` layout is personal,
it docks the new mod at the bottom using `mod.json`. No restart is required. If you
already use a personal layout, keep it active and skip the clone command.
Keep the folder name `tehablo-voice`; the mod uses it to resolve its icons.

Check the source before installing it: this trusted mod reads the pairing-code
file and addresses only teHablo's loopback HTTP API. Herdr App performs the HTTP
transport and enforces its own redirect and proxy policy.

Validate the installed copy without sending a request:

```sh
herdr-app check ~/.config/herdr-app/mods/tehablo-voice
herdr-app status
```

The status output should report `"layout": "tehablo"` (or your personal layout)
and an empty `errors` array. Installing the folder while a shipped layout is active
discovers the mod but deliberately leaves it unattached and invisible.

On Windows, the default directory is still `%USERPROFILE%\.config\herdr-app\mods\tehablo-voice`.

## Remove

Delete the `tehablo-voice` folder from Herdr App's mod directory. This does not change teHablo or Herdr App settings.

## Tests

```sh
node tests/test_herdr_app_mod.mjs
herdr-app check herdr-app-mod
```

Both checks are silent: they do not start teHablo, call `/speak`, or play audio.
