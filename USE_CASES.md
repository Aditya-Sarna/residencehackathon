# Residence — full use-case catalog

Capture on Mac (⌘⇧R), reason against the personal Fact graph, Accept into DataHub, write back to Calendar / Notes / Reminders.

---

## A. Mac capture & write-back integrations

| # | Integration | Capture | On Accept |
|---|---|---|---|
| 1 | **Claude Desktop** | Selection / MCP | Graph only (MCP resolve) |
| 2 | **ChatGPT / Claude web** | Selection | Notes / commitments |
| 3 | **YouTube** | Browser tab + URL | Watch-later Reminder ± Calendar block |
| 4 | **Gmail** | Browser tab | Calendar invite (± clash) |
| 5 | **Apple Mail** | Selected message | Same invite path as Gmail |
| 6 | **Google Calendar** | Browser tab | Sync / Calendar event |
| 7 | **Meet / Zoom / Teams** | Meeting link tab | Calendar event |
| 8 | **Amazon / shopping** | Product tab | Shopping Reminder ± budget / allergy Note |
| 9 | **Maps (Google / Apple)** | Tab or Maps.app window | Notes place + visit Reminder |
| 10 | **LinkedIn** | Tab or selection | Follow-up Reminder ± Calendar |
| 11 | **GitHub / GitLab** | Tab or selection | Review Reminder |
| 12 | **Music / Spotify** | Now playing or web track | Listen / focus Reminder |
| 13 | **Notion** | Selection | Notes / Commitment |
| 14 | **Linear / Jira / Asana / Trello** | Ticket tab | Focus Calendar / deadline Reminder |
| 15 | **Uber / Lyft** | Ride tab | Ride buffer Calendar + leave Reminder |
| 16 | **Booking / Airbnb / Expedia** | Trip page | Budget check + Commitment |
| 17 | **X / Reddit / HN** | Article tab | Read-later Reminder |
| 18 | **Apple Notes** | Front note / selection | New Note |
| 19 | **Apple Calendar** | Upcoming event context | New event (+ pick-a-time) |
| 20 | **Reminders** | — (write-only) | Watch-later, shop, maps, PRs, gifts, budget |
| 21 | **Safari / Chrome / Arc / Brave** | Selection + enriched tab | Via destination above |
| 22 | **Slack / Discord / Messages / WhatsApp** | Selection | Commitment / Reminder prompt |

---

## B. Cross-reasoning (new utterance × memory)

| Intent | Trigger | Outcome |
|---|---|---|
| `cross.ask_times` | Two+ bookings in one utterance | Ask for clock times |
| `cross.same_day_conflict` | New plan on a day that already has events | Time or reschedule |
| `cross.same_day_stack` | Stack another event onto a busy day | Warn + confirm |
| `cross.packed_day` | Day already has 3+ commitments | Discourage more |
| `cross.trip_clash` | Local appointment on a travel day | Trip clash |
| `cross.priority_clash` | Social plan on exam / focus day | Priority conflict |
| `cross.meal_allergy` | Meal / restaurant vs allergy Fact | Allergy check |
| `cross.watch_later` | YouTube on a busy day | Watch-later Reminder |
| `cross.watch_calendar` | YouTube on a free day | Optional watch block |
| `cross.email_invite` | Gmail / Zoom / Meet invite | Add to Calendar |
| `cross.email_invite_clash` | Invite vs existing day | Clash + needsTime |
| `cross.travel_budget` | Flight / hotel / Airbnb > budget | Wallet raise / cheaper |
| `cross.missing_time` | Book/schedule without a clock time | Ask for time |
| `cross.shopping_list` | Amazon / shopping capture | Shopping Reminder |
| `cross.shopping_budget` | Purchase price > weekly ceiling | Wallet + list |
| `cross.maps_place` | Maps place save | Notes + visit Reminder |
| `cross.linkedin_followup` | LinkedIn profile / message | Follow-up Reminder / Calendar |
| `cross.github_review` | PR / issue | Review Reminder |
| `cross.music_save` | Track / focus listen | Listen-later Reminder |
| `cross.ride_clash` | Uber/Lyft vs Calendar day | Leave earlier / move |
| `cross.ride_eta` | Ride with free day | Buffer + leave Reminder |
| `cross.read_later` | Article / HN / Reddit / X | Read-later Reminder |
| `cross.work_focus` | Linear / Jira / Asana ticket | Focus block / deadline |

---

## C. Memory inference (saved Facts → proactive nudges)

| Intent | Trigger |
|---|---|
| `memory.contradiction` | New claim conflicts with an existing Fact |
| `memory.allergy_guard` | Shopping / product language vs Health Condition |
| `memory.gift_from_calendar` | Upcoming birthday / person → gift idea |
| `memory.open_commitment` | Open commitment needing follow-through |
| `memory.trip_prep` | Upcoming trip → prep checklist |
| `memory.exam_focus` | Exam day → protect focus |
| `memory.stress_checkin` | Stress signals → wellness check-in |
| `memory.budget_guard` | Spend language vs Budget ceiling |
| `memory.upcoming` | Near-term commitment surface |

---

## D. Ambient Mac product loops (not app-specific)

1. Smart capture HUD (⌘⇧R) with app + method + kind  
2. **Edit-before-send composer** (⌘⏎ send · Esc cancel)  
3. Clipboard-only capture (⌘⇧C)  
4. Notification Accept / Decline  
5. **Inbox queue** (⌘⇧I) with Prev / Next / Decline rest  
6. Contradiction side-by-side diff  
7. **Accept chips** — Facts only · Watch later only · Calendar only · Remind for time  
8. **Real write-back confirm** (`on` / `confirm` / `off` per integration)  
9. Menu-bar agent mode (LSUIElement · Dock optional)  
10. Single-instance lock · Open at login · Quiet hours  
11. `residence://capture` · `residence://inbox` · `residence://status` · `residence://briefing` · `residence://calendar`  
12. Tray + optional Dock badge (rate-limited bounce)  
13. Live status refresh + hotkey conflict surface  
14. Multi-undo stack (⌘⇧Z, up to 8)  
15. Activity strip + outbox / write-back retry  
16. Idempotent write-back via `[Residence operation:…]` markers  
17. Phone shell live Graph mirror after Accept  
18. **Morning briefing** — after quiet hours: Calendar + Facts + budget + allergy + clash notify  
19. **Apple Calendar 7-day sync** → Accept import into Commitments (`dateISO` + time)  
20. **Habit onboarding** — login item · quiet hours · briefing · calendar import  
21. Shell **Today** tab (default) shows live briefing — demos only on `?judge` / `?smart` 

---

## Judge-friendly demos (pick 3–4)

1. **Judge path** — `/?judge&auto=1` Wallet → Shop block → privacy → Graph  
2. **Smart memory breadth** — `/?smart&auto=1` (22 scenarios, coverage toast)  
3. **Same-day clash** — Claude/Notes: “lunch with Alex on the 15th”  
4. **YouTube busy day** — Safari YouTube tab → watch later  
5. **Amazon + budget/allergy** — product tab → list / wallet  
6. **Maps / LinkedIn / GitHub / Uber** — Mac capture encore  

Reliability gates: `./scripts/judge-preflight.sh` (DataHub boot, `/ready`, judge + smart-memory coverage, desktop capture smoke, unit tests).
