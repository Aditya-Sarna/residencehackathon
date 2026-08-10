/** Real writes/reads against Google APIs — called with a live OAuth access token. */

async function googleFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!r.ok) {
    let detail = "";
    try {
      const j = await r.json();
      detail = j?.error?.message || j?.error_description || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Google API error (${r.status})`);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toRfc3339(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:00`;
}

export type EventInput = {
  title: string;
  description?: string;
  start: Date;
  end: Date;
};

export type CreatedCalendarEvent = {
  id: string;
  htmlLink: string;
  summary: string;
};

/** Creates a real event on the signed-in user's primary Google Calendar. */
export async function createCalendarEvent(token: string, input: EventInput): Promise<CreatedCalendarEvent> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return googleFetch<CreatedCalendarEvent>(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    token,
    {
      method: "POST",
      body: JSON.stringify({
        summary: input.title,
        description: input.description || "",
        start: { dateTime: toRfc3339(input.start), timeZone: tz },
        end: { dateTime: toRfc3339(input.end), timeZone: tz },
      }),
    }
  );
}

export type CreatedTask = { id: string; title: string; selfLink?: string };

/** Creates a real task in the signed-in user's default Google Tasks list. */
export async function createTask(
  token: string,
  input: { title: string; notes?: string; due?: Date }
): Promise<CreatedTask> {
  return googleFetch<CreatedTask>("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", token, {
    method: "POST",
    body: JSON.stringify({
      title: input.title,
      notes: input.notes || "",
      ...(input.due ? { due: input.due.toISOString() } : {}),
    }),
  });
}

export type CreatedDoc = { documentId: string; title: string };

/** Creates a real Google Doc with the capture's title + body as its content. */
export async function createDoc(token: string, title: string, body: string): Promise<CreatedDoc> {
  const doc = await googleFetch<CreatedDoc>("https://docs.googleapis.com/v1/documents", token, {
    method: "POST",
    body: JSON.stringify({ title: title.slice(0, 120) || "Residence note" }),
  });
  if (body.trim()) {
    await googleFetch(`https://docs.googleapis.com/v1/documents/${doc.documentId}:batchUpdate`, token, {
      method: "POST",
      body: JSON.stringify({
        requests: [{ insertText: { location: { index: 1 }, text: body } }],
      }),
    });
  }
  return doc;
}

export function docUrl(documentId: string) {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

export type GmailThreadPreview = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  link: string;
};

/** Reads real, live Gmail — the most recent inbox messages, metadata only. */
export async function listRecentGmail(token: string, maxResults = 6): Promise<GmailThreadPreview[]> {
  const list = await googleFetch<{ messages?: Array<{ id: string }> }>(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`,
    token
  );
  const ids = (list.messages || []).map((m) => m.id);
  const previews = await Promise.all(
    ids.map(async (id) => {
      const msg = await googleFetch<{
        id: string;
        snippet?: string;
        payload?: { headers?: Array<{ name: string; value: string }> };
      }>(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        token
      );
      const headers = msg.payload?.headers || [];
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const from = headers.find((h) => h.name === "From")?.value || "";
      return {
        id: msg.id,
        subject,
        from,
        snippet: msg.snippet || "",
        link: `https://mail.google.com/mail/u/0/#inbox/${msg.id}`,
      };
    })
  );
  return previews;
}
