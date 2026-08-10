# Residence for Mac

Menu-bar app with **native Mac integrations** — capture from the app you’re in, Accept into the shared Fact store, and write back to Calendar / Notes / Reminders.

Full catalog: [`USE_CASES.md`](../USE_CASES.md).

## Integrations

| App | Capture | Write-back on Accept |
|---|---|---|
| **Claude Desktop** | Selection / MCP · cross-reasoning | — |
| **ChatGPT / Claude web** | Selection → commitments / health | Notes |
| **YouTube** | Safari/Chrome tab or URL | Watch-later reminder / calendar block |
| **Gmail / Apple Mail** | Tab or selected message | Calendar invite (+ clash check) |
| **Meet / Zoom / Teams** | Meeting link tab | Calendar event |
| **Amazon / shopping** | Product tab | Shopping Reminder ± budget / allergy |
| **Maps (web + Apple Maps)** | Tab or Maps window | Notes place + visit Reminder |
| **LinkedIn** | Tab / selection | Follow-up Reminder ± Calendar |
| **GitHub / GitLab** | Tab / selection | Review Reminder |
| **Music / Spotify** | Now playing or web track | Listen / focus Reminder |
| **Notion** | Selection | Notes / Commitment |
| **Linear / Jira / Asana** | Ticket tab | Focus block / deadline Reminder |
| **Uber / Lyft** | Ride tab | Calendar buffer + leave Reminder |
| **Booking / Airbnb** | Trip page | Budget + Commitment |
| **X / Reddit / HN** | Article tab | Read-later Reminder |
| **Apple Notes** | Selection or front note | New note |
| **Apple Calendar** | Upcoming event context | New event (+ “pick a time” if clash) |
| **Reminders** | — | Watch-later, shop, maps, PRs, gifts, budget, times |
| **Safari / Chrome / Arc** | Selection or enriched tab | Via destination above |
| **Slack / Discord / Messages / WhatsApp** | Selection | Commitment / Reminder prompt |

### Cross-reasoning (examples)

- Two bookings same day → **what times?** / reschedule  
- New event on a taken day → **time or move?**  
- Local appointment on travel day → trip clash  
- Exam day + party → priority clash  
- YouTube on a busy day → watch later  
- Gmail/Zoom invite vs existing event → invite clash  
- Amazon / shopping → list + budget / allergy  
- Maps place → Notes + visit Reminder  
- LinkedIn → follow-up · GitHub → review Reminder  
- Uber/Lyft vs Calendar · ticket → focus block  
- Meal vs allergy · budget vs trip · packed day (3+)

## Download & run

```bash
# Core must be on :8700
./scripts/open-mac-app.sh
```

Or: `~/Downloads/Residence.app` after build.

Grant when prompted:

- **Notifications**
- **Accessibility** (selection capture via ⌘C bridge)
- **Automation** for Notes / Calendar / Reminders / Safari (first Accept)

## The pill is the whole UI

There are no secondary windows. One rounded pill holds every surface, switched
by the bank row: **Do · Save · Apps · Prefs · Fix**.

- Drag it anywhere; the position is remembered across launches.
- **Esc** hides it. The menu-bar **R** brings it back.
- Background events (a new pending item, a finished capture) surface the pill
  *without* stealing focus, so you can keep typing where you are.
- Confirmations appear as timed toasts inside the pill and are never overwritten
  by a routine status refresh.
- Every accepted save plays a full-pill green checkmark flash — the one moment
  you should feel "that's saved" without reading anything.

## Daily use

1. First run: the pill opens on **Do** and asks once for Accessibility  
2. After quiet hours (or tray **Morning briefing…**): Today digest + clash notify  
3. Tray **Sync Calendar (7 days)…** → Accept imports into shared Facts  
4. Work in Claude, Notes, Safari, Mail… → **⌘⇧R** capture → Save → write-back  
5. Phone UI `http://localhost:5173/` **Today** tab mirrors the briefing (demos on `?judge`)  

### Standout controls

| Shortcut | Action |
|---|---|
| **⌘⇧R** | Smart capture from the front app — reads context, infers where it goes |
| **⌘⇧C** | Clipboard capture |
| **⌘⇧A / ⌘⇧D** | Accept / decline top pending decision |
| **⌘⇧I** | Inbox queue in the pill |
| **⌘⇧Z** | Undo Accept (multi-deep stack) |
| **⌘⏎** | Send from the compose box (edit-before-send / manual capture) |
| **Esc** | Hide the pill |

Also: menu-bar agent (no Dock by default), single-instance, open at login, quiet
hours, `residence://` URLs, real write `on|confirm|off`, live status refresh,
hotkey conflict surfacing, rate-limited Dock bounce when shown.

Tray → **Integrations…** for policies + agent prefs.

## Capture, smart inference & Save

**⌘⇧R** reads the front app (selection, tab URL/title, or clipboard fallback),
figures out what it is, and queues it for a decision — this is the whole
capture pipeline, no microphone involved:

1. **Capture** — Accessibility reads the front app's context (Slack message,
   Safari tab, Notes selection, …).
2. **Smart inference** — Core classifies it (calendar event, shopping item,
   note, cross-app clash, or a **contradiction** with something already
   saved) and proposes where it should land.
3. **Save** bank — review the inferred destination (Calendar / Notes /
   Reminders) and tap the dial (or a list row) to accept or decline.
   - For a normal capture the dial shows **green ✓ Save** or **red ✕ Skip**
     depending on what is selected, exactly like the original Accept/Decline
     design.
   - For a **contradiction** ("Your notes disagree — fix?") the pill shows
     the old and new values side by side and two dedicated buttons: green
     **Accept new** and red **Keep saved** — one tap resolves it.
4. **Saved flash** — the instant something is written to the shared Fact
   graph, the whole pill flashes green with an animated checkmark, so you
   never have to read a toast to know it worked.

If nothing is selected, or **Edit before send** is on in Prefs, the pill opens
a plain typed **compose** box instead (no mic, no speech) — review or write
the text, then ⌘⏎ / tap the dial to send it through the same pipeline.

## Troubleshooting

Run the built-in health check:

```bash
/Applications/Residence.app/Contents/MacOS/Residence --selftest
```

It reports Core, DataHub, Accessibility, hotkeys, notifications, and both
retry queues. The same report is available from tray → **Run diagnostics…**,
and the **Fix** bank in the pill surfaces anything actionable.

If the menu-bar icon never appears, an older copy is probably already running —
Residence is single-instance, so quit any stale `Residence.app` (often left in
`~/Downloads`) before launching the new one.

## Claude Desktop MCP

Already wired if you accepted the earlier config. Tools: `save_to_residence`, `check_residence_context`, `list_residence_pending`, `resolve_residence_pending`.

Quit Claude fully (⌘Q) after config changes.

## Dev / rebuild

```bash
cd desktop
npm start              # runs Electron
npm test               # schedule unit tests + pill UI behaviour tests
npm run dist           # packaged zip in dist/
```

## Honest limits

AppleScript bridges are best-effort per app; Accessibility + Automation must be granted. Web enrichment depends on the active tab URL/title. See `USE_CASES.md` for the full intent list.
