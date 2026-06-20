import { TestBed } from '@angular/core/testing';
import { HonchoAuthService } from './honcho-auth.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = {
  id: 'u-1',
  username: 'alice',
  isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('HonchoAuthService', () => {
  let auth: HonchoAuthService;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(HonchoAuthService);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('should be unauthenticated by default', () => {
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.user()).toBeNull();
  });

  it('login() should POST /api/auth/login and store { sessionId, user }', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ sessionId: 'sess-1', user: USER }),
    );
    const creds = await auth.login({ username: 'alice', password: 'passw0rd' });
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(creds.sessionId).toBe('sess-1');
    expect(creds.user.username).toBe('alice');
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.user()?.username).toBe('alice');
  });

  it('login() should reject empty username before calling the backend', async () => {
    await expect(
      auth.login({ username: '   ', password: 'passw0rd' }),
    ).rejects.toThrow(/Username is required/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('login() should reject passwords shorter than 8 chars', async () => {
    await expect(
      auth.login({ username: 'alice', password: 'short' }),
    ).rejects.toThrow(/at least 8 characters/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('login() should surface backend error messages and stay unauthenticated', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ error: 'invalid username or password' }, 401),
    );
    await expect(
      auth.login({ username: 'alice', password: 'passw0rd' }),
    ).rejects.toThrow(/invalid username or password/);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('register() should POST /api/auth/register, then call login, then store session', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(USER, 201))
      .mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-2', user: USER }));
    const creds = await auth.register({ username: 'alice', password: 'passw0rd' });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('/api/auth/register');
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('/api/auth/login');
    expect(creds.sessionId).toBe('sess-2');
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('logout() should POST /api/auth/logout with X-Session-Id and clear localStorage', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', user: USER }));
    await auth.login({ username: 'alice', password: 'passw0rd' });
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }));
    await auth.logout();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Session-Id': 'sess-1' }),
      }),
    );
    expect(auth.isAuthenticated()).toBe(false);
    expect(localStorage.getItem('honcho-credentials')).toBeNull();
  });

  it('logout() should clear localStorage even if the backend call fails', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', user: USER }));
    await auth.login({ username: 'alice', password: 'passw0rd' });
    expect(localStorage.getItem('honcho-credentials')).toBeTruthy();
    fetchSpy.mockRejectedValueOnce(new Error('network down'));
    await auth.logout();
    expect(localStorage.getItem('honcho-credentials')).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('should persist credentials to localStorage on login', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', user: USER }));
    await auth.login({ username: 'alice', password: 'passw0rd' });
    const stored = JSON.parse(localStorage.getItem('honcho-credentials')!);
    expect(stored.sessionId).toBe('sess-1');
    expect(stored.user.username).toBe('alice');
    expect(stored.password).toBeUndefined();
    expect(stored.apiKey).toBeUndefined();
  });

  it('should restore credentials from localStorage on construction', () => {
    localStorage.setItem(
      'honcho-credentials',
      JSON.stringify({ sessionId: 'restored', user: USER }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(HonchoAuthService);
    expect(fresh.credentials()?.sessionId).toBe('restored');
    expect(fresh.user()?.username).toBe('alice');
  });

  it('should ignore malformed localStorage payloads', () => {
    localStorage.setItem('honcho-credentials', '{not valid json');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(HonchoAuthService);
    expect(fresh.credentials()).toBeNull();
  });

  it('me() should GET /api/auth/me with X-Session-Id and refresh the user signal', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', user: USER }));
    await auth.login({ username: 'alice', password: 'passw0rd' });
    const updated = { ...USER, username: 'alice2' };
    fetchSpy.mockResolvedValueOnce(jsonResponse(updated));
    const me = await auth.me();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ 'X-Session-Id': 'sess-1' }),
      }),
    );
    expect(me.username).toBe('alice2');
    expect(auth.user()?.username).toBe('alice2');
  });
});
