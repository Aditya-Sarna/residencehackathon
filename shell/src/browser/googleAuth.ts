/**
 * Real "Sign in with Google" for the browser Residence — Google Identity
 * Services token client (public OAuth client, no server secret). One
 * consent grants every scope Residence needs; Calendar/Gmail/Tasks/Docs all
 * ride the same access token.
 *
 * Requires VITE_GOOGLE_CLIENT_ID (a public OAuth 2.0 Web-application Client
 * ID from console.cloud.google.com — see shell/GOOGLE_SETUP.md). Without it,
 * every helper here reports "not configured" rather than pretending to work.
 */

export type GoogleScopeKey = "calendar" | "gmail" | "tasks" | "docs";

export const GOOGLE_SCOPES: Record<GoogleScopeKey, string> = {
  calendar: "https://www.googleapis.com/auth/calendar.events",
  gmail: "https://www.googleapis.com/auth/gmail.readonly",
  tasks: "https://www.googleapis.com/auth/tasks",
  docs: "https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/drive.file",
};

const STORAGE_KEY = "residence-google-token-v1";
const GIS_SRC = "https://accounts.google.com/gsi/client";

type StoredToken = {
  accessToken: string;
  scope: string;
  expiresAt: number;
  email?: string;
};

type TokenClient = {
  requestAccessToken: (opts?: { prompt?: string }) => void;
};

type GoogleAccountsGlobal = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (resp: { access_token?: string; scope?: string; error?: string }) => void;
        error_callback?: (err: { type: string }) => void;
      }) => TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleAccountsGlobal;
  }
}

let gisLoadPromise: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load Google Sign-In")));
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
    document.head.appendChild(script);
  });
  return gisLoadPromise;
}

export function googleClientId(): string {
  return (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || "";
}

export function googleConfigured(): boolean {
  return googleClientId().length > 0;
}

function loadStoredToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken || parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToken(token: StoredToken) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token));
}

/** Scopes are space-separated in the token response — check every scope we need is present. */
function hasScopes(token: StoredToken, scopes: string[]): boolean {
  const granted = new Set(token.scope.split(/\s+/));
  return scopes.every((s) => granted.has(s));
}

export function googleAccessToken(scopeKeys: GoogleScopeKey[]): string | null {
  const token = loadStoredToken();
  if (!token) return null;
  const needed = scopeKeys.map((k) => GOOGLE_SCOPES[k]).flatMap((s) => s.split(/\s+/));
  return hasScopes(token, needed) ? token.accessToken : null;
}

export function googleIsConnected(scopeKeys: GoogleScopeKey[]): boolean {
  return googleAccessToken(scopeKeys) != null;
}

export function googleAccountEmail(): string | undefined {
  return loadStoredToken()?.email;
}

async function fetchProfileEmail(accessToken: string): Promise<string | undefined> {
  try {
    const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) return undefined;
    const j = (await r.json()) as { email?: string };
    return j.email;
  } catch {
    return undefined;
  }
}

/**
 * Opens the real Google consent popup (or silently reuses consent already
 * granted this browser session) for the union of the requested scopes, then
 * resolves once a live access token is stored.
 */
export async function connectGoogle(scopeKeys: GoogleScopeKey[]): Promise<StoredToken> {
  if (!googleConfigured()) {
    throw new Error("Google isn't configured — add VITE_GOOGLE_CLIENT_ID to enable this.");
  }
  await loadGis();
  const scope = Array.from(new Set(scopeKeys.map((k) => GOOGLE_SCOPES[k]).flatMap((s) => s.split(/\s+/)))).join(
    " "
  );
  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: googleClientId(),
      scope,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error || "Google sign-in was cancelled."));
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => reject(new Error(err?.type || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: "" });
  });
  const email = await fetchProfileEmail(accessToken);
  const token: StoredToken = {
    accessToken,
    scope,
    expiresAt: Date.now() + 55 * 60 * 1000,
    email,
  };
  saveToken(token);
  return token;
}

export function disconnectGoogle() {
  sessionStorage.removeItem(STORAGE_KEY);
}
