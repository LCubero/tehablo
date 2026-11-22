const PREFIX = /^[A-Z][A-Z0-9]{0,3}\s*\|\s*/;
const MAX_TITLE = 48;
const MAX_NAMED = 2;

function clean(value) {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[|—–]/g, " ")
    .replace(/[^\p{L}\p{N}_\s,.;:!?¿¡'"()\-/&+]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  if (text.length <= MAX_TITLE) return text;
  const cut = text.slice(0, MAX_TITLE).replace(/\s+\S*$/, "").replace(/[ ,.;:\-/]+$/, "");
  return cut || text.slice(0, MAX_TITLE).trim();
}

function taskLabel(agent) {
  const title = typeof agent.title === "string" ? agent.title.trim().replace(PREFIX, "") : null;
  return clean(title) || clean(agent.tab_name) || clean(agent.program?.name) || "agente";
}

function projectLabel(agent) {
  return clean(agent.space_name) || "proyecto";
}

export function createVoiceState(agents = []) {
  return {
    statuses: new Map(agents.map((agent) => [agent.address, agent.status])),
  };
}

export function createNoticeBatch() {
  return { items: [], dueAt: 0 };
}

export function enqueueNotices(batch, notices, now, windowMs) {
  if (!notices.length) return;
  if (!batch.items.length) batch.dueAt = now + windowMs;
  batch.items.push(...notices);
}

export function takeDueNotices(batch, now) {
  if (!batch.items.length || now < batch.dueAt) return [];
  const items = batch.items.splice(0);
  batch.dueAt = 0;
  return items;
}

export function deriveNotices(state, agents, { muted = false } = {}) {
  const notices = [];
  const next = new Map();

  for (const agent of agents) {
    next.set(agent.address, agent.status);
    const previous = state.statuses.get(agent.address);
    const becameNotice = previous != null && previous !== agent.status && ["done", "blocked"].includes(agent.status);
    if (!muted && becameNotice && !agent.focused) {
      notices.push({
        address: agent.address,
        status: agent.status,
        project: projectLabel(agent),
        label: taskLabel(agent),
      });
    }
  }

  state.statuses = next;
  return notices;
}

function sentence(items, single, many) {
  const names = [...new Set(items.map((item) => `${item.project}, ${item.label}`))];
  if (items.length === 1 && names.length === 1) return `${names[0]}: ${single}.`;
  const shown = names.slice(0, MAX_NAMED);
  const remaining = names.length - shown.length;
  const body = remaining ? `${shown.join("; ")}; y ${remaining} más` : shown.join("; ");
  return `${many} ${body}.`;
}

export function composeNotices(items) {
  const done = items.filter((item) => item.status === "done");
  const blocked = items.filter((item) => item.status === "blocked");
  return [
    done.length ? sentence(done, "terminó", "Terminaron") : null,
    blocked.length ? sentence(blocked, "te espera", "Te esperan") : null,
  ].filter(Boolean).join(" ") || null;
}

export function speakRequest(code, identifier, text) {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Tehablo-Codigo": code,
    },
    body: JSON.stringify({
      id: identifier,
      text,
      lexicon: true,
      policy: "wait",
    }),
  };
}
