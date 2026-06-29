import { snakeToCamel, ApiError, ApiClient } from './api-client';
import { HonchoAuthService } from './honcho-auth.service';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core';

describe('snakeToCamel', () => {
  it('passes primitives through unchanged', () => {
    expect(snakeToCamel('hello')).toBe('hello');
    expect(snakeToCamel(42)).toBe(42);
    expect(snakeToCamel(true)).toBe(true);
    expect(snakeToCamel(null)).toBeNull();
    expect(snakeToCamel(undefined)).toBeUndefined();
  });

  it('converts a single snake_case key', () => {
    expect(snakeToCamel({ users_total: 5 })).toEqual({ usersTotal: 5 });
    expect(snakeToCamel({ first_run: true })).toEqual({ firstRun: true });
  });

  it('converts nested objects recursively', () => {
    expect(
      snakeToCamel({
        users_total: 1,
        audit_log: {
          rows_total: 0,
          generated_at: '2026-01-01T00:00:00Z',
        },
      }),
    ).toEqual({
      usersTotal: 1,
      auditLog: {
        rowsTotal: 0,
        generatedAt: '2026-01-01T00:00:00Z',
      },
    });
  });

  it('walks arrays element-wise', () => {
    expect(snakeToCamel({ items: [{ created_at: 'a' }, { created_at: 'b' }] })).toEqual({
      items: [{ createdAt: 'a' }, { createdAt: 'b' }],
    });
  });

  it('leaves already-camelCase keys alone', () => {
    expect(snakeToCamel({ alreadyCamel: 'x', count42: 1 })).toEqual({
      alreadyCamel: 'x',
      count42: 1,
    });
  });

  it('handles an empty object and empty array', () => {
    expect(snakeToCamel({})).toEqual({});
    expect(snakeToCamel([])).toEqual([]);
  });

  it('handles a backend-shaped AdminDashboardOverview payload', () => {
    expect(
      snakeToCamel({
        users_total: 1,
        users_admins: 1,
        users_last7d: 1,
        users_last30d: 1,
        profiles_total: 1,
        audit_total: 0,
        audit_last30d: 0,
        generated_at: '2026-06-25T16:25:06Z',
      }),
    ).toEqual({
      usersTotal: 1,
      usersAdmins: 1,
      usersLast7d: 1,
      usersLast30d: 1,
      profilesTotal: 1,
      auditTotal: 0,
      auditLast30d: 0,
      generatedAt: '2026-06-25T16:25:06Z',
    });
  });

  it('does not double-convert already-camelCase keys mixed with snake keys', () => {
    // Mixed: ensure both shapes survive the same recursion pass.
    expect(
      snakeToCamel({
        user_count: 3,
        sessionCount: 7,
        nested: { node_id: 'n1', parentId: 'p1' },
      }),
    ).toEqual({
      userCount: 3,
      sessionCount: 7,
      nested: { nodeId: 'n1', parentId: 'p1' },
    });
  });
});

describe('ApiClient 401 session-expired flow', () => {
  // The api-client's contract: on a 401 from a non-anonymous,
  // non-logout call, it must (a) call HonchoAuthService.localLogout
  // to clear the stale local session, (b) emit on the
  // sessionExpiredSignal so the App component can route the user
  // to /login?reason=expired, and (c) still throw the original
  // ApiError so any per-call try/catch in the consumer sees the
  // failure (the router subscription is in ADDITION to the throw,
  // not a replacement).
  let auth: HonchoAuthService;
  let client: ApiClient;
  let logoutSpy: ReturnType<typeof vi.spyOn>;
  let signalSpy: ReturnType<typeof vi.fn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    auth = TestBed.inject(HonchoAuthService);
    client = TestBed.inject(ApiClient);
    logoutSpy = vi.spyOn(auth, 'localLogout');
    signalSpy = vi.fn();
    auth.sessionExpiredSignal.subscribe({ next: signalSpy } as any);
    // Seed a fake local session so the request attempts to send
    // X-Session-Id (the 401 detection path only triggers on
    // non-anonymous calls).
    (auth as any)._credentials.set({
      sessionId: 'sess-stale',
      user: { id: 'u-1', username: 'admin', isAdmin: true, createdAt: 'x' },
    });
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('signals the auth service and clears local state on a 401 from a protected call', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid username or password' }), { status: 401 }),
    );
    await expect(client.request({ method: 'GET', path: '/peers' })).rejects.toThrow(ApiError);
    expect(logoutSpy).toHaveBeenCalledTimes(1);
    expect(signalSpy).toHaveBeenCalledTimes(1);
  });

  it('does not signal on a 401 from an anonymous call (login form)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid username or password' }), { status: 401 }),
    );
    await expect(
      client.request({ method: 'POST', path: '/auth/login', body: { username: 'x', password: 'y' }, anonymous: true }),
    ).rejects.toThrow(ApiError);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(signalSpy).not.toHaveBeenCalled();
  });

  it('does not signal on a 401 from /auth/logout (the user is signing out, that IS the goal)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'invalid username or password' }), { status: 401 }),
    );
    await expect(
      client.request({ method: 'POST', path: '/auth/logout', anonymous: true }),
    ).rejects.toThrow(ApiError);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(signalSpy).not.toHaveBeenCalled();
  });

  it('does not signal on a 4xx that is not 401', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'not found' }), { status: 404 }),
    );
    await expect(client.request({ method: 'GET', path: '/peers/nonexistent' })).rejects.toThrow(ApiError);
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(signalSpy).not.toHaveBeenCalled();
  });

  it('does not signal on a 2xx (success path is not session-expired)', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    );
    const out = await client.request<{ ok: boolean }>({ method: 'GET', path: '/peers' });
    expect(out).toEqual({ ok: true });
    expect(logoutSpy).not.toHaveBeenCalled();
    expect(signalSpy).not.toHaveBeenCalled();
  });
});
