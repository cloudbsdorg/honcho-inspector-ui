import { Component, ViewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Dashboard } from './dashboard';
import { AppHeader } from '../app-header/app-header';
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

const PROFILE_A: Profile = {
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

const PROFILE_B: Profile = {
  ...PROFILE_A,
  id: 'p-b',
  label: 'Work',
  baseUrl: 'https://mcp.work.example',
  workspaceId: 'work',
  honchoUserName: 'alice-w',
};

async function bootstrapSession() {
  localStorage.setItem('honcho-credentials', JSON.stringify({ sessionId: 'sess-abc', user: USER }));
  localStorage.setItem('honcho-active-profile', JSON.stringify(PROFILE_A.id));
}

@Component({
  standalone: true,
  imports: [AppHeader, Dashboard],
  template: `
    <app-header />
    <app-dashboard />
  `,
})
class TestHost {
  @ViewChild(Dashboard) dashboard?: Dashboard;
}

describe('Dashboard', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: Dashboard;
  let honcho: HonchoService;
  let auth: HonchoAuthService;
  let profiles: ProfileService;
  let theme: ThemeService;

  beforeEach(async () => {
    localStorage.clear();
    await bootstrapSession();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [provideRouter([])],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    honcho = TestBed.inject(HonchoService);
    profiles = TestBed.inject(ProfileService);
    theme = TestBed.inject(ThemeService);
    installFetch((path) => {
      if (path === '/api/profiles') return jsonResponse([PROFILE_A, PROFILE_B]);
      if (path === '/api/peers') {
        return jsonResponse({
          items: [
            { id: 'alice', created_at: '2024-01-01T00:00:00Z', metadata: {} },
            { id: 'bob', created_at: '2024-01-02T00:00:00Z', metadata: {} },
          ],
        });
      }
      if (path === '/api/sessions') return jsonResponse({ items: [] });
      if (path === '/api/peers/alice/card') return jsonResponse(['fact about alice']);
      if (path === '/api/peers/alice/representation') return jsonResponse('alice is cool');
      if (path === '/api/peers/bob/card') return jsonResponse(['fact about bob']);
      if (path === '/api/peers/bob/representation') return jsonResponse('bob is cool');
      return jsonResponse({});
    });
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
    component = fixture.componentInstance.dashboard!;
    await component.ready;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should render the sidebar with peer count from the backend', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Peers (2)');
  });

  it('should render the app header with the user menu trigger', () => {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      'app-user-menu [data-testid="user-menu-trigger"]',
    );
    expect(trigger).toBeTruthy();
  });

  it('should render the inspector link in the user menu', async () => {
    // Inspector nav link now lives inside the collapsed user-menu
    // dropdown. Open it via click and verify the link is present.
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="user-menu-trigger"]',
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    trigger?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    const link = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="user-menu-inspector"]',
    );
    expect(link).toBeTruthy();
  });

  it('should render the profile switcher in the app header with all loaded profiles', () => {
    const select = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="profile-switcher"]',
    ) as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.options.length).toBe(2);
  });

  it('should render the workspace overview when peers are present and no peer is selected', () => {
    const overview = (fixture.nativeElement as HTMLElement).querySelector('app-workspace-overview');
    expect(overview).toBeTruthy();
  });

  it('should show the welcome empty state when there are no peers', async () => {
    installFetch((path) => {
      if (path === '/api/profiles') return jsonResponse([PROFILE_A, PROFILE_B]);
      if (path === '/api/peers') return jsonResponse({ items: [] });
      if (path === '/api/sessions') return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    const newFixture = TestBed.createComponent(TestHost);
    newFixture.detectChanges();
    const newComponent = newFixture.componentInstance.dashboard!;
    await newComponent.ready;
    newFixture.detectChanges();
    const empty = (newFixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="empty-state"]',
    );
    expect(empty).toBeTruthy();
  });

  it('should restore the selected peer from localStorage on init', async () => {
    localStorage.setItem('honcho-dashboard-selected-peer', 'bob');
    const newFixture = TestBed.createComponent(TestHost);
    newFixture.detectChanges();
    const newComponent = newFixture.componentInstance.dashboard!;
    await newComponent.ready;
    expect(newComponent.selectedPeerId()).toBe('bob');
  });

  it('should persist the selected peer to localStorage when selectPeer is called', async () => {
    await component.selectPeer('alice');
    expect(localStorage.getItem('honcho-dashboard-selected-peer')).toBe('alice');
  });

  it('should expose a human-friendly lastRefreshLabel', () => {
    expect(component.lastRefreshLabel(Date.now() - 30_000)).toBe('30s ago');
    expect(component.lastRefreshLabel(Date.now() - 90_000)).toBe('1m ago');
    expect(component.lastRefreshLabel(Date.now() - 3_600_000)).toBe('1h ago');
    expect(component.lastRefreshLabel(Date.now() - 86_400_000)).toBe('1d ago');
    expect(component.lastRefreshLabel(Date.now())).toBe('just now');
  });

  it('should clear selectedPeerId when Workspace Overview button is clicked', async () => {
    await component.selectPeer('alice');
    fixture.detectChanges();
    expect(component.selectedPeerId()).toBe('alice');

    const button = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="workspace-overview-button"]',
    ) as HTMLButtonElement;
    expect(button).toBeTruthy();
    button.click();
    fixture.detectChanges();

    expect(component.selectedPeerId()).toBeNull();
  });

  it('should select peer when WorkspaceOverview emits peerSelected', async () => {
    expect(component.selectedPeerId()).toBeNull();
    const overviewComp = fixture.debugElement.query(
      (el) => el.name === 'app-workspace-overview',
    )?.componentInstance;
    expect(overviewComp).toBeTruthy();

    overviewComp.peerSelected.emit('bob');
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.selectedPeerId()).toBe('bob');
  });
});
