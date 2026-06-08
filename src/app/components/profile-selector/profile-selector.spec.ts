import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ProfileSelector } from './profile-selector';
import { ProfileService } from '../../core/profile.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { Profile } from '../../core/models';

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

const USER = { id: 'u-1', username: 'alice', isAdmin: false, createdAt: '2026-01-01T00:00:00Z' };

const PROFILE_A: Profile = {
  id: 'p-a',
  userId: 'u-1',
  label: 'Personal',
  apiKeyEncrypted: 'ZW5j',
  baseUrl: 'https://mcp.honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const PROFILE_B: Profile = {
  ...PROFILE_A,
  id: 'p-b',
  label: 'Work',
  baseUrl: 'https://mcp.work.example',
  workspaceId: 'work',
  honchoUserName: 'alice-w',
};

describe('ProfileSelector', () => {
  let fixture: ComponentFixture<ProfileSelector>;
  let component: ProfileSelector;
  let profiles: ProfileService;
  let auth: HonchoAuthService;

  beforeEach(async () => {
    localStorage.clear();
    // Pre-seed an authenticated session so ngOnInit can load profiles.
    localStorage.setItem(
      'honcho-credentials',
      JSON.stringify({ sessionId: 'sess-1', user: USER }),
    );
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ProfileSelector],
      providers: [provideRouter([])],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    profiles = TestBed.inject(ProfileService);
    installFetch((path) => {
      if (path === '/api/profiles') return jsonResponse([PROFILE_A, PROFILE_B]);
      return jsonResponse({});
    });
    fixture = TestBed.createComponent(ProfileSelector);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should render the loaded profiles', async () => {
    await profiles.list();
    fixture.detectChanges();
    const rows = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="profile-row"]',
    );
    expect(rows.length).toBe(2);
  });

  it('should highlight the active profile with a badge', () => {
    profiles.setActive('p-a');
    fixture.detectChanges();
    const active = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="active-badge"]',
    );
    expect(active).toBeTruthy();
  });

  it('should set the active profile and navigate to the dashboard', async () => {
    profiles.setActive(null);
    fixture.detectChanges();
    const navigateSpy = vi.fn().mockResolvedValue(true);
    const router = (component as unknown as { router: { navigateByUrl: typeof navigateSpy } })
      .router;
    router.navigateByUrl = navigateSpy;
    await component.setActive(PROFILE_B);
    expect(profiles.activeProfileId()).toBe('p-b');
    expect(navigateSpy).toHaveBeenCalledWith('/');
  });

  it('should open the reveal overlay with the API key from /reveal', async () => {
    installFetch((path) => {
      if (path === '/api/profiles/p-a/reveal') {
        return jsonResponse({ profile: PROFILE_A, apiKey: 'hnc_plaintext' });
      }
      return jsonResponse({});
    });
    await component.showKey(PROFILE_A);
    expect(component.reveal()?.apiKey).toBe('hnc_plaintext');
    fixture.detectChanges();
    const overlay = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="reveal-overlay"]',
    );
    expect(overlay).toBeTruthy();
    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="reveal-key-input"]',
    );
    expect((input as HTMLInputElement | null)?.value).toBe('hnc_plaintext');
  });

  it('should call delete on the service and remove the row after confirm()', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    installFetch((path, init) => {
      if (path === '/api/profiles/p-a' && init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      return jsonResponse({});
    });
    await component.delete(PROFILE_A);
    expect(confirmSpy).toHaveBeenCalled();
    expect(profiles.profiles().find((p) => p.id === 'p-a')).toBeUndefined();
  });

  it('should NOT call delete on the service when confirm() returns false', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const before = profiles.profiles().length;
    await component.delete(PROFILE_A);
    expect(profiles.profiles().length).toBe(before);
  });

  it('should call testConnection and store the result in testResults', async () => {
    installFetch((path, init) => {
      if (path === '/api/profiles/p-a/test' && init?.method === 'POST') {
        return jsonResponse({ ok: true, message: 'reachable' });
      }
      return jsonResponse({});
    });
    await component.test(PROFILE_A);
    expect(component.testResults()['p-a']?.ok).toBe(true);
    expect(component.testResults()['p-a']?.message).toBe('reachable');
  });
});
