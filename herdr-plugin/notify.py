#!/usr/bin/env python3
"""Speak a short notice when a herdr agent finishes or waits for input.

herdr exposes agent state, not the agent's text, so this plugin announces the
state change instead of reading the message: which project, which task, and
whether the agent finished or is waiting.

One process runs per event, with no daemon and no long-lived worker. The first
process to wake up after a short window speaks every notice collected during
that window, which is how several simultaneous notices become one sentence.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PORTS = (23765, 23766, 23767, 23768, 23769)
DEFAULT_WINDOW = 2.0
MAX_TITLE = 48
MAX_NAMED = 2
TIMEOUT = 5.0
HEALTH_TIMEOUT = 0.4
PREFIX = re.compile(r'^[A-Z][A-Z0-9]{0,3}\s*\|\s*')
DASHES = re.compile(r'[|\u2014\u2013]')
KEEP = re.compile(r'[^\w\s,.;:!?\u00bf\u00a1\'"()\-/&+]')


# --- Pure helpers ------------------------------------------------------------


def strip_prefix(title):
    """Drop the agent tag herdr prepends to terminal titles.

    OpenCode writes ``OC | task`` and Pi writes ``PI | task``. Anything that
    does not look like a short uppercase tag followed by a bar is kept as is.
    """
    if not isinstance(title, str):
        return None
    text = PREFIX.sub('', title.strip()).strip()
    return text or None


def clean(text, limit=MAX_TITLE):
    """Make a title speakable: single line, no noise, short enough to hear."""
    if not isinstance(text, str):
        return None
    text = DASHES.sub(' ', text)
    text = KEEP.sub('', text)
    text = ' '.join(text.split())
    if not text:
        return None
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(' ', 1)[0].rstrip(' ,.;:-/')
    return cut or text[:limit].strip()


def label_of(agent):
    """Name of the task inside a project: agent name, then title, then kind."""
    if not isinstance(agent, dict):
        return 'agente'
    named = clean(agent.get('name'))
    if named:
        return named
    title = clean(strip_prefix(agent.get('terminal_title_stripped') or agent.get('terminal_title')))
    if title:
        return title
    kind = clean(agent.get('display_agent') or agent.get('agent')) or 'agente'
    pane = agent.get('pane_id')
    if isinstance(pane, str) and ':' in pane:
        return f'{kind} {pane.rsplit(":", 1)[1]}'
    return kind


def project_of(agent, sidebar=None):
    """Project name: the workspace label, or the last part of the directory."""
    label = clean(sidebar)
    if label:
        return label
    cwd = agent.get('cwd') if isinstance(agent, dict) else None
    if isinstance(cwd, str) and cwd.strip():
        parts = [part for part in re.split(r'[\\/]+', cwd.strip()) if part]
        name = clean(parts[-1] if parts else None)
        if name:
            return name
    return 'proyecto'


def announceable(agent, skip_focused=True):
    """Status worth speaking, or None when the event should stay silent."""
    if not isinstance(agent, dict):
        return None
    status = agent.get('agent_status')
    if status not in ('done', 'blocked'):
        return None
    if skip_focused and agent.get('focused') is True:
        return None
    return status


def is_duplicate(state, pane, status, seq):
    """True when this exact completion was already spoken."""
    if status != 'done' or seq is None:
        return False
    return state.get('seen', {}).get(pane) == seq


def mark_seen(state, pane, status, seq):
    if status == 'done' and seq is not None:
        state.setdefault('seen', {})[pane] = seq


def parse_event(raw):
    """Read the pane id out of HERDR_PLUGIN_EVENT_JSON."""
    if not raw:
        return {}
    try:
        payload = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    if not isinstance(payload, dict):
        return {}
    data = payload.get('data') if isinstance(payload.get('data'), dict) else payload
    pane = data.get('pane_id') or payload.get('pane_id')
    if not isinstance(pane, str) or not pane:
        return {}
    return {'pane_id': pane, 'agent_status': data.get('agent_status')}


def add_pending(state, item):
    """Queue one notice, ignoring a repeat of the same pane and status."""
    pending = state.setdefault('pending', [])
    for existing in pending:
        if existing.get('pane') == item['pane'] and existing.get('status') == item['status']:
            existing['ts'] = item['ts']
            return
    pending.append(item)


def pending_items(state, now, window=DEFAULT_WINDOW):
    """Notices still inside the window, dropping anything stale."""
    limit = max(window, DEFAULT_WINDOW) * 3
    kept = []
    for item in state.get('pending') or []:
        if not isinstance(item, dict):
            continue
        try:
            age = now - float(item.get('ts'))
        except (TypeError, ValueError):
            continue
        if age > limit:
            continue
        if item.get('status') not in ('done', 'blocked'):
            continue
        kept.append({'pane': item.get('pane'), 'status': item['status'],
                     'project': str(item.get('project') or 'proyecto'),
                     'label': str(item.get('label') or 'agente')})
    return kept


def _sentence(items, single, many):
    names = []
    for item in items:
        name = f"{item['project']}, {item['label']}"
        if name not in names:
            names.append(name)
    if len(items) == 1 and len(names) == 1:
        return f'{names[0]}: {single}.'
    shown = names[:MAX_NAMED]
    rest = len(names) - len(shown)
    body = '; '.join(shown)
    if rest:
        body = f'{body}; y {rest} más'
    return f'{many} {body}.'


def compose(items):
    """One spoken sentence for every notice, or None when there is nothing."""
    if not items:
        return None
    done = [item for item in items if item.get('status') == 'done']
    blocked = [item for item in items if item.get('status') == 'blocked']
    sentences = []
    if done:
        sentences.append(_sentence(done, 'terminó', 'Terminaron'))
    if blocked:
        sentences.append(_sentence(blocked, 'te espera', 'Te esperan'))
    return ' '.join(sentences) or None


# --- Environment -------------------------------------------------------------


def log(message):
    print(f'tehablo-herdr: {message}', file=sys.stderr)


def state_dir():
    root = os.environ.get('HERDR_PLUGIN_STATE_DIR')
    return Path(root) if root else Path.home() / '.tehablo' / 'herdr-plugin' / 'state'


def config_dir():
    root = os.environ.get('HERDR_PLUGIN_CONFIG_DIR')
    return Path(root) if root else Path.home() / '.tehablo' / 'herdr-plugin' / 'config'


def settings():
    """Read config.json, keeping the defaults for anything missing or odd."""
    options = {'skip_focused': True, 'window': DEFAULT_WINDOW, 'lexicon': True}
    try:
        stored = json.loads((config_dir() / 'config.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return options
    if not isinstance(stored, dict):
        return options
    if isinstance(stored.get('skip_focused'), bool):
        options['skip_focused'] = stored['skip_focused']
    if isinstance(stored.get('lexicon'), bool):
        options['lexicon'] = stored['lexicon']
    window = stored.get('window')
    if isinstance(window, (int, float)) and not isinstance(window, bool) and 0 <= window <= 10:
        options['window'] = float(window)
    return options


def herdr(args):
    """Run a herdr CLI command and return its ``result`` object."""
    binary = os.environ.get('HERDR_BIN_PATH') or 'herdr'
    try:
        done = subprocess.run([binary, *args], capture_output=True, text=True,
                              timeout=TIMEOUT, encoding='utf-8', errors='replace')
    except (OSError, subprocess.SubprocessError) as error:
        log(f'herdr {args[0]} failed: {error}')
        return None
    if done.returncode != 0:
        detail = (done.stderr or '').strip()[:200]
        log(f'herdr {args[0]} exited {done.returncode}: {detail}')
        return None
    try:
        payload = json.loads(done.stdout)
    except ValueError:
        return None
    result = payload.get('result') if isinstance(payload, dict) else None
    return result if isinstance(result, dict) else None


def agent_info(pane_id):
    result = herdr(['agent', 'get', pane_id])
    agent = result.get('agent') if result else None
    return agent if isinstance(agent, dict) else None


def workspace_label(workspace_id):
    if not isinstance(workspace_id, str) or not workspace_id:
        return None
    result = herdr(['workspace', 'get', workspace_id])
    workspace = result.get('workspace') if result else None
    label = workspace.get('label') if isinstance(workspace, dict) else None
    return label if isinstance(label, str) else None


def auth_code():
    try:
        return (Path.home() / '.tehablo' / 'ssh-codigo').read_text(encoding='ascii').strip()
    except (OSError, ValueError):
        return None


def tehablo_base():
    """Base URL of a running teHablo server, identified by its /health.

    /health answers without the pairing code, so this never speaks to another
    program that happens to hold one of the candidate ports.
    """
    for port in PORTS:
        base = f'http://127.0.0.1:{port}'
        try:
            with urllib.request.urlopen(base + '/health', timeout=HEALTH_TIMEOUT) as response:
                payload = json.loads(response.read().decode('utf-8'))
        except (urllib.error.URLError, OSError, ValueError):
            continue
        if isinstance(payload, dict) and payload.get('service') == 'tehablo':
            return base
    return None


def speak(base, identifier, text, lexicon=True):
    """POST /speak with policy ``wait`` so an ongoing reading is never cut."""
    code = auth_code()
    if not code:
        log('missing ~/.tehablo/ssh-codigo; notice not spoken')
        return False
    body = json.dumps({'id': identifier, 'text': text, 'lexicon': lexicon,
                       'policy': 'wait'}).encode('utf-8')
    request = urllib.request.Request(base + '/speak', data=body, method='POST',
                                     headers={'Content-Type': 'application/json',
                                              'X-Tehablo-Codigo': code})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return 200 <= response.status < 300
    except (urllib.error.URLError, OSError) as error:
        log(f'/speak failed: {error}')
        return False


# --- State -------------------------------------------------------------------


@contextlib.contextmanager
def locked_state():
    """Serialize the processes herdr launches, so only one speaks per window."""
    directory = state_dir()
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        log(f'cannot use the state directory: {error}')
        raise
    path = directory / 'state.json'
    with open(directory / 'state.lock', 'a+b') as handle:
        _lock(handle)
        try:
            yield path
        finally:
            _unlock(handle)


def _lock(handle):
    handle.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
    else:
        import fcntl
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)


def _unlock(handle):
    try:
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
    except OSError:
        pass


def load_state(path):
    try:
        state = json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {'seen': {}, 'pending': []}
    if not isinstance(state, dict):
        return {'seen': {}, 'pending': []}
    if not isinstance(state.get('seen'), dict):
        state['seen'] = {}
    if not isinstance(state.get('pending'), list):
        state['pending'] = []
    return state


def save_state(path, state):
    try:
        Path(path).write_text(json.dumps(state, ensure_ascii=False), encoding='utf-8')
    except OSError as error:
        log(f'cannot save state: {error}')


# --- Entry points ------------------------------------------------------------


def handle(dry=False):
    """Announce one status change, grouping whatever else arrived meanwhile."""
    event = parse_event(os.environ.get('HERDR_PLUGIN_EVENT_JSON'))
    pane = event.get('pane_id')
    if not pane:
        return 0
    agent = agent_info(pane)
    if not agent:
        return 0
    options = settings()
    status = announceable(agent, options['skip_focused'])
    if status is None:
        return 0
    seq = agent.get('completion_seq')
    item = {'pane': pane, 'status': status,
            'project': project_of(agent, workspace_label(agent.get('workspace_id'))),
            'label': label_of(agent), 'ts': time.time()}
    with locked_state() as path:
        state = load_state(path)
        if is_duplicate(state, pane, status, seq):
            return 0
        mark_seen(state, pane, status, seq)
        add_pending(state, item)
        save_state(path, state)
        if options['window'] > 0:
            time.sleep(options['window'])
        state = load_state(path)
        pending = pending_items(state, time.time(), options['window'])
        if not pending:
            return 0
        text = compose(pending)
        if not text:
            return 0
        if dry:
            print(text)
        else:
            base = tehablo_base()
            if base is None:
                log('teHablo server is not running; notice not spoken')
            else:
                speak(base, pending[0]['pane'], text, options['lexicon'])
        state['pending'] = []
        save_state(path, state)
    return 0


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ['--say']:
        text = ' '.join(args[1:]).strip()
        base = tehablo_base()
        if base is None:
            log('teHablo server is not running')
            return 1
        if not text:
            log('--say needs a text')
            return 1
        return 0 if speak(base, 'herdr-manual', text) else 1
    return handle(dry='--dry-run' in args)


if __name__ == '__main__':
    sys.exit(main())
