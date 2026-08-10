/**
 * Real Spotify sign-in — Authorization Code with PKCE, Spotify's official
 * flow for browser-only apps (no client secret, token exchange happens
 * directly from the client via fetch — see developer.spotify.com PKCE guide).
 *
 * Requires VITE_SPOTIFY_CLIENT_ID (see shell/SPOTIFY_SETUP.md). Without it,
 * connectSpotify() throws instead of pretending to work.
 */

const STORAGE_KEY = "residence-spotify-token-v1";
const VERIFIER_KEY = "residence-spotify-verifier-v1";
const SCOPES = "user-library-modify playlist-modify-private user-read-email";

type StoredToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

export function spotifyClientId(): string {
  return (import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined) || "";
}

export function spotifyConfigured(): boolean {
  return spotifyClientId().length > 0;
}

function redirectUri(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomVerifier(): string {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer).slice(0, 128);
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

function loadToken(): StoredToken | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredToken;
    if (!parsed.accessToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToken(token: StoredToken) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(token));
}

export function spotifyIsConnected(): boolean {
  const t = loadToken();
  return !!t && t.expiresAt > Date.now();
}

export function disconnectSpotify() {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Kicks off the real Spotify consent screen — the page navigates away and back. */
export async function beginSpotifyConnect(): Promise<void> {
  if (!spotifyConfigured()) {
    throw new Error("Spotify isn't configured — add VITE_SPOTIFY_CLIENT_ID to enable this.");
  }
  const verifier = randomVerifier();
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = await challengeFor(verifier);
  const params = new URLSearchParams({
    client_id: spotifyClientId(),
    response_type: "code",
    redirect_uri: redirectUri(),
    scope: SCOPES,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state: "residence-spotify",
  });
  window.location.href = `https://accounts.spotify.com/authorize?${params.toString()}`;
}

async function exchangeCode(code: string, verifier: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Spotify token exchange failed (${r.status})`);
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiresAt: Date.now() + (j.expires_in - 30) * 1000,
  };
}

/**
 * Call once on app load — if the URL carries `?code=...&state=residence-spotify`
 * from the redirect back from Spotify, complete the real token exchange and
 * scrub the URL.
 */
export async function completeSpotifyRedirectIfPresent(): Promise<boolean> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || state !== "residence-spotify") return false;
  const verifier = sessionStorage.getItem(VERIFIER_KEY) || "";
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  window.history.replaceState({}, "", url.toString());
  if (!verifier) return false;
  const token = await exchangeCode(code, verifier);
  saveToken(token);
  sessionStorage.removeItem(VERIFIER_KEY);
  return true;
}

async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const body = new URLSearchParams({
    client_id: spotifyClientId(),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!r.ok) throw new Error(`Spotify token refresh failed (${r.status})`);
  const j = (await r.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token || refreshToken,
    expiresAt: Date.now() + (j.expires_in - 30) * 1000,
  };
}

/** Returns a live access token, transparently refreshing if it just expired. */
export async function spotifyAccessToken(): Promise<string | null> {
  const token = loadToken();
  if (!token) return null;
  if (token.expiresAt > Date.now()) return token.accessToken;
  if (!token.refreshToken) return null;
  try {
    const refreshed = await refreshAccessToken(token.refreshToken);
    saveToken(refreshed);
    return refreshed.accessToken;
  } catch {
    disconnectSpotify();
    return null;
  }
}
