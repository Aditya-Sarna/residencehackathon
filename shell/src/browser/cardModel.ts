import type { DesktopPermission, FactResult } from "../api";

export type ContextCard = {
  id: string;
  kind: "pending" | "fact";
  sourceLabel: string;
  badge: string;
  title: string;
  aiReading: string;
  yourMessage: string;
  whenLabel: string;
  dateISO?: string;
  startHhmm?: string;
  url?: string;
  tags: string[];
  confidence: number;
  status: "pending" | "accepted" | "declined";
  actionApp: string;
  preferredDestination: "calendar" | "docs" | "tasks" | "facts-only";
  raw?: DesktopPermission;
};

function extractUrl(text: string) {
  const m = String(text || "").match(/https?:\/\/[^\s]+/i);
  return m ? m[0].replace(/[),.;]+$/, "") : "";
}

function tagsFor(card: Partial<ContextCard>): string[] {
  const blob = `${card.title} ${card.aiReading} ${card.yourMessage} ${card.sourceLabel}`.toLowerCase();
  const tags: string[] = [];
  if (/remind|todo|text someone|follow/.test(blob)) tags.push("#reminder");
  if (/whatsapp|message|text|sms|chat/.test(blob)) tags.push("#messaging");
  if (/follow/.test(blob)) tags.push("#follow-up");
  if (/morning|10\s*a\.?m|am\b/.test(blob)) tags.push("#morning");
  if (/calendar|meeting|event|commitment/.test(blob)) tags.push("#calendar");
  if (/note/.test(blob)) tags.push("#note");
  if (/youtube|watch/.test(blob)) tags.push("#watch");
  if (/map|place|visit/.test(blob)) tags.push("#place");
  if (/spotify|listen|music/.test(blob)) tags.push("#listen");
  if (!tags.length) tags.push("#capture");
  return tags.slice(0, 4);
}

function destinationFor(actionApp: string, title: string, body: string): ContextCard["preferredDestination"] {
  const blob = `${actionApp} ${title} ${body}`.toLowerCase();
  if (/remind|to-?do/.test(blob) || actionApp === "reminders") return "tasks";
  if (actionApp === "calendar" || /calendar|meeting|commitment|event/.test(blob)) return "calendar";
  return "docs";
}

function sourceLabel(source?: string, captureMethod?: string) {
  const s = (source || "").toLowerCase();
  if (/whatsapp|messaging/.test(s)) return "WHATSAPP";
  if (/gmail|mail/.test(s)) return "GMAIL";
  if (/youtube/.test(s)) return "YOUTUBE";
  if (/maps/.test(s)) return "MAPS";
  if (/music|spotify/.test(s)) return "SPOTIFY";
  if (/claude/.test(s)) return "CLAUDE";
  if (/screen|browser/.test(s) || captureMethod === "screen") return "SCREEN";
  if (s === "text" || captureMethod === "text") return "TYPED";
  // Legacy captures made before audio capture was removed.
  if (captureMethod === "voice" || s === "voice") return "VOICE MEMO";
  return (source || "CAPTURE").toUpperCase().replace(/-/g, " ");
}

function badgeFor(dest: ContextCard["preferredDestination"], actionApp: string) {
  if (dest === "calendar" || actionApp === "calendar") return "EVENT";
  if (dest === "tasks") return "TASK";
  return "NOTE";
}

function whenFromPayload(p: Record<string, unknown>, utterance: string) {
  const whenLabel = String(p.whenLabel || "").trim();
  if (whenLabel) return { whenLabel, dateISO: String(p.dateISO || ""), startHhmm: String(p.startHhmm || p.time || "") };
  const dateISO = String(p.dateISO || "");
  const startHhmm = String(p.startHhmm || p.time || "");
  if (dateISO && startHhmm) return { whenLabel: `${dateISO} · ${startHhmm}`, dateISO, startHhmm };
  if (/tomorrow/i.test(utterance) && /10\s*(a\.?m\.?|am)/i.test(utterance)) {
    return { whenLabel: "Tomorrow, 10:00 AM", dateISO: "", startHhmm: "10:00" };
  }
  if (/tomorrow/i.test(utterance)) return { whenLabel: "Tomorrow", dateISO: "", startHhmm: "" };
  return { whenLabel: "", dateISO, startHhmm };
}

export function cardFromPermission(item: DesktopPermission): ContextCard {
  const p = item.payload || {};
  const utterance = String(item.utterance || p.text || p.note || "");
  const title = String(item.title || p.title || utterance.slice(0, 80) || "Capture");
  const aiReading = String(item.body || p.summary || "Claude will interpret this capture.");
  const yourMessage = utterance || String(p.incoming || p.note || "");
  const when = whenFromPayload(p, yourMessage);
  const actionApp = String(item.actionApp || "notes");
  const preferredDestination = destinationFor(actionApp, title, aiReading);
  const url = String(p.url || extractUrl(yourMessage) || "");
  const card: ContextCard = {
    id: item.id,
    kind: "pending",
    sourceLabel: sourceLabel(item.source, item.captureMethod),
    badge: badgeFor(preferredDestination, actionApp),
    title,
    aiReading,
    yourMessage,
    whenLabel: when.whenLabel,
    dateISO: when.dateISO || undefined,
    startHhmm: when.startHhmm || undefined,
    url: url || undefined,
    tags: [],
    confidence: Math.round(Math.min(0.99, Math.max(0.72, Number(p.confidence) || 0.9)) * 100),
    status: item.status === "accepted" ? "accepted" : item.status === "declined" ? "declined" : "pending",
    actionApp,
    preferredDestination,
    raw: item,
  };
  card.tags = tagsFor(card);
  return card;
}

export function cardFromFact(fr: FactResult): ContextCard | null {
  const f = fr.fact;
  let value: Record<string, unknown> = {};
  try {
    value = typeof f.value === "string" ? JSON.parse(f.value) : (f.value as unknown as Record<string, unknown>);
  } catch {
    value = { note: f.value };
  }
  const title = String(
    value.title || value.note || value.intent || value.q || f.decisionLabel || "Fact"
  ).slice(0, 120);
  const yourMessage = String(value.note || value.sourceText || value.title || f.value || "");
  const glossary = (f.glossaryTermUrn || "").toLowerCase();
  let preferredDestination: ContextCard["preferredDestination"] = "docs";
  let badge = "NOTE";
  let actionApp = "notes";
  if (glossary.includes("commitment")) {
    preferredDestination = "calendar";
    badge = "EVENT";
    actionApp = "calendar";
  } else if (glossary.includes("intent")) {
    preferredDestination = "tasks";
    badge = "TASK";
    actionApp = "reminders";
  }
  const whenLabel = String(value.whenLabel || value.dateISO || "");
  const card: ContextCard = {
    id: f.factId,
    kind: "fact",
    sourceLabel: "FACT GRAPH",
    badge,
    title,
    aiReading: String(value.summary || fr.provenance || "Stored in your Residence Fact graph."),
    yourMessage,
    whenLabel,
    dateISO: value.dateISO ? String(value.dateISO) : undefined,
    startHhmm: value.startHhmm ? String(value.startHhmm) : undefined,
    url: value.url ? String(value.url) : extractUrl(yourMessage) || undefined,
    tags: [],
    confidence: Math.round((f.confidence || 0.9) * 100),
    status: f.certificationStatus === "user_confirmed" ? "accepted" : "pending",
    actionApp,
    preferredDestination,
  };
  card.tags = tagsFor(card);
  return card;
}
