import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, type CanActivateFn } from '@angular/router';
import { adminGuard } from './admin.guard';
import { HonchoAuthService } from '../core/honcho-auth.service';

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

async function login(auth: HonchoAuthService, isAdmin: boolean) {
  installFetch((p) => {
    if (p === '/api/auth/login') {
      return jsonResponse({
        sessionId: 'sess-admin',
        user: { id: 'u-1', username: 'alice', isAdmin, createdAt: '' },
      });
    }
    return jsonResponse({});
  });
  await auth.login({ username: 'alice', password: 'passw0rd' });
}

describe('adminGuard', () => {
  let executeGuard: CanActivateFn;
  let auth: HonchoAuthService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(HonchoAuthService);
    router = TestBed.inject(Router);
    executeGuard = (...params) => TestBed.runInInjectionContext(() => adminGuard(...params));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should redirect to / when user is not authenticated', async () => {
    const result = await executeGuard({} as never, {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('should redirect to / when user is authenticated but not admin', async () => {
    await login(auth, false);
    const result = await executeGuard({} as never, {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('should allow navigation when user is authenticated and admin', async () => {
    await login(auth, true);
    const result = await executeGuard({} as never, {} as never);
    expect(result).toBe(true);
  });
});
