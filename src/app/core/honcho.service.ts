import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from './api-client';
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
import { formatError } from './error-message';

type CallOpts = Omit<Parameters<ApiClient['request']>[0], 'profileId'>;

@Injectable({ providedIn: 'root' })
export class HonchoService {
  private readonly auth = inject(HonchoAuthService);
  private readonly profile = inject(ProfileService);
  private readonly api = inject(ApiClient);

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
  readonly isStale = computed(() => this._error() !== null && this._peers().length > 0);
  readonly friendlyError = computed(() => {
    const e = this._error();
    return e ? this.friendlyErrorMessage(e) : null;
  });

  constructor() {}

  async init(): Promise<void> {
    this.requireSession();
    const id = this.profile.activeProfileId();
    if (!id) throw new ApiError('Cannot init Honcho: no active profile', 0);
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
      await this.refreshPeersInternal();
      this.persistCache();
    });
  }

  async refreshSessions(): Promise<void> {
    await this.run(async () => {
      await this.refreshSessionsInternal();
      this.persistCache();
    });
  }

  async refreshQueueStatus(): Promise<void> {
    await this.run(async () => {
      const q = await this.call<ApiQueueStatus>({ method: 'GET', path: '/queue-status' });
      this._queueStatus.set(toQueueStatus(q));
    });
  }

  async inspectWorkspace(): Promise<HonchoWorkspaceInspect> {
    return this.runOrThrow(async () => {
      this.requireSession();
      this.requireProfile();
      const [info, peers, sessions] = await Promise.all([
        this.call<{
          workspace: ApiWorkspaceMetadata;
          configuration: ApiWorkspaceConfig;
          queue: ApiQueueStatus;
        }>({ method: 'GET', path: '/workspace/info' }),
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
        // Honcho v3 GET /card returns { peer_card: [...] }; the registry unwraps it to string[]
        this.call<string[] | null>({
          method: 'GET',
          path: `/peers/${encodeURIComponent(peerId)}/card`,
        }),
        // Honcho v3 disallows GET on /representation (returns 405); the
        // backend now exposes this as POST with an empty {} body. The
        // registry unwraps it to string.
        this.call<string | null>({
          method: 'POST',
          path: `/peers/${encodeURIComponent(peerId)}/representation`,
          body: {},
        }),
        // Honcho v3 moved /conclusions up one level: POST
        // /v3/workspaces/{ws}/conclusions/list with {filters:{...}} body.
        // The backend fills observed_id from the path variable. Honcho v3
        // 422s on unknown filter keys (e.g. `size`), so we leave filters empty.
        this.call<ApiPage<ApiConclusion>>({
          method: 'POST',
          path: `/peers/${encodeURIComponent(peerId)}/conclusions`,
          body: { filters: {} },
        }),
        this.call<ApiPage<unknown>>({
          method: 'GET',
          path: `/peers/${encodeURIComponent(peerId)}/sessions`,
        }).catch(() => ({ items: [] }) as ApiPage<unknown>),
      ]);
      return {
        id: peerId,
        card: card ?? [],
        representation: rep ?? '',
        configuration: null,
        sessionCount: sessionCount.items?.length ?? 0,
        conclusionCount: conclusions.items.length,
        sessions: ((sessionCount.items as ApiSession[]) ?? []).map((s) => ({
          id: s.id,
          peerIds: [],
          createdAt: (s as any).createdAt ?? s.created_at ?? '',
        })),
        recentConclusions: conclusions.items.map(toConclusion),
      };
    });
  }

  async inspectSession(sessionId: string): Promise<HonchoSessionInspect> {
    return this.runOrThrow(async () => {
      const [details, peers, summaries, messages] = await Promise.all([
        this.call<ApiSession>({
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionId)}`,
        }),
        this.call<{ peers: string[] } | string[]>({
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionId)}/peers`,
        }),
        this.call<ApiSessionSummaries>({
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionId)}/summaries`,
        }),
        this.call<ApiPage<ApiMessage>>({
          method: 'GET',
          path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
          query: { size: 50 },
        }),
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
    return (
      (await this.call<string[]>({
        method: 'GET',
        path: `/peers/${encodeURIComponent(peerId)}/card`,
      })) ?? []
    );
  }

  async getPeerRepresentation(peerId: string): Promise<string> {
    // Honcho v3 disallows GET on /representation (returns 405); use
    // POST with an empty body instead. The unwrapper on the proxy
    // extracts the `{representation: "..."}` field; the advice
    // wraps the bare string as {data:"...", error:null, meta:null};
    // the api-client unwraps `data` and returns the bare string.
    // Earlier the raw `{representation: "..."}` envelope was
    // returned through unchanged, which made Angular render
    // "[object Object]" in the dashboard's Representation panel.
    return (
      (await this.call<string>({
        method: 'POST',
        path: `/peers/${encodeURIComponent(peerId)}/representation`,
        body: {},
      })) ?? ''
    );
  }

  async chat(peerId: string, query: string, target?: string): Promise<string> {
    const body: Record<string, unknown> = { query };
    if (target) body['target'] = target;
    return (
      (await this.call<string>({
        method: 'POST',
        path: `/peers/${encodeURIComponent(peerId)}/chat`,
        body,
      })) ?? ''
    );
  }

  async getOrCreatePeer(peerId: string): Promise<void> {
    await this.call<unknown>({ method: 'POST', path: '/peers', body: { id: peerId } });
  }

  async getOrCreateSession(sessionId: string, peerIds: string[] = []): Promise<void> {
    await this.call<unknown>({
      method: 'POST',
      path: '/sessions',
      body: { id: sessionId, peers: peerIds },
    });
  }

  async listConclusions(
    peerId: string,
    options?: { size?: number },
  ): Promise<{ items: HonchoConclusion[]; total: number; page: number; size: number }> {
    // Honcho v3 moved /conclusions to the workspace level; the proxy now
    // expects POST + {filters:{...}} body. Backend fills observed_id from
    // the path variable. Honcho v3 ignores unknown filter keys (and 422s
    // on bogus ones like `size`), so we pass an empty filters object here
    // and let the backend apply the peer filter.
    void options;
    const filters: Record<string, unknown> = {};
    const page = await this.call<ApiPage<ApiConclusion>>({
      method: 'POST',
      path: `/peers/${encodeURIComponent(peerId)}/conclusions`,
      body: { filters },
    });
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
    const items = await this.call<ApiConclusion[]>({
      method: 'POST',
      path: `/peers/${encodeURIComponent(peerId)}/conclusions/query`,
      body: { query, top_k: topK, distance },
    });
    return (items ?? []).map(toConclusion);
  }

  async getSessionContext(
    sessionId: string,
    options?: { tokens?: number; summary?: boolean },
  ): Promise<HonchoSessionContext> {
    const query: Record<string, string | number | boolean> = {};
    if (options?.tokens !== undefined) query['tokens'] = options.tokens;
    if (options?.summary !== undefined) query['summary'] = options.summary;
    return this.call<HonchoSessionContext>({
      method: 'GET',
      path: `/sessions/${encodeURIComponent(sessionId)}/context`,
      query,
    });
  }

  async searchWorkspace(query: string, options?: { limit?: number }): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>({
      method: 'POST',
      path: '/search',
      body,
    });
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async searchPeer(
    peerId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>({
      method: 'POST',
      path: `/peers/${encodeURIComponent(peerId)}/search`,
      body,
    });
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async searchSession(
    sessionId: string,
    query: string,
    options?: { limit?: number },
  ): Promise<HonchoMessage[]> {
    const body: Record<string, unknown> = { query };
    if (options?.limit !== undefined) body['limit'] = options.limit;
    const items = await this.call<ApiMessage[] | ApiPage<ApiMessage>>({
      method: 'POST',
      path: `/sessions/${encodeURIComponent(sessionId)}/search`,
      body,
    });
    return Array.isArray(items) ? items.map(toMessage) : (items.items ?? []).map(toMessage);
  }

  async scheduleDream(observer: string, observed?: string, sessionId?: string): Promise<void> {
    const body: Record<string, unknown> = { observer };
    if (observed) body['observed'] = observed;
    if (sessionId) body['session'] = sessionId;
    await this.call<unknown>({ method: 'POST', path: '/dream', body });
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
    await this.call<unknown>({
      method: 'POST',
      path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
      body,
    });
  }

  async listSessionMessages(
    sessionId: string,
    options?: { size?: number; peerId?: string },
  ): Promise<HonchoSessionMessageList> {
    const query: Record<string, string | number> = {};
    if (options?.size !== undefined) query['size'] = options.size;
    if (options?.peerId) query['peer_id'] = options.peerId;
    const page = await this.call<ApiPage<ApiMessage>>({
      method: 'GET',
      path: `/sessions/${encodeURIComponent(sessionId)}/messages`,
      query,
    });
    return {
      items: page.items.map(toMessage),
      total: page.total ?? 0,
      page: page.page ?? 1,
      size: page.size ?? 0,
    };
  }

  private requireSession() {
    const c = this.auth.credentials();
    if (!c) throw new ApiError('Not authenticated', 401);
    return c;
  }

  private requireProfile(): string {
    const id = this.profile.activeProfileId();
    if (!id) {
      throw new ApiError('No active profile. Create or select a profile first.', 0);
    }
    return id;
  }

  /**
   * Thin wrapper over `ApiClient.request` that always sends the active
   * profile id. Throws via `requireSession`/`requireProfile` first so
   * the caller fails fast with a clear message before any network I/O.
   */
  private call<T>(opts: CallOpts): Promise<T> {
    this.requireSession();
    this.requireProfile();
    return this.api.request<T>({ ...opts, profileId: this.profile.activeProfileId() ?? undefined });
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
    const page = await this.call<ApiPage<ApiPeer>>({ method: 'GET', path: '/peers' });
    const peers = page.items.map((p) => ({
      id: p.id,
      createdAt: (p as any).createdAt ?? p.created_at,
      metadata: p.metadata ?? {},
    }));
    this._peers.set(peers);
    return peers;
  }

  private async refreshSessionsInternal(): Promise<HonchoSessionSummary[]> {
    const page = await this.call<ApiPage<ApiSession>>({ method: 'GET', path: '/sessions' });
    const sessions = page.items.map((s) => ({
      id: s.id,
      peerIds: [],
      createdAt: (s as any).createdAt ?? s.created_at,
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

  private writeCache(
    profileId: string,
    payload: { peers: HonchoPeerSummary[]; sessions: HonchoSessionSummary[] },
  ): void {
    try {
      localStorage.setItem(this.cacheKey(profileId), JSON.stringify(payload));
    } catch {
      return;
    }
  }

  private persistCache(): void {
    const id = this.profile.activeProfileId();
    if (!id || typeof localStorage === 'undefined') return;
    this.writeCache(id, { peers: this._peers(), sessions: this._sessions() });
  }

  friendlyErrorMessage(e: unknown): string {
    if (e instanceof ApiError) {
      return e.friendlyMessage({
        baseUrl: this.profile.activeProfile()?.baseUrl,
      });
    }
    return formatError(e);
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
    createdAt: (api as any).createdAt ?? api.created_at ?? '',
    raw: api,
  };
}

function toConfig(api: ApiWorkspaceConfig | null | undefined): HonchoWorkspaceConfig {
  if (!api) {
    return {
      reasoning: { enabled: null },
      peerCard: { create: null },
      summary: { enabled: null },
      dream: { enabled: null },
    };
  }
  const peerCardConfig = (api as any).peerCard ?? api.peer_card;
  return {
    reasoning: { enabled: api.reasoning?.enabled ?? null },
    peerCard: { create: peerCardConfig?.create ?? null },
    summary: { enabled: api.summary?.enabled ?? null },
    dream: { enabled: api.dream?.enabled ?? null },
  };
}

function toQueueStatus(api: ApiQueueStatus | null | undefined): HonchoQueueStatus {
  if (!api) return emptyQueue();
  return {
    totalWorkUnits: (api as any).totalWorkUnits ?? api.total_work_units ?? 0,
    completedWorkUnits: (api as any).completedWorkUnits ?? api.completed_work_units ?? 0,
    inProgressWorkUnits: (api as any).inProgressWorkUnits ?? api.in_progress_work_units ?? 0,
    pendingWorkUnits: (api as any).pendingWorkUnits ?? api.pending_work_units ?? 0,
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
    observerId: (api as any).observerId ?? api.observer_id ?? '',
    observedId: (api as any).observedId ?? api.observed_id ?? '',
    sessionId: (api as any).sessionId ?? api.session_id ?? null,
    createdAt: (api as any).createdAt ?? api.created_at ?? '',
  };
}

function toMessage(api: ApiMessage): HonchoMessage {
  return {
    id: api.id,
    peerId: (api as any).peerId ?? api.peer_id ?? '',
    content: api.content,
    sessionId: (api as any).sessionId ?? api.session_id ?? '',
    createdAt: (api as any).createdAt ?? api.created_at ?? '',
    metadata: api.metadata ?? {},
  };
}

function toSummaries(
  sessionId: string,
  api: ApiSessionSummaries,
): {
  id: string;
  shortSummary: {
    content: string;
    messageId: string;
    summaryType: 'short';
    createdAt: string;
    tokenCount: number;
  } | null;
  longSummary: {
    content: string;
    messageId: string;
    summaryType: 'long';
    createdAt: string;
    tokenCount: number;
  } | null;
} {
  const short = (api as any).shortSummary ?? api.short_summary;
  const long = (api as any).longSummary ?? api.long_summary;
  return {
    id: sessionId,
    shortSummary: short
      ? {
          content: short.content,
          messageId: '',
          summaryType: 'short',
          createdAt: short.createdAt ?? short.created_at ?? '',
          tokenCount: 0,
        }
      : null,
    longSummary: long
      ? {
          content: long.content,
          messageId: '',
          summaryType: 'long',
          createdAt: long.createdAt ?? long.created_at ?? '',
          tokenCount: 0,
        }
      : null,
  };
}
