/**
 * Pure schedule + write-body helpers (no AppleScript).
 * Used by macos.js write-back and unit-tested in isolation.
 */

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nextValidOccurrence(dayOfMonth, now = new Date()) {
  const requested = Math.max(1, Math.min(31, Number(dayOfMonth) || now.getDate()));
  let year = now.getFullYear();
  let month = now.getMonth();
  const make = () =>
    new Date(
      year,
      month,
      Math.min(requested, new Date(year, month + 1, 0).getDate()),
      10,
      0,
      0
    );
  let out = make();
  if (out.getTime() <= now.getTime()) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    out = make();
  }
  return {
    year: out.getFullYear(),
    month: out.getMonth() + 1,
    day: out.getDate(),
    dateISO: `${out.getFullYear()}-${pad2(out.getMonth() + 1)}-${pad2(out.getDate())}`,
  };
}

function nextWeekday(targetMon0, now = new Date()) {
  const jsDay = (targetMon0 + 1) % 7; // JS: Sun=0
  const cur = now.getDay();
  let delta = (jsDay - cur + 7) % 7;
  const out = new Date(now);
  out.setHours(10, 0, 0, 0);
  out.setDate(out.getDate() + delta);
  return out;
}

const WEEKDAYS = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
};

/**
 * Resolve payload date/time fields into a concrete schedule.
 * @returns {{ dateISO: string, startHhmm: string, dayOfMonth: number, label: string }}
 */
function resolveEventSchedule(input = {}, now = new Date()) {
  const p = input || {};
  let startHhmm = p.startHhmm || p.time || "";
  if (startHhmm && /^\d{1,2}:\d{2}$/.test(String(startHhmm))) {
    const [h, mi] = String(startHhmm).split(":").map(Number);
    startHhmm = `${pad2(h)}:${pad2(mi)}`;
  } else {
    startHhmm = "";
  }

  const when = String(p.when || "").toLowerCase();
  let dateISO = "";
  if (p.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(String(p.dateISO))) {
    dateISO = String(p.dateISO);
  } else if (["today", "tonight", "this morning", "this afternoon", "this evening"].includes(when)) {
    dateISO = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
    if (!startHhmm) {
      if (when === "tonight") startHhmm = "20:00";
      else if (when === "this morning") startHhmm = "09:00";
      else if (when === "this afternoon") startHhmm = "15:00";
      else if (when === "this evening") startHhmm = "18:00";
    }
  } else if (when === "tomorrow") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    dateISO = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  } else if (p.weekday != null && p.weekday !== "") {
    const wd = Number(p.weekday);
    if (!Number.isNaN(wd)) {
      const t = nextWeekday(wd, now);
      dateISO = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
    }
  } else if (typeof p.when === "string") {
    for (const [name, idx] of Object.entries(WEEKDAYS)) {
      if (new RegExp(`\\b${name}\\b`, "i").test(p.when)) {
        const t = nextWeekday(idx, now);
        dateISO = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
        break;
      }
    }
  }

  if (!dateISO && (p.dayOfMonth != null || p.day != null)) {
    const occ = nextValidOccurrence(p.dayOfMonth || p.day, now);
    dateISO = occ.dateISO;
  }

  if (!dateISO) {
    // Default: today if before evening, else tomorrow — still write something usable
    const t = new Date(now);
    if (t.getHours() >= 21) t.setDate(t.getDate() + 1);
    dateISO = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  }

  if (!startHhmm) startHhmm = "10:00";

  const [y, m, d] = dateISO.split("-").map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [hh, mm] = startHhmm.split(":").map(Number);
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 || 12;
  const label =
    p.whenLabel ||
    `${days[dt.getDay()]} ${months[dt.getMonth()]} ${d} · ${h12}:${pad2(mm)} ${suffix}`;

  return {
    dateISO,
    startHhmm,
    dayOfMonth: d,
    label,
  };
}

function summarizeContent(text, maxLen = 160) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "Captured from Residence";
  const sentence = t.split(/(?<=[.!?])\s+/)[0] || t;
  if (sentence.length <= maxLen) return sentence;
  return `${sentence.slice(0, maxLen - 1)}…`;
}

/**
 * Structured body for Notes / Reminders / Calendar description.
 */
function formatWriteBody({
  source,
  captureMethod,
  utterance,
  summary,
  personalNote,
  content,
  title,
} = {}) {
  const srcBits = [source, captureMethod && String(captureMethod).replace(/-/g, " ")]
    .filter(Boolean)
    .join(" · ");
  const raw = content || utterance || title || "";
  const sum = summary || summarizeContent(raw);
  const lines = [];
  if (srcBits) lines.push(`Source: ${srcBits}`);
  lines.push(`Summary: ${sum}`);
  const note = String(personalNote || "").trim();
  if (note) {
    lines.push("---");
    lines.push(note);
  }
  lines.push("---");
  lines.push("Content:");
  lines.push(String(raw).trim() || "(empty)");
  return lines.join("\n");
}

module.exports = {
  nextValidOccurrence,
  resolveEventSchedule,
  summarizeContent,
  formatWriteBody,
};
