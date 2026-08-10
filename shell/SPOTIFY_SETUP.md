# Spotify setup — real "save to Liked Songs"

The Spotify card uses the Authorization Code with PKCE flow — Spotify's own
recommended flow for browser-only apps. There's no client secret; the token
exchange happens directly from the browser via `fetch`.

## 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app.
2. In the app's **Settings**, add a **Redirect URI** for every origin the
   shell is served from, matched exactly (Residence redirects back to the
   current page with no path/query — e.g.):
   - `http://127.0.0.1:5173/`
   - `https://<your-vercel-domain>.vercel.app/`
3. Under **Which API/SDKs are you planning to use?**, select **Web API**.
4. Copy the **Client ID** from the app's Settings page (no secret needed).

## 2. Configure Residence

```bash
# shell/.env (local dev) or Vercel → Project → Settings → Environment Variables
VITE_SPOTIFY_CLIENT_ID=your-spotify-client-id
```

Redeploy (or restart `vite dev`). The Spotify card will show a real
**Connect Spotify** button. Connecting sends the browser to Spotify's
consent screen and back; once connected, pasting a `open.spotify.com/track/...`
or `spotify:track:...` link into a capture and tapping **Accept** shows a
"♪ Save to Spotify Liked Songs" action that writes a real save via the
Spotify Web API.

## Scopes requested

- `user-library-modify` — save a track to Liked Songs
- `playlist-modify-private` — reserved for a future "add to playlist" write
- `user-read-email` — nothing beyond identifying the signed-in account
