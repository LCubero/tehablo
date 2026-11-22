import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  composeNotices,
  createNoticeBatch,
  createVoiceState,
  deriveNotices,
  enqueueNotices,
  speakRequest,
  takeDueNotices,
} from "../herdr-app-mod/voice.js";

const baseAgent = {
  address: "t1",
  space_name: "tehablo",
  tab_name: "PRs para issues 8 y 9",
  title: "PI | PRs para issues 8 y 9",
  status: "working",
  focused: false,
};

const mainSource = readFileSync(new URL("../herdr-app-mod/main.js", import.meta.url), "utf8");

{
  const state = createVoiceState([baseAgent]);
  const next = [{ ...baseAgent, status: "done" }];
  const notices = deriveNotices(state, next, { muted: false });
  assert.deepEqual(notices, [{
    address: "t1",
    status: "done",
    project: "tehablo",
    label: "PRs para issues 8 y 9",
  }]);
  assert.equal(composeNotices(notices), "tehablo, PRs para issues 8 y 9: terminó.");
}

{
  const batch = createNoticeBatch();
  const first = [{ address: "t1", status: "done", project: "tehablo", label: "tests" }];
  const second = [{ address: "t2", status: "blocked", project: "herdr", label: "docs" }];
  enqueueNotices(batch, first, 100, 2000);
  enqueueNotices(batch, second, 1900, 2000);
  assert.equal(batch.dueAt, 2100);
  assert.deepEqual(takeDueNotices(batch, 2099), []);
  assert.deepEqual(takeDueNotices(batch, 2100), [...first, ...second]);
}

{
  const request = speakRequest("0123456789abcdef0123456789abcdef", "t1", "Aviso");
  assert.deepEqual(Object.keys(request).sort(), ["body", "headers", "method"]);
  assert.deepEqual(JSON.parse(request.body), {
    id: "t1",
    text: "Aviso",
    lexicon: true,
    policy: "wait",
  });
  assert.ok(!("redirect" in request));
  assert.ok(!request.body.includes("0123456789abcdef0123456789abcdef"));
  assert.doesNotMatch(mainSource, /console\./);
  assert.doesNotMatch(mainSource, /https?:\/\/(?!127\.0\.0\.1:)/);
}

{
  const previous = [
    baseAgent,
    { ...baseAgent, address: "t2", space_name: "herdr", title: "OC | docs" },
  ];
  const current = [
    { ...previous[0], status: "done" },
    { ...previous[1], status: "blocked" },
  ];
  assert.equal(
    composeNotices(deriveNotices(createVoiceState(previous), current, { muted: false })),
    "tehablo, PRs para issues 8 y 9: terminó. herdr, docs: te espera.",
  );
}

{
  assert.deepEqual(
    deriveNotices(createVoiceState([baseAgent]), [{ ...baseAgent, status: "done", focused: true }], { muted: false }),
    [],
  );
  assert.deepEqual(
    deriveNotices(createVoiceState([baseAgent]), [{ ...baseAgent, status: "done" }], { muted: true }),
    [],
  );
}

{
  const initial = { ...baseAgent, status: "done" };
  assert.deepEqual(deriveNotices(createVoiceState([initial]), [initial], { muted: false }), []);
}

{
  const previous = [baseAgent];
  const current = [{ ...baseAgent, status: "working" }];
  assert.deepEqual(deriveNotices(createVoiceState(previous), current, { muted: false }), []);
}

{
  const previous = [
    baseAgent,
    { ...baseAgent, address: "t2", space_name: "herdr", title: "OC | docs" },
  ];
  const current = previous.map((agent) => ({ ...agent, status: "done" }));
  assert.equal(
    composeNotices(deriveNotices(createVoiceState(previous), current, { muted: false })),
    "Terminaron tehablo, PRs para issues 8 y 9; herdr, docs.",
  );
}

console.log("herdr-app voice seam: ok");
