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

describe('MemoryInspector.metadataEntries', () => {
  let component: MemoryInspector;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(MemoryInspector);
    component = fixture.componentInstance;
  });

  it('returns empty array for null/undefined input', () => {
    expect(component.metadataEntries(null)).toEqual([]);
    expect(component.metadataEntries(undefined)).toEqual([]);
  });

  it('flattens flat key/value pairs', () => {
    const out = component.metadataEntries({ source: 'fixture', version: 1 });
    expect(out).toContainEqual({ key: 'source', value: 'fixture', depth: 0 });
    expect(out).toContainEqual({ key: 'version', value: '1', depth: 0 });
  });

  it('recurses into nested objects with dotted keys', () => {
    const out = component.metadataEntries({
      owner: { name: 'mlapointe', email: 'a@b.c' },
    });
    // Only leaves are rows; intermediate objects are NOT rows (their
    // existence is encoded in the dotted key path).
    expect(out).toContainEqual({ key: 'owner.name', value: 'mlapointe', depth: 1 });
    expect(out).toContainEqual({ key: 'owner.email', value: 'a@b.c', depth: 1 });
    expect(out).toHaveLength(2);
  });

  it('handles deeply nested objects (infinite-style nesting)', () => {
    const out = component.metadataEntries({
      a: { b: { c: { d: { e: 'deep' } } } },
    });
    // 4 nested levels — but only the leaf 'e' becomes a row.
    expect(out).toContainEqual({ key: 'a.b.c.d.e', value: 'deep', depth: 4 });
    expect(out).toHaveLength(1);
  });

  it('recurses into arrays with index in key', () => {
    const out = component.metadataEntries({
      tags: ['alpha', 'beta', 'gamma'],
    });
    // Array is not a row; only the elements are.
    expect(out).toContainEqual({ key: 'tags[0]', value: 'alpha', depth: 1 });
    expect(out).toContainEqual({ key: 'tags[1]', value: 'beta', depth: 1 });
    expect(out).toContainEqual({ key: 'tags[2]', value: 'gamma', depth: 1 });
    expect(out).toHaveLength(3);
  });

  it('handles arrays of objects', () => {
    const out = component.metadataEntries({
      peers: [{ name: 'alice' }, { name: 'bob' }],
    });
    // Each array element becomes one row per leaf in that element.
    expect(out).toContainEqual({ key: 'peers[0].name', value: 'alice', depth: 2 });
    expect(out).toContainEqual({ key: 'peers[1].name', value: 'bob', depth: 2 });
    expect(out).toHaveLength(2);
  });

  it('renders null and undefined as empty value strings', () => {
    const out = component.metadataEntries({ a: null, b: undefined, c: 0, d: '' });
    expect(out).toContainEqual({ key: 'a', value: '', depth: 0 });
    expect(out).toContainEqual({ key: 'b', value: '', depth: 0 });
    expect(out).toContainEqual({ key: 'c', value: '0', depth: 0 });
    expect(out).toContainEqual({ key: 'd', value: '', depth: 0 });
  });

  it('detects cycles and renders <cycle> instead of recursing', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b', ref: a };
    a['ref'] = b; // cycle a -> b -> a
    const out = component.metadataEntries(a);
    const cycleRow = out.find((e) => e.value === '<cycle>');
    expect(cycleRow).toBeTruthy();
  });

  it('caps recursion depth at 16 levels', () => {
    // Build a 20-level chain.
    let innermost: Record<string, unknown> = { v: 'x' };
    let wrapped: Record<string, unknown> = innermost;
    for (let i = 0; i < 20; i++) {
      const next: Record<string, unknown> = { level: i };
      next['next'] = wrapped;
      wrapped = next;
    }
    const out = component.metadataEntries(wrapped);
    // Should contain at least one <depth> marker and not infinite-loop.
    expect(out.some((e) => e.value === '<depth>')).toBe(true);
  });

  it('handles empty objects and empty arrays with sentinel markers', () => {
    const out = component.metadataEntries({ empty: {}, list: [] });
    // Empty {} / [] become one sentinel row each so they're visible.
    expect(out).toContainEqual({ key: 'empty', value: '{}', depth: 0 });
    expect(out).toContainEqual({ key: 'list', value: '[]', depth: 0 });
  });

  // ----- Conclusions tab: workspace-wide default load + switch-back guard -----

  it('auto-loads the workspace top-N when the Conclusions tab opens with no peer', async () => {
    installFetch((path) => {
      if (path === '/api/conclusions') {
        return jsonResponse({
          items: [
            { id: 'wc-1', content: 'first', observer_id: 'a', observed_id: 'b', created_at: '2026-01-01T00:00:00Z' },
            { id: 'wc-2', content: 'second', observer_id: 'a', observed_id: 'b', created_at: '2026-01-02T00:00:00Z' },
          ],
          total: 200,
        });
      }
      return jsonResponse({});
    });
    await component.loadLatestConclusions();
    expect(component.selectedPeerId()).toBeNull();
    expect(component.workspaceConclusionsLoaded()).toBe(true);
    expect(component.conclusions().map((c) => c.id)).toEqual(['wc-1', 'wc-2']);
  });

  it('slices the workspace list to the configured limit (default 10)', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({
      id: `wc-${i}`,
      content: `c-${i}`,
      observer_id: 'a',
      observed_id: 'b',
      created_at: '2026-01-01T00:00:00Z',
    }));
    installFetch(() => jsonResponse({ items, total: 200 }));
    component.workspaceConclusionsLimit.set(10);
    await component.loadLatestConclusions();
    expect(component.conclusions().length).toBe(10);
    expect(component.conclusions()[0].id).toBe('wc-0');
  });

  it('onConclusionsPeerChange with empty string restores the workspace top-N', async () => {
    let callsToConclusions = 0;
    let callsToWorkspace = 0;
    installFetch((path) => {
      if (path === '/api/conclusions' && callsToWorkspace++ === 0) {
        return jsonResponse({
          items: [{ id: 'wc-1', content: 'wide', observer_id: 'a', observed_id: 'b', created_at: '2026-01-01T00:00:00Z' }],
          total: 50,
        });
      }
      if (path.includes('/peers/alice/conclusions') && callsToConclusions++ === 0) {
        return jsonResponse({
          items: [{ id: 'pc-1', content: 'peer', observer_id: 'a', observed_id: 'a', created_at: '2026-01-01T00:00:00Z' }],
          total: 5,
        });
      }
      return jsonResponse({ items: [] });
    });
    // 1) Pick alice → must hit the per-peer endpoint and populate per-peer conclusions
    await component.onConclusionsPeerChange('alice');
    expect(component.selectedPeerId()).toBe('alice');
    expect(component.conclusions().map((c) => c.id)).toEqual(['pc-1']);
    // 2) Switch back to "— latest across workspace —" → must reload workspace top-N
    await component.onConclusionsPeerChange('');
    expect(component.selectedPeerId()).toBeNull();
    expect(component.conclusions().map((c) => c.id)).toEqual(['wc-1']);
  });

  it('onConclusionsPeerChange with a non-empty peer id loads that peer (does not touch workspace endpoint)', async () => {
    let callsToWorkspace = 0;
    installFetch((path) => {
      if (path === '/api/conclusions') {
        callsToWorkspace++;
        return jsonResponse({ items: [] });
      }
      if (path.includes('/peers/bob/conclusions')) {
        return jsonResponse({
          items: [{ id: 'bc-1', content: 'bob', observer_id: 'a', observed_id: 'bob', created_at: '2026-01-01T00:00:00Z' }],
          total: 5,
        });
      }
      return jsonResponse({ items: [] });
    });
    await component.onConclusionsPeerChange('bob');
    expect(component.selectedPeerId()).toBe('bob');
    expect(component.conclusions().map((c) => c.id)).toEqual(['bc-1']);
    expect(callsToWorkspace).toBe(0);
  });

  it('setTab("conclusions") auto-loads workspace top-N on first open', async () => {
    let workspaceHits = 0;
    installFetch((path) => {
      if (path === '/api/conclusions') {
        workspaceHits++;
        return jsonResponse({ items: [], total: 0 });
      }
      return jsonResponse({ items: [] });
    });
    component.setTab('conclusions');
    await Promise.resolve();
    await Promise.resolve();
    expect(workspaceHits).toBeGreaterThanOrEqual(1);
    expect(component.workspaceConclusionsLoaded()).toBe(true);
  });
});

describe('MemoryInspector bulk + edit state', () => {
  let fixture: ComponentFixture<MemoryInspector>;
  let component: MemoryInspector;

  beforeEach(async () => {
    localStorage.clear();
    await bootstrapSession();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MemoryInspector],
      providers: [provideRouter([])],
    }).compileComponents();
    TestBed.inject(HonchoService);
    TestBed.inject(HonchoAuthService);
    TestBed.inject(ProfileService);
    TestBed.inject(ThemeService);
    installFetch(() => jsonResponse({}));
    fixture = TestBed.createComponent(MemoryInspector);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('toggleConclusionSelect adds and removes ids from the selection set', () => {
    component.toggleConclusionSelect('c-1');
    expect(component.isConclusionSelected('c-1')).toBe(true);
    component.toggleConclusionSelect('c-1');
    expect(component.isConclusionSelected('c-1')).toBe(false);
  });

  it('bulk-delete conclusions opens a destructive dialog with the correct typed confirmation', () => {
    component.selectedConclusionIds.set(new Set(['c-1', 'c-2', 'c-3']));
    component.bulkDeleteConclusions();
    const cfg = component.destructiveDialog();
    expect(cfg).toBeTruthy();
    expect(cfg?.dangerLevel).toBe('high');
    expect(cfg?.typedConfirmation).toBe('delete 3 conclusions');
    expect(cfg?.title).toContain('3');
  });

  it('delete-one conclusion uses the medium danger level and typed "delete conclusion"', () => {
    component.deleteOneConclusion('c-1');
    const cfg = component.destructiveDialog();
    expect(cfg?.dangerLevel).toBe('medium');
    expect(cfg?.typedConfirmation).toBe('delete conclusion');
  });

  it('confirming the destructive dialog clears the dialog payload and runs the callback', async () => {
    let ran = false;
    component.askDestructive({
      title: 'x',
      description: 'y',
      confirmButtonText: 'z',
      dangerLevel: 'low',
      typedConfirmation: null,
      onConfirm: () => {
        ran = true;
      },
    });
    expect(component.destructiveDialog()).not.toBeNull();
    component.onDestructiveConfirmed();
    expect(component.destructiveDialog()).toBeNull();
    expect(ran).toBe(true);
  });

  it('cancelling the destructive dialog clears the payload without running the callback', () => {
    let ran = false;
    component.askDestructive({
      title: 'x',
      description: 'y',
      confirmButtonText: 'z',
      dangerLevel: 'low',
      typedConfirmation: null,
      onConfirm: () => {
        ran = true;
      },
    });
    component.onDestructiveCancelled();
    expect(component.destructiveDialog()).toBeNull();
    expect(ran).toBe(false);
  });

  it('peerCardDirty is true when a draft row differs from the server, false when identical', async () => {
    installFetch((path) => {
      if (path.endsWith('/card')) return jsonResponse(['fact one', 'fact two']);
      if (path.endsWith('/representation')) return jsonResponse('');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    await component.selectPeer('alice');
    expect(component.peerCardDirty()).toBe(false);
    component.startPeerCardEdit();
    expect(component.peerCardDirty()).toBe(false);
    component.updatePeerCardRow(0, 'CHANGED');
    expect(component.peerCardDirty()).toBe(true);
    component.cancelPeerCardEdit();
    expect(component.peerCardDirty()).toBe(false);
  });

  it('message edit lifecycle: startEdit → messageDraft, saveEdit clears the editor', async () => {
    let putCalls = 0;
    installFetch((path) => {
      if (path.endsWith('/card')) return jsonResponse([]);
      if (path.endsWith('/representation')) return jsonResponse('');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions/sess-123/messages') && path.includes('/m-1') && !path.includes('?')) {
        putCalls++;
        return jsonResponse({});
      }
      return jsonResponse({});
    });
    await component.selectPeer('alice');
    component.startEditMessage({
      id: 'm-1',
      peerId: 'alice',
      sessionId: 'sess-123',
      content: 'orig',
      createdAt: '',
    });
    expect(component.editingMessageId()).toBe('m-1');
    expect(component.messageDraft()).toBe('orig');
    component.messageDraft.set('edited');
    await component.saveEditMessage();
    expect(putCalls).toBe(1);
    expect(component.editingMessageId()).toBeNull();
  });

  it('toggleSessionSelect and bulkDeleteSessions shape the typed confirmation correctly', () => {
    component.toggleSessionSelect('s1');
    component.toggleSessionSelect('s2');
    component.bulkDeleteSessions();
    const cfg = component.destructiveDialog();
    expect(cfg?.dangerLevel).toBe('high');
    expect(cfg?.typedConfirmation).toBe('delete 2 sessions');
    component.clearSessionSelections();
    expect(component.selectedSessionIds().size).toBe(0);
  });

  it('deleteOneSession types the session id into the confirmation prompt', () => {
    component.deleteOneSession('sess-xyz');
    const cfg = component.destructiveDialog();
    expect(cfg?.typedConfirmation).toBe('delete session sess-xyz');
  });

  it('sessionMetadata JSON parse errors surface in sessionMetadataJsonError', () => {
    component.openEditSessionMetadata();
    component.onSessionMetadataJsonChange('not-json');
    expect(component.sessionMetadataJsonError()).toContain('invalid JSON');
  });

  it('objectEntries flattens a record to key/value pairs for the template', () => {
    const out = component.objectEntries({ a: '1', b: '2' });
    expect(out).toEqual([
      { key: 'a', value: '1' },
      { key: 'b', value: '2' },
    ]);
  });

  it('deletes a single conclusion and removes it from the live conclusions signal', async () => {
    let deleteCalls = 0;
    let refreshCalls = 0;
    const refreshedItems = [
      { id: 'c-2', content: 'keep', observer_id: 'a', observed_id: 'b', created_at: '2026-01-02T00:00:00Z' },
    ];
    installFetch((path, init) => {
      if (path === '/api/conclusions/c-1' && init?.method === 'DELETE') {
        deleteCalls++;
        return jsonResponse({ data: null, error: null, meta: null });
      }
      if (path === '/api/conclusions' && init?.method !== 'DELETE') {
        refreshCalls++;
        return jsonResponse({ items: refreshedItems, total: 1 });
      }
      return jsonResponse({ items: [] });
    });
    component.conclusions.set([
      { id: 'c-1', content: 'gone', observerId: 'a', observedId: 'b', sessionId: null, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'c-2', content: 'keep', observerId: 'a', observedId: 'b', sessionId: null, createdAt: '2026-01-02T00:00:00Z' },
    ]);
    component.deleteOneConclusion('c-1');
    expect(component.destructiveDialog()?.typedConfirmation).toBe('delete conclusion');
    await component.onDestructiveConfirmed();
    // The onConfirm closure is fire-and-forget inside the dialog
    // handler, so let any pending microtasks settle.
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    expect(deleteCalls).toBe(1);
    expect(refreshCalls).toBeGreaterThanOrEqual(1);
    expect(component.conclusions().map((c) => c.id)).toEqual(['c-2']);
    expect(component.destructiveDialog()).toBeNull();
    expect(component.error()).toBeNull();
  });

  it('deleteOneConclusion surfaces backend errors via the error signal (does not throw)', async () => {
    installFetch((path, init) => {
      if (path === '/api/conclusions/c-1' && init?.method === 'DELETE') {
        // 4xx (other than 401/403/404/429) — the api-client surfaces
        // the wrapped `error` field verbatim via ApiError.friendlyMessage.
        return jsonResponse({ error: 'cannot delete derived fact' }, 400);
      }
      return jsonResponse({ items: [] });
    });
    component.conclusions.set([
      { id: 'c-1', content: 'x', observerId: 'a', observedId: 'b', sessionId: null, createdAt: '' },
    ]);
    component.deleteOneConclusion('c-1');
    await component.onDestructiveConfirmed();
    await new Promise((r) => setTimeout(r, 0));
    await fixture.whenStable();
    expect(component.error()).toContain('cannot delete derived fact');
    // Still in the list because the delete didn't succeed.
    expect(component.conclusions().map((c) => c.id)).toEqual(['c-1']);
  });
});

// ── Dropdown empty-string guards ─────────────────────────────
//
// The Peers and Sessions tab dropdowns both have a leading
// "— select peer/session —" placeholder whose value is the empty
// string. Before these guards, picking that option fired an API
// call with an empty id (e.g. /api/peers//card), which 404'd and
// surfaced as a user-visible error in the inspector pane.
//
// These specs verify both halves of the fix:
//   - empty input clears state and never reaches the network
//   - non-empty input still does the original fetch + store

describe('MemoryInspector dropdown empty-string guards', () => {
  let fixture: ComponentFixture<MemoryInspector>;
  let component: MemoryInspector;

  beforeEach(async () => {
    localStorage.clear();
    await bootstrapSession();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MemoryInspector],
      providers: [provideRouter([])],
    }).compileComponents();
    TestBed.inject(HonchoService);
    TestBed.inject(HonchoAuthService);
    TestBed.inject(ProfileService);
    TestBed.inject(ThemeService);
    fixture = TestBed.createComponent(MemoryInspector);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('selectPeer("") clears state without calling the API', async () => {
    const fetchSpy = installFetch((path) => {
      if (path.endsWith('/card')) return jsonResponse(['fact about alice']);
      if (path.endsWith('/representation')) return jsonResponse('rep about alice');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });

    // Seed state by picking alice — exercises the happy path and
    // proves the seed actually populated peerDetail.
    await component.selectPeer('alice');
    const callsAfterAlice = fetchSpy.mock.calls.length;
    expect(component.selectedPeerId()).toBe('alice');
    expect(component.peerDetail()?.id).toBe('alice');

    // Now pick the empty placeholder — must clear state and must
    // NOT issue any new fetch calls.
    await component.selectPeer('');
    expect(component.selectedPeerId()).toBeNull();
    expect(component.peerDetail()).toBeNull();
    expect(component.error()).toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterAlice);
  });

  it('selectPeer("alice") still calls inspectPeer and stores detail', async () => {
    let inspectPeerCalls = 0;
    installFetch((path) => {
      if (path.endsWith('/card')) return jsonResponse(['fact about alice']);
      if (path.endsWith('/representation')) return jsonResponse('rep about alice');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions')) return jsonResponse({ items: [] });
      // Anything that touches /peers/alice/ counts as part of the
      // inspectPeer fan-out — track it so we can assert ≥ 1 call.
      if (path.includes('/peers/alice/')) inspectPeerCalls++;
      return jsonResponse({});
    });

    await component.selectPeer('alice');
    expect(component.selectedPeerId()).toBe('alice');
    expect(component.peerDetail()?.id).toBe('alice');
    expect(component.peerDetail()?.card).toEqual(['fact about alice']);
    expect(component.peerDetail()?.representation).toBe('rep about alice');
    expect(inspectPeerCalls).toBeGreaterThan(0);
    expect(component.error()).toBeNull();
  });

  it('selectSessionWithMessages("") clears state without calling the API', async () => {
    const fetchSpy = installFetch((path) => {
      if (path === '/api/sessions/foo') return jsonResponse({ id: 'foo' });
      if (path.includes('/sessions/foo/peers')) return jsonResponse(['alice']);
      if (path.includes('/sessions/foo/summaries')) return jsonResponse({});
      if (path.includes('/sessions/foo/messages')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });

    // Seed state by picking foo — exercises inspectSession + listSessionMessages.
    await component.selectSessionWithMessages('foo');
    const callsAfterFoo = fetchSpy.mock.calls.length;
    expect(component.selectedSessionId()).toBe('foo');
    expect(component.sessionDetail()?.id).toBe('foo');

    // Now pick the empty placeholder — must clear state and must
    // NOT issue any new fetch calls.
    await component.selectSessionWithMessages('');
    expect(component.selectedSessionId()).toBeNull();
    expect(component.sessionDetail()).toBeNull();
    expect(component.sessionMessages()).toEqual([]);
    expect(component.error()).toBeNull();
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFoo);
  });

  it('selectSessionWithMessages("foo") still calls inspectSession + listSessionMessages', async () => {
    let inspectSessionCalls = 0;
    let listMessagesCalls = 0;
    installFetch((path) => {
      if (path === '/api/sessions/foo') {
        inspectSessionCalls++;
        return jsonResponse({ id: 'foo' });
      }
      if (path.includes('/sessions/foo/peers')) return jsonResponse(['alice']);
      if (path.includes('/sessions/foo/summaries')) return jsonResponse({});
      if (path.includes('/sessions/foo/messages') && !path.includes('/m-')) {
        listMessagesCalls++;
        return jsonResponse({
          items: [
            {
              id: 'm-1',
              peer_id: 'alice',
              session_id: 'foo',
              content: 'hello',
              created_at: '2026-01-01T00:00:00Z',
            },
          ],
        });
      }
      return jsonResponse({});
    });

    await component.selectSessionWithMessages('foo');
    expect(component.selectedSessionId()).toBe('foo');
    expect(component.sessionDetail()?.id).toBe('foo');
    expect(component.sessionDetail()?.peerIds).toEqual(['alice']);
    expect(inspectSessionCalls).toBeGreaterThan(0);
    expect(listMessagesCalls).toBeGreaterThan(0);
    expect(component.sessionMessages().map((m) => m.id)).toEqual(['m-1']);
    expect(component.sessionMessages()[0].content).toBe('hello');
    expect(component.error()).toBeNull();
  });
});

describe('filterable peer/session lists (peers + sessions)', () => {
  let fixture: ComponentFixture<MemoryInspector>;
  let component: MemoryInspector;
  let honcho: HonchoService;

  const peers = Array.from({ length: 30 }, (_, i) => ({
    id: i < 5 ? `alice-${i}` : i < 10 ? `bob-${i}` : `peer-${i}`,
    createdAt: '2026-01-01T00:00:00Z',
    metadata: {},
  }));
  const sessions = Array.from({ length: 30 }, (_, i) => ({
    id: i < 5 ? `chat-${i}` : i < 10 ? `meeting-${i}` : `session-${i}`,
    peerIds: [],
    createdAt: '2026-01-01T00:00:00Z',
  }));

  function seedData() {
    const h = honcho as unknown as {
      _peers: { set: (v: typeof peers) => void };
      _sessions: { set: (v: typeof sessions) => void };
    };
    h._peers.set(peers);
    h._sessions.set(sessions);
  }

  beforeEach(async () => {
    localStorage.clear();
    await bootstrapSession();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [MemoryInspector],
      providers: [provideRouter([])],
    }).compileComponents();
    TestBed.inject(HonchoAuthService);
    TestBed.inject(ProfileService);
    TestBed.inject(ThemeService);
    honcho = TestBed.inject(HonchoService);
    installFetch(() => jsonResponse({}));
    fixture = TestBed.createComponent(MemoryInspector);
    component = fixture.componentInstance;
    seedData();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('peerSearchInput filters peers whose id contains the substring (case-insensitive)', () => {
    component.peerSearchInput.set('alice');
    fixture.detectChanges();
    const ids = component.filteredPeers().map((p) => p.id);
    expect(ids).toEqual(['alice-0', 'alice-1', 'alice-2', 'alice-3', 'alice-4']);
    expect(component.filteredPeers().length).toBe(5);
  });

  it('peerSearchInput is case-insensitive (uppercase query matches lowercase ids)', () => {
    component.peerSearchInput.set('ALICE');
    fixture.detectChanges();
    expect(component.filteredPeers().map((p) => p.id).sort()).toEqual([
      'alice-0',
      'alice-1',
      'alice-2',
      'alice-3',
      'alice-4',
    ]);
    expect(component.filteredPeers().length).toBe(5);
  });

  it('peerSearchInput empty shows all peers', () => {
    component.peerSearchInput.set('xyz-no-match');
    fixture.detectChanges();
    expect(component.filteredPeers().length).toBe(0);

    component.peerSearchInput.set('');
    fixture.detectChanges();
    expect(component.filteredPeers().length).toBe(peers.length);
    expect(component.filteredPeers()).toEqual(peers);
  });

  it('peerCurrentPage pagination: page 1 shows first 25, page 2 shows remainder, totalPages clamps overflow', () => {
    expect(component.peerTotalPages()).toBe(2);
    expect(component.pagedPeers().length).toBe(25);
    expect(component.pagedPeers()[0].id).toBe('alice-0');
    expect(component.pagedPeers()[24].id).toBe('peer-24');

    component.peerCurrentPage.set(2);
    fixture.detectChanges();
    expect(component.pagedPeers().length).toBe(5);
    expect(component.pagedPeers().map((p) => p.id)).toEqual([
      'peer-25',
      'peer-26',
      'peer-27',
      'peer-28',
      'peer-29',
    ]);

    component.peerCurrentPage.set(99);
    fixture.detectChanges();
    expect(component.pagedPeers().length).toBe(5);
  });

  it('clicking a peer card calls selectPeer with that id', async () => {
    installFetch((path) => {
      if (path.endsWith('/card')) return jsonResponse([]);
      if (path.endsWith('/representation')) return jsonResponse('');
      if (path.includes('/conclusions')) return jsonResponse({ items: [] });
      if (path.includes('/sessions')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    const selectSpy = vi.spyOn(component, 'selectPeer');
    component.setTab('peers');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '[data-testid="inspect-peer-card-alice-2"]',
    ) as HTMLButtonElement;
    expect(card).toBeTruthy();
    card.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selectSpy).toHaveBeenCalledWith('alice-2');
  });

  it('sessionSearchInput filters sessions whose id contains the substring (case-insensitive)', () => {
    component.sessionSearchInput.set('chat');
    fixture.detectChanges();
    expect(component.filteredSessions().map((s) => s.id)).toEqual([
      'chat-0',
      'chat-1',
      'chat-2',
      'chat-3',
      'chat-4',
    ]);
    expect(component.filteredSessions().length).toBe(5);
  });

  it('sessionSearchInput is case-insensitive (uppercase query matches lowercase ids)', () => {
    component.sessionSearchInput.set('CHAT');
    fixture.detectChanges();
    expect(component.filteredSessions().map((s) => s.id).sort()).toEqual([
      'chat-0',
      'chat-1',
      'chat-2',
      'chat-3',
      'chat-4',
    ]);
    expect(component.filteredSessions().length).toBe(5);
  });

  it('sessionSearchInput empty shows all sessions', () => {
    component.sessionSearchInput.set('xyz-no-match');
    fixture.detectChanges();
    expect(component.filteredSessions().length).toBe(0);

    component.sessionSearchInput.set('');
    fixture.detectChanges();
    expect(component.filteredSessions().length).toBe(sessions.length);
    expect(component.filteredSessions()).toEqual(sessions);
  });

  it('sessionCurrentPage pagination: page 1 shows first 25, page 2 shows remainder, totalPages clamps overflow', () => {
    expect(component.sessionTotalPages()).toBe(2);
    expect(component.pagedSessions().length).toBe(25);
    expect(component.pagedSessions()[0].id).toBe('chat-0');

    component.sessionCurrentPage.set(2);
    fixture.detectChanges();
    expect(component.pagedSessions().length).toBe(5);
    expect(component.pagedSessions().map((s) => s.id)).toEqual([
      'session-25',
      'session-26',
      'session-27',
      'session-28',
      'session-29',
    ]);

    component.sessionCurrentPage.set(99);
    fixture.detectChanges();
    expect(component.pagedSessions().length).toBe(5);
  });

  it('clicking a session card calls selectSessionWithMessages with that id', async () => {
    installFetch((path) => {
      if (path === '/api/sessions/chat-1') return jsonResponse({ id: 'chat-1' });
      if (path.includes('/sessions/chat-1/peers')) return jsonResponse([]);
      if (path.includes('/sessions/chat-1/summaries')) return jsonResponse({});
      if (path.includes('/sessions/chat-1/messages')) return jsonResponse({ items: [] });
      return jsonResponse({});
    });
    const selectSpy = vi.spyOn(component, 'selectSessionWithMessages');
    component.setTab('sessions');
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector(
      '[data-testid="inspect-session-card-chat-1"]',
    ) as HTMLButtonElement;
    expect(card).toBeTruthy();
    card.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(selectSpy).toHaveBeenCalledWith('chat-1');
  });
});
