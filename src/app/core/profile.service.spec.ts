import { TestBed } from '@angular/core/testing';
import { ProfileService } from './profile.service';
import { HonchoAuthService } from './honcho-auth.service';
import { Profile } from './models';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function pathOf(input: RequestInfo | URL): string {
  const s =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
  return s.replace(/^https?:\/\/[^/]+/, '');
}

function installFetch(
  handler: (path: string, init?: RequestInit) => Response | Promise<Response>,
) {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    return Promise.resolve(handler(pathOf(input), init));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const USER = { id: 'u1', username: 'alice', isAdmin: false, createdAt: '2026-01-01T00:00:00Z' };

function seedAuth() {
  localStorage.setItem(
    'honcho-credentials',
    JSON.stringify({ sessionId: 'sess-1', user: USER }),
  );
}

const SAMPLE: Profile = {
  id: 'p-1',
  userId: 'u1',
  label: 'Personal',
  apiKeyEncrypted: 'ZmFrZS1lbmNyeXB0ZWQ=',
  baseUrl: 'https://mcp.honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

describe('ProfileService', () => {
  let profiles: ProfileService;

  beforeEach(() => {
    localStorage.clear();
    seedAuth();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    profiles = TestBed.inject(ProfileService);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('list() should GET /api/profiles and populate the signal', async () => {
    installFetch((path, init) => {
      expect(path).toBe('/api/profiles');
      expect(init?.headers).toMatchObject({ 'X-Session-Id': 'sess-1' });
      return jsonResponse([SAMPLE]);
    });
    const result = await profiles.list();
    expect(result).toEqual([SAMPLE]);
    expect(profiles.profiles()).toEqual([SAMPLE]);
  });

  it('create() should POST /api/profiles, prepend to signal, and return the new profile', async () => {
    installFetch((path, init) => {
      expect(path).toBe('/api/profiles');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init!.body as string)).toEqual({
        label: 'Work',
        apiKey: 'hnc_test_key',
        baseUrl: 'https://mcp.honcho.example',
        workspaceId: 'ws-work',
        honchoUserName: 'alice',
      });
      return jsonResponse({ ...SAMPLE, id: 'p-2', label: 'Work' }, 201);
    });
    const created = await profiles.create({
      label: 'Work',
      apiKey: 'hnc_test_key',
      baseUrl: 'https://mcp.honcho.example',
      workspaceId: 'ws-work',
      honchoUserName: 'alice',
    });
    expect(created.id).toBe('p-2');
    expect(profiles.profiles()[0]!.id).toBe('p-2');
  });

  it('update() should PUT /api/profiles/{id} and replace the signal entry', async () => {
    installFetch((path) => {
      if (path === '/api/profiles') return jsonResponse([SAMPLE]);
      return jsonResponse({});
    });
    await profiles.list();
    installFetch((path, init) => {
      expect(path).toBe('/api/profiles/p-1');
      expect(init?.method).toBe('PUT');
      expect(JSON.parse(init!.body as string)).toEqual({ label: 'Renamed' });
      return jsonResponse({ ...SAMPLE, label: 'Renamed' });
    });
    const updated = await profiles.update('p-1', { label: 'Renamed' });
    expect(updated.label).toBe('Renamed');
    expect(profiles.profiles()[0]!.label).toBe('Renamed');
  });

  it('delete() should DELETE /api/profiles/{id} and remove from the signal', async () => {
    // pre-seed the signal via list call
    installFetch(() => jsonResponse([SAMPLE]));
    await profiles.list();
    installFetch((path, init) => {
      expect(path).toBe('/api/profiles/p-1');
      expect(init?.method).toBe('DELETE');
      return new Response(null, { status: 204 });
    });
    await profiles.delete('p-1');
    expect(profiles.profiles()).toEqual([]);
  });

  it('delete() should clear the active profile id when the deleted one was active', async () => {
    installFetch(() => jsonResponse([SAMPLE]));
    await profiles.list();
    profiles.setActive('p-1');
    expect(profiles.activeProfileId()).toBe('p-1');
    installFetch(() => new Response(null, { status: 204 }));
    await profiles.delete('p-1');
    expect(profiles.activeProfileId()).toBeNull();
    expect(localStorage.getItem('honcho-active-profile')).toBeNull();
  });

  it('reveal() should GET /api/profiles/{id}/reveal and return the plaintext key', async () => {
    installFetch((path) => {
      expect(path).toBe('/api/profiles/p-1/reveal');
      return jsonResponse({ profile: SAMPLE, apiKey: 'hnc_plaintext_key' });
    });
    const result = await profiles.reveal('p-1');
    expect(result.apiKey).toBe('hnc_plaintext_key');
    expect(result.profile.id).toBe('p-1');
  });

  it('testConnection() should POST /api/profiles/{id}/test and surface the result', async () => {
    installFetch((path, init) => {
      expect(path).toBe('/api/profiles/p-1/test');
      expect(init?.method).toBe('POST');
      return jsonResponse({ ok: true, message: 'reachable' });
    });
    const result = await profiles.testConnection('p-1');
    expect(result.ok).toBe(true);
    expect(result.message).toBe('reachable');
  });

  it('setActive() should update the signal and persist to localStorage', () => {
    profiles.setActive('p-1');
    expect(profiles.activeProfileId()).toBe('p-1');
    expect(localStorage.getItem('honcho-active-profile')).toBe('"p-1"');
    profiles.setActive(null);
    expect(profiles.activeProfileId()).toBeNull();
    expect(localStorage.getItem('honcho-active-profile')).toBeNull();
  });

  it('constructor should restore the active profile id from localStorage', () => {
    localStorage.setItem('honcho-active-profile', JSON.stringify('p-99'));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ProfileService);
    expect(fresh.activeProfileId()).toBe('p-99');
  });

  it('activeProfile() should return the matching profile or null', async () => {
    installFetch(() => jsonResponse([SAMPLE]));
    await profiles.list();
    expect(profiles.activeProfile()).toBeNull();
    profiles.setActive('p-1');
    expect(profiles.activeProfile()).toEqual(SAMPLE);
  });

  it('hasProfiles() should reflect the loaded list', async () => {
    expect(profiles.hasProfiles()).toBe(false);
    installFetch(() => jsonResponse([SAMPLE]));
    await profiles.list();
    expect(profiles.hasProfiles()).toBe(true);
  });
});
