# How to make Residence undeniable

Judges reward a **clear thesis + one perfect live proof**. Depth already exists — win on the room.

## The URLs that matter

```text
http://localhost:5173/?judge&auto=1
http://localhost:5173/?smart&auto=1
```

`auto=1` runs only after Core **and** DataHub are ready and history wipe finishes. Hands free.

## 90-second spoken script (memorize)

| :00–:15 | **Problem:** “Every personal agent keeps its own memory. Shop doesn’t know Wallet. Calendar doesn’t know Wellness. They lie to each other.” |
| :15–:25 | Open `/?judge&auto=1`. Point at stage lights: Core · DataHub · green. |
| :25–:55 | Demo auto-runs. Narrate: “Wallet locks $40 in DataHub → Voice understands birthday + shoes → Shop blocks $95 runners with lineage → allergy stays private from Shop.” |
| :55–:75 | Closing card appears, then the UI auto-opens **Graph**. Say: *“This is the actual DataHub graph — every fact, every lineage edge, every agent scope. Nothing mocked.”* Point at privacy matrix: Shop has `health ✕`. Tap a fact → **Open in DataHub**. |
| :75–:90 | Say: *“Apps stopped lying because Facts live in DataHub — glossary, ownership, lineage, domains, assertions, sensitivity.”* Optional encore: **Smart memory**. Stop talking. |

**If anything breaks:** run `./scripts/judge-preflight.sh` — it repairs or tells you exactly what’s red. Fallback: `pytest tests/test_judge_demo.py -q` + screenshots in `samples/`.

## Pre-stage checklist (T-10 min)

```bash
./scripts/judge-preflight.sh
# expect: ALL GREEN
# browser opens ?judge&auto=1
```

- [ ] Laptop on power, Do Not Disturb on  
- [ ] Font zoom readable for projector  
- [ ] One Chrome window only — judge URL  
- [ ] Core log quiet (`~/.residence/core.log`)  
- [ ] No VPN weirdness to localhost  

## What NOT to demo live

- Apple notarization / Gatekeeper rabbit hole  
- Installing MCP mid-pitch  
- Rebuilding Electron  
- Anything that needs a network API key unless already warm  

## Killer differentiators (say if asked)

1. **DataHub is load-bearing** — Graph tab renders `/graph` straight from GMS  
2. **Agent Context Kit + Analytics Agent** — ACK discover → Text-to-SQL on Fact warehouse (`via: agent-context-kit+text-to-sql`) + official `datahub-skills` pack  
3. **Official DataHub MCP + Residence MCP** — Claude talks to GMS *and* Accept gates  
4. **Skills** — search / lineage / enrich / quality / personal-context playbooks  
5. **Conflict that ships** — budget block + sensitivity isolation in one button  
6. **Mac product path** — Claude/Notes → Accept → shared graph (encore)  
7. **Daily OS loop** — morning briefing + Calendar sync → Accept inbox (not demo-button only)  

## Anti-patterns that lose

- Explaining architecture for 2 minutes before the button  
- Apologizing for “hackathon code”  
- Clicking five apps with no narrative  
- Demo that requires typing a long utterance under pressure  
