import type { GoogleScopeKey } from "./googleAuth";

export type IntegrationId =
  | "claude"
  | "calendar"
  | "gmail"
  | "docs"
  | "tasks"
  | "whatsapp"
  | "maps"
  | "weather"
  | "youtube"
  | "spotify";

/**
 * How this integration is actually authenticated in the browser — drives the
 * real status badge in IntegrationsPage. Nothing here is decorative:
 *  - "core": always on, no auth (Claude reasoning).
 *  - "google": real OAuth via Google Identity Services (googleAuth.ts).
 *  - "spotify": real OAuth via PKCE (spotifyAuth.ts).
 *  - "paste": no API exists for a personal account — paste is the honest,
 *    real mechanism (WhatsApp has no personal-account API at all).
 *  - "public": a real, keyless public API Residence already calls server-side
 *    (OpenStreetMap / Open-Meteo / YouTube search) — always live, no sign-in.
 */
export type AuthKind = "core" | "google" | "spotify" | "paste" | "public";

export type IntegrationDef = {
  id: IntegrationId;
  name: string;
  platform: string;
  blurb: string;
  /** Always on — Claude reads every capture. */
  core?: boolean;
  /** Default connected on first visit. */
  defaultOn: boolean;
  /** Capture source string sent to Core. */
  captureSource: string;
  /** Accept destinations this integration unlocks. */
  destinations: Array<"calendar" | "docs" | "tasks" | "facts-only">;
  icon: "claude" | "calendar" | "gmail" | "docs" | "tasks" | "whatsapp" | "maps" | "weather" | "youtube" | "spotify";
  authKind: AuthKind;
  /** Google scopes this integration needs, when authKind === "google". */
  googleScopes?: GoogleScopeKey[];
};

/** Every Google-backed integration shares one consent — connecting any one connects all four. */
export const ALL_GOOGLE_SCOPES: GoogleScopeKey[] = ["calendar", "gmail", "tasks", "docs"];

export const INTEGRATIONS: IntegrationDef[] = [
  {
    id: "claude",
    name: "Claude",
    platform: "Reasoning",
    blurb: "Reads every capture and writes the plain-language interpretation.",
    core: true,
    defaultOn: true,
    captureSource: "claude",
    destinations: ["facts-only"],
    icon: "claude",
    authKind: "core",
  },
  {
    id: "calendar",
    name: "Calendar",
    platform: "Google Calendar",
    blurb: "Turns a commitment into a real dated event on your Google Calendar.",
    defaultOn: true,
    captureSource: "gcal",
    destinations: ["calendar"],
    icon: "calendar",
    authKind: "google",
    googleScopes: ["calendar"],
  },
  {
    id: "gmail",
    name: "Gmail",
    platform: "Email",
    blurb: "Pull a real thread from your inbox — Residence lifts the decision, deadline and reply hook.",
    defaultOn: true,
    captureSource: "gmail",
    destinations: ["docs"],
    icon: "gmail",
    authKind: "google",
    googleScopes: ["gmail"],
  },
  {
    id: "docs",
    name: "Docs",
    platform: "Google Docs",
    blurb: "Anything worth keeping lands as a real Google Doc in your Drive.",
    defaultOn: true,
    captureSource: "docs",
    destinations: ["docs"],
    icon: "docs",
    authKind: "google",
    googleScopes: ["docs"],
  },
  {
    id: "tasks",
    name: "Tasks",
    platform: "Google Tasks",
    blurb: "Small to-dos become a real Google Task with a due date already filled in.",
    defaultOn: true,
    captureSource: "tasks",
    destinations: ["tasks"],
    icon: "tasks",
    authKind: "google",
    googleScopes: ["tasks"],
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    platform: "Messaging",
    blurb: "Paste a chat and Residence lifts the ask, date and next step — no personal-account API exists, so paste is the real integration.",
    defaultOn: true,
    captureSource: "messaging-web",
    destinations: ["docs", "tasks", "calendar"],
    icon: "whatsapp",
    authKind: "paste",
  },
  {
    id: "maps",
    name: "Maps",
    platform: "OpenStreetMap",
    blurb: "A place you mention becomes a visit you can schedule — live geocoding, no sign-in.",
    defaultOn: false,
    captureSource: "maps",
    destinations: ["docs", "calendar"],
    icon: "maps",
    authKind: "public",
  },
  {
    id: "weather",
    name: "Weather",
    platform: "Open-Meteo",
    blurb: "Live weather is folded into plans that depend on it — no sign-in needed.",
    defaultOn: false,
    captureSource: "weather",
    destinations: ["facts-only"],
    icon: "weather",
    authKind: "public",
  },
  {
    id: "youtube",
    name: "YouTube",
    platform: "Media",
    blurb: "Save a real video as a watch-later block on your Google Calendar.",
    defaultOn: false,
    captureSource: "youtube",
    destinations: ["calendar"],
    icon: "youtube",
    authKind: "public",
  },
  {
    id: "spotify",
    name: "Spotify",
    platform: "Media",
    blurb: "Turn a shared track link into a real save to your Liked Songs.",
    defaultOn: false,
    captureSource: "music",
    destinations: ["facts-only"],
    icon: "spotify",
    authKind: "spotify",
  },
];

const STORAGE_KEY = "residence-web-integrations-v2";

export type IntegrationState = Record<IntegrationId, boolean>;

export function defaultIntegrationState(): IntegrationState {
  const out = {} as IntegrationState;
  for (const i of INTEGRATIONS) out[i.id] = i.defaultOn;
  return out;
}

export function loadIntegrationState(): IntegrationState {
  const base = defaultIntegrationState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<IntegrationState>;
    for (const i of INTEGRATIONS) {
      if (i.core) base[i.id] = true;
      else if (typeof parsed[i.id] === "boolean") base[i.id] = parsed[i.id]!;
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function saveIntegrationState(state: IntegrationState) {
  const toSave = { ...state, claude: true };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

/** Infer capture source from optional URL + connected integrations. */
export function sourceFromLink(url: string, connected: IntegrationState): string {
  const u = (url || "").toLowerCase();
  if (/web\.whatsapp|wa\.me/.test(u) && connected.whatsapp) return "messaging-web";
  if (/mail\.google|gmail/.test(u) && connected.gmail) return "gmail";
  if (/youtube\.com|youtu\.be/.test(u) && connected.youtube) return "youtube";
  if (/maps\.google|maps\.apple|goo\.gl\/maps/.test(u) && connected.maps) return "maps";
  if (/spotify\.com|spotify:track/.test(u) && connected.spotify) return "music";
  if (/calendar\.google/.test(u) && connected.calendar) return "gcal";
  if (connected.whatsapp) return "messaging-web";
  return "text";
}
