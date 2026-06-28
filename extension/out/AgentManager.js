"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentManager = void 0;
class AgentManager {
    constructor() {
        this.providers = new Map();
        this.sessions = new Map();
        this.fleetListeners = new Set();
        this.messageUnsubs = new Map();
    }
    register(provider) {
        this.providers.set(provider.name, provider);
    }
    startFleetPoll(intervalMs = 5000) {
        this.syncFleet();
        this.fleetPollTimer = setInterval(() => this.syncFleet(), intervalMs);
    }
    stopFleetPoll() {
        if (this.fleetPollTimer)
            clearInterval(this.fleetPollTimer);
    }
    onFleetUpdate(listener) {
        this.fleetListeners.add(listener);
        // Deliver current state immediately
        listener(this.fleet());
        return () => this.fleetListeners.delete(listener);
    }
    async spawn(prompt, providerName = 'claude', parentId) {
        const provider = this.getProvider(providerName);
        const session = await provider.spawnSession(prompt, parentId);
        this.sessions.set(session.id, session);
        this.emitFleet();
        return session;
    }
    async stop(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return;
        const provider = this.getProvider(session.provider);
        await provider.stopSession(sessionId);
        session.status = 'stopped';
        this.sessions.set(sessionId, session);
        this.emitFleet();
    }
    async sendMessage(sessionId, text) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error(`Session not found: ${sessionId}`);
        const provider = this.getProvider(session.provider);
        await provider.sendMessage(sessionId, text);
    }
    subscribeMessages(sessionId, onMessages) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return () => { };
        const provider = this.getProvider(session.provider);
        const unsub = provider.subscribeMessages(sessionId, onMessages);
        this.messageUnsubs.set(sessionId, unsub);
        return () => {
            unsub();
            this.messageUnsubs.delete(sessionId);
        };
    }
    unsubscribeMessages(sessionId) {
        const unsub = this.messageUnsubs.get(sessionId);
        if (unsub) {
            unsub();
            this.messageUnsubs.delete(sessionId);
        }
    }
    async getInsights(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session)
            return null;
        const provider = this.getProvider(session.provider);
        return provider.getInsights?.(sessionId) ?? null;
    }
    async fork(sessionId, instruction) {
        const session = this.sessions.get(sessionId);
        if (!session)
            throw new Error(`Session not found: ${sessionId}`);
        const provider = this.getProvider(session.provider);
        let contextSummary = '';
        if (provider.getInsights) {
            contextSummary = (await provider.getInsights(sessionId)) ?? '';
        }
        const composedPrompt = contextSummary
            ? `Continue from this context:\n\n${contextSummary.slice(0, 500)}\n\nInstead of continuing the previous plan, please: ${instruction}`
            : instruction;
        return this.spawn(composedPrompt, session.provider, sessionId);
    }
    async syncFleet() {
        const all = [];
        for (const provider of this.providers.values()) {
            try {
                const sessions = await provider.listSessions();
                sessions.forEach((s) => all.push(s));
            }
            catch {
                // provider unavailable — skip
            }
        }
        all.forEach((s) => this.sessions.set(s.id, s));
        this.emitFleet();
    }
    fleet() {
        return Array.from(this.sessions.values()).sort((a, b) => b.createdAt - a.createdAt);
    }
    emitFleet() {
        const fleet = this.fleet();
        this.fleetListeners.forEach((fn) => fn(fleet));
    }
    getProvider(name) {
        const provider = this.providers.get(name);
        if (!provider)
            throw new Error(`Provider not configured: ${name}`);
        return provider;
    }
    dispose() {
        this.stopFleetPoll();
        this.messageUnsubs.forEach((fn) => fn());
        this.messageUnsubs.clear();
        this.fleetListeners.clear();
    }
}
exports.AgentManager = AgentManager;
//# sourceMappingURL=AgentManager.js.map