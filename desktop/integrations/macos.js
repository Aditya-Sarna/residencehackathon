/**
 * macOS app bridges via AppleScript / System Events.
 * Capture from Notes, Safari, Chrome, Mail, Calendar; write back on Accept.
 */
const { execFile, spawn } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const web = require("./web_apps");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Run AppleScript via stdin (multiline `-e` is unreliable on newer macOS).
 */
function osascript(lines) {
  const script = Array.isArray(lines) ? lines.join("\n") : String(lines);
  return new Promise((resolve, reject) => {
    const child = spawn("osascript", [], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error("AppleScript timeout"));
    }, 12000);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve((stdout || "").trim());
        return;
      }
      const msg = (stderr || stdout || "AppleScript failed").trim();
      const err = new Error(msg);
      err.code = code;
      reject(err);
    });
    child.stdin.write(script);
    child.stdin.end();
  });
}

async function readPasteboard() {
  try {
    const { stdout } = await execFileAsync("pbpaste", [], {
      timeout: 3000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return String(stdout || "");
  } catch {
    return "";
  }
}

async function writePasteboard(text) {
  await new Promise((resolve, reject) => {
    const child = spawn("pbcopy", []);
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("pbcopy failed"))));
    child.stdin.write(String(text ?? ""), "utf8");
    child.stdin.end();
  });
}

async function frontmostApp() {
  try {
    const name = await osascript([
      'tell application "System Events"',
      "  name of first application process whose frontmost is true",
      "end tell",
    ]);
    return name || "Unknown";
  } catch {
    return "Unknown";
  }
}

function sourceFromApp(appName) {
  const n = (appName || "").toLowerCase();
  if (n.includes("claude")) return "claude-desktop";
  if (n.includes("chatgpt") || n.includes("openai")) return "ai-chat";
  if (n.includes("notes")) return "apple-notes";
  if (n.includes("calendar")) return "apple-calendar";
  if (n.includes("reminders")) return "apple-reminders";
  if (n.includes("safari")) return "safari";
  if (n.includes("chrome") || n.includes("chromium") || n.includes("arc") || n.includes("brave"))
    return "browser";
  if (n.includes("mail")) return "apple-mail";
  if (n.includes("messages") || n.includes("whatsapp")) return "messages";
  if (n.includes("slack")) return "slack";
  if (n.includes("discord")) return "discord";
  if (n.includes("notion")) return "notion";
  if (n.includes("textedit")) return "textedit";
  if (n.includes("music") && !n.includes("youtube")) return "apple-music";
  if (n.includes("spotify")) return "spotify";
  if (n.includes("maps")) return "apple-maps";
  if (n.includes("linkedin")) return "linkedin";
  if (n.includes("github") || n.includes("gitkraken") || n.includes("tower")) return "github";
  if (n.includes("cursor") || n.includes("code") || n.includes("xcode")) return "dev";
  if (n.includes("finder")) return "finder";
  if (n.includes("linear")) return "work-tracker";
  return "macos";
}

/**
 * Read focused AXSelectedText (no clipboard clobber). Best on native Cocoa apps.
 */
async function captureSelectedTextAX(appName) {
  try {
    const text = await osascript([
      'tell application "System Events"',
      `  tell application process ${JSON.stringify(appName || "")}`,
      '    set fe to missing value',
      '    try',
      '      set fe to value of attribute "AXFocusedUIElement"',
      "    end try",
      "    if fe is missing value then return \"\"",
      '    try',
      '      return value of attribute "AXSelectedText" of fe',
      "    on error",
      '      return ""',
      "    end try",
      "  end tell",
      "end tell",
    ]);
    return (text || "").replace(/\r/g, "\n").trim();
  } catch {
    return "";
  }
}

/**
 * Copy current selection via ⌘C (requires Accessibility), restore clipboard after.
 * Uses system pasteboard (pbcopy/pbpaste) + activate front app — Electron clipboard
 * alone often races or reads before the pasteboard updates.
 */
async function captureSelection(clipboard) {
  const front = await frontmostApp();
  // Prefer AX — no clipboard side effects when it works.
  if (front && front !== "Unknown" && !/^residence|electron$/i.test(front)) {
    const ax = await captureSelectedTextAX(front);
    if (ax) return { text: ax, method: "selection-ax" };
  }

  const previous =
    (typeof clipboard?.readText === "function" ? clipboard.readText() : "") ||
    (await readPasteboard());
  const marker = `__residence_waiting_${Date.now()}__`;
  try {
    await writePasteboard(marker);
    if (typeof clipboard?.writeText === "function") clipboard.writeText(marker);

    // Let global-hotkey modifiers (⇧⌘) release before we synthesize ⌘C.
    await sleep(80);

    const target = front && !/^residence|electron$/i.test(front) ? front : "";
    await osascript([
      "set targetApp to " + JSON.stringify(target),
      'if targetApp is not "" then',
      "  try",
      "    tell application targetApp to activate",
      "  end try",
      "  delay 0.08",
      "end if",
      'tell application "System Events"',
      '  keystroke "c" using command down',
      "end tell",
    ]);

    let text = "";
    for (let i = 0; i < 12; i++) {
      await sleep(i === 0 ? 120 : 60);
      const fromPb = await readPasteboard();
      const fromEl =
        typeof clipboard?.readText === "function" ? clipboard.readText() || "" : "";
      const candidate = fromPb || fromEl;
      if (candidate && candidate !== marker) {
        text = candidate;
        break;
      }
    }

    text = (text || "").replace(/\r/g, "\n").trim();
    await writePasteboard(previous);
    if (typeof clipboard?.writeText === "function") clipboard.writeText(previous);

    if (!text || text === marker) {
      return { text: "", method: "selection-empty" };
    }
    return { text, method: "selection" };
  } catch (e) {
    try {
      await writePasteboard(previous);
      if (typeof clipboard?.writeText === "function") clipboard.writeText(previous);
    } catch {
      /* ignore restore errors */
    }
    throw e;
  }
}

async function notesFrontBody() {
  // Best-effort: most recently modified note in Notes
  const body = await osascript([
    'tell application "Notes"',
    "  if (count of notes) is 0 then return \"\"",
    "  set n to note 1",
    "  try",
    "    return plaintext of n",
    "  on error",
    "    return body of n",
    "  end try",
    "end tell",
  ]);
  return (body || "").replace(/\r/g, "\n").trim();
}

async function safariContext() {
  try {
    const raw = await osascript([
      'tell application "Safari"',
      "  if (count of windows) is 0 then return \"\"",
      "  set t to name of current tab of front window",
      "  set u to URL of current tab of front window",
      '  return t & "\\n" & u',
      "end tell",
    ]);
    return raw;
  } catch {
    return "";
  }
}

async function chromeContext() {
  try {
    const raw = await osascript([
      'tell application "Google Chrome"',
      "  if (count of windows) is 0 then return \"\"",
      "  set t to title of active tab of front window",
      "  set u to URL of active tab of front window",
      '  return t & "\\n" & u',
      "end tell",
    ]);
    return raw;
  } catch {
    return "";
  }
}

async function mailFrontSubject() {
  try {
    return await osascript([
      'tell application "Mail"',
      "  if (count of message viewers) is 0 then return \"\"",
      "  set sel to selection",
      "  if (count of sel) is 0 then return \"\"",
      "  set m to item 1 of sel",
      '  return subject of m & "\\n" & content of m',
      "end tell",
    ]);
  } catch {
    return "";
  }
}

async function calendarSelectedSummary() {
  try {
    return await osascript([
      'tell application "Calendar"',
      "  -- Calendar selection API is limited; return next upcoming event as context",
      "  set d0 to current date",
      "  set d1 to d0 + 7 * days",
      "  set evs to every event of calendar 1 whose start date ≥ d0 and start date ≤ d1",
      "  if (count of evs) is 0 then return \"\"",
      "  set e to item 1 of evs",
      '  return summary of e & " on " & (start date of e as string)',
      "end tell",
    ]);
  } catch {
    return "";
  }
}

/**
 * Pull next N days of Apple Calendar events (calendar 1) for daily sync / briefing.
 * Returns [{ title, dateISO, startHhmm }]
 */
async function listCalendarEvents({ days = 7 } = {}) {
  const n = Math.max(1, Math.min(14, Number(days) || 7));
  try {
    const raw = await osascript([
      "on pad(n)",
      '  set s to n as string',
      '  if (count of s) is 1 then return "0" & s',
      "  return s",
      "end pad",
      'tell application "Calendar"',
      "  set d0 to current date",
      "  set hours of d0 to 0",
      "  set minutes of d0 to 0",
      "  set seconds of d0 to 0",
      `  set d1 to d0 + ${n} * days`,
      '  set out to ""',
      "  try",
      "    set evs to every event of calendar 1 whose start date ≥ d0 and start date < d1",
      "  on error",
      "    return \"\"",
      "  end try",
      "  repeat with e in evs",
      "    try",
      "      set s to start date of e",
      "      set y to year of s as integer",
      "      set m to month of s as integer",
      "      set dy to day of s as integer",
      "      set hh to hours of s as integer",
      "      set mm to minutes of s as integer",
      '      set t to summary of e as string',
      '      set iso to (y as string) & "-" & my pad(m) & "-" & my pad(dy)',
      '      set hm to my pad(hh) & ":" & my pad(mm)',
      '      set out to out & t & tab & iso & tab & hm & linefeed',
      "    end try",
      "  end repeat",
      "  return out",
      "end tell",
    ]);
    return String(raw || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split("\t");
        if (parts.length < 2) return null;
        const title = parts[0].trim();
        const dateISO = parts[1].trim();
        const startHhmm = (parts[2] || "").trim();
        if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return null;
        return { title: title.slice(0, 120), dateISO, startHhmm: startHhmm.slice(0, 5) };
      })
      .filter(Boolean)
      .slice(0, 40);
  } catch {
    return [];
  }
}

async function musicNowPlaying() {
  try {
    return await osascript([
      'tell application "Music"',
      "  if player state is stopped then return \"\"",
      "  set t to name of current track",
      "  set a to artist of current track",
      '  return "Music: " & t & " by " & a & "\\nSave for focus later or add a listen reminder?"',
      "end tell",
    ]);
  } catch {
    return "";
  }
}

async function mapsFrontContext() {
  try {
    // Maps AppleScript is limited; window name often carries the place
    return await osascript([
      'tell application "System Events"',
      '  tell process "Maps"',
      "    if (count of windows) is 0 then return \"\"",
      "    set w to name of front window",
      '    return "Place: " & w & "\\nSave this place for later / dinner / trip?"',
      "  end tell",
      "end tell",
    ]);
  } catch {
    return "";
  }
}

async function frontWindowTitle(appName) {
  const safe = String(appName || "").replace(/"/g, "");
  if (!safe) return "";
  try {
    return await osascript([
      'tell application "System Events"',
      `  tell process "${safe}"`,
      "    if (count of windows) is 0 then return \"\"",
      "    return name of front window",
      "  end tell",
      "end tell",
    ]);
  } catch {
    return "";
  }
}

async function browserTabRaw(source) {
  if (source === "safari") return safariContext();
  if (source === "browser") return chromeContext();
  // Arc/Brave often still respond to Chrome AppleScript suite
  try {
    return await chromeContext();
  } catch {
    return "";
  }
}

/**
 * Smart capture: selection first, then app-specific / YouTube / Gmail tab context.
 */
async function smartCapture(clipboard) {
  const appName = await frontmostApp();
  let source = sourceFromApp(appName);
  let text = "";
  let method = "none";
  let kind = null;
  let meta = { appName, source };

  let selection = "";
  try {
    const sel = await captureSelection(clipboard);
    if (sel.text) {
      selection = sel.text;
      method = "selection";
    }
  } catch {
    // Accessibility may be denied — fall through
  }

  // Browser tabs → YouTube / Gmail / Meet enrichment
  if (source === "safari" || source === "browser") {
    try {
      const raw = await browserTabRaw(source);
      const tab = web.parseTabContext(raw);
      if (tab) {
        const enriched = web.enrichCapture({
          title: tab.title,
          url: tab.url,
          selection,
        });
        if (enriched.text) {
          text = enriched.text;
          source = enriched.source;
          kind = enriched.kind;
          method = selection ? "selection+tab" : "tab";
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!text && selection) {
    text = selection;
    method = "selection";
  }

  if (!text) {
    try {
      if (source === "apple-notes") {
        text = await notesFrontBody();
        method = text ? "notes-front" : "none";
      } else if (source === "apple-mail") {
        text = await mailFrontSubject();
        method = text ? "mail-selection" : "none";
        if (text) source = "gmail"; // treat Mail like email invites for reasoning
      } else if (source === "apple-calendar") {
        text = await calendarSelectedSummary();
        method = text ? "calendar-upcoming" : "none";
      } else if (source === "apple-music" || source === "spotify") {
        text = await musicNowPlaying();
        if (text) {
          method = "music-now";
          kind = "music";
          source = "music";
        }
      } else if (source === "apple-maps") {
        text = await mapsFrontContext();
        if (text) {
          method = "maps-window";
          kind = "maps";
          source = "maps";
        }
      } else if (source === "linkedin" || source === "github" || source === "dev") {
        const winTitle = await frontWindowTitle(appName);
        if (winTitle) {
          if (source === "linkedin") {
            text = `LinkedIn: ${winTitle}\nSchedule a follow-up or save a networking note?`;
            kind = "linkedin";
          } else {
            text = `Code thread: ${winTitle}\nRemind me to review this later?`;
            kind = "github";
            source = "github";
          }
          method = "window-title";
        }
      }
    } catch {
      /* ignore */
    }
  }

  // Notion / messaging selection with light prompt when raw selection only
  if (text && selection && !kind) {
    if (source === "notion") {
      text = `${selection}\nCapture this into Residence Notes / Commitment?`;
      kind = "notion";
    } else if (source === "messages" || source === "slack" || source === "discord") {
      text = `${selection}\nTurn this into a Calendar commitment or reminder?`;
      kind = "messaging";
    } else if (source === "linkedin") {
      text = `${selection}\nSchedule a follow-up or save a networking note?`;
      kind = "linkedin";
      source = "linkedin";
    } else if (source === "github" || source === "dev") {
      text = `${selection}\nRemind me to review this later?`;
      kind = "github";
      source = "github";
    } else if (source === "ai-chat") {
      text = `${selection}\nSave commitments or health notes from this chat?`;
      kind = "ai-chat";
    }
  }

  // Never silently repurpose arbitrary clipboard contents as application
  // context. Clipboard capture is an explicit, separate hotkey in main.js.

  return { text, method, kind, ...meta, source };
}

function appleString(value, limit = 2000) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, "\\n")
    .slice(0, limit);
}

function residenceMarker(operationId) {
  return `[Residence operation:${operationId}]`;
}

function nextValidOccurrence(dayOfMonth) {
  const now = new Date();
  const requested = Math.max(1, Math.min(31, Number(dayOfMonth) || now.getDate()));
  let year = now.getFullYear();
  let month = now.getMonth();
  const make = () => new Date(year, month, Math.min(requested, new Date(year, month + 1, 0).getDate()), 10, 0, 0);
  let out = make();
  if (out <= now) {
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
    out = make();
  }
  return { year: out.getFullYear(), month: out.getMonth() + 1, day: out.getDate() };
}

async function createCalendarEvent({ title, dayOfMonth, dateISO, startHhmm, notes, operationId }) {
  const summary = appleString(title || "Residence", 120);
  const marker = residenceMarker(operationId || "unknown");
  const body = appleString(`${notes || ""}\n${marker}`, 1000);
  let year;
  let month;
  let day;
  let hours = 10;
  let minutes = 0;
  if (dateISO && /^\d{4}-\d{2}-\d{2}$/.test(String(dateISO))) {
    const [y, m, d] = String(dateISO).split("-").map(Number);
    year = y;
    month = m;
    day = d;
  } else {
    const occurrence = nextValidOccurrence(dayOfMonth);
    year = occurrence.year;
    month = occurrence.month;
    day = occurrence.day;
  }
  if (startHhmm && /^\d{1,2}:\d{2}$/.test(String(startHhmm))) {
    const [h, mi] = String(startHhmm).split(":").map(Number);
    hours = h;
    minutes = mi;
  }
  await osascript([
    "set startDate to current date",
    `set year of startDate to ${year}`,
    `set month of startDate to ${month}`,
    `set day of startDate to ${day}`,
    `set hours of startDate to ${hours}`,
    `set minutes of startDate to ${minutes}`,
    "set seconds of startDate to 0",
    "set endDate to startDate + 1 * hours",
    'tell application "Calendar"',
    "  tell calendar 1",
    `    if (count of (every event whose description contains "${appleString(marker, 120)}")) is 0 then`,
    `      make new event with properties {summary:"${summary}", start date:startDate, end date:endDate, description:"${body}"}`,
    "    end if",
    "  end tell",
    "end tell",
  ]);
  return { ok: true, app: "Calendar" };
}

async function createOrAppendNote({ title, body, operationId }) {
  const name = appleString(title || "Residence", 80);
  const marker = residenceMarker(operationId || "unknown");
  const content = appleString(`${body || ""}\n${marker}`, 2000);
  const markerSafe = appleString(marker, 120);
  // Prefer default account folder; fall back to a top-level note if folder APIs flake.
  try {
    await osascript([
      'tell application "Notes"',
      "  tell account 1",
      "    try",
      '      set theFolder to folder "Notes"',
      "    on error",
      "      try",
      "        set theFolder to folder 1",
      "      on error",
      "        set theFolder to missing value",
      "      end try",
      "    end try",
      "    if theFolder is missing value then",
      `      make new note with properties {name:"${name}", body:"${content}"}`,
      "    else",
      "      tell theFolder",
      `        if (count of (every note whose body contains "${markerSafe}")) is 0 then`,
      `          make new note with properties {name:"${name}", body:"${content}"}`,
      "        end if",
      "      end tell",
      "    end if",
      "  end tell",
      "end tell",
    ]);
  } catch (e) {
    // Last resort: create without folder / idempotency scan (Automation prompt may appear)
    await osascript([
      'tell application "Notes"',
      `  make new note with properties {name:"${name}", body:"${content}"}`,
      "end tell",
    ]);
  }
  return { ok: true, app: "Notes" };
}

async function createReminder({ title, body, operationId }) {
  const name = appleString(title || "Residence", 120);
  const marker = residenceMarker(operationId || "unknown");
  const note = appleString(`${body || ""}\n${marker}`, 1000);
  await osascript([
    'tell application "Reminders"',
    "  set theList to default list",
    `  tell theList to if (count of (every reminder whose body contains "${appleString(marker, 120)}")) is 0 then make new reminder with properties {name:"${name}", body:"${note}"}`,
    "end tell",
  ]);
  return { ok: true, app: "Reminders" };
}

async function writeBack(actionApp, payload, utterance, operationId, opts = {}) {
  const writes = [];
  const p = payload || {};
  const ut = utterance || "";
  const urlMatch = ut.match(/https?:\/\/\S+/);
  const dest = String(opts.destination || "").toLowerCase();
  const title =
    p.title || p.text || (ut ? ut.slice(0, 80) : "") || "Residence";
  const body = p.note || p.incoming || p.text || ut || "";

  // Explicit one-tap destinations from the choice sheet — skip specialty routing.
  if (dest === "notes") {
    try {
      writes.push(
        await createOrAppendNote({
          title: title.slice(0, 80) || "Residence · Note",
          body,
          operationId,
        })
      );
      return { ok: true, writes };
    } catch (e) {
      return { ok: false, error: String(e.message || e), writes };
    }
  }
  if (dest === "calendar") {
    try {
      writes.push(
        await createCalendarEvent({
          title: title.slice(0, 120) || "Residence event",
          dayOfMonth: p.dayOfMonth || p.day,
          dateISO: p.dateISO,
          startHhmm: p.startHhmm,
          notes: body,
          operationId,
        })
      );
      return { ok: true, writes };
    } catch (e) {
      return { ok: false, error: String(e.message || e), writes };
    }
  }
  if (dest === "reminders") {
    try {
      writes.push(
        await createReminder({
          title: title.slice(0, 120) || "Residence reminder",
          body: [urlMatch && urlMatch[0], body].filter(Boolean).join("\n").slice(0, 400),
          operationId,
        })
      );
      return { ok: true, writes };
    } catch (e) {
      return { ok: false, error: String(e.message || e), writes };
    }
  }

  try {
    // YouTube / watch-later → Reminders (+ optional calendar block)
    if (
      p.q === "youtube" ||
      /youtube\.com|youtu\.be/i.test(ut) ||
      String(p.title || "").toLowerCase().includes("watch")
    ) {
      writes.push(
        await createReminder({
          title: p.title || "Watch later",
          body: urlMatch ? urlMatch[0] : ut.slice(0, 200),
          operationId,
        })
      );
      if (actionApp === "calendar" && p.dayOfMonth) {
        writes.push(
          await createCalendarEvent({
            title: p.title || "Watch",
            dayOfMonth: p.dayOfMonth,
            notes: ut,
            operationId,
          })
        );
      }
      return { ok: true, writes };
    }

    // Shopping / Amazon → Reminders list (+ Notes if allergy)
    if (
      p.q === "shopping" ||
      actionApp === "shop" ||
      /amazon\.|shopping list|buy this|check budget/i.test(ut)
    ) {
      writes.push(
        await createReminder({
          title: p.who ? `Gift for ${p.who}` : p.title || p.q || "Shopping list",
          body: [urlMatch && urlMatch[0], p.title, utterance].filter(Boolean).join(" — ").slice(0, 400),
          operationId,
        })
      );
      if (actionApp === "wellness" || p.allergen) {
        writes.push(
          await createOrAppendNote({
            title: "Residence · Allergy check",
            body: p.note || `Check for ${p.allergen || "allergens"} before: ${ut.slice(0, 160)}`,
            operationId,
          })
        );
      }
      if (actionApp === "wallet") {
        writes.push(
          await createReminder({
            title: `Budget $${p.ceilingWeeklyUsd || ""}`.trim(),
            body: utterance || "Shopping vs budget",
            operationId,
          })
        );
      }
      return { ok: true, writes };
    }

    // Maps / place → Notes + optional Reminder
    if (p.q === "maps" || /maps\.google|maps\.apple|save this place/i.test(ut)) {
      writes.push(
        await createOrAppendNote({
          title: p.title || "Saved place",
          body: [urlMatch && urlMatch[0], utterance].filter(Boolean).join("\n"),
          operationId,
        })
      );
      writes.push(
        await createReminder({
          title: p.title || "Visit place",
          body: urlMatch ? urlMatch[0] : ut.slice(0, 200),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    // LinkedIn / networking follow-up
    if (p.q === "linkedin" || /linkedin\.com|follow-up|networking note/i.test(ut)) {
      if (actionApp === "calendar" && p.dayOfMonth) {
        writes.push(
          await createCalendarEvent({
            title: p.title || "Networking follow-up",
            dayOfMonth: p.dayOfMonth,
            notes: ut,
            operationId,
          })
        );
      }
      writes.push(
        await createReminder({
          title: p.title || "LinkedIn follow-up",
          body: [urlMatch && urlMatch[0], utterance].filter(Boolean).join("\n").slice(0, 400),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    // GitHub / PR review
    if (p.q === "github" || /github\.com|gitlab\.com|review this later/i.test(ut)) {
      writes.push(
        await createReminder({
          title: p.title || "Review PR / issue",
          body: [urlMatch && urlMatch[0], utterance].filter(Boolean).join("\n").slice(0, 400),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    // Music / focus listen
    if (p.q === "music" || /save for focus|listen reminder|music:/i.test(ut)) {
      writes.push(
        await createReminder({
          title: p.title || "Listen later",
          body: ut.slice(0, 300),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    // Read-later articles
    if (p.q === "read-later" || /read later/i.test(ut)) {
      writes.push(
        await createReminder({
          title: p.title || "Read later",
          body: [urlMatch && urlMatch[0], utterance].filter(Boolean).join("\n").slice(0, 400),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    // Rideshare clash → calendar note + remind to leave
    if (p.q === "rideshare" || /uber\.com|lyft\.com|ride conflict/i.test(ut)) {
      if (p.dayOfMonth || actionApp === "calendar") {
        writes.push(
          await createCalendarEvent({
            title: p.title || "Ride",
            dayOfMonth: p.dayOfMonth || new Date().getDate(),
            notes: ut,
            operationId,
          })
        );
      }
      writes.push(
        await createReminder({
          title: "Leave for ride",
          body: ut.slice(0, 200),
          operationId,
        })
      );
      return { ok: true, writes };
    }

    if (actionApp === "calendar") {
      writes.push(
        await createCalendarEvent({
          title: p.title || p.text || utterance || "Residence event",
          dayOfMonth: p.dayOfMonth || p.day,
          dateISO: p.dateISO,
          startHhmm: p.startHhmm,
          notes: utterance || p.text || "",
          operationId,
        })
      );
      // Same-day conflict Accept with needsTime → also remind to pick a time
      if (p.needsTime === true || p.needsTime === "true") {
        writes.push(
          await createReminder({
            title: `Pick a time · ${p.title || "event"}`,
            body: p.existing
              ? `Conflicts with: ${p.existing}`
              : "Residence asked for a clock time.",
            operationId,
          })
        );
      }
    }
    if (actionApp === "wellness" || actionApp === "notes") {
      writes.push(
        await createOrAppendNote({
          title: actionApp === "notes" ? "Residence · Note" : "Residence · Wellness",
          body: p.note || p.incoming || p.text || utterance || "",
          operationId,
        })
      );
    }
    if (actionApp === "wallet" || (p.kind === "budget_conflict" && actionApp === "wallet")) {
      writes.push(
        await createReminder({
          title: `Budget $${p.ceilingWeeklyUsd || ""}`.trim(),
          body: utterance || "Updated from Residence",
          operationId,
        })
      );
    }
    if (actionApp === "shop") {
      writes.push(
        await createReminder({
          title: p.who ? `Gift for ${p.who}` : p.q || "Shop from Residence",
          body: [p.title, utterance].filter(Boolean).join(" — "),
          operationId,
        })
      );
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e), writes };
  }
  return { ok: true, writes };
}

const INTEGRATIONS = [
  {
    id: "claude",
    name: "Claude Desktop",
    detail: "MCP + capture · same-day clash / ask times",
    capture: true,
    writeBack: false,
  },
  {
    id: "ai-chat",
    name: "ChatGPT / Claude web",
    detail: "Selection → commitments & health notes",
    capture: true,
    writeBack: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    detail: "Safari/Chrome tab → watch-later or calendar block",
    capture: true,
    writeBack: true,
  },
  {
    id: "gmail",
    name: "Gmail",
    detail: "mail.google.com tab or Mail.app → invite / clash check",
    capture: true,
    writeBack: true,
  },
  {
    id: "shopping",
    name: "Amazon / shopping",
    detail: "Product tab → budget + allergy + shopping list",
    capture: true,
    writeBack: true,
  },
  {
    id: "maps",
    name: "Maps (web + Apple Maps)",
    detail: "Place → Notes + visit Reminder",
    capture: true,
    writeBack: true,
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    detail: "Profile / message → follow-up Reminder or Calendar",
    capture: true,
    writeBack: true,
  },
  {
    id: "github",
    name: "GitHub / GitLab",
    detail: "PR / issue → review Reminder",
    capture: true,
    writeBack: true,
  },
  {
    id: "music",
    name: "Music / Spotify",
    detail: "Now playing or web track → listen / focus Reminder",
    capture: true,
    writeBack: true,
  },
  {
    id: "notion",
    name: "Notion",
    detail: "Selection → Notes / Commitment",
    capture: true,
    writeBack: true,
  },
  {
    id: "work-tracker",
    name: "Linear / Jira / Asana",
    detail: "Ticket tab → focus block or deadline Reminder",
    capture: true,
    writeBack: true,
  },
  {
    id: "rideshare",
    name: "Uber / Lyft",
    detail: "Ride vs Calendar commitment",
    capture: true,
    writeBack: true,
  },
  {
    id: "travel",
    name: "Booking / Airbnb",
    detail: "Trip page → budget check + Commitment",
    capture: true,
    writeBack: true,
  },
  {
    id: "read-later",
    name: "X / Reddit / HN",
    detail: "Article tab → read-later Reminder",
    capture: true,
    writeBack: true,
  },
  {
    id: "notes",
    name: "Apple Notes",
    detail: "Capture note text · Accept → new note",
    capture: true,
    writeBack: true,
  },
  {
    id: "calendar",
    name: "Apple Calendar",
    detail: "Capture · Accept → event (+ time reminder if clash)",
    capture: true,
    writeBack: true,
  },
  {
    id: "reminders",
    name: "Reminders",
    detail: "Watch-later, shop, maps, PRs, gifts, budget, pick-a-time",
    capture: false,
    writeBack: true,
  },
  {
    id: "safari",
    name: "Safari",
    detail: "Selection or tab (YouTube, Gmail, Shop, Maps, …)",
    capture: true,
    writeBack: false,
  },
  {
    id: "chrome",
    name: "Chrome / Arc / Brave",
    detail: "Selection or active tab (enriched web use cases)",
    capture: true,
    writeBack: false,
  },
  {
    id: "mail",
    name: "Apple Mail",
    detail: "Selected message → invite reasoning",
    capture: true,
    writeBack: false,
  },
  {
    id: "slack",
    name: "Slack / Discord / Messages / WhatsApp",
    detail: "Selection → commitment or reminder prompt",
    capture: true,
    writeBack: false,
  },
  {
    id: "meeting",
    name: "Meet / Zoom / Teams",
    detail: "Browser meeting link → Calendar",
    capture: true,
    writeBack: true,
  },
];

module.exports = {
  osascript,
  frontmostApp,
  sourceFromApp,
  smartCapture,
  captureSelection,
  writeBack,
  createCalendarEvent,
  createOrAppendNote,
  createReminder,
  listCalendarEvents,
  INTEGRATIONS,
};
