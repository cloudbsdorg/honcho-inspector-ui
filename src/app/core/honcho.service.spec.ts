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
  baseUrl: 'https://honcho.example',
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

  describe('listWorkspaceConclusions', () => {
    it('should POST /api/conclusions and slice the items to the requested count', async () => {
      const spy = installFetch((path) => {
        if (path === '/api/conclusions') {
          return jsonResponse({
            items: Array.from({ length: 50 }, (_, i) => ({
              id: `wid-${i}`,
              content: `c-${i}`,
              observer_id: 'a',
              observed_id: 'b',
              created_at: '2026-01-01T00:00:00Z',
            })),
            total: 200,
            page: 1,
            size: 50,
          });
        }
        return jsonResponse({});
      });
      const result = await service.listWorkspaceConclusions(10);
      expect(result.items.length).toBe(10);
      expect(result.items[0].id).toBe('wid-0');
      expect(result.total).toBe(200);
      // Verify the path hit
      const hit = spy.mock.calls.some((c) => pathOf(c[0] as RequestInfo) === '/api/conclusions');
      expect(hit).toBe(true);
    });

    it('should default to 10 when no limit is given', async () => {
      installFetch((path) => {
        if (path === '/api/conclusions') {
          return jsonResponse({
            items: Array.from({ length: 50 }, (_, i) => ({
              id: `x-${i}`,
              content: '',
              observer_id: 'a',
              observed_id: 'b',
              created_at: '',
            })),
          });
        }
        return jsonResponse({});
      });
      const result = await service.listWorkspaceConclusions();
      expect(result.items.length).toBe(10);
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

  describe('createConclusion', () => {
    it('should POST /api/conclusions/create with the expected envelope and unwrap the first item', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/conclusions/create');
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init!.body as string);
        expect(body.conclusions).toEqual([
          {
            content: 'alice likes coffee',
            observer_id: 'alice',
            observed_id: 'bob',
            session_id: 's1',
          },
        ]);
        return jsonResponse({
          items: [
            [
              {
                id: 'new-1',
                content: 'alice likes coffee',
                observer_id: 'alice',
                observed_id: 'bob',
                session_id: 's1',
                created_at: '2026-01-01T00:00:00Z',
              },
            ],
          ],
        });
      });
      const out = await service.createConclusion('alice likes coffee', 'alice', 'bob', 's1');
      expect(out.id).toBe('new-1');
      expect(out.observerId).toBe('alice');
      expect(out.observedId).toBe('bob');
      expect(out.sessionId).toBe('s1');
      expect(spy).toHaveBeenCalled();
    });

    it('should omit session_id when not provided', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/conclusions/create');
        const body = JSON.parse(init!.body as string);
        expect(body.conclusions[0].session_id).toBeUndefined();
        return jsonResponse({
          items: [
            [
              {
                id: 'new-2',
                content: 'x',
                observer_id: 'a',
                observed_id: 'b',
                created_at: '',
              },
            ],
          ],
        });
      });
      await service.createConclusion('x', 'a', 'b');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('deleteConclusion', () => {
    it('should DELETE /api/conclusions/<id>', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/conclusions/c-99');
        expect(init?.method).toBe('DELETE');
        return jsonResponse({});
      });
      await service.deleteConclusion('c-99');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('updatePeer', () => {
    it('should PUT /api/peers/<id> with metadata body', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/peers/alice');
        expect(init?.method).toBe('PUT');
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ metadata: { foo: 'bar' } });
        return jsonResponse({});
      });
      await service.updatePeer('alice', { metadata: { foo: 'bar' } });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('updatePeerCard', () => {
    it('should PUT /api/peers/<id>/card with peer_card body', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/peers/alice/card');
        expect(init?.method).toBe('PUT');
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ peer_card: ['fact 1', 'fact 2'] });
        return jsonResponse({});
      });
      await service.updatePeerCard('alice', ['fact 1', 'fact 2']);
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('updateSession', () => {
    it('should PUT /api/sessions/<id> with metadata body', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/sessions/s1');
        expect(init?.method).toBe('PUT');
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ metadata: { foo: 'bar' } });
        return jsonResponse({});
      });
      await service.updateSession('s1', { metadata: { foo: 'bar' } });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('deleteSession', () => {
    it('should DELETE /api/sessions/<id>', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/sessions/s1');
        expect(init?.method).toBe('DELETE');
        return jsonResponse({});
      });
      await service.deleteSession('s1');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('updateMessage', () => {
    it('should PUT /api/sessions/<sid>/messages/<mid> with content body', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/sessions/s1/messages/m-99');
        expect(init?.method).toBe('PUT');
        const body = JSON.parse(init!.body as string);
        expect(body).toEqual({ content: 'edited', metadata: { tag: 'admin' } });
        return jsonResponse({});
      });
      await service.updateMessage('s1', 'm-99', {
        content: 'edited',
        metadata: { tag: 'admin' },
      });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('chatStream', () => {
    /**
     * Build a `Response` whose body is a `ReadableStream<Uint8Array>`
     * over the given SSE bytes. Mirrors what jsdom + the browser
     * expose for `fetch()` streaming responses.
     */
    function sseResponse(bytes: string, status = 200): Response {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(bytes));
          controller.close();
        },
      });
      return new Response(stream, {
        status,
        headers: {
          'Content-Type': 'text/event-stream',
        },
      });
    }

    it('should POST to /api/peers/{id}/chat/stream with json body', async () => {
      const spy = installFetch((path, init) => {
        expect(path).toBe('/api/peers/alice/chat/stream');
        expect(init?.method).toBe('POST');
        expect(JSON.parse(init!.body as string)).toEqual({ query: 'hello' });
        return sseResponse('data: {"data":{"text":"hi"},"meta":{"done":true}}\n\n');
      });
      const chunks: { text: string; done: boolean }[] = [];
      for await (const c of service.chatStream('alice', 'hello')) {
        chunks.push(c);
      }
      expect(spy).toHaveBeenCalledTimes(1);
      expect(chunks).toEqual([{ text: 'hi', done: true }]);
    });

    it('should send Content-Type: application/json and Accept: text/event-stream', async () => {
      installFetch((_path, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/json');
        expect(headers['Accept']).toBe('text/event-stream');
        return sseResponse('data: {"data":{"text":"ok"},"meta":{"done":true}}\n\n');
      });
      for await (const _c of service.chatStream('alice', 'ping')) {
        /* drain */
      }
    });

    it('should send X-Session-Id and X-Honcho-Profile-Id on the stream request', async () => {
      installFetch((_path, init) => {
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Session-Id']).toBe('sess-abc');
        expect(headers['X-Honcho-Profile-Id']).toBe('profile-1');
        return sseResponse('data: {"data":{"text":"ok"},"meta":{"done":true}}\n\n');
      });
      for await (const _c of service.chatStream('alice', 'ping')) {
        /* drain */
      }
    });

    it('should yield a chunk per data: line and assemble text incrementally', async () => {
      const payload = [
        'data: {"data":{"text":"Hello"},"meta":{"done":false}}\n\n',
        'data: {"data":{"text":", world"},"meta":{"done":false}}\n\n',
        'data: {"data":{"text":"!"},"meta":{"done":false}}\n\n',
        'data: {"data":{"text":""},"meta":{"done":true}}\n\n',
      ].join('');
      installFetch(() => sseResponse(payload));
      const chunks: { text: string; done: boolean }[] = [];
      for await (const c of service.chatStream('alice', 'go')) {
        chunks.push(c);
      }
      expect(chunks).toEqual([
        { text: 'Hello', done: false },
        { text: ', world', done: false },
        { text: '!', done: false },
        { text: '', done: true },
      ]);
      // The final done chunk ends the loop; we should not consume
      // past it even if the underlying stream stayed open.
      expect(chunks.length).toBe(4);
    });

    it('should stop yielding after the done:true sentinel', async () => {
      const payload = [
        'data: {"data":{"text":"a"},"meta":{"done":false}}\n\n',
        'data: {"data":{"text":""},"meta":{"done":true}}\n\n',
        'data: {"data":{"text":"LEAKED"},"meta":{"done":false}}\n\n',
      ].join('');
      installFetch(() => sseResponse(payload));
      const chunks: { text: string; done: boolean }[] = [];
      for await (const c of service.chatStream('alice', 'go')) {
        chunks.push(c);
      }
      const seenLeak = chunks.some((c) => c.text.includes('LEAKED'));
      expect(seenLeak).toBe(false);
      expect(chunks.at(-1)?.done).toBe(true);
    });

    it('should throw an ApiError on a non-2xx response with the envelope message', async () => {
      installFetch(() =>
        jsonResponse({ error: 'dream pipeline offline' }, 502),
      );
      await expect(async () => {
        for await (const _c of service.chatStream('alice', 'go')) {
          /* drain */
        }
      }).rejects.toMatchObject({ status: 502, message: 'dream pipeline offline' });
    });

    it('should release the reader lock when the consumer stops early', async () => {
      // Build a stream that yields a single chunk and stays open
      // until the reader is cancelled. The consumer breaks out of
      // the for-await loop right after the first chunk, which
      // exercises the finally-block reader cleanup.
      const encoder = new TextEncoder();
      let cancelCalled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"data":{"text":"first"},"meta":{"done":false}}\n\n'),
          );
          // Do not close — the consumer must cancel us.
        },
        cancel() {
          cancelCalled = true;
        },
      });
      installFetch(
        () =>
          new Response(stream, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      );
      const iter = service.chatStream('alice', 'go')[Symbol.asyncIterator]();
      const first = await iter.next();
      expect(first.value).toEqual({ text: 'first', done: false });
      // Break out without consuming the rest. The service's
      // finally block should still run reader.cancel() and the
      // underlying cancel() callback above should fire.
      await iter.return?.(undefined);
      // Give the microtask queue a chance to drain.
      await new Promise((r) => setTimeout(r, 0));
      expect(cancelCalled).toBe(true);
    });

    it('should treat an aborted fetch as a graceful no-op (no throw)', async () => {
      // Simulate the operator pressing Cancel: the consumer's
      // AbortController fires while fetch() is still resolving.
      // The service should swallow the resulting DOMException
      // and end the generator without an error.
      const ctrl = new AbortController();
      installFetch((_path, init) => {
        const signal = init?.signal as AbortSignal | undefined;
        // Fire abort on the next tick so the fetch is mid-flight.
        queueMicrotask(() => ctrl.abort());
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });
      const chunks: { text: string; done: boolean }[] = [];
      for await (const c of service.chatStream('alice', 'go', { signal: ctrl.signal })) {
        chunks.push(c);
      }
      expect(chunks).toEqual([]);
    });

    it('releases the ReadableStream reader on stream completion (regression for "already locked" error)', async () => {
      // Regression test for the failure mode where the SSE
      // parsing loop's `reader` was never released, so a SECOND
      // `chatStream` call would throw
      //   `Failed to execute 'getReader' on 'ReadableStream':
      //    ReadableStreamDefaultReader constructor can only
      //    accept readable streams that are not yet locked to
      //    a reader`
      // because the underlying body stayed locked from the first
      // call. The fix is to `reader.releaseLock()` from the
      // `finally` block of `parseSseStream` so the lock is
      // released on success, early-break, error, AND cancellation.
      //
      // Strategy: build a stream that enumerates a couple of
      // chunks then closes itself, run `chatStream` to completion
      // once, then run it again. If the lock isn't released,
      // the second call's `getReader()` will throw.
      const encoder = new TextEncoder();
      const makeStream = () =>
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"data":{"text":"first"},"meta":{"done":false}}\n\n',
              ),
            );
            controller.enqueue(
              encoder.encode(
                'data: {"data":{"text":""},"meta":{"done":true}}\n\n',
              ),
            );
            controller.close();
          },
        });
      const makeResponse = () =>
        new Response(makeStream(), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      let calls = 0;
      installFetch(() => {
        calls += 1;
        return makeResponse();
      });
      // First call: drain it fully.
      const first: { text: string; done: boolean }[] = [];
      for await (const c of service.chatStream('alice', 'go')) {
        first.push(c);
      }
      expect(calls).toBe(1);
      expect(first).toEqual([
        { text: 'first', done: false },
        { text: '', done: true },
      ]);
      // Second call: the body produced by installFetch() is a
      // brand-new ReadableStream, but if Bug B regresses and the
      // previous reader's lock is leaked onto shared state, the
      // second invocation will throw synchronously from
      // `stream.getReader()`. Drain it and assert no throw.
      const second: { text: string; done: boolean }[] = [];
      await expect(async () => {
        for await (const c of service.chatStream('alice', 'go')) {
          second.push(c);
        }
      }).not.rejects.toThrow();
      expect(calls).toBe(2);
      expect(second).toEqual([
        { text: 'first', done: false },
        { text: '', done: true },
      ]);
      // Defense-in-depth: directly probe the stream's `locked`
      // bit. Build a third stream, acquire a reader through
      // `chatStream` using a throwaway fetch handler, let it
      // complete, then assert the original stream is unlocked.
      let probed: ReadableStream<Uint8Array> | null = null;
      installFetch(() => {
        probed = makeStream();
        return new Response(probed, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      });
      for await (const _c of service.chatStream('alice', 'go')) {
        /* drain */
      }
      // If the finally block ran releaseLock, the stream must
      // no longer be locked.
      expect(probed!.locked).toBe(false);
      // And a brand-new reader can be acquired without the
      // "already locked" DOMException.
      const reader = probed!.getReader();
      reader.releaseLock();
    });
  });
});
