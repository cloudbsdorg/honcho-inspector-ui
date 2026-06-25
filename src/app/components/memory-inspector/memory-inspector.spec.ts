import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { MemoryInspector } from './memory-inspector';
import { ApiError } from '../../core/api-client';
import { HonchoService } from '../../core/honcho.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { ThemeService } from '../../core/theme.service';
import { Profile } from '../../core/models';

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

function installFetch(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    return Promise.resolve(handler(pathOf(input), init));
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const USER = { id: 'u-1', username: 'alice', isAdmin: false, createdAt: '2026-01-01T00:00:00Z' };

const PROFILE: Profile = {
  id: 'p-a',
  userId: 'u-1',
  label: 'Personal',
  apiKeyEncrypted: 'ZW5j',
  baseUrl: 'https://honcho.example',
  workspaceId: 'default',
  honchoUserName: 'alice',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

async function bootstrapSession() {
  localStorage.setItem('honcho-credentials', JSON.stringify({ sessionId: 'sess-abc', user: USER }));
  localStorage.setItem('honcho-active-profile', JSON.stringify(PROFILE.id));
}

describe('MemoryInspector', () => {
  let fixture: ComponentFixture<MemoryInspector>;
  let component: MemoryInspector;
  let honcho: HonchoService;
  let auth: HonchoAuthService;
  let profiles: ProfileService;

  beforeEach(async () => {
    localStorage.clear();
    await bootstrapSession();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MemoryInspector],
      providers: [provideRouter([])],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    honcho = TestBed.inject(HonchoService);
    profiles = TestBed.inject(ProfileService);
    TestBed.inject(ThemeService);
    installFetch((path) => {
      if (path === '/api/profiles') return jsonResponse([PROFILE]);
      if (path === '/api/workspace/info') {
        return jsonResponse({
          workspace: { id: 'default', created_at: '2024-01-01' },
          configuration: { reasoning: { enabled: true }, peer_card: { create: true } },
          queue: {
            total_work_units: 5,
            completed_work_units: 1,
            in_progress_work_units: 2,
            pending_work_units: 2,
          },
        });
      }
      if (path === '/api/peers')
        return jsonResponse({ items: [{ id: 'alice', created_at: '', metadata: {} }] });
      if (path === '/api/sessions') return jsonResponse({ items: [] });
      if (path === '/api/queue-status') return jsonResponse({ total_work_units: 5 });
      if (path.endsWith('/card')) return jsonResponse(['fact about peer']);
      if (path.endsWith('/representation')) return jsonResponse('rep about peer');
      if (path.includes('/peers/alice/sessions')) return jsonResponse({ items: [] });
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path === '/api/dream') return jsonResponse({ ok: true });
      if (path === '/api/auth/logout') return jsonResponse({ ok: true });
      return jsonResponse({});
    });
    fixture = TestBed.createComponent(MemoryInspector);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should render the 5 tab buttons', () => {
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="tab-button"]',
    );
    expect(tabs.length).toBe(5);
  });

  it('should default to the workspace tab', () => {
    expect(component.activeTab()).toBe('workspace');
  });

  it('should switch tabs via setTab', () => {
    component.setTab('peers');
    expect(component.activeTab()).toBe('peers');
  });

  it('should load workspace info when loadWorkspace is called', async () => {
    await profiles.list();
    fixture.detectChanges();
    await component.loadWorkspace();
    expect(component.workspace()?.workspaceId).toBe('default');
  });

  it('should select a peer and populate peerDetail', async () => {
    await component.selectPeer('alice');
    expect(component.selectedPeerId()).toBe('alice');
    expect(component.peerDetail()?.id).toBe('alice');
  });

  it('should clear errors when switching tabs', () => {
    component.error.set('old error');
    component.setTab('peers');
    expect(component.error()).toBeNull();
  });

  it('should call /api/dream when triggerDream is called', async () => {
    await component.selectPeer('alice');
    installFetch(() => jsonResponse({ ok: true }));
    await component.triggerDream();
    expect(component.error()).toBeNull();
  });

  it('should expose a user-friendly error via honcho.friendlyErrorMessage', () => {
    const msg = honcho.friendlyErrorMessage(new ApiError('Failed to fetch', 0));
    expect(msg).toContain('Cannot reach');
  });

  it('should logout and clear the session', async () => {
    installFetch(() => jsonResponse({ ok: true }));
    await component.logout();
    expect(auth.credentials()).toBeNull();
  });

  it('should navigate to dashboard via goToDashboard', () => {
    const router = TestBed.inject(Router);
    const spy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    component.goToDashboard();
    expect(spy).toHaveBeenCalledWith('/');
  });

  it('should expose the active profile honchoUserName and workspaceId', async () => {
    await profiles.list();
    fixture.detectChanges();
    expect(component.workspaceId()).toBe('default');
    expect(component.honchoUserName()).toBe('alice');
    expect(component.userName()).toBe('alice');
  });

  it('should select a peer and fetch/map their sessions', async () => {
    installFetch((path) => {
      if (path.includes('/peers/alice/sessions')) {
        return jsonResponse({
          items: [{ id: 'sess-123', created_at: '2024-03-03T00:00:00Z' }],
        });
      }
      if (path.endsWith('/card')) return jsonResponse(['fact about peer']);
      if (path.endsWith('/representation')) return jsonResponse('rep about peer');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });

    await component.selectPeer('alice');
    fixture.detectChanges();

    expect(component.peerDetail()?.sessions).toEqual([
      { id: 'sess-123', peerIds: [], createdAt: '2024-03-03T00:00:00Z' },
    ]);
  });

  it('should navigate to sessions tab and select session when session button is clicked in peer details', async () => {
    installFetch((path) => {
      if (path.includes('/peers/alice/sessions')) {
        return jsonResponse({
          items: [{ id: 'sess-123', created_at: '2024-03-03T00:00:00Z' }],
        });
      }
      if (path.endsWith('/card')) return jsonResponse(['fact about peer']);
      if (path.endsWith('/representation')) return jsonResponse('rep about peer');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions/sess-123/messages')) return jsonResponse({ items: [] });
      if (path.includes('/sessions/sess-123/peers')) return jsonResponse(['alice']);
      if (path.includes('/sessions/sess-123/summaries')) return jsonResponse({});
      if (path === '/api/sessions/sess-123') return jsonResponse({ id: 'sess-123' });
      return jsonResponse({});
    });

    await component.selectPeer('alice');
    fixture.detectChanges();

    // Now switch to peers tab in the UI
    component.setTab('peers');
    fixture.detectChanges();

    // Find the session button in the html and click it
    const button = (fixture.nativeElement as HTMLElement).querySelector(
      'button[class*="font-mono"]',
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toContain('sess-123');

    button.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // Verify it changed tabs to sessions and selected sess-123
    expect(component.activeTab()).toBe('sessions');
    expect(component.selectedSessionId()).toBe('sess-123');
  });
});
