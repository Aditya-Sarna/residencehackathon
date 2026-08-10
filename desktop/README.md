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

## Daily use

1. First-run wizard: open at login · quiet hours · morning briefing · Calendar import  
2. After quiet hours (or tray **Morning briefing…**): Today digest + clash notify  
3. Tray **Sync Calendar (7 days)…** → Accept imports into shared Facts  
4. Work in Claude, Notes, Safari, Mail… → **⌘⇧R** capture → Accept → write-back  
5. Phone UI `http://localhost:5173/` **Today** tab mirrors the briefing (demos on `?judge`)  

### Standout controls

| Shortcut | Action |
|---|---|
| **⌘⇧R** | Smart capture → edit composer → send (⌘⏎) |
| **⌘⇧C** | Clipboard capture (same composer) |
| **⌘⇧A / ⌘⇧D** | Accept / decline top pending decision |
| **⌘⇧I** | Inbox queue (Prev / Next / Decline rest) |
| **⌘⇧Z** | Undo Accept (multi-deep stack) |
| **⏎ / Esc** | Accept / decline · write-confirm Yes / Facts only |

Also: menu-bar agent (no Dock by default), single-instance, open at login, quiet hours, `residence://` URLs, Accept chips (Facts only / Watch later / Calendar only), real write `on|confirm|off`, live status refresh, hotkey conflict surfacing, rate-limited Dock bounce when shown.

Tray → **Integrations…** for policies + agent prefs.

## Claude Desktop MCP

Already wired if you accepted the earlier config. Tools: `save_to_residence`, `check_residence_context`, `list_residence_pending`, `resolve_residence_pending`.

Quit Claude fully (⌘Q) after config changes.

## Dev / rebuild

```bash
cd desktop && npm start
./scripts/build-mac-app.sh
./scripts/open-mac-app.sh
```

## Honest limits

AppleScript bridges are best-effort per app; Accessibility + Automation must be granted. Web enrichment depends on the active tab URL/title. See `USE_CASES.md` for the full intent list.
