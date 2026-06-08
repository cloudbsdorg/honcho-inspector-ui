import { Injectable, computed, inject, signal } from '@angular/core';
import { HonchoAuthService } from './honcho-auth.service';
import { ProfileService } from './profile.service';
import {
  HonchoConclusion,
  HonchoMessage,
  HonchoPeerInspect,
  HonchoPeerSummary,
  HonchoQueueStatus,
  HonchoSessionContext,
  HonchoSessionInspect,
  HonchoSessionMessageList,
  HonchoSessionSummary,
  HonchoWorkspaceConfig,
  HonchoWorkspaceInspect,
  HonchoWorkspaceMetadata,
} from './models';

@Injectable({ providedIn: 'root' })
export class HonchoService {
  private readonly auth = inject(HonchoAuthService);
  private readonly profile = inject(ProfileService);

  private readonly _peers = signal<HonchoPeerSummary[]>([]);
  private readonly _sessions = signal<HonchoSessionSummary[]>([]);
  private readonly _queueStatus = signal<HonchoQueueStatus | null>(null);
  private readonly _error = signal<string | null>(null);
  private readonly _loading = signal(false);
  private readonly _lastRefreshedAt = signal<number | null>(null);

  readonly peers = this._peers.asReadonly();
  readonly sessions = this._sessions.asReadonly();
  readonly queueStatus = this._queueStatus.asReadonly();
  readonly error = this._error.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly lastRefreshedAt = this._lastRefreshedAt.asReadonly();
  readonly isReady = computed(
    () => this.auth.isAuthenticated() && this.profile.activeProfileId() !== null,
  );
  readonly isStale = computed(
    () => this._error() !== null && this._peers().length > 0,
  );
  readonly friendlyError = computed(() => {
    const e = this._error();
    return e ? this.friendlyErrorMessage(e) : null;
  });

  async init(): Promise<void> {
    this.requireSession();
    const id = this.profile.activeProfileId();
    if (!id) throw new Error('Cannot init Honcho: no active profile');
    this.loadCache(id);
  }

  reset(): void {
    const id = this.profile.activeProfileId();
    if (id && typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.cacheKey(id));
    }
    this._peers.set([]);
    this._sessions.set([]);
    this._queueStatus.set(null);
    this._error.set(null);
    this._lastRefreshedAt.set(null);
  }

  async refreshPeers(): Promise<void> {
    await this.run(async () => {
      const page = await this.call<ApiPage<ApiPeer>>('GET', '/peers');
      this._peers.set(
        page.items.map((p) => ({
          id: p.id,
          createdAt: p.created_at,
          metadata: p.metadata ?? {},
        })),
      );
      this.persistCache();
    });
  }

  async refreshSessions(): Promise<void> {
    await this.run(async () => {
      const page = await this.call<ApiPage<ApiSession>>('GET', '/sessions');
      this._sessions.set(
        page.items.map((s) => ({
          id: s.id,
          peerIds: [],
          createdAt: s.created_at,
        })),
      );
      this.persistCache();
    });
  }

  async refreshQueueStatus(): Promise<void> {
    await this.run(async () => {
      const q = await this.call<ApiQueueStatus>('GET', '/queue-status');
      this._queueStatus.set(toQueueStatus(q));
    });
  }

  async inspectWorkspace(): Promise<HonchoWorkspaceInspect> {
    return this.runOrThrow(async () => {
      this.requireSession();
      this.requireProfile();
      const [info, peers, sessions] = await Promise.all([
        this.call<{ workspace: ApiWorkspaceMetadata; configuration: ApiWorkspaceConfig; queue: ApiQueueStatus }>(
          'GET',
          '/workspace/info',
        ),
        this.refreshPeersInternal(),
        this.refreshSessionsInternal(),
      ]);
      return {
        workspaceId: this.profile.activeProfile()?.workspaceId ?? '',
        peerCount: peers.length,
        sessionCount: sessions.length,
        metadata: toMetadata(info.workspace).raw,
        configuration: toConfig(info.configuration),
        queue: toQueueStatus(info.queue),
      };
    });
  }

  async inspectPeer(peerId: string): Promise<HonchoPeerInspect> {
    return this.runOrThrow(async () => {
      const [card, rep, conclusions, sessionCount] = await Promise.all([
        this.call<string[]>('GET', `/peers/${encodeURIComponent(peerId)}/card`),
        this.call<string>('GET', `/peers/${encodeURIComponent(peerId)}/representation`),
        this.call<ApiPage<ApiConclusion>>(
          'GET',
          `/peers/${encodeURIComponent(peerId)}/conclusions?size=10`,
        ),
        this.call<ApiPage<unknown>>('GET', `/peers/${encodeURIComponent(peerId)}/sessions`).catch(
          () => ({ items: [] }) as ApiPage<unknown>,
        ),
      ]);
      return {
        id: peerId,
        card: card ?? [],
        representation: rep ?? '',
        configuration: null,
        sessionCount: sessionCount.items?.length ?? 0,
        conclusionCount: conclusions.items.length,
        sessions: [],
        recentConclusions: conclusions.items.map(toConclusion),
      };
    });
  }

  async inspectSession(sessionId: string): Promise<HonchoSessionInspect> {
    return this.runOrThrow(async () => {
      const [details, peers, summaries, messages] = await Promise.all([
        this.call<ApiSession>('GET', `/sessions/${encodeURIComponent(sessionId)}`),
        this.call<{ peers: string[] } | string[]>(
          'GET',
          `/sessions/${encodeURIComponent(sessionId)}/peers`,
        ),
        this.call<ApiSessionSummaries>(
          'GET',
          `/sessions/${encodeURIComponent(sessionId)}/summaries`,
        ),
        this.call<ApiPage<ApiMessage>>(
          'GET',
          `/sessions/${encodeURIComponent(sessionId)}/messages?size=50`,
        ),
      ]);
      const peerIds = Array.isArray(peers) ? peers : (peers?.peers ?? []);
      return {
        id: sessionId,
        peerIds,
        messageCount: messages.items.length,
        summaries: toSummaries(sessionId, summaries),
        queue: emptyQueue(),
      };
    });
  }

  async getPeerCard(peerId: string): Promise<string[]> {
    return (await this.call<string[]>('GET', `/peers/${encodeURIComponent(peerId)}/card`)) ?? [];
  }

  async getPeerRepresentation(peerId: string): Promise<string> {
    return (await this.call<string>('GET', `/peers/${encodeURIComponent(peerId)}/representation`)) ?? '';
  }

  async chat(peerId: string, query: string, target?: string): Promise<string> {
    const body: Record<string, unknown> = { query };
    if (target) body['target'] = target;
    return (await this.call<string>('POST', `/peers/${encodeURIComponent(peerId)}/chat`, body)) ?? '';
  }

  async getOrCreatePeer(peerId: string): Promise<void> {
    await this.call<unknown>('POST', '/peers', { id: peerId });
  }

  async getOrCreateSession(sessionId: string, peerIds: string[] = []): Promise<void> {
    await this.call<unknown>('POST', '/sessions', { id: sessionId, peers: peerIds });
  }

  async listConclusions(
    peerId: string,
    options?: { size?: number },
  ): Promise<{ items: HonchoConclusion[]; total: number; page: number; size: number }> {
    const query = options?.size ? `?size=${options.size}` : '';
    const page = await this.call<ApiPage<ApiConclusion>>(
      'GET',
      `/peers/${encodeURIComponent(peerId)}/conclusions${query}`,
    );
    return {
      items: page.items.map(toConclusion),
      total: page.total ?? 0,
      page: page.page ?? 1,
      size: page.size ?? 0,
    };
  }

  async queryConclusions(
    peerId: string,
    query: string,
    topK = 25,
    distance = 0.6,
  ): Promise<HonchoConclusion[]> {
    const items = await this.call<ApiConclusion[]>(
      'POST',
      `/peers/${encodeURIComponent(peerId)}/conclusions/query`,
      { query, top_k: topK, distance },
    );
    return (items ?? []).map(toConclusion);
  }

  async getSessionContext(
    sessionId: string,
    options?: { tokens?: number; summary?: boolean },
  ): Promise<HonchoSessionContext> {
    const query: Record<string, string> = {};
    if (options?.tokens !== undefined) query['tokens'] = String(options.tokens);
    if (options?.summary !== undefined) query['summary'] = String(options.summary);
    return this.call<HonchoSessionContext>(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}/context`,
      undefined,
      query,
    );
  }

  async searchWorkspace(query: string, options?: { limit?: number }): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>('POST', '/search', body);
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async searchPeer(peerId: string, query: string, options?: { limit?: number }): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>(
      'POST',
      `/peers/${encodeURIComponent(peerId)}/search`,
      body,
    );
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async searchSession(sessionId: string, query: string, options?: { limit?: number }): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>(
      'POST',
      `/sessions/${encodeURIComponent(sessionId)}/search`,
      body,
    );
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async scheduleDream(observer: string, observed?: string, sessionId?: string): Promise<void> {
    const body: Record<string, unknown> = { observer };
    if (observed) body['observed'] = observed;
    if (sessionId) body['session'] = sessionId;
    await this.call<unknown>('POST', '/dream', body);
  }

  async sendMessage(
    sessionId: string,
    peerId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const body = {
      messages: [{ peer_id: peerId, content, metadata: metadata ?? {} }],
    };
    await this.call<unknown>(
      'POST',
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      body,
    );
  }

  async listSessionMessages(
    sessionId: string,
    options?: { size?: number; peerId?: string },
  ): Promise<HonchoSessionMessageList> {
    const query: Record<string, string> = {};
    if (options?.size !== undefined) query['size'] = String(options.size);
    if (options?.peerId) query['peer_id'] = options.peerId;
    const page = await this.call<ApiPage<ApiMessage>>(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      undefined,
      query,
    );
    return {
      items: page.items.map(toMessage),
      total: page.total ?? 0,
      page: page.page ?? 1,
      size: page.size ?? 0,
    };
  }

  private requireSession() {
    const c = this.auth.credentials();
    if (!c) throw new Error('Not authenticated');
    return c;
  }

  private requireProfile(): string {
    const id = this.profile.activeProfileId();
    if (!id) {
      throw new Error('No active profile. Create or select a profile first.');
    }
    return id;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    query?: Record<string, string>,
  ): Promise<T> {
    const session = this.requireSession();
    const profileId = this.requireProfile();
    const url = new URL('/api' + path, window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, v);
      }
    }
    const headers: Record<string, string> = {
      'X-Session-Id': session.sessionId,
      'X-Honcho-Profile-Id': profileId,
    };
    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(url.toString(), { method, headers, body: payload });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = errBody.error ?? `Backend error ${res.status}`;
      const err = new Error(msg);
      (err as Error & { backendStatus?: number }).backendStatus = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  private async run(fn: () => Promise<void>): Promise<void> {
    this._loading.set(true);
    this._error.set(null);
    try {
      await fn();
      this._lastRefreshedAt.set(Date.now());
    } catch (e) {
      this._error.set(this.errorMessage(e));
    } finally {
      this._loading.set(false);
    }
  }

  private async runOrThrow<T>(fn: () => Promise<T>): Promise<T> {
    this._loading.set(true);
    this._error.set(null);
    try {
      const result = await fn();
      this._lastRefreshedAt.set(Date.now());
      return result;
    } catch (e) {
      this._error.set(this.errorMessage(e));
      throw e;
    } finally {
      this._loading.set(false);
    }
  }

  private async refreshPeersInternal(): Promise<HonchoPeerSummary[]> {
    const page = await this.call<ApiPage<ApiPeer>>('GET', '/peers');
    const peers = page.items.map((p) => ({
      id: p.id,
      createdAt: p.created_at,
      metadata: p.metadata ?? {},
    }));
    this._peers.set(peers);
    return peers;
  }

  private async refreshSessionsInternal(): Promise<HonchoSessionSummary[]> {
    const page = await this.call<ApiPage<ApiSession>>('GET', '/sessions');
    const sessions = page.items.map((s) => ({
      id: s.id,
      peerIds: [],
      createdAt: s.created_at,
    }));
    this._sessions.set(sessions);
    return sessions;
  }

  private cacheKey(profileId: string): string {
    return `honcho-cache-${profileId}`;
  }

  private loadCache(profileId: string): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(this.cacheKey(profileId));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        peers?: HonchoPeerSummary[];
        sessions?: HonchoSessionSummary[];
      };
      if (Array.isArray(parsed.peers)) this._peers.set(parsed.peers);
      if (Array.isArray(parsed.sessions)) this._sessions.set(parsed.sessions);
    } catch {
      return;
    }
  }

  private persistCache(): void {
    if (typeof localStorage === 'undefined') return;
    const id = this.profile.activeProfileId();
    if (!id) return;
    const payload = {
      peers: this._peers(),
      sessions: this._sessions(),
    };
    try {
      localStorage.setItem(this.cacheKey(id), JSON.stringify(payload));
    } catch {
      return;
    }
  }

  friendlyErrorMessage(e: unknown): string {
    const raw = e instanceof Error ? e.message : String(e);
    const lower = raw.toLowerCase();
    if (lower.includes('failed to fetch') || lower.includes('networkerror')) {
      const url = this.profile.activeProfile()?.baseUrl ?? 'the configured URL';
      return `Cannot reach Honcho server at ${url}. Check that the backend is running and the Honcho URL is correct.`;
    }
    if (lower.includes('401') || lower.includes('403') || lower.includes('authentication')) {
      return 'Authentication failed. Try selecting a different profile or logging in again.';
    }
    if (lower.includes('404') || lower.includes('not found')) {
      return 'Not found. Check the workspace ID and Honcho URL for the active profile.';
    }
    if (lower.includes('rate limit') || lower.includes('429')) {
      return 'Rate limit hit. Slow down and retry in a moment.';
    }
    if (lower.includes('no active profile') || lower.includes('missing x-honcho-profile-id')) {
      return 'No active profile. Choose a profile to continue.';
    }
    return raw;
  }

  private errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}

interface ApiPage<T> {
  items: T[];
  total?: number;
  page?: number;
  size?: number;
}

interface ApiPeer {
  id: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

interface ApiSession {
  id: string;
  created_at?: string;
}

interface ApiQueueStatus {
  total_work_units?: number;
  completed_work_units?: number;
  in_progress_work_units?: number;
  pending_work_units?: number;
  sessions?: Record<string, unknown>;
}

interface ApiWorkspaceMetadata {
  id?: string;
  created_at?: string;
  [k: string]: unknown;
}

interface ApiWorkspaceConfig {
  reasoning?: { enabled?: boolean };
  peer_card?: { create?: boolean };
  summary?: { enabled?: boolean };
  dream?: { enabled?: boolean };
  [k: string]: unknown;
}

interface ApiConclusion {
  id: string;
  content: string;
  observer_id?: string;
  observed_id?: string;
  session_id?: string | null;
  created_at?: string;
}

interface ApiMessage {
  id: string;
  peer_id?: string;
  content: string;
  session_id?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

interface ApiSessionSummaries {
  short_summary?: { content: string; created_at?: string } | null;
  long_summary?: { content: string; created_at?: string } | null;
}

function toMetadata(api: ApiWorkspaceMetadata): HonchoWorkspaceMetadata {
  return {
    id: api.id ?? '',
    createdAt: api.created_at ?? '',
    raw: api,
  };
}

function toConfig(api: ApiWorkspaceConfig): HonchoWorkspaceConfig {
  return {
    reasoning: { enabled: api.reasoning?.enabled ?? null },
    peerCard: { create: api.peer_card?.create ?? null },
    summary: { enabled: api.summary?.enabled ?? null },
    dream: { enabled: api.dream?.enabled ?? null },
  };
}

function toQueueStatus(api: ApiQueueStatus | null | undefined): HonchoQueueStatus {
  if (!api) return emptyQueue();
  return {
    totalWorkUnits: api.total_work_units ?? 0,
    completedWorkUnits: api.completed_work_units ?? 0,
    inProgressWorkUnits: api.in_progress_work_units ?? 0,
    pendingWorkUnits: api.pending_work_units ?? 0,
  };
}

function emptyQueue(): HonchoQueueStatus {
  return {
    totalWorkUnits: 0,
    completedWorkUnits: 0,
    inProgressWorkUnits: 0,
    pendingWorkUnits: 0,
  };
}

function toConclusion(api: ApiConclusion): HonchoConclusion {
  return {
    id: api.id,
    content: api.content,
    observerId: api.observer_id ?? '',
    observedId: api.observed_id ?? '',
    sessionId: api.session_id ?? null,
    createdAt: api.created_at ?? '',
  };
}

function toMessage(api: ApiMessage): HonchoMessage {
  return {
    id: api.id,
    peerId: api.peer_id ?? '',
    content: api.content,
    sessionId: api.session_id ?? '',
    createdAt: api.created_at ?? '',
    metadata: api.metadata ?? {},
  };
}

function toSummaries(sessionId: string, api: ApiSessionSummaries): {
  id: string;
  shortSummary: { content: string; messageId: string; summaryType: 'short'; createdAt: string; tokenCount: number } | null;
  longSummary: { content: string; messageId: string; summaryType: 'long'; createdAt: string; tokenCount: number } | null;
} {
  return {
    id: sessionId,
    shortSummary: api.short_summary
      ? { content: api.short_summary.content, messageId: '', summaryType: 'short', createdAt: api.short_summary.created_at ?? '', tokenCount: 0 }
      : null,
    longSummary: api.long_summary
      ? { content: api.long_summary.content, messageId: '', summaryType: 'long', createdAt: api.long_summary.created_at ?? '', tokenCount: 0 }
      : null,
  };
}
