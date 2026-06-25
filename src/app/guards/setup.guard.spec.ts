import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, type CanActivateFn } from '@angular/router';
import { setupGuard } from './setup.guard';
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

async function login(auth: HonchoAuthService) {
  installFetch((p) => {
    if (p === '/api/auth/login') {
      return jsonResponse({
        sessionId: 'sess-setup',
        user: { id: 'u-1', username: 'alice', isAdmin: false, createdAt: '' },
      });
    }
    return jsonResponse({});
  });
  await auth.login({ username: 'alice', password: 'passw0rd' });
}

describe('setupGuard', () => {
  let executeGuard: CanActivateFn;
  let auth: HonchoAuthService;
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    auth = TestBed.inject(HonchoAuthService);
    router = TestBed.inject(Router);
    executeGuard = (...params) => TestBed.runInInjectionContext(() => setupGuard(...params));
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should redirect to / if user is already authenticated', async () => {
    await login(auth);
    const result = await executeGuard({} as never, {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/');
  });

  it('should allow navigation if user is not authenticated and backend is in firstRun state', async () => {
    installFetch((p) => {
      if (p === '/api/health') {
        return jsonResponse({ ok: true, firstRun: true, needsRegister: true });
      }
      return jsonResponse({});
    });

    const result = await executeGuard({} as never, {} as never);
    expect(result).toBe(true);
  });

  it('should redirect to /login if backend is not in firstRun state', async () => {
    installFetch((p) => {
      if (p === '/api/health') {
        return jsonResponse({ ok: true, firstRun: false, needsRegister: false });
      }
      return jsonResponse({});
    });

    const result = await executeGuard({} as never, {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('should redirect to /login if backend health check fails', async () => {
    installFetch(() => {
      throw new Error('Connection refused');
    });

    const result = await executeGuard({} as never, {} as never);
    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });
});
