"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeCodeProvider = void 0;
const child_process_1 = require("child_process");
const uuid_1 = require("uuid");
// Common install locations for the claude CLI, tried in order
const FALLBACK_PATHS = [
    '/usr/local/bin/claude',
    `${process.env.HOME ?? '~'}/.local/bin/claude`,
    `${process.env.HOME ?? '~'}/.npm/bin/claude`,
    `${process.env.HOME ?? '~'}/.npm-global/bin/claude`,
];
class ClaudeCodeProvider {
    /**
     * @param claudePath Path to the `claude` binary. Defaults to `claude` (expects it in PATH).
     *   Configure via `tower.claude.path` in VS Code settings if the binary is not on PATH.
     */
    constructor(claudePath = 'claude', workspacePath) {
        this.claudePath = claudePath;
        this.workspacePath = workspacePath;
        this.name = 'claude';
        this.processes = new Map();
        this.completedSessions = [];
    }
    async listSessions() {
        const running = Array.from(this.processes.values()).map((r) => r.session);
        return [...running, ...this.completedSessions].sort((a, b) => b.createdAt - a.createdAt);
    }
    async spawnSession(prompt, parentId) {
        const id = (0, uuid_1.v4)();
        const now = Date.now();
        const session = {
            id,
            provider: 'claude',
            prompt,
            status: 'running',
            title: prompt.slice(0, 60),
            createdAt: now,
            updatedAt: now,
            parentId,
        };
        const args = ['--output-format', 'stream-json', '--print', prompt];
        const proc = (0, child_process_1.spawn)(this.claudePath, args, {
            env: { ...process.env },
            cwd: this.workspacePath,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        const entry = { proc, session, messageBuffer: [], subscribers: new Set() };
        this.processes.set(id, entry);
        this.attachProcessHandlers(id, entry);
        return session;
    }
    async stopSession(sessionId) {
        const entry = this.processes.get(sessionId);
        if (!entry)
            return;
        entry.proc.kill('SIGTERM');
        this.finalizeSession(sessionId, 'stopped');
    }
    async sendMessage(sessionId, text) {
        // Running processes don't accept stdin in --print mode.
        // Queue a follow-up: record the message now and it will be picked up as
        // a new session when the current one finishes (handled by the consumer).
        const entry = this.processes.get(sessionId);
        const msg = this.makeMessage(sessionId, 'user', text);
        if (entry) {
            entry.messageBuffer.push(msg);
            this.notifySubscribers(entry, [msg]);
            const note = this.makeMessage(sessionId, 'system', 'Redirect queued — the agent will pick this up after its current task completes.');
            entry.messageBuffer.push(note);
            this.notifySubscribers(entry, [note]);
        }
    }
    subscribeMessages(sessionId, onMessages) {
        const entry = this.processes.get(sessionId);
        if (!entry) {
            // Completed session — deliver buffer and return
            const completed = this.completedSessions.find((s) => s.id === sessionId);
            if (completed) {
                const msgs = completed.__messages ?? [];
                if (msgs.length)
                    setTimeout(() => onMessages([...msgs]), 0);
            }
            return () => { };
        }
        if (entry.messageBuffer.length > 0) {
            setTimeout(() => onMessages([...entry.messageBuffer]), 0);
        }
        entry.subscribers.add(onMessages);
        return () => entry.subscribers.delete(onMessages);
    }
    async getInsights(sessionId) {
        const entry = this.processes.get(sessionId);
        const completed = this.completedSessions.find((s) => s.id === sessionId);
        const messages = entry?.messageBuffer ?? completed?.__messages ?? [];
        const agentText = messages
            .filter((m) => m.source === 'agent')
            .map((m) => m.text)
            .join('\n')
            .slice(-1000);
        return agentText || null;
    }
    attachProcessHandlers(id, entry) {
        entry.proc.stdout?.on('data', (data) => {
            for (const line of data.toString().split('\n').filter(Boolean)) {
                this.handleOutputLine(id, entry, line);
            }
        });
        entry.proc.stderr?.on('data', (data) => {
            const text = data.toString().trim();
            if (!text)
                return;
            const msg = this.makeMessage(id, 'system', `[stderr] ${text}`);
            entry.messageBuffer.push(msg);
            this.notifySubscribers(entry, [msg]);
        });
        entry.proc.on('close', (code) => {
            const status = code === 0 ? 'done' : code === null ? 'stopped' : 'errored';
            this.finalizeSession(id, status);
        });
        entry.proc.on('error', (err) => {
            const isNotFound = err.code === 'ENOENT';
            const text = isNotFound
                ? `claude CLI not found at "${this.claudePath}". ` +
                    `Install Claude Code (https://claude.ai/code) or set tower.claude.path in VS Code settings. ` +
                    `Tried fallbacks: ${FALLBACK_PATHS.join(', ')}`
                : `Process error: ${err.message}`;
            const msg = this.makeMessage(id, 'system', text);
            entry.messageBuffer.push(msg);
            this.notifySubscribers(entry, [msg]);
            this.finalizeSession(id, 'errored');
        });
    }
    handleOutputLine(id, entry, line) {
        let text = line;
        let source = 'agent';
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'system' && typeof parsed.session_id === 'string') {
                entry.claudeSessionId = parsed.session_id;
                return;
            }
            if (parsed.type === 'assistant') {
                const content = parsed.message?.content;
                if (Array.isArray(content)) {
                    text = content
                        .filter((b) => b.type === 'text')
                        .map((b) => b.text)
                        .join('');
                }
            }
            else if (parsed.type === 'result') {
                text = parsed.result ?? '';
                source = 'system';
            }
            else if (parsed.type === 'tool_use' || parsed.type === 'tool_result') {
                // Tool call details — skip for the side panel; too noisy
                return;
            }
        }
        catch {
            // Raw text line
        }
        if (!text.trim())
            return;
        entry.session.lastMessage = text.slice(0, 80);
        entry.session.updatedAt = Date.now();
        const msg = this.makeMessage(id, source, text);
        entry.messageBuffer.push(msg);
        this.notifySubscribers(entry, [msg]);
    }
    finalizeSession(id, status) {
        const entry = this.processes.get(id);
        if (!entry)
            return;
        entry.session.status = status;
        entry.session.updatedAt = Date.now();
        const completed = {
            ...entry.session,
            __messages: [...entry.messageBuffer],
        };
        this.completedSessions.unshift(completed);
        this.processes.delete(id);
        const msg = this.makeMessage(id, 'system', `Session ${status}.`);
        entry.subscribers.forEach((fn) => fn([msg]));
        entry.subscribers.clear();
    }
    notifySubscribers(entry, messages) {
        entry.subscribers.forEach((fn) => fn(messages));
    }
    makeMessage(sessionId, source, text) {
        return { id: (0, uuid_1.v4)(), sessionId, source, text, createdAt: Date.now() };
    }
}
exports.ClaudeCodeProvider = ClaudeCodeProvider;
//# sourceMappingURL=ClaudeCodeProvider.js.map