import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, type CanActivateFn } from '@angular/router';
import { authGuard } from './auth.guard';
import { HonchoAuthService } from '../core/honcho-auth.service';
import { ProfileService } from '../core/profile.service';
import { Profile } from '../core/models';

const USER = {
  id: 'u-1',
  username: 'alice',
  isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z',
};

const PROFILE_A: Profile = {
  id: 'p-a',
  userId: 'u-1',
  label: 'A',
  apiKeyEncrypted: 'ZW5j',
  baseUrl: 'https://honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(handler: (path: string) => Response | Promise<Response>) {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL) => {
    const s =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(s.replace(/^https?:\/\/[^/]+/, '')));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function fakeRoute(path: string) {
  return { routeConfig: { path } } as never;
}

async function login(auth: HonchoAuthService) {
  installFetch((p) => {
    if (p === '/api/auth/login') return jsonResponse({ sessionId: 'sess-1', user: USER });
    return jsonResponse({});
  });
  await auth.login({ username: 'alice', password: 'passw0rd' });
}

describe('authGuard', () => {
  let executeGuard: CanActivateFn;
  let auth: HonchoAuthService;
  let profiles: ProfileService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(HonchoAuthService);
    profiles = TestBed.inject(ProfileService);
    router = TestBed.inject(Router);
    executeGuard = (...params) => TestBed.runInInjectionContext(() => authGuard(...params));
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should redirect to /login when not authenticated', async () => {
    const result = await executeGuard(fakeRoute(''), {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('should redirect to /setup when backend reports firstRun', async () => {
    installFetch((p) => {
      if (p === '/api/health')
        return jsonResponse({ ok: true, firstRun: true, needsRegister: true });
      return jsonResponse({});
    });
    const result = await executeGuard(fakeRoute(''), {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/setup');
  });

  it('should allow /login route through even when authenticated', async () => {
    await login(auth);
    const result = await executeGuard(fakeRoute('login'), {} as never);
    expect(result).toBe(true);
  });

  it('should allow /profiles route through even when authenticated', async () => {
    await login(auth);
    const result = await executeGuard(fakeRoute('profiles'), {} as never);
    expect(result).toBe(true);
  });

  it('should allow protected route when authenticated and active profile is set', async () => {
    await login(auth);
    profiles.setActive('p-a');
    const result = await executeGuard(fakeRoute(''), {} as never);
    expect(result).toBe(true);
  });

  it('should redirect to /profiles when authenticated but no active profile', async () => {
    await login(auth);
    installFetch((p) => {
      if (p === '/api/profiles') return jsonResponse([PROFILE_A]);
      return jsonResponse({});
    });
    const result = await executeGuard(fakeRoute(''), {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/profiles');
  });

  it('should redirect to /login when authenticated but profile list fetch fails', async () => {
    await login(auth);
    installFetch((p) => {
      if (p === '/api/profiles') return jsonResponse({ error: 'boom' }, 401);
      return jsonResponse({});
    });
    const result = await executeGuard(fakeRoute(''), {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });
});
