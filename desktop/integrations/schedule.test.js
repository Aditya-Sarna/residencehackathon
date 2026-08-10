const assert = require("assert");
const {
  resolveEventSchedule,
  formatWriteBody,
  summarizeContent,
  nextValidOccurrence,
  detectWriteGenre,
  splitCaptureParts,
} = require("./schedule");

function test(name, fn) {
  try {
    fn();
    console.log(`ok  ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("tomorrow at 15:00", () => {
  const now = new Date(2026, 7, 10, 12, 0, 0); // Aug 10
  const s = resolveEventSchedule(
    { when: "tomorrow", startHhmm: "15:00" },
    now
  );
  assert.strictEqual(s.dateISO, "2026-08-11");
  assert.strictEqual(s.startHhmm, "15:00");
  assert.match(s.label, /Aug 11/);
});

test("time alias maps to startHhmm", () => {
  const now = new Date(2026, 7, 10, 9, 0, 0);
  const s = resolveEventSchedule({ when: "today", time: "19:00" }, now);
  assert.strictEqual(s.dateISO, "2026-08-10");
  assert.strictEqual(s.startHhmm, "19:00");
});

test("dayOfMonth rolls forward when past", () => {
  const now = new Date(2026, 7, 20, 12, 0, 0); // Aug 20
  const occ = nextValidOccurrence(5, now);
  assert.strictEqual(occ.dateISO, "2026-09-05");
});

test("dateISO preferred over dayOfMonth", () => {
  const s = resolveEventSchedule({
    dateISO: "2026-03-15",
    dayOfMonth: 1,
    startHhmm: "09:30",
  });
  assert.strictEqual(s.dateISO, "2026-03-15");
  assert.strictEqual(s.startHhmm, "09:30");
});

test("splitCaptureParts strips URL and helper prompts", () => {
  const parts = splitCaptureParts({
    utterance: `(82) WhatsApp
https://web.whatsapp.com/
Turn this into a Calendar commitment or reminder?`,
  });
  assert.strictEqual(parts.primary, "(82) WhatsApp");
  assert.strictEqual(parts.url, "https://web.whatsapp.com/");
});

test("detectWriteGenre messaging-web", () => {
  assert.strictEqual(
    detectWriteGenre({
      source: "messaging-web",
      url: "https://web.whatsapp.com/",
    }),
    "messaging-web"
  );
});

test("formatWriteBody messaging layout", () => {
  const body = formatWriteBody({
    source: "messaging-web",
    captureMethod: "browser-tab",
    summary: "(82) WhatsApp https://web.whatsapp.com/ Turn this into a Calendar commitment",
    intentTitle: "Add to Calendar?",
    personalNote: "Look at this message for submission details",
    content: `(82) WhatsApp
https://web.whatsapp.com/
Turn this into a Calendar commitment or reminder?`,
    utterance: `(82) WhatsApp
https://web.whatsapp.com/
Turn this into a Calendar commitment or reminder?`,
    title: "Add to Calendar?",
    savedAt: new Date(2026, 7, 10, 15, 1, 0),
  });
  assert.match(body, /^Message\n\(82\) WhatsApp/m);
  assert.match(body, /^Link\nhttps:\/\/web\.whatsapp\.com\//m);
  assert.match(body, /^AI interpretation\nAdd to Calendar\?/m);
  assert.match(body, /^My note\nLook at this message for submission details/m);
  assert.match(body, /^Saved\n/m);
  assert.doesNotMatch(body, /Turn this into a Calendar/);
  assert.doesNotMatch(body, /Source: messaging-web Summary:/);
  assert.doesNotMatch(body, /Content:/);
});

test("formatWriteBody youtube genre", () => {
  const body = formatWriteBody({
    source: "youtube",
    q: "youtube",
    content: `Watch this video: Cool talk
https://youtube.com/watch?v=abc
Should I block watch time or save watch-later?`,
    intentTitle: "Watch later",
    personalNote: "After standup",
    savedAt: new Date(2026, 7, 10, 12, 0, 0),
  });
  assert.match(body, /^Video\n/m);
  assert.match(body, /^Link\nhttps:\/\/youtube\.com\/watch\?v=abc/m);
  assert.match(body, /^AI interpretation\nWatch later/m);
  assert.match(body, /^My note\nAfter standup/m);
});

test("formatWriteBody shopping genre", () => {
  const body = formatWriteBody({
    q: "shopping",
    content: `Shopping: Running shoes
https://amazon.com/dp/x
Check budget / allergy before buying? Save to shopping list?`,
    summary: "Budget check before buying running shoes",
    personalNote: "Need size 10",
    whenLabel: "Tue Aug 11 · 10:00 AM",
    destination: "calendar",
  });
  assert.match(body, /^Product\n/m);
  assert.match(body, /^AI interpretation\nBudget check before buying running shoes/m);
  assert.match(body, /^When\nTue Aug 11 · 10:00 AM/m);
});

test("formatWriteBody includes source summary personal note (compat)", () => {
  const body = formatWriteBody({
    source: "Claude",
    captureMethod: "selection",
    summary: "Dinner plan",
    personalNote: "Bring wine",
    content: "Dinner with Sam tomorrow at 7pm",
    savedAt: new Date(2026, 7, 10, 12, 0, 0),
  });
  assert.match(body, /Dinner with Sam/);
  assert.match(body, /AI interpretation\nDinner plan/);
  assert.match(body, /My note\nBring wine/);
  assert.match(body, /Source\nClaude · selection/);
});

test("summarizeContent truncates", () => {
  const long = "A".repeat(200);
  const s = summarizeContent(long, 40);
  assert.ok(s.length <= 40);
});

console.log("schedule tests passed");
