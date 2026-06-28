"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DevinProvider = void 0;
const uuid_1 = require("uuid");
const BASE = 'https://api.devin.ai/v3';
class DevinProvider {
    constructor(getApiKey, getOrgId) {
        this.getApiKey = getApiKey;
        this.getOrgId = getOrgId;
        this.name = 'devin';
        this.cursors = new Map();
        this.pollIntervals = new Map();
        this.mapSession = (s) => ({
            id: s.session_id,
            provider: 'devin',
            prompt: s.title ?? '',
            status: this.mapStatus(s.status),
            title: s.title ?? s.session_id.slice(0, 8),
            createdAt: s.created_at * 1000,
            updatedAt: s.updated_at * 1000,
            url: s.url,
            acuConsumed: s.acus_consumed,
            parentId: s.parent_session_id ?? undefined,
        });
    }
    async listSessions() {
        const data = await this.get('sessions');
        return (data.sessions ?? []).map(this.mapSession);
    }
    async spawnSession(prompt, parentId) {
        const body = { prompt };
        if (parentId)
            body.parent_session_id = parentId;
        const data = await this.post('sessions', body);
        return this.mapSession(data);
    }
    async stopSession(sessionId) {
        this.clearPoll(sessionId);
        await this.delete(`sessions/${sessionId}`);
    }
    async sendMessage(sessionId, text) {
        await this.post(`sessions/${sessionId}/messages`, { message: text });
    }
    subscribeMessages(sessionId, onMessages) {
        this.cursors.delete(sessionId);
        const poll = async () => {
            try {
                const cursor = this.cursors.get(sessionId);
                const qs = cursor ? `?cursor=${cursor}` : '';
                const data = await this.get(`sessions/${sessionId}/messages${qs}`);
                if (data.items?.length) {
                    onMessages(data.items.map((m) => this.mapMessage(sessionId, m)));
                }
                if (data.end_cursor)
                    this.cursors.set(sessionId, data.end_cursor);
            }
            catch {
                // session may have ended
            }
        };
        poll();
        const interval = setInterval(poll, 2000);
        this.pollIntervals.set(sessionId, interval);
        return () => this.clearPoll(sessionId);
    }
    async getInsights(sessionId) {
        try {
            const data = await this.get(`sessions/${sessionId}/insights`);
            return data.summary ?? null;
        }
        catch {
            try {
                const data = await this.post(`sessions/${sessionId}/insights/generate`, {});
                return data.summary ?? null;
            }
            catch {
                return null;
            }
        }
    }
    clearPoll(sessionId) {
        const interval = this.pollIntervals.get(sessionId);
        if (interval) {
            clearInterval(interval);
            this.pollIntervals.delete(sessionId);
        }
    }
    mapMessage(sessionId, m) {
        return {
            id: m.event_id || (0, uuid_1.v4)(),
            sessionId,
            source: m.source === 'user' ? 'user' : 'agent',
            text: m.message,
            createdAt: m.created_at * 1000,
        };
    }
    mapStatus(s) {
        if (s === 'running')
            return 'running';
        if (s === 'blocked' || s === 'suspended')
            return 'blocked';
        if (s === 'finished' || s === 'completed')
            return 'done';
        if (s === 'failed')
            return 'errored';
        if (s === 'stopped')
            return 'stopped';
        return 'running';
    }
    async headers() {
        return {
            Authorization: `Bearer ${await this.getApiKey()}`,
            'Content-Type': 'application/json',
        };
    }
    orgPath(path) {
        return `${BASE}/organizations/${this.getOrgId()}/${path}`;
    }
    async get(path) {
        const res = await fetch(this.orgPath(path), { headers: await this.headers() });
        if (!res.ok)
            throw new Error(`Devin API ${res.status}: ${path}`);
        return res.json();
    }
    async post(path, body) {
        const res = await fetch(this.orgPath(path), {
            method: 'POST',
            headers: await this.headers(),
            body: JSON.stringify(body),
        });
        if (!res.ok)
            throw new Error(`Devin API ${res.status}: POST ${path}`);
        return res.json();
    }
    async delete(path) {
        const res = await fetch(this.orgPath(path), {
            method: 'DELETE',
            headers: await this.headers(),
        });
        if (!res.ok)
            throw new Error(`Devin API ${res.status}: DELETE ${path}`);
    }
}
exports.DevinProvider = DevinProvider;
//# sourceMappingURL=DevinProvider.js.map