# Google setup — real Calendar, Gmail, Tasks & Docs

Residence's browser Integrations page writes real Google Calendar events,
reads real Gmail threads, and creates real Google Tasks/Docs — directly from
the browser, via one OAuth consent. No backend secret is involved; the
"Client ID" below is public by design (it identifies the app, it does not
authenticate it).

## 1. Create a Google Cloud project

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) → create (or pick) a project.
2. **APIs & Services → Library** — enable:
   - Google Calendar API
   - Gmail API
   - Google Tasks API
   - Google Docs API
   - Google Drive API (needed for Docs to create a file in Drive)

## 2. Configure the OAuth consent screen

**APIs & Services → OAuth consent screen**

- User type: External (unless you have a Google Workspace org).
- Scopes: add
  - `.../auth/calendar.events`
  - `.../auth/gmail.readonly`
  - `.../auth/tasks`
  - `.../auth/documents`
  - `.../auth/drive.file`
- While the app is in **Testing** mode, add every Google account that should be
  able to sign in (including your own) under **Test users**. Gmail's readonly
  scope is a "sensitive" scope, so any account *not* listed as a test user will
  see Google's "unverified app" warning and can't get past it until you submit
  the app for verification. For a small/personal deployment, Testing mode +
  test users is normal and expected.
- To open this up to arbitrary users in production, submit the app for
  [Google's OAuth verification](https://support.google.com/cloud/answer/9110914) —
  required because of the Gmail scope.

## 3. Create the OAuth Client ID

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Authorized JavaScript origins — add every origin the shell is served from, e.g.:
  - `http://localhost:5173`
  - `https://<your-vercel-domain>.vercel.app`
- No redirect URI is needed — Residence uses Google Identity Services' token
  client (a popup), not a redirect flow.
- Copy the **Client ID** (looks like `1234-abc.apps.googleusercontent.com`).

## 4. Configure Residence

Add the Client ID as an environment variable for the `shell` Vite app:

```bash
# shell/.env (local dev) or Vercel → Project → Settings → Environment Variables
VITE_GOOGLE_CLIENT_ID=1234-abc.apps.googleusercontent.com
```

Redeploy (or restart `vite dev`). The Calendar / Gmail / Docs / Tasks cards on
the Integrations page will show a real **Connect Google** button instead of
"Needs setup," and connecting any one of them grants all four scopes at once.
