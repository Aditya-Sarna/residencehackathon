/**
 * Real write-back for the browser Residence. When Google is connected this
 * makes a genuine Calendar event / Google Doc / Google Task via the REST
 * APIs (googleApi.ts). When it isn't connected — or the live write fails —
 * it falls back to a client-only compose link / file download, and the
 * result is labelled honestly (`live: false`) rather than pretending.
 */

import { googleAccessToken, type GoogleScopeKey } from "./googleAuth";
import { createCalendarEvent, createDoc, createTask, docUrl } from "./googleApi";

export type WriteTarget = "calendar" | "docs" | "tasks" | "facts-only";

export type WritePayload = {
  title: string;
  body: string;
  whenLabel?: string;
  dateISO?: string;
  startHhmm?: string;
  url?: string;
};

export type WriteBackResult = {
  message: string;
  /** true when this actually wrote to the live third-party app via its API. */
  live: boolean;
  link?: string;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseWhen(p: WritePayload): { start: Date; end: Date } {
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  let d = now.getDate();
  if (p.dateISO && /^\d{4}-\d{2}-\d{2}$/.test(p.dateISO)) {
    const [yy, mm, dd] = p.dateISO.split("-").map(Number);
    y = yy;
    m = mm - 1;
    d = dd;
  } else if (/tomorrow/i.test(p.whenLabel || p.body || p.title)) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    y = t.getFullYear();
    m = t.getMonth();
    d = t.getDate();
  }
  let hh = 10;
  let mi = 0;
  const hm = (p.startHhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (hm) {
    hh = Number(hm[1]);
    mi = Number(hm[2]);
  } else {
    const ampm = (p.whenLabel || "").match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
    if (ampm) {
      hh = Number(ampm[1]) % 12;
      if (/pm/i.test(ampm[3])) hh += 12;
      mi = Number(ampm[2] || 0);
    }
  }
  const start = new Date(y, m, d, hh, mi, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end };
}

function icsStamp(dt: Date) {
  return (
    `${dt.getUTCFullYear()}${pad2(dt.getUTCMonth() + 1)}${pad2(dt.getUTCDate())}T` +
    `${pad2(dt.getUTCHours())}${pad2(dt.getUTCMinutes())}${pad2(dt.getUTCSeconds())}Z`
  );
}

function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeIcs(s: string) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function slug(s: string) {
  return (
    String(s || "residence")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "residence"
  );
}

function offlineCalendarCompose(p: WritePayload): string {
  const { start, end } = parseWhen(p);
  const gStart =
    `${start.getFullYear()}${pad2(start.getMonth() + 1)}${pad2(start.getDate())}T` +
    `${pad2(start.getHours())}${pad2(start.getMinutes())}00`;
  const gEnd =
    `${end.getFullYear()}${pad2(end.getMonth() + 1)}${pad2(end.getDate())}T` +
    `${pad2(end.getHours())}${pad2(end.getMinutes())}00`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    details: [p.body, p.url].filter(Boolean).join("\n\n"),
    dates: `${gStart}/${gEnd}`,
  });
  const href = `https://calendar.google.com/calendar/render?${params}`;
  window.open(href, "_blank", "noopener");
  return href;
}

function offlineIcsDownload(p: WritePayload) {
  const { start, end } = parseWhen(p);
  const uid = `residence-${Date.now()}@local`;
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Residence//Browser//EN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${escapeIcs(p.title)}`,
    `DESCRIPTION:${escapeIcs([p.body, p.url].filter(Boolean).join("\\n"))}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  downloadText(`${slug(p.title)}.ics`, ics, "text/calendar");
}

function offlineNoteDownload(p: WritePayload) {
  const text = [
    p.title,
    "",
    p.body,
    p.whenLabel ? `\nWhen: ${p.whenLabel}` : "",
    p.url ? `\nLink: ${p.url}` : "",
    "",
    "— Saved from Residence",
  ]
    .filter(Boolean)
    .join("\n");
  downloadText(`${slug(p.title)}.txt`, text, "text/plain");
}

const TARGET_SCOPE: Record<Exclude<WriteTarget, "facts-only">, GoogleScopeKey> = {
  calendar: "calendar",
  docs: "docs",
  tasks: "tasks",
};

/**
 * Writes the accepted capture to the app it belongs in. Tries the real
 * Google API first when connected; always succeeds from the user's point of
 * view via the offline fallback, but the result tells the caller whether the
 * write actually landed in the live third-party app.
 */
export async function performWriteBack(target: WriteTarget, p: WritePayload): Promise<WriteBackResult> {
  if (target === "facts-only") {
    return { message: "Saved to your Fact graph", live: true };
  }

  const token = googleAccessToken([TARGET_SCOPE[target]]);

  if (target === "calendar") {
    if (token) {
      try {
        const { start, end } = parseWhen(p);
        const ev = await createCalendarEvent(token, {
          title: p.title,
          description: [p.body, p.url].filter(Boolean).join("\n\n"),
          start,
          end,
        });
        return { message: "Added to Google Calendar", live: true, link: ev.htmlLink };
      } catch (e) {
        offlineCalendarCompose(p);
        offlineIcsDownload(p);
        return { message: `Google Calendar write failed (${(e as Error).message}) — opened a prefilled event instead`, live: false };
      }
    }
    offlineCalendarCompose(p);
    offlineIcsDownload(p);
    return { message: "Google not connected — opened a prefilled event · downloaded .ics", live: false };
  }

  if (target === "docs") {
    if (token) {
      try {
        const doc = await createDoc(
          token,
          p.title,
          [p.body, p.whenLabel ? `When: ${p.whenLabel}` : "", p.url || ""].filter(Boolean).join("\n\n")
        );
        return { message: "Saved as a Google Doc", live: true, link: docUrl(doc.documentId) };
      } catch (e) {
        offlineNoteDownload(p);
        return { message: `Google Docs write failed (${(e as Error).message}) — downloaded a note instead`, live: false };
      }
    }
    offlineNoteDownload(p);
    return { message: "Google not connected — downloaded a note file", live: false };
  }

  // tasks
  if (token) {
    try {
      const { start } = parseWhen(p);
      await createTask(token, {
        title: p.title,
        notes: [p.body, p.url].filter(Boolean).join("\n\n"),
        due: start,
      });
      return { message: "Added to Google Tasks", live: true };
    } catch (e) {
      offlineNoteDownload({ ...p, title: `Task · ${p.title}` });
      return { message: `Google Tasks write failed (${(e as Error).message}) — downloaded a note instead`, live: false };
    }
  }
  offlineNoteDownload({ ...p, title: `Task · ${p.title}` });
  return { message: "Google not connected — downloaded a note file", live: false };
}
