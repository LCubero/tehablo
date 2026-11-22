import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
  agents,
  checking,
  home,
  readTextFile,
  theme,
} from "herdr";

import {
  composeNotices,
  createNoticeBatch,
  createVoiceState,
  deriveNotices,
  enqueueNotices,
  speakRequest,
  takeDueNotices,
} from "./voice.js";

const PORTS = [23765, 23766, 23767, 23768, 23769];
const GROUP_WINDOW_MS = 2000;
const HEALTH_INTERVAL_MS = 5000;
const TICK_MS = 500;

async function pairingCode() {
  const value = (await readTextFile(`${home()}/.tehablo/ssh-codigo`))?.trim();
  // Same rule as the server: 32 lowercase hex characters.
  return /^[0-9a-f]{32}$/.test(value ?? "") ? value : null;
}

async function findServer(isActive = () => true) {
  for (const port of PORTS) {
    if (!isActive()) return null;
    const base = `http://127.0.0.1:${port}`;
    try {
      const response = await fetch(`${base}/health`);
      if (!response.ok) continue;
      const payload = await response.json();
      if (payload?.service === "tehablo") return base;
    } catch {
      // A stopped server is a normal state for the indicator.
    }
  }
  return null;
}

async function sendNotice(base, identifier, text) {
  let code;
  try {
    code = await pairingCode();
  } catch {
    return { ok: false, reason: "Pairing code unavailable" };
  }
  if (!code) return { ok: false, reason: "Pairing code unavailable" };
  try {
    const response = await fetch(`${base}/speak`, speakRequest(code, identifier, text));
    return response.ok
      ? { ok: true }
      : { ok: false, reason: `Server rejected the notice (${response.status})` };
  } catch {
    return { ok: false, reason: "teHablo became unavailable" };
  }
}

export default class TehabloVoice extends View {
  init(_props, cx) {
    this.muted = localStorage.getItem("muted") === "true";
    this.base = null;
    this.connection = "checking";
    this.last = this.muted ? "Voice alerts muted" : "Waiting for agent activity";
    this.ticker = null;
    this.sending = false;
    this.nextHealthAt = 0;

    if (checking()) return;
    if (!this.muted) this.start(cx);
  }

  start(cx) {
    this.voice = createVoiceState(agents());
    this.batch = createNoticeBatch();
    this.refreshConnection(cx);
    this.ticker = cx.timer.every(TICK_MS, (cx) => this.tick(cx));
  }

  stop() {
    this.ticker?.cancel();
    this.ticker = null;
    this.batch = createNoticeBatch();
  }

  refreshConnection(cx) {
    this.nextHealthAt = Date.now() + HEALTH_INTERVAL_MS;
    const batch = this.batch;
    const isActive = () => this.batch === batch;
    cx.spawn(async (cx) => {
      const base = await findServer(isActive);
      if (!isActive()) return;
      const connection = base ? "connected" : "unavailable";
      const changed = base !== this.base || connection !== this.connection;
      this.base = base;
      this.connection = connection;
      if (changed) cx.notify();
    });
  }

  tick(cx) {
    const notices = deriveNotices(this.voice, agents(), { muted: this.muted });
    const now = Date.now();
    enqueueNotices(this.batch, notices, now, GROUP_WINDOW_MS);

    if (now >= this.nextHealthAt) this.refreshConnection(cx);
    if (!this.sending) {
      const pending = takeDueNotices(this.batch, now);
      const text = composeNotices(pending);
      if (text) this.speak(pending[0].address, text, cx);
    }
  }

  speak(identifier, text, cx) {
    this.sending = true;
    cx.spawn(async (cx) => {
      try {
        let base = this.base;
        if (!base) {
          base = await findServer();
          this.base = base;
          this.connection = base ? "connected" : "unavailable";
        }

        if (!base) {
          this.last = "Notice skipped: teHablo is unavailable";
        } else {
          const result = await sendNotice(base, identifier, text);
          this.last = result.ok ? text : `Notice skipped: ${result.reason}`;
          if (!result.ok && result.reason === "teHablo became unavailable") {
            this.base = null;
            this.connection = "unavailable";
          }
        }
      } finally {
        this.sending = false;
        cx.notify();
      }
    });
  }

  toggleMute(cx) {
    this.muted = !this.muted;
    localStorage.setItem("muted", String(this.muted));
    if (this.muted) {
      this.stop();
      this.last = "Voice alerts muted";
    } else {
      this.start(cx);
      this.last = "Voice alerts enabled";
    }
    cx.notify();
  }

  render() {
    const t = theme();
    const state = this.muted ? "muted" : this.connection;
    const stateText = {
      muted: "Muted",
      checking: "Checking teHablo",
      connected: "teHablo connected",
      unavailable: "teHablo unavailable",
    }[state];
    const stateColor = {
      muted: t.dim,
      checking: t.working,
      connected: t.done,
      unavailable: t.blocked,
    }[state];

    return h_flex()
      .size_full()
      .px(12)
      .gap(12)
      .items_center()
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .text_size(11.8)
      .text_color(t.muted)
      .child(
        h_flex()
          .gap(7)
          .items_center()
          .child(div().size(7).rounded(4).bg(stateColor))
          .child(div().text_color(t.foreground).child(stateText)),
      )
      .child(div().flex_1().truncate().text_color(t.dim).child(this.last))
      .child(
        h_flex()
          .id("toggle-mute")
          .gap(6)
          .items_center()
          .px(8)
          .h(22)
          .rounded(5)
          .hover((style) => style.bg(t.hover))
          .on_click((_event, cx) => this.toggleMute(cx))
          .child(svg(`mods/tehablo-voice/${this.muted ? "volume-off" : "volume"}.svg`).size(13))
          .child(this.muted ? "Unmute alerts" : "Mute alerts"),
      );
  }
}
