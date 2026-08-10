const assert = require("assert");
const {
  resolveEventSchedule,
  formatWriteBody,
  summarizeContent,
  nextValidOccurrence,
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

test("formatWriteBody includes source summary personal note", () => {
  const body = formatWriteBody({
    source: "Claude",
    captureMethod: "selection",
    summary: "Dinner plan",
    personalNote: "Bring wine",
    content: "Dinner with Sam tomorrow at 7pm",
  });
  assert.match(body, /Source: Claude · selection/);
  assert.match(body, /Summary: Dinner plan/);
  assert.match(body, /Bring wine/);
  assert.match(body, /Content:/);
  assert.match(body, /Dinner with Sam/);
});

test("summarizeContent truncates", () => {
  const long = "A".repeat(200);
  const s = summarizeContent(long, 40);
  assert.ok(s.length <= 40);
});

console.log("schedule tests passed");
