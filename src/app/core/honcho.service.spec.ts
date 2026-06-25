import { TestBed } from '@angular/core/testing';
import { ApiError } from './api-client';
import { HonchoAuthService } from './honcho-auth.service';
import { ProfileService } from './profile.service';
import { HonchoService } from './honcho.service';
import { Profile } from './models';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const s = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  return s.replace(/^https?:\/\/[^/]+/, '');
}

const USER = { id: 'u1', username: 'alice', isAdmin: true, createdAt: '2026-01-01T00:00:00Z' };
const PROFILE: Profile = {
  id: 'profile-1',
  userId: 'u1',
  label: 'Personal',
  apiKeyEncrypted: 'ZmFrZQ==',
  baseUrl: 'https://mcp.honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function installFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    return Promise.resolve(handler(pathOf(input), init));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

async function login(auth: HonchoAuthService) {
  globalThis.fetch = vi
    .fn()
    .mockResolvedValue(
      jsonResponse({ sessionId: 'sess-abc', user: USER }),
    ) as unknown as typeof fetch;
  await auth.login({ username: 'alice', password: 'passw0rd' });
}

function seedProfile(profile: ProfileService) {
  // Skip the network call: install fetch that handles /api/profiles and set active manually.
  installFetch((path) => {
    if (path === '/api/profiles') return jsonResponse([PROFILE]);
    return jsonResponse({});
  });
  return profile.list().then(() => {
    profile.setActive(PROFILE.id);
  });
}

describe('HonchoService', () => {
  let service: HonchoService;
  let auth: HonchoAuthService;
  let profiles: ProfileService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(HonchoAuthService);
    profiles = TestBed.inject(ProfileService);
    service = TestBed.inject(HonchoService);
    await login(auth);
    await seedProfile(profiles);
  });

  it('should be ready when authenticated AND an active profile is set', () => {
    expect(service.isReady()).toBe(true);
  });

  it('should throw a clear error on init when no active profile', async () => {
    profiles.setActive(null);
    await expect(service.init()).rejects.toThrow(/active profile/);
  });

  it('should send X-Session-Id AND X-Honcho-Profile-Id on every request', async () => {
    const spy = installFetch((path) => {
      expect(path).toBe('/api/peers');
      return jsonResponse({ items: [] });
    });
    await service.refreshPeers();
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      'X-Session-Id': 'sess-abc',
      'X-Honcho-Profile-Id': 'profile-1',
    });
  });

  it('should map snake_case peers response to camelCase model', async () => {
    installFetch(() =>
      jsonResponse({
        items: [{ id: 'alice', created_at: '2024-01-01T00:00:00Z', metadata: { source: 'test' } }],
      }),
    );
    await service.refreshPeers();
    expect(service.peers().length).toBe(1);
    expect(service.peers()[0]).toEqual({
      id: 'alice',
      createdAt: '2024-01-01T00:00:00Z',
      metadata: { source: 'test' },
    });
  });

  it('should map snake_case sessions response to camelCase model', async () => {
    installFetch(() => jsonResponse({ items: [{ id: 's1', created_at: '2024-02-02T00:00:00Z' }] }));
    await service.refreshSessions();
    expect(service.sessions()[0]).toEqual({
      id: 's1',
      peerIds: [],
      createdAt: '2024-02-02T00:00:00Z',
    });
  });

  it('should map snake_case queue response to camelCase model', async () => {
    installFetch(() =>
      jsonResponse({
        total_work_units: 5,
        completed_work_units: 1,
        in_progress_work_units: 2,
        pending_work_units: 2,
      }),
    );
    await service.refreshQueueStatus();
    expect(service.queueStatus()).toEqual({
      totalWorkUnits: 5,
      completedWorkUnits: 1,
      inProgressWorkUnits: 2,
      pendingWorkUnits: 2,
    });
  });

  it('should call POST /api/peers when getOrCreatePeer is called', async () => {
    const spy = installFetch((path, init) => {
      expect(path).toBe('/api/peers');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body as string)).toEqual({ id: 'new-peer' });
      return jsonResponse({ id: 'new-peer' });
    });
    await service.getOrCreatePeer('new-peer');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should call POST /api/sessions/{id}/messages with peer_id', async () => {
    const spy = installFetch((path, init) => {
      expect(path).toBe('/api/sessions/s1/messages');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init!.body as string);
      expect(body.messages[0]).toMatchObject({ peer_id: 'alice', content: 'hello' });
      return jsonResponse({});
    });
    await service.sendMessage('s1', 'alice', 'hello');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should call POST /api/peers/{id}/chat with the query', async () => {
    const spy = installFetch((path, init) => {
      expect(path).toBe('/api/peers/alice/chat');
      expect(JSON.parse(init!.body as string).query).toBe('what do you know about me?');
      return jsonResponse('reply text');
    });
    const reply = await service.chat('alice', 'what do you know about me?');
    expect(reply).toBe('reply text');
  });

  it('should call POST /api/dream with observer + observed + session', async () => {
    const spy = installFetch((path, init) => {
      expect(path).toBe('/api/dream');
      const body = JSON.parse(init!.body as string);
      expect(body).toEqual({ observer: 'alice', observed: 'bob', session: 's1' });
      return jsonResponse({});
    });
    await service.scheduleDream('alice', 'bob', 's1');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  describe('localStorage persistence (per profile)', () => {
    it('should persist peers to localStorage under honcho-cache-{profileId}', async () => {
      installFetch(() =>
        jsonResponse({ items: [{ id: 'alice', created_at: '2024-01-01', metadata: {} }] }),
      );
      await service.refreshPeers();
      const raw = localStorage.getItem('honcho-cache-profile-1');
      expect(raw).toBeTruthy();
      const parsed = JSON.parse(raw!);
      expect(parsed.peers.length).toBe(1);
      expect(parsed.peers[0].id).toBe('alice');
    });

    it('should load peers from localStorage on init', async () => {
      localStorage.setItem(
        'honcho-cache-profile-1',
        JSON.stringify({
          peers: [{ id: 'cached-peer', createdAt: '', metadata: {} }],
          sessions: [],
        }),
      );
      await service.init();
      expect(service.peers()[0]?.id).toBe('cached-peer');
    });

    it('should keep cached peers visible when refreshPeers fails', async () => {
      localStorage.setItem(
        'honcho-cache-profile-1',
        JSON.stringify({ peers: [{ id: 'cached', createdAt: '', metadata: {} }], sessions: [] }),
      );
      await service.init();
      installFetch(() => Promise.resolve(jsonResponse({ error: 'boom' }, 502)));
      await service.refreshPeers();
      expect(service.peers()[0]?.id).toBe('cached');
      expect(service.error()).toBeTruthy();
    });

    it('should clear the cache on reset()', async () => {
      installFetch(() => jsonResponse({ items: [{ id: 'a', created_at: '', metadata: {} }] }));
      await service.refreshPeers();
      expect(localStorage.getItem('honcho-cache-profile-1')).toBeTruthy();
      service.reset();
      expect(localStorage.getItem('honcho-cache-profile-1')).toBeNull();
    });

    it('should isolate cache between profiles', async () => {
      // First profile's data
      installFetch(() =>
        jsonResponse({ items: [{ id: 'p1-peer', created_at: '', metadata: {} }] }),
      );
      await service.refreshPeers();
      expect(localStorage.getItem('honcho-cache-profile-1')).toBeTruthy();
      // Switch profile → cache key should differ
      profiles.setActive('profile-2');
      installFetch(() =>
        jsonResponse({ items: [{ id: 'p2-peer', created_at: '', metadata: {} }] }),
      );
      await service.refreshPeers();
      expect(localStorage.getItem('honcho-cache-profile-2')).toBeTruthy();
      expect(JSON.parse(localStorage.getItem('honcho-cache-profile-1')!).peers[0].id).toBe(
        'p1-peer',
      );
    });
  });

  describe('freshness + stale state', () => {
    it('should expose lastRefreshedAt after a successful refresh', async () => {
      installFetch(() => jsonResponse({ items: [] }));
      const before = Date.now();
      await service.refreshPeers();
      const after = Date.now();
      const ts = service.lastRefreshedAt();
      expect(ts).not.toBeNull();
      expect(ts!).toBeGreaterThanOrEqual(before);
      expect(ts!).toBeLessThanOrEqual(after);
    });

    it('should set isStale to true after a failed refresh when peers exist', async () => {
      localStorage.setItem(
        'honcho-cache-profile-1',
        JSON.stringify({ peers: [{ id: 'cached', createdAt: '', metadata: {} }], sessions: [] }),
      );
      await service.init();
      expect(service.isStale()).toBe(false);
      installFetch(() => Promise.resolve(jsonResponse({ error: 'boom' }, 502)));
      await service.refreshPeers();
      expect(service.isStale()).toBe(true);
    });
  });

  describe('friendly error messages', () => {
    it('should map status 0 to a network-reachable error', () => {
      const msg = service.friendlyErrorMessage(new ApiError('Failed to fetch', 0));
      expect(msg).toContain('Cannot reach');
    });

    it('should map 401 / authentication errors', () => {
      expect(service.friendlyErrorMessage(new ApiError('unauthorized', 401))).toContain(
        'Authentication',
      );
    });

    it('should map 403 to authentication as well (session likely dead)', () => {
      expect(service.friendlyErrorMessage(new ApiError('forbidden', 403))).toContain(
        'Authentication',
      );
    });

    it('should map 404 / not found', () => {
      expect(service.friendlyErrorMessage(new ApiError('not found', 404))).toContain('Not found');
    });

    it('should map 429 to a rate-limit hint', () => {
      expect(service.friendlyErrorMessage(new ApiError('rate limit', 429))).toContain('Rate limit');
    });

    it('should map 5xx to a server-error hint', () => {
      expect(service.friendlyErrorMessage(new ApiError('boom', 502))).toContain('server error');
    });

    it('should fall back to plain Error.message for non-ApiError', () => {
      expect(service.friendlyErrorMessage(new Error('Some weird thing'))).toBe('Some weird thing');
    });
  });

  describe('inspectWorkspace', () => {
    it('should call /api/workspace/info and combine with peer/session counts', async () => {
      const spy = installFetch((path) => {
        if (path === '/api/workspace/info') {
          return jsonResponse({
            workspace: { id: 'default', created_at: '2024-01-01' },
            configuration: {
              reasoning: { enabled: true },
              peer_card: { create: true },
              summary: { enabled: false },
              dream: { enabled: true },
            },
            queue: {
              total_work_units: 3,
              completed_work_units: 1,
              in_progress_work_units: 1,
              pending_work_units: 1,
            },
          });
        }
        if (path === '/api/peers') {
          return jsonResponse({
            items: [
              { id: 'a', created_at: '', metadata: {} },
              { id: 'b', created_at: '', metadata: {} },
            ],
          });
        }
        if (path === '/api/sessions') {
          return jsonResponse({ items: [{ id: 's1', created_at: '' }] });
        }
        return jsonResponse({});
      });
      const ws = await service.inspectWorkspace();
      expect(ws.workspaceId).toBe('default');
      expect(ws.peerCount).toBe(2);
      expect(ws.sessionCount).toBe(1);
      expect(ws.configuration.reasoning?.enabled).toBe(true);
      expect(ws.configuration.peerCard?.create).toBe(true);
      expect(ws.configuration.summary?.enabled).toBe(false);
      expect(ws.configuration.dream?.enabled).toBe(true);
      expect(ws.queue.totalWorkUnits).toBe(3);
      expect(spy).toHaveBeenCalled();
    });
  });
});
