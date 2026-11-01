---
name: tehablo-pronunciacion
description: "Trigger: pronunciation test, listening test, prueba de escucha, compare pronunciation variants, add or fix pronunciaciones.json entries in tehablo. Run owner-approved listening tests and record the chosen spelling."
license: "MIT"
metadata:
  author: tehablo
  version: "1.0"
---

## Activation Contract

Use when the owner tests how tehablo speaks English terms, compares spellings, or asks to add or correct entries in `pronunciaciones.json`. The spelling rules live in `docs/pronunciacion.md`; read it first and do not duplicate it here.

## Hard Rules

- Never play audio without asking first. A spelling the owner sends for a word ("probá X", "X vs Y", "de nuevo") counts as the request to play it; anything else waits for a yes.
- Every time you play, and every time you ask to play, show a table with the normal word and the spelling actually sent:

  | # | Palabra | Pronunciación usada |
  |---|---|---|
  | 1a | widget | güíllet |

  Use `#` for group and variant letters (`1a`, `1b`), so the owner can answer "1b, 2a". Mark filler rows as `(relleno)`.
- Send the owner's spelling byte for byte: keep or omit accents, `ü`, `ll` and doubled letters exactly as written. When a missing accent changes the stress, ask before choosing.
- Do not edit `pronunciaciones.json` until the owner approves the final spellings.
- Never two voices in one reading: Spanish model, voice `lola`.

## Building Variants

- Offer at most 5 variants per word and change one thing at a time.
- The Spanish tokenizer has no piece for `sh`, `sch`, `tch`, `w` or `k`; `w`, `k` and `ü` become raw bytes. This does not establish training frequency or an acoustic cause. Listening on 2026-10-31 favored `uídyet` over `wídyet`, found no audible difference in `chek`/`chec` and `kiú`/`quiú`, and favored `propóusd` over `propóuzd`. These are word-specific observations, not bans on `w` or `z`. See `docs/pronunciacion.md#qué-ve-el-modelo`.
- To see the pieces of candidate spellings (read-only, offline):

  ```bash
  HF_HUB_OFFLINE=1 .venv-pocket/bin/python - <<'EOF'
  from pocket_tts.utils.utils import download_if_necessary
  import tokenizers, yaml
  cfg = yaml.safe_load(open(".venv-pocket/lib/python3.12/site-packages/pocket_tts/config/spanish.yaml"))
  path = cfg["flow_lm"]["lookup_table"]["tokenizer_path"]
  tok = tokenizers.Tokenizer.from_file(str(download_if_necessary(path)))
  for word in "güíllet wídyet chek".split():
      print(word, tok.encode(word).tokens)
  EOF
  ```

## Playback

1. Use the server that answers: `PORT=8765`, or `PORT=8766` if `curl -s localhost:8765/status` gets no reply. In that case start a test server in the background and leave Pi's port alone:
   `.venv-pocket/bin/python src/tehablo_server.py --port 8766`
2. When comparing variants, send one word per request with a short pause (about 0.6 s between words, 1.5 s between groups). Run this Bash sequence in the background with the `PORT` selected in step 1. It stops on HTTP, transport, invalid status or speech errors. It polls at most 120 times (1 s apart, each HTTP call limited to 5 s); on timeout it aborts without sending another word or stopping accepted audio:

   ```bash
   say(){
     local payload status state attempt
     payload=$(python3 -c 'import json,sys; print(json.dumps({"id":"w", "text":sys.argv[1]}))' "$1") || return
     curl --fail --silent --show-error --connect-timeout 2 --max-time 5 \
       -X POST "localhost:$PORT/speak" -H 'Content-Type: application/json' -d "$payload" >/dev/null || return
     for ((attempt=0; attempt<120; attempt++)); do
       status=$(curl --fail --silent --show-error --connect-timeout 2 --max-time 5 "localhost:$PORT/status") || return
       state=$(python3 -c 'import json,sys
s=json.loads(sys.argv[1])
if s.get("error") or s.get("state") not in ("idle", "loading", "generating", "playing"):
    sys.exit("Error de estado: " + str(s))
print(s["state"])' "$status") || return
       if [[ "$state" == idle ]]; then sleep "$2"; return; fi
       sleep 1 || return
     done
     echo 'Tiempo de espera agotado; secuencia abortada sin cortar el audio.' >&2
     return 1
   }
   say "fícher." 0.6 && say "fítcher." 1.5
   ```

   Ellipses do not make a pause: normalization turns `...` into a period.
3. When sending a whole list in one request, end it with a filler word (`listo.`): the model dropped the last word of a 15-word list.
4. After playback ends, report it in one line and repeat the pending question.

## Recording The Choice

After the owner approves:

1. Add one case per group of new words to `tests/test_lexicon.py` (shipped-term checks) and observe it fail.
2. Add the entries to `pronunciaciones.json`.
3. Run every `tests/test_*.py` in the background.
4. In `docs/pronunciacion.md`, under `Decisiones y pendientes`, record each winner and the variants it beat. Update the term count in `docs/repo-harness/current-state.md` and add a `CHANGELOG.md` line, with the date in Costa Rica time (`TZ=CST6 date`, check `-0600`).
