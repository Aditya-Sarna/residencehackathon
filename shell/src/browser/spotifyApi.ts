/** Real Spotify writes — called with a live access token from spotifyAuth. */

/** Pulls a track ID out of a Spotify URL or `spotify:track:` URI. */
export function extractSpotifyTrackId(text: string): string | null {
  const url = text.match(/open\.spotify\.com\/track\/([a-zA-Z0-9]+)/);
  if (url) return url[1];
  const uri = text.match(/spotify:track:([a-zA-Z0-9]+)/);
  if (uri) return uri[1];
  return null;
}

export type SpotifyTrack = {
  id: string;
  name: string;
  artists: string;
  url: string;
};

async function spotifyFetch<T>(url: string, token: string, init?: RequestInit): Promise<T> {
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
      detail = j?.error?.message || "";
    } catch {
      /* ignore */
    }
    throw new Error(detail || `Spotify API error (${r.status})`);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

export async function getTrack(token: string, trackId: string): Promise<SpotifyTrack> {
  const t = await spotifyFetch<{
    id: string;
    name: string;
    artists: Array<{ name: string }>;
    external_urls: { spotify: string };
  }>(`https://api.spotify.com/v1/tracks/${trackId}`, token);
  return {
    id: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name).join(", "),
    url: t.external_urls.spotify,
  };
}

/** Real write: saves the track to the signed-in user's Liked Songs. */
export async function saveTrackToLibrary(token: string, trackId: string): Promise<void> {
  await spotifyFetch(`https://api.spotify.com/v1/me/tracks?ids=${trackId}`, token, { method: "PUT" });
}
