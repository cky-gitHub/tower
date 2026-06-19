# DevinControl — JetBrains plugin MVP spec

> Mission control for a fleet of Devin sessions. Replaces the chat UI with a node-graph as the primary way to spawn, observe, redirect, and stop Devin agents — without leaving the IDE.
>
> Megathon 2026 build, targeting **Best Build with Devin** (Cognition) + **Main Startup Track**.

---

## North star

Open the tool window. See every Devin session your org has running as a live node graph. Click a node → live state, recent actions, logs. Click empty canvas → spawn a new session with a prompt. Right-click a running node → redirect ("actually do X instead") or stop. Sunday stretch: fork from a snapshot.

The pitch line: *"You don't chat with Devin anymore. You orchestrate it."*

---

## Form factor

- **JetBrains IDE plugin** (IntelliJ Platform SDK, Kotlin).
- Tool window on the right side called **DevinControl**.
- Graph rendered in **JCEF** (embedded Chromium) using React + **ReactFlow**. Same pattern as Codesidian.
- Kotlin backend in the plugin process owns the Devin API key (stored via IntelliJ `PasswordSafe`) and exposes a JS bridge to the webview.

Why this works: the team has shipped a JetBrains+JCEF plugin before (Codesidian). Graph rendering, layout, pan/zoom are essentially solved problems from the prior codebase.

---

## API coverage — verified

All endpoints are on `https://api.devin.ai/v3/organizations/{org_id}/...`. Auth: `Authorization: Bearer cog_...`.

| Verb (UI) | Endpoint | Notes |
|---|---|---|
| **Spawn** | `POST /sessions` | Body: `{ "prompt": "...", "create_as_user_id": "..." }` |
| **List fleet** | `GET /sessions` | Paginated, returns all active + recent |
| **Inspect** | `GET /sessions/{id}` | Returns status, output, metadata |
| **Inspect (messages)** | `GET /sessions/{id}/messages` | Cursor-paginated; poll incrementally |
| **Inspect (AI summary)** | `GET /sessions/{id}/insights` + `POST /sessions/{id}/insights/generate` | Devin's own AI summary of the session — use this for the "narrator" overlay |
| **Redirect** | `POST /sessions/{id}/messages` | Body: `{ "message": "..." }`. Docs: *"session will be automatically resumed if suspended."* This is the killer endpoint. |
| **Stop** | `DELETE /sessions/{id}` | Terminate |
| **Archive (soft stop)** | `POST /sessions/{id}/archive` | Sleeps but keeps state |
| **Attach playbook** | `GET /playbooks` to list, reference at spawn time via prompt | No mid-session attach in v3 — attach only at spawn |
| **Tag** | `POST /sessions/{id}/tags` | For grouping/coloring nodes |

**No native fork endpoint.** Workaround for Sunday demo: "Fork from here" reads messages up to step N, generates a context summary (use `insights/generate`), then `POST /sessions` with prompt = `"Continue from this state. Context so far: <summary>. Next, instead of <prior plan>, do: <user input>"`. Demo-grade fork without a real fork primitive.

---

## MVP scope (Friday night → Saturday afternoon)

These three verbs end-to-end. Nothing else.

1. **List + render fleet**
   - Poll `GET /sessions` every 5s. Diff against current graph state. Add/remove nodes.
   - Node color = status (running=green, blocked=yellow, done=blue, errored=red).
   - Layout: ReactFlow's `dagre` auto-layout, or simple grid.

2. **Spawn**
   - Floating "+" button on canvas → modal with prompt textarea → `POST /sessions` → optimistically add node.

3. **Inspect (side panel)**
   - Click node → right-side panel slides in.
   - Top: live status, started-at, ACU consumed.
   - Middle: scrollable message stream from `GET /sessions/{id}/messages` (poll cursor every 2s while panel open).
   - Bottom: "AI narrator" — show `insights` summary, button to regenerate.

## Saturday evening adds

4. **Redirect**
   - In side panel: text input at bottom. Send → `POST /sessions/{id}/messages`. Node briefly pulses to show acknowledgement.

5. **Stop**
   - Side panel button + right-click on node → `DELETE /sessions/{id}`.

## Sunday morning (demo-winner)

6. **Fork**
   - Right-click node → "Branch from here" → modal with current insight as context preview + new instruction → spawn child session with composed prompt.
   - Render edge from parent → child on the canvas. This is the visual moment that lands the demo.

## Don't build these for the demo

- Chain (drag A → B as data flow)
- Bulk lasso operations
- Mid-session playbook attach
- Real-time websocket (polling is enough at hackathon scale)
- Multi-org switcher

---

## State sync — the one thing that has to be solid

Single polling loop in Kotlin backend:

- Every **5s**: `GET /sessions` → reconcile fleet (add/remove/update nodes).
- Per open side panel, every **2s**: `GET /sessions/{id}/messages?cursor=<last>` → append new messages only.
- Optimistic UI for spawn / redirect / stop — show pending state immediately, reconcile on next poll. Roll back with toast if API call fails.
- Backoff on 429.

If polling feels laggy on demo day, drop fleet poll to 3s. Cost is bounded — small fleet, small payloads.

---

## Architecture

```
JetBrains plugin (Kotlin)
├── Tool window: DevinControl
├── JCEF browser → React app (Vite build, embedded as plugin resource)
│   ├── ReactFlow canvas
│   ├── Side panel (inspect + redirect)
│   └── Spawn modal
├── Kotlin backend
│   ├── DevinClient.kt — HTTP wrapper around v3 API
│   ├── PollingService.kt — coroutine-based fleet + per-session pollers
│   ├── StateStore.kt — fleet state, observable from JS bridge
│   └── Settings panel — API key (PasswordSafe), org ID
└── JS↔Kotlin bridge via JCEF JBCefJSQuery
```

API key + org ID stored in IntelliJ `PasswordSafe`. Never expose key to JS — all calls go through Kotlin backend.

---

## Demo script (Sunday, 3 minutes)

1. **0:00** — Open IntelliJ. Open DevinControl tool window. Three nodes already on the canvas, two running, one done. *"This is every Devin session my team has running, right now."*
2. **0:30** — Click "+" → type prompt → new node appears, starts pulsing green. *"Spawn a new agent without ever leaving the IDE."*
3. **1:00** — Click an existing node → side panel opens, messages streaming in. AI narrator says what it's doing. *"Real-time visibility into what every agent is thinking."*
4. **1:45** — Type "actually, also add unit tests" in the redirect box → send. Show the message land in the stream. *"Redirect a running agent without context-switching to chat."*
5. **2:15** — Right-click the same node → "Branch from here" → modal pre-fills the current context → type alternate instruction → new child node appears connected by an edge. *"Don't lose work — branch into a parallel path."*
6. **2:45** — Zoom out to show the whole fleet. *"Six agents, one canvas, one operator. This is what scaling Devin actually looks like."*

---

## Devin-track compliance

The track requires **Devin commits in repo history**. Plan:

- Set up the repo (scaffolding, build config, README) by hand or via Codex locally.
- For each major feature (`spawn`, `inspect`, `redirect`, `fork`), open a cloud Devin session via `/handoff` from Codex CLI and have Devin do the implementation PR.
- Merge Devin's PRs to `main`. Result: commit history shows substantial Devin authorship while the human operator stays in the loop via Codex.

This also doubles as a meta-demo: we used a fleet of Devins to build a tool for orchestrating a fleet of Devins.

---

## Stack

- **Plugin**: Kotlin, IntelliJ Platform SDK, Gradle (`gradle-intellij-plugin`)
- **Webview**: React + Vite + ReactFlow + Tailwind
- **HTTP**: Ktor client (Kotlin) or OkHttp
- **Polling**: Kotlin coroutines + `Flow`
- **Storage**: IntelliJ `PasswordSafe` for API key, `PropertiesComponent` for org ID

---

## Open questions to validate in the first hour

1. Does `POST /sessions/{id}/messages` work on a session currently in `running` state, or only when blocked? Docs say "auto-resume if suspended" — need to confirm running-state behavior with a test call.
2. What's the actual schema of `GET /sessions/{id}/messages` items? (Role, content, timestamps — need shape before building the side panel.)
3. Is there rate limiting on polling? Test with 5s fleet poll + 2s per-session poll across 5 sessions.
4. Does `insights/generate` work on still-running sessions or only completed ones?

If any of these is a blocker, fall back: skip insights overlay for MVP (just show raw messages), skip redirect-while-running (queue and apply on next blocked state).
