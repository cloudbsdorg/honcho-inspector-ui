import { TestBed } from '@angular/core/testing';
import { AdminService } from './admin.service';
import { ApiClient } from './api-client';
import { HonchoAuthService } from './honcho-auth.service';
import { ProfileService } from './profile.service';

function pathOf(input: RequestInfo | URL): string {
  const s = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const withoutOrigin = s.replace(/^https?:\/\/[^/]+/, '');
  return withoutOrigin.includes('?')
    ? withoutOrigin.slice(0, withoutOrigin.indexOf('?'))
    : withoutOrigin;
}

function queryOf(input: RequestInfo | URL): URLSearchParams {
  let raw = '';
  if (typeof input === 'string') raw = input;
  else if (input instanceof URL) raw = input.toString();
  else raw = (input as Request).url ?? '';
  const qs = raw.includes('?') ? raw.slice(raw.indexOf('?') + 1) : '';
  return new URLSearchParams(qs);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface CapturedRequest {
  path: string;
  query: URLSearchParams;
  init?: RequestInit;
}

function installFetch(handler: (req: CapturedRequest) => Response | Promise<Response>) {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    const query = queryOf(input);
    return Promise.resolve(handler({ path, query, init }));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const USER = {
  id: 'u1',
  username: 'admin',
  isAdmin: true,
  createdAt: '2026-01-01T00:00:00Z',
};

const ADMIN_PAGE = {
  items: [
    {
      id: 'u1',
      username: 'alice',
      isAdmin: false,
      disabled: false,
      createdAt: '2026-06-01T00:00:00Z',
      lastLoginAt: null,
    },
  ],
  total: 1,
  page: 0,
  size: 20,
};

async function loginAsAdmin(): Promise<void> {
  installFetch((req) => {
    if (req.path === '/api/auth/login') {
      return jsonResponse({ sessionId: 'sess-admin', user: USER });
    }
    return jsonResponse({});
  });
  const auth = TestBed.inject(HonchoAuthService);
  await auth.login({ username: 'admin', password: 'cloudbsd-admin-2026' });
}

describe('AdminService page-index conversion', () => {
  let svc: AdminService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(AdminService);
    await loginAsAdmin();
  });

  it('listUsers sends page=0 when UI asks for page=1 (zero-indexed backend)', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users');
      expect(req.query.get('page')).toBe('0');
      expect(req.query.get('pageSize')).toBe('20');
      return jsonResponse({ items: [], total: 0, page: 0, size: 20 });
    });
    await svc.listUsers({ page: 1, pageSize: 20 });
    expect(spy).toHaveBeenCalled();
  });

  it('listUsers sends page=4 when UI asks for page=5', async () => {
    const spy = installFetch((req) => {
      expect(req.query.get('page')).toBe('4');
      expect(req.query.get('pageSize')).toBe('30');
      return jsonResponse({ items: [], total: 0, page: 4, size: 30 });
    });
    await svc.listUsers({ page: 5, pageSize: 30 });
    expect(spy).toHaveBeenCalled();
  });

  it('listUsers defaults to page=0 when no page is given', async () => {
    const spy = installFetch((req) => {
      expect(req.query.get('page')).toBe('0');
      expect(req.query.get('pageSize')).toBe('20');
      return jsonResponse({ items: [], total: 0, page: 0, size: 20 });
    });
    await svc.listUsers();
    expect(spy).toHaveBeenCalled();
  });

  it('listUsers does not underflow when given page=0', async () => {
    const spy = installFetch((req) => {
      expect(req.query.get('page')).toBe('0');
      return jsonResponse({ items: [], total: 0, page: 0, size: 10 });
    });
    await svc.listUsers({ page: 0, pageSize: 10 });
    expect(spy).toHaveBeenCalled();
  });

  it('listAudit sends page=0 when UI asks for page=1', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/audit');
      expect(req.query.get('page')).toBe('0');
      expect(req.query.get('pageSize')).toBe('30');
      return jsonResponse({ items: [], total: 0, page: 0, size: 30 });
    });
    await svc.listAudit({ page: 1, pageSize: 30 });
    expect(spy).toHaveBeenCalled();
  });

  it('listAudit passes action and since filters through', async () => {
    const spy = installFetch((req) => {
      expect(req.query.get('action')).toBe('user.create');
      expect(req.query.get('since')).toBe('2026-06-01');
      expect(req.query.get('page')).toBe('1');
      return jsonResponse({ items: [], total: 0, page: 1, size: 30 });
    });
    await svc.listAudit({ action: 'user.create', since: '2026-06-01', page: 2, pageSize: 30 });
    expect(spy).toHaveBeenCalled();
  });

  it('listAudit with no opts sends page=0 and default pageSize=30', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/audit');
      expect(req.query.get('page')).toBe('0');
      expect(req.query.get('pageSize')).toBe('30');
      expect(req.query.get('action')).toBeNull();
      expect(req.query.get('since')).toBeNull();
      return jsonResponse({ items: [], total: 0, page: 0, size: 30 });
    });
    await svc.listAudit();
    expect(spy).toHaveBeenCalled();
  });

  it('overview() hits /admin/dashboard/overview and returns converted fields', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/dashboard/overview');
      expect(req.init?.method).toBe('GET');
      return jsonResponse({
        usersTotal: 0,
        usersAdmins: 0,
        usersLast7d: 0,
        usersLast30d: 0,
        profilesTotal: 0,
        auditTotal: 0,
        auditLast30d: 0,
      });
    });
    const data = await svc.overview();
    expect(data.usersTotal).toBe(0);
    expect(data.auditTotal).toBe(0);
    expect(spy).toHaveBeenCalled();
  });

  it('maintenanceStatus() hits /admin/maintenance/status', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/maintenance/status');
      expect(req.init?.method).toBe('GET');
      return jsonResponse({
        audit_rows: 0,
        audit_retention_days: 90,
        audit_max_rows: 1_000_000,
        audit_purge_cron: '0 0 3 * * *',
      });
    });
    const data = await svc.maintenanceStatus();
    expect(data.auditRows).toBe(0);
    expect(data.auditRetentionDays).toBe(90);
    expect(data.auditMaxRows).toBe(1_000_000);
    expect(data.auditPurgeCron).toBe('0 0 3 * * *');
    expect(spy).toHaveBeenCalled();
  });

  it('listUsers converts snake_case response to camelCase AdminUserPage', async () => {
    installFetch(() => jsonResponse(ADMIN_PAGE));
    const result = await svc.listUsers({ page: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      id: 'u1',
      username: 'alice',
      isAdmin: false,
    });
    expect(result.total).toBe(1);
    expect(result.page).toBe(0);
  });

  it('searchUsers hits /admin/users/search with query parameters', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/search');
      expect(req.query.get('q')).toBe('alice');
      expect(req.query.get('pageSize')).toBe('10');
      return jsonResponse(ADMIN_PAGE);
    });
    await svc.searchUsers('alice', 10);
    expect(spy).toHaveBeenCalled();
  });

  it('getUser hits /admin/users/{id}', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/u1');
      return jsonResponse(ADMIN_PAGE.items[0]);
    });
    const user = await svc.getUser('u1');
    expect(user.username).toBe('alice');
    expect(spy).toHaveBeenCalled();
  });

  it('createUser hits POST /admin/users with body', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users');
      expect(req.init?.method).toBe('POST');
      return jsonResponse(ADMIN_PAGE.items[0]);
    });
    const user = await svc.createUser({ username: 'alice', password: 'password123' });
    expect(user.username).toBe('alice');
    expect(spy).toHaveBeenCalled();
  });

  it('updateUser hits PUT /admin/users/{id} with body', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/u1');
      expect(req.init?.method).toBe('PUT');
      return jsonResponse(ADMIN_PAGE.items[0]);
    });
    const user = await svc.updateUser('u1', { username: 'bob' });
    expect(user.username).toBe('alice');
    expect(spy).toHaveBeenCalled();
  });

  it('deleteUser hits DELETE /admin/users/{id}', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/u1');
      expect(req.init?.method).toBe('DELETE');
      return jsonResponse(undefined, 204);
    });
    await svc.deleteUser('u1');
    expect(spy).toHaveBeenCalled();
  });

  it('resetPassword hits POST /admin/users/{id}/password', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/u1/password');
      expect(req.init?.method).toBe('POST');
      return jsonResponse(undefined, 204);
    });
    await svc.resetPassword('u1', { newPassword: 'password123' });
    expect(spy).toHaveBeenCalled();
  });

  it('revokeSessions hits POST /admin/users/{id}/sessions/revoke', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/users/u1/sessions/revoke');
      expect(req.init?.method).toBe('POST');
      return jsonResponse({ revoked: 5 });
    });
    const res = await svc.revokeSessions('u1');
    expect(res.revoked).toBe(5);
    expect(spy).toHaveBeenCalled();
  });

  it('purgeAudit hits POST /admin/maintenance/audit/purge', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/maintenance/audit/purge');
      expect(req.init?.method).toBe('POST');
      return jsonResponse({ deleted: 100 });
    });
    const res = await svc.purgeAudit();
    expect(res.deleted).toBe(100);
    expect(spy).toHaveBeenCalled();
  });

  it('purgeExpiredSessions hits POST /admin/maintenance/sessions/purge-expired', async () => {
    const spy = installFetch((req) => {
      expect(req.path).toBe('/api/admin/maintenance/sessions/purge-expired');
      expect(req.init?.method).toBe('POST');
      return jsonResponse({ deleted: 10 });
    });
    const res = await svc.purgeExpiredSessions();
    expect(res.deleted).toBe(10);
    expect(spy).toHaveBeenCalled();
  });
});
