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

/** Capture helper prompts injected by web_apps.enrichCapture — not user content. */
const CAPTURE_PROMPT_RE =
  /^(should i |looks like |sync this |add this meeting|check budget|save this place|schedule a follow-up|remind me to review|save for focus|capture this into|save commitments or health|block focus time|turn this into a calendar|does this ride conflict|check budget and add trip|save a read-later reminder)/i;

const GENRE_LABELS = {
  messaging: { primary: "Message", link: "Link" },
  "messaging-web": { primary: "Message", link: "Link" },
  youtube: { primary: "Video", link: "Link" },
  shopping: { primary: "Product", link: "Link" },
  maps: { primary: "Place", link: "Link" },
  meeting: { primary: "Meeting", link: "Link" },
  "meeting-link": { primary: "Meeting", link: "Link" },
  gmail: { primary: "Email", link: "Link" },
  gcal: { primary: "Event", link: "Link" },
  linkedin: { primary: "Profile / message", link: "Link" },
  github: { primary: "Thread", link: "Link" },
  music: { primary: "Track", link: "Link" },
  notion: { primary: "Page", link: "Link" },
  "ai-chat": { primary: "Chat", link: "Link" },
  "work-tracker": { primary: "Task", link: "Link" },
  rideshare: { primary: "Ride", link: "Link" },
  "travel-book": { primary: "Trip", link: "Link" },
  "read-later": { primary: "Article", link: "Link" },
  calendar: { primary: "Commitment", link: "Link" },
  wellness: { primary: "Note", link: "Link" },
  browser: { primary: "Capture", link: "Link" },
  default: { primary: "Capture", link: "Link" },
};

function extractUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[),.;]+$/, "") : "";
}

function detectWriteGenre({ source, q, kind, url, utterance, title } = {}) {
  const blob = [source, q, kind, url, title, utterance].filter(Boolean).join(" ").toLowerCase();
  if (q && GENRE_LABELS[q]) return q;
  if (kind && GENRE_LABELS[kind]) return kind;
  if (source && GENRE_LABELS[source]) return source;
  if (/web\.whatsapp|telegram\.org|imessage|messages|slack\.com|discord\.com/.test(blob))
    return "messaging";
  if (/youtube\.com|youtu\.be/.test(blob)) return "youtube";
  if (/amazon\.|amzn\.|shopping|ebay\.|etsy\.|walmart\.|target\./.test(blob)) return "shopping";
  if (/maps\.google|maps\.apple|openstreetmap/.test(blob)) return "maps";
  if (/meet\.google|zoom\.us|teams\.microsoft/.test(blob)) return "meeting";
  if (/mail\.google|gmail/.test(blob)) return "gmail";
  if (/calendar\.google/.test(blob)) return "gcal";
  if (/linkedin\.com/.test(blob)) return "linkedin";
  if (/github\.com|gitlab\.com|bitbucket\.org/.test(blob)) return "github";
  if (/spotify\.com|music\.apple/.test(blob)) return "music";
  if (/notion\.(so|site)/.test(blob)) return "notion";
  if (/chatgpt\.com|claude\.ai|openai\.com/.test(blob)) return "ai-chat";
  if (/linear\.app|atlassian\.net|asana\.com|trello\.com/.test(blob)) return "work-tracker";
  if (/uber\.com|lyft\.com|bolt\.eu/.test(blob)) return "rideshare";
  if (/booking\.com|airbnb\.|expedia\.|kayak\./.test(blob)) return "travel-book";
  if (/x\.com\/|twitter\.com|reddit\.com|news\.ycombinator/.test(blob)) return "read-later";
  if (/calendar|commitment|event/.test(blob)) return "calendar";
  return "default";
}

/**
 * Split a mashed capture (title / URL / selection / helper prompt) into clean parts.
 */
function splitCaptureParts({
  utterance,
  content,
  title,
  url,
  selection,
  pageTitle,
} = {}) {
  const raw = String(content || utterance || "").trim();
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^\[Residence operation:/i.test(l));

  let foundUrl = String(url || "").trim() || extractUrl(raw);
  const cleanedLines = [];
  for (const line of lines) {
    const bare = line.replace(/^URL:\s*/i, "").trim();
    if (/^https?:\/\//i.test(bare)) {
      if (!foundUrl) foundUrl = bare.replace(/[),.;]+$/, "");
      continue;
    }
    if (CAPTURE_PROMPT_RE.test(line)) continue;
    cleanedLines.push(line);
  }

  let primary =
    String(selection || "").trim() ||
    String(pageTitle || "").trim() ||
    "";
  if (!primary && cleanedLines.length) {
    // Prefer a non-URL line that isn't just echoing the page chrome
    primary = cleanedLines[0];
    if (cleanedLines.length > 1 && /^https?:\/\//i.test(primary)) {
      primary = cleanedLines.find((l) => !/^https?:\/\//i.test(l)) || primary;
    }
  }
  if (!primary) primary = String(title || "").trim();

  // Drop duplicate URL-looking primary
  if (primary && foundUrl && primary === foundUrl) primary = String(title || "").trim();

  return {
    primary: primary.replace(/\s+/g, " ").trim(),
    url: foundUrl,
    extras: cleanedLines.filter((l) => l !== primary && l !== foundUrl).slice(0, 4),
  };
}

function looksLikeRawDump(candidate, parts) {
  const c = String(candidate || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!c) return true;
  if (/^https?:\/\//i.test(c)) return true;
  if (parts.url && c.includes(parts.url.toLowerCase())) return true;
  const primary = (parts.primary || "").toLowerCase();
  if (primary && c === primary) return true;
  if (primary && c.startsWith(primary) && c.length < primary.length + 40) return true;
  if (CAPTURE_PROMPT_RE.test(c)) return true;
  return false;
}

function buildInterpretation({ summary, title, payloadTitle, intentTitle, genre, parts } = {}) {
  const candidates = [intentTitle, payloadTitle, summary, title]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  for (const c of candidates) {
    if (!looksLikeRawDump(c, parts)) return summarizeContent(c, 220);
  }
  const label = (GENRE_LABELS[genre] || GENRE_LABELS.default).primary.toLowerCase();
  const head = parts.primary || "Captured item";
  const genreHints = {
    messaging: `Treat as a follow-up from this ${label}`,
    "messaging-web": "WhatsApp / messaging thread — likely a commitment or reminder",
    youtube: "Watch-later or schedule viewing time",
    shopping: "Shopping candidate — check budget before buying",
    maps: "Saved place — visit / dinner / trip candidate",
    meeting: "Meeting link — add to calendar",
    gmail: "Email thread — extract RSVP or follow-up",
    calendar: "Calendar commitment",
    github: "Code review / issue follow-up",
    "read-later": "Read later when the day is free",
    music: "Listen later / focus track",
    linkedin: "Networking follow-up",
    rideshare: "Ride — check calendar conflict",
    "travel-book": "Travel booking — budget + trip commitment",
  };
  const hint = genreHints[genre] || `Residence ${label}`;
  return summarizeContent(`${hint}: ${head}`, 220);
}

function formatWhenLine({ whenLabel, dateISO, startHhmm, savedAt } = {}, now = new Date()) {
  if (whenLabel && String(whenLabel).trim()) return String(whenLabel).trim();
  if (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO))) {
    const sched = resolveEventSchedule({ dateISO, startHhmm: startHhmm || "10:00" }, now);
    return sched.label;
  }
  const d = savedAt instanceof Date ? savedAt : now;
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = d.getHours();
  const mm = pad2(d.getMinutes());
  const suffix = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 || 12;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm} ${suffix}`;
}

/**
 * Structured body for Notes / Reminders / Calendar description.
 *
 * Layout (genre-adaptive labels):
 *   Message|Video|Product|…
 *   <primary>
 *   Link
 *   <url>
 *   AI interpretation
 *   <clean first read>
 *   My note
 *   <personal note>
 *   When|Saved
 *   <date/time>
 */
function formatWriteBody({
  source,
  captureMethod,
  utterance,
  summary,
  personalNote,
  content,
  title,
  intentTitle,
  url,
  selection,
  pageTitle,
  q,
  kind,
  whenLabel,
  dateISO,
  startHhmm,
  savedAt,
  destination,
} = {}) {
  const genre = detectWriteGenre({
    source,
    q,
    kind,
    url,
    utterance: utterance || content,
    title,
  });
  const labels = GENRE_LABELS[genre] || GENRE_LABELS.default;
  const parts = splitCaptureParts({
    utterance,
    content,
    title,
    url,
    selection,
    pageTitle,
  });
  const interpretation = buildInterpretation({
    summary,
    title,
    payloadTitle: title,
    intentTitle,
    genre,
    parts,
  });
  const note = String(personalNote || "").trim();
  const when = formatWhenLine({ whenLabel, dateISO, startHhmm, savedAt });
  const whenHeading =
    whenLabel || dateISO || destination === "calendar" || genre === "calendar" || genre === "meeting"
      ? "When"
      : "Saved";

  const blocks = [];
  if (parts.primary) {
    blocks.push(`${labels.primary}\n${parts.primary}`);
  }
  if (parts.url) {
    blocks.push(`${labels.link}\n${parts.url}`);
  }
  for (const extra of parts.extras) {
    if (extra && extra !== interpretation) blocks.push(extra);
  }
  blocks.push(`AI interpretation\n${interpretation}`);
  if (note) {
    blocks.push(`My note\n${note}`);
  }
  blocks.push(`${whenHeading}\n${when}`);

  const srcBits = [source, captureMethod && String(captureMethod).replace(/-/g, " ")]
    .filter(Boolean)
    .join(" · ");
  if (srcBits) blocks.push(`Source\n${srcBits}`);

  return blocks.join("\n\n");
}

function noteTitleForGenre({ genre, parts, title, destination } = {}) {
  const g = genre || "default";
  const primary = (parts && parts.primary) || "";
  const short = summarizeContent(primary || title || "Residence", 56);
  const prefixes = {
    messaging: "WhatsApp",
    "messaging-web": "WhatsApp",
    youtube: "Watch",
    shopping: "Shop",
    maps: "Place",
    meeting: "Meeting",
    "meeting-link": "Meeting",
    gmail: "Email",
    github: "Code",
    "read-later": "Read",
    music: "Listen",
    linkedin: "Network",
    calendar: "Calendar",
    rideshare: "Ride",
    "travel-book": "Trip",
  };
  const prefix = prefixes[g] || (destination === "calendar" ? "Calendar" : "Residence");
  if (!short || short === "Captured from Residence") return `${prefix}`;
  if (short.toLowerCase().startsWith(prefix.toLowerCase())) return short;
  return `${prefix} · ${short}`;
}

module.exports = {
  nextValidOccurrence,
  resolveEventSchedule,
  summarizeContent,
  formatWriteBody,
  detectWriteGenre,
  splitCaptureParts,
  extractUrl,
  buildInterpretation,
  formatWhenLine,
  noteTitleForGenre,
};
