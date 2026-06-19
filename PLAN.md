# Tower — MVP Build Plan & Handoff

Complete plan for finishing Tower at MEGATHON 2026 after the foundation checkpoint. Assumes Claude is unavailable; ChatGPT 5.5 Thinking takes the planning + review role (system prompt at the bottom of this doc).

---

## Status snapshot

Foundation complete:
- Gradle multi-module project (`plugin/` + `webview/`)
- Plugin loads in sandbox IDE with empty tool window
- `buildWebview` Gradle task wires `npm run build` → copies `webview/dist/*` to `plugin/src/main/resources/webview/`
- Devin v3 API auth verified end-to-end
- Session + message schemas captured

Latest commit: `e5b2702 Scaffold IntelliJ plugin foundation`

### Captured API schemas

Session object (from POST/GET `/sessions`):
```
session_id          string
url                 string
status              string
title               string | null
tags                array
playbook_id         string | null
user_id             string
org_id              string
created_at          number
updated_at          number
is_archived         boolean
acus_consumed       number
pull_requests       object
parent_session_id   string | null
child_session_ids   array | null
service_user_id     string
category            string | null
subcategory         string | null
origin              string
structured_output   object | null
status_detail       string | null
```

Messages response (`GET /sessions/{id}/messages`):
```
items[]
  event_id     string
  source       string
  message      string
  created_at   number
end_cursor     string | null
has_next_page  boolean
total          number
```

Use these to build Kotlin `@Serializable` data classes and matching TS types. Configure `kotlinx.serialization` with `ignoreUnknownKeys = true` and `coerceInputValues = true` so future schema additions don't break things.

---

## Architecture review

**Verdict: foundation is sound. Proceed.**

**Gradle webview embedding (correct):** the `buildWebview` task is the standard pattern. Verify `processResources` depends on it in `plugin/build.gradle.kts` so plugin jars never package stale webview output.

**JCEF resource loading (sound; use simplest path first):**
- Recommended: extract bundled webview to a temp dir on tool window open, then `browser.loadURL("file://...")`. ~30 lines.
- Fallback if assets 404: register a custom `CefResourceHandler` for `tower://` protocol serving from classpath.
- Avoid spinning up a localhost HTTP server. Overkill.

**JDK / instrumentation workaround (acceptable):** disabling IntelliJ instrumentation around the Microsoft OpenJDK path bug is fine for dev. For Sunday packaging: switch to JetBrains Runtime (JBR), re-enable instrumentation, run `./gradlew :plugin:buildPlugin` to produce a real distribution zip. ~15 min. Don't do it before Sunday.

**Next milestone (M1) is correct:** get React loading in JCEF before any API or UI work. Foundation problems compound — every feature built on a broken webview is wasted.

---

## Milestones (M1 → M13)

Each milestone has: goal, files, validation, time estimate, Cascade prompt, risks. **Stop and validate** before moving on. If validation fails, fix before adding code.

Total to demo-ready: ~25–30 focused hours. Sleep at least 5 hours Saturday night.

---

### M1 — JCEF loads React placeholder

**Goal:** Replace Swing label with JCEF browser displaying the built React app.
**Files:** `WebViewPanel.kt` (new), modify `DevinControlToolWindowFactory.kt`, `webview/vite.config.ts`.
**Validation:** `./gradlew :plugin:runIde` → tool window shows the Vite/React default UI.
**Time:** 1 hour
**Risks:** JCEF on Windows + `file://` can 404 on assets — if so, set Vite `base: "./"` and verify extracted `index.html` references `./assets/...`.

**Cascade prompt:**
```
Milestone M1 — Load the built React app in a JCEF browser inside the
Tower tool window.

Steps:
1. Set webview/vite.config.ts base: "./" so built assets use relative paths.
2. Rebuild webview with ./gradlew :plugin:buildWebview.
3. Create plugin/src/main/kotlin/com/tower/ui/WebViewPanel.kt that:
   - Creates a JBCefBrowser
   - On init, extracts plugin/src/main/resources/webview/* from the
     plugin classpath to a temp directory (Files.createTempDirectory)
   - Calls browser.loadURL("file://" + tempDir + "/index.html")
   - Exposes browser.component as the panel UI
4. Modify DevinControlToolWindowFactory.kt to use WebViewPanel instead
   of the placeholder JBLabel.
5. Run ./gradlew :plugin:runIde and confirm the tool window shows the
   default Vite/React UI.

If JCEF asset loading 404s, report the error and STOP. We'll fall back
to a custom CefResourceHandler.

Do not add bridge code or any features yet.
```

---

### M2 — JS↔Kotlin bridge (ping/pong)

**Goal:** Prove round-trip JS ↔ Kotlin communication.
**Files:** `JBCefBridge.kt`, `webview/src/bridge.ts`, modify `App.tsx`.
**Validation:** Click button in React → Kotlin returns "pong" → displays in UI.
**Time:** 1.5 hours
**Risks:** Bridge injection timing — inject on `onLoadEnd`, not constructor.

**Cascade prompt:**
```
Milestone M2 — JS↔Kotlin bridge.

1. Create plugin/src/main/kotlin/com/tower/ui/JBCefBridge.kt:
   - Wraps a JBCefBrowser
   - Registers a JBCefJSQuery with handler dispatch by "name"
   - Initial handler: "ping" returns "pong"
   - On onLoadEnd, injects window.cefQuery wrapper via
     browser.executeJavaScript
   - Exposes Kotlin-side API: bridge.handle(name) { req -> reply }

2. Create webview/src/bridge.ts with a promise-based wrapper:
   bridge.call(name: string, payload: any): Promise<any>

3. App.tsx: "Ping bridge" button → bridge.call("ping", null) →
   show response.

4. WebViewPanel.kt: construct JBCefBridge, not raw JBCefBrowser.

Validation: runIde → click button → see "pong". Don't add more
handlers yet.
```

---

### M3 — Settings (PasswordSafe + org ID)

**Goal:** User configures API key + org ID in IDE settings; persistent + secure.
**Files:** `SettingsConfigurable.kt`, `TowerSettings.kt`, `plugin.xml`.
**Validation:** Settings → Tools → Tower → save → restart sandbox → values persist.
**Time:** 1 hour

**Cascade prompt:**
```
Milestone M3 — Plugin settings for Devin API credentials.

1. TowerSettings.kt:
   - getApiKey/setApiKey via PasswordSafe with
     CredentialAttributes("Tower:apiKey")
   - getOrgId/setOrgId via PropertiesComponent.getInstance()

2. SettingsConfigurable.kt implements Configurable. Two JBTextField
   inputs; the key field uses JPasswordField.

3. Register in plugin.xml under <applicationConfigurable
   parentId="tools" displayName="Tower">.

4. "Test Connection" button — for now just logs the key length and
   org ID. Full DevinClient comes in M4.

Validation: Settings → Tools → Tower → save → restart sandbox → values
still present.
```

---

### M4 — DevinClient (HTTP wrapper)

**Goal:** Kotlin HTTP client for the seven endpoints we need.
**Files:** `DevinClient.kt`, `models/Session.kt`, `models/Message.kt`, `models/Insights.kt`.
**Validation:** Test Connection in settings calls real `listSessions`, displays session count or HTTP error.
**Time:** 2 hours

**Cascade prompt:**
```
Milestone M4 — DevinClient HTTP wrapper for the v3 Devin API.

OkHttp + kotlinx.serialization. Add deps to plugin/build.gradle.kts if
missing.

Methods (auth via TowerSettings):
- listSessions(): List<Session>
- getSession(id): Session
- createSession(prompt: String, parentSessionId: String? = null): Session
- getMessages(sessionId, cursor: String? = null): MessagesPage
- sendMessage(sessionId, text: String)
- terminateSession(sessionId)
- getInsights(sessionId): Insights?  // returns null on 404
- generateInsights(sessionId): Insights

All endpoints: https://api.devin.ai/v3/organizations/{orgId}/...
Auth: Authorization: Bearer <apiKey>

Models use @Serializable with nullable fields per the schemas in
PLAN.md. Json { ignoreUnknownKeys = true; coerceInputValues = true }.

Wire Test Connection (M3) to call listSessions → display
"OK — N sessions" or the HTTP error.

Validation: With real credentials, Test Connection returns a real
count.
```

---

### M5 — PollingService + StateStore

**Goal:** Background poller maintains fleet state, pushes updates to webview.
**Files:** `PollingService.kt`, `StateStore.kt`, bridge handlers `subscribeFleet` / `subscribeMessages`.
**Validation:** Browser console shows fleet updates every 5s; create a session via curl → it appears in next poll.
**Time:** 2.5 hours
**Risks:** Coroutine lifecycle — tie scope to Project disposal; polling must stop when tool window closes.

**Cascade prompt:**
```
Milestone M5 — PollingService and StateStore.

1. StateStore.kt:
   - MutableStateFlow<Map<String, Session>> for fleet
   - Map<sessionId, MutableStateFlow<List<Message>>> for active message
     subscriptions
   - asFleetFlow() and asMessageFlow(sessionId) accessors

2. PollingService.kt:
   - Coroutine scope tied to Project (SupervisorJob + Dispatchers.IO)
   - startFleetPoll(): every 5s → listSessions → update StateStore
   - startMessagePoll(sessionId): every 2s → getMessages with cursor →
     append new items
   - stopMessagePoll(sessionId): cancels that job
   - stop(): cancels all on Project disposal

3. Bridge handlers in JBCefBridge:
   - "subscribeFleet": collect fleet flow, push deltas via
     browser.executeJavaScript("window.onFleetUpdate(JSON.parse(...))")
   - "subscribeMessages": same pattern for one session
   - "unsubscribeMessages": stops that session's poll

4. App.tsx: window.onFleetUpdate stub that console.logs incoming data.

Validation: runIde with valid creds → console shows fleet state every
5s. Create a session via curl → appears in next poll.
```

---

### M6 — ReactFlow canvas (FIRST DEMOABLE MOMENT)

**Goal:** See your real fleet as nodes on a graph.
**Files:** `Canvas.tsx`, `Node.tsx`, `useFleetPoll.ts`, install `reactflow`.
**Validation:** Tool window shows a node graph mirroring the real Devin fleet, status colors, auto-layout.
**Time:** 3 hours
**Risks:** ReactFlow node state vs external state — use controlled nodes with `applyNodeChanges`.

**Cascade prompt:**
```
Milestone M6 — ReactFlow canvas rendering the live fleet.

1. cd webview && npm install reactflow

2. Canvas.tsx using ReactFlow with controlled nodes/edges. Background:
   ReactFlow <Background variant={BackgroundVariant.Dots} color="#1f2937" />

3. Node.tsx custom node type:
   - ~120px circle
   - Status color: running=#22c55e, blocked=#eab308, done=#3b82f6,
     errored=#ef4444, archived=#6b7280
   - Title (or first 30 chars of last message) under the circle
   - acus_consumed small badge

4. useFleetPoll.ts hook:
   - On mount: bridge.call("subscribeFleet", null)
   - window.onFleetUpdate → update React state
   - Diff against current nodes, add/remove/update

5. Layout: grid for MVP. Math.floor(index / 4) * 200 for y, (index % 4)
   * 200 for x. Dagre layout is stretch.

6. App.tsx renders <Canvas />.

Validation: Tool window shows live fleet. Spawn a session via curl or
/handoff — watch the node appear within 5s.

FIRST DEMOABLE MOMENT. Take a screenshot for the README.
```

---

### M7 — Spawn flow

**Goal:** + button → modal → new session.
**Files:** `SpawnModal.tsx`, bridge handler `createSession`.
**Validation:** Click +, type prompt, see new node appear.
**Time:** 1.5 hours

**Cascade prompt:**
```
Milestone M7 — Spawn modal + create session.

1. Floating + button fixed bottom-right of Canvas → opens SpawnModal.
2. SpawnModal: textarea + Spawn button. On submit:
   bridge.call("createSession", { prompt }) → close.
3. Bridge handler "createSession" calls DevinClient.createSession.
4. Optimistic: on response, add a pulsing gray "pending" node
   immediately. PollingService reconciles within 5s.

Validation: Click +, enter "Say hello and exit", see node appear,
transition to real status within 5s.
```

---

### M8 — Side panel (inspect)

**Goal:** Click node → live session details + messages + insights.
**Files:** `SidePanel.tsx`, bridge handlers for messages and insights.
**Validation:** Click node → status, ACU, message stream, AI insights summary visible.
**Time:** 3 hours
**Risks:** Insights may 404 if not yet generated — call `/insights/generate` first.

**Cascade prompt:**
```
Milestone M8 — Side panel for inspecting a session.

1. SidePanel.tsx slides in from right when selectedSessionId is set.
   Top: title, status badge, ACU, started-at.
   Middle: scrolling message stream (auto-scroll to bottom).
   Bottom: insights card.

2. Click handler on Node sets selectedSessionId.

3. On selection: bridge.call("subscribeMessages", { sessionId }) +
   bridge.call("getInsights", { sessionId }).

4. window.onMessages(sessionId, items) appends to local message state.

5. Insights: if null, show "Generating..." and call
   bridge.call("generateInsights", { sessionId }) once.

6. On close: bridge.call("unsubscribeMessages", { sessionId }).

Validation: Click any running node → live message stream within 2s.
Insights appear after a few seconds.
```

---

### M9 — Redirect

**Goal:** Send instruction to running session from side panel.
**Files:** Modify `SidePanel.tsx`, bridge handler `sendMessage`.
**Validation:** Type "also add tests" → message appears in stream → agent responds.
**Time:** 45 min

**Cascade prompt:**
```
Milestone M9 — Redirect: send messages to a running session.

1. SidePanel.tsx: textarea + Send at bottom.
2. On send: bridge.call("sendMessage", { sessionId, text }) → clear.
3. Bridge handler calls DevinClient.sendMessage.
4. Show "Sent ✓" toast. No optimistic message render — poll picks it
   up within 2s.

Validation: Send a message to a running/blocked session, see it appear
in the stream, agent responds.
```

---

### M10 — Stop / terminate

**Goal:** Terminate from side panel + node right-click.
**Files:** `SidePanel.tsx`, context menu in `Node.tsx`, bridge handler `terminateSession`.
**Validation:** Both stop paths work.
**Time:** 45 min

**Cascade prompt:**
```
Milestone M10 — Stop / terminate.

1. Side panel: red Stop button with confirm dialog.
2. Node right-click context menu (react-contexify or custom) → Stop.
3. Bridge handler "terminateSession" → DevinClient.terminateSession.
4. Optimistic: node transitions to gray; poll reconciles.

Validation: Spawn → stop → node updates within 5s.
```

---

### M11 — Aesthetic polish (mission-control)

**Goal:** Visual that wins the demo. Pulsing glowing nodes, live captions, dark canvas.
**Files:** `Node.tsx` CSS, `Canvas.tsx`, `App.css`.
**Validation:** Looks like sci-fi command bridge, not generic graph tool.
**Time:** 3–4 hours
**Risks:** Easy to over-design. Stop at "great in screenshot," not "every detail perfect."

**Cascade prompt:**
```
Milestone M11 — Mission-control aesthetic polish.

1. Background: very dark navy (#0a0e1a). Subtle starfield via CSS
   radial gradients or static SVG behind Canvas.

2. Node:
   - Strong box-shadow glow in status color
   - 2px ring in status color
   - @keyframes pulse: glow size animates 8px ↔ 20px over 2s; apply
     when status === 'running'
   - Hover: glow intensifies, slight scale up

3. Live caption (the killer feature):
   - For every running node, small floating label 80px right of node
   - Content: first 5–7 words of the latest insights summary
   - Add per-running-session insights polling to PollingService (10s
     cadence)
   - Faint opacity pulse

4. Edges (forked sessions): glowing thin lines with animated dotted
   particles flowing parent → child. SVG <animate> or ReactFlow
   custom edge.

5. Minimap: <MiniMap /> bottom-left, styled dark.

6. Empty state: faint constellation illustration + "No agents online.
   Tap + to spawn."

Validation: Sit back. Would a judge do a double-take? If not, one
more pass on glow + background.

Do NOT start this until M1–M10 are done.
```

---

### M12 (STRETCH) — Fork from snapshot

**Goal:** Right-click → "Branch from here" → new session with parent context.
**Files:** `ForkModal.tsx`, context menu, bridge handler `forkSession`.
**Validation:** Right-click → branch → new node connects via edge.
**Time:** 2 hours
**Risks:** Context too long — truncate insights to 500 chars before composing prompt.

**Cascade prompt:**
```
Milestone M12 — Fork from snapshot (stretch).

No native fork endpoint. Synthesize:
1. Pull parent insights summary, truncate to 500 chars.
2. createSession with composed prompt:
   "Continue from this state:\n\n[insights summary]\n\nThe previous
   agent was about to: [parent.status_detail].\nInstead, please:
   [user's instruction]"
3. Pass parent_session_id to createSession (Devin v3 supports it).
4. Render edge parent → child in ReactFlow.

UI: right-click → "Branch from here" → ForkModal pre-fills insights
preview + textarea for the redirect.

Edge: dashed at first, particles flow on creation, then solid.

Validation: Branch from a session, see new connected node, confirm
child sees parent context.
```

---

### M13 — Demo polish + practice

**Goal:** Submission-ready repo + a rehearsed 3-min demo.
**Files:** `README.md`, demo recording, screenshots.
**Validation:** Three timed run-throughs without fumbling.
**Time:** 2 hours

Checklist:
- [ ] `README.md` with screenshot, 1-paragraph pitch, install instructions
- [ ] Repo public on GitHub with clean commit history
- [ ] **Devin-authored commits exist** (`git log --author="Devin"` returns results) — if not, urgently `/handoff` 2–3 tasks NOW
- [ ] 30s demo video recorded (OBS or Loom)
- [ ] Pre-spawn 5–6 sessions on real-looking tasks ~30 min before judging so the demo canvas isn't empty
- [ ] Practiced the 3-minute script 3x
- [ ] Submitted via megathon.xyz registration link

### Demo script (rehearse)

> "Tower turns Devin from a chatbot into infrastructure. *Open tool window.* These are six agents my team has running, right now, across our repos. Each node — one Devin session.
>
> *Click +, type prompt.* I can spawn a new one without leaving the IDE.
>
> *Click a node, side panel opens.* I see what it's doing in real time. The AI narrator tells me it's currently refactoring auth.ts.
>
> *Type into redirect.* I can correct it mid-flight — 'also add tests.' Message lands, agent picks it up.
>
> *Right-click → Branch.* I can fork into an alternate path without losing the original work. New child node connects to the parent.
>
> Six agents, one canvas, one operator. This is what scaling Devin actually looks like in production."

---

## Three-agent workflow recap

- **Cascade with SWE-1.6 Fast** — primary in-IDE coder. Use for everything routine.
- **`/handoff` to cloud Devin** — major feature PRs (must be substantial). Use at least 3x more this weekend for track-required commit attribution.
- **Codex CLI (terminal, 2500 credits)** — surgical strikes when Cascade is stuck after 20+ min.

Escalation order when Cascade stalls:
1. Switch model to plain **SWE-1.6** (slower, more thinking).
2. After 20 min still stuck → **GPT-5.5 Low Thinking** or **Kimi K2.7**.
3. After another 20 min → **Codex CLI** in second terminal with full context.

---

## Submission requirements

For MEGATHON + Best Build with Devin:
- Public GitHub repo
- Devin Cloud commits in `git log` (track requirement — verify before submission)
- README with screenshot
- Demo (recording or live at venue)
- Submit via megathon.xyz registration link (check Discord for exact URL)

---

## Final pre-flight checks (do before M1)

- [ ] `processResources` depends on `buildWebview` in `plugin/build.gradle.kts`
- [ ] `webview/vite.config.ts` has `base: "./"`
- [ ] Foundation commit pushed to `main`
- [ ] You have water, snacks, and have taken a 5-min break

---

## ChatGPT 5.5 Thinking system prompt

Paste this as the first message of a new ChatGPT 5.5 Thinking conversation. Then paste SPEC.md and this PLAN.md in the next two messages.

```
You are a senior engineering advisor helping a builder finish "Tower" at
MEGATHON 2026 — a JetBrains IDE plugin that's mission-control for
orchestrating cloud Devin sessions visually. The builder has ~36 hours
left, is on mobile, and needs direct, useful guidance.

The builder will paste SPEC.md and PLAN.md as context. PLAN.md has the
full milestone roadmap with Cascade prompts and validation checkpoints.

YOUR JOB:
1. Review output from Cascade (the builder's primary in-IDE coding
   agent running SWE-1.6 Fast in Devin Desktop). Tell the builder
   honestly if it's correct, what to fix, what to approve. Quote
   specific files / function names.
2. Map "what's next" to a milestone in PLAN.md. Give the builder a
   copy-pasteable Cascade prompt for that milestone — use PLAN.md's
   prompts as the starting point, adjust for actual state.
3. When the builder hits an error, diagnose and give ONE concrete fix
   first. Only suggest alternatives if the first fix fails.
4. Push back when the builder is about to waste time —
   over-engineering, premature polish, scope creep. The MVP wins, not
   perfection.
5. Track milestone progress. Remind the builder when a validation
   checkpoint is being skipped.

HOW TO RESPOND:
- Mobile-friendly: short paragraphs, minimal headers, code blocks for
  paste-ables.
- Direct. No "Great question!" preamble. No flattery. No long
  disclaimers about your limitations.
- Specific: exact file names, exact commands, exact prompts.
- Honest about risk and time. If something is a likely 2-hour rabbit
  hole, say so before they start.
- Don't change the stack mid-build. IntelliJ Platform SDK + Kotlin +
  Gradle + JCEF + React + Vite + ReactFlow are fixed.
- PowerShell syntax on Windows: $env:VAR for env vars, backtick for
  line continuation, curl.exe for real curl.

THE THREE-AGENT SETUP (already configured):
- Cascade in Devin Desktop with SWE-1.6 Fast — primary in-IDE coder.
- /handoff to cloud Devin — substantive feature PRs; required for
  "Best Build with Devin" track (commits must show "Devin" as author).
- Codex CLI in terminal (2500 credits) — surgical strikes on hard
  problems where Cascade is stuck after 20+ min.

WHEN THE BUILDER IS STUCK:
- First: ask what the actual error / symptom is. Don't speculate.
- Second: give the most likely fix as a concrete command or diff.
- Third: only if those fail, propose alternatives.

WHEN THE BUILDER WANTS TO ADD A NON-MVP FEATURE:
- Default: no. List what's still pending in PLAN.md.
- Override only if it's a quick win that demos well and won't risk
  M1–M11 completion.

START BY: confirming you've read SPEC.md and PLAN.md. Don't summarize
them back — the builder wrote them. Ask which milestone they're on and
what they need.
```

---

You've got the spec, the plan, the prompts, the agents, the credits, and a working foundation. Now go ship it.
