import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatPanel } from './chat-panel';
import { HonchoService } from '../../core/honcho.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { Profile } from '../../core/models';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
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

async function loginAndInit() {
  localStorage.setItem('honcho-credentials', JSON.stringify({ sessionId: 'sess-abc', user: USER }));
  localStorage.setItem('honcho-active-profile', JSON.stringify(PROFILE.id));
}

describe('ChatPanel', () => {
  let fixture: ComponentFixture<ChatPanel>;
  let component: ChatPanel;
  let honcho: HonchoService;
  let auth: HonchoAuthService;
  let profiles: ProfileService;

  beforeEach(async () => {
    localStorage.clear();
    await loginAndInit();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ChatPanel],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    honcho = TestBed.inject(HonchoService);
    profiles = TestBed.inject(ProfileService);
    fixture = TestBed.createComponent(ChatPanel);
    component = fixture.componentInstance;
    component.peerId = 'alice';
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('should have an empty input value initially', () => {
    expect(component.inputValue()).toBe('');
  });

  it('should update input value signal as user types', () => {
    component.inputValue.set('hello world');
    expect(component.inputValue()).toBe('hello world');
  });

  it('should disable send when input is empty', () => {
    component.inputValue.set('');
    expect(component.canSend()).toBe(false);
  });

  it('should enable send when input is non-empty', () => {
    component.inputValue.set('tell me about yourself');
    expect(component.canSend()).toBe(true);
  });

  it('should disable send while waiting for a reply', () => {
    component.inputValue.set('hi');
    component.busy.set(true);
    expect(component.canSend()).toBe(false);
  });

  it('should call /api/peers/{id}/chat on send and append a user + assistant turn', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('mock reply for alice'));
    component.inputValue.set('hi alice');
    await component.send();
    expect(component.turns().length).toBe(2);
    expect(component.turns()[0]!.role).toBe('user');
    expect(component.turns()[0]!.content).toBe('hi alice');
    expect(component.turns()[1]!.role).toBe('assistant');
    expect(component.turns()[1]!.content).toBe('mock reply for alice');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/peers/alice/chat'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('should include X-Session-Id AND X-Honcho-Profile-Id in chat requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse('mock reply'));
    component.inputValue.set('hi');
    await component.send();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.headers).toMatchObject({
      'X-Session-Id': 'sess-abc',
      'X-Honcho-Profile-Id': 'p-a',
    });
  });

  it('should clear the input after a successful send', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse('reply'));
    component.inputValue.set('hi');
    await component.send();
    expect(component.inputValue()).toBe('');
  });

  it('should surface the honcho error in the error signal when chat fails (not as a turn)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ error: 'nope' }, 502));
    component.inputValue.set('hi');
    await component.send();
    expect(component.turns().length).toBe(1);
    expect(component.turns()[0]!.role).toBe('user');
    expect(component.error()).toContain('server error');
  });

  it('should clear the turns when peerId changes', () => {
    component.inputValue.set('hi');
    component.peerId = 'bob';
    component.ngOnChanges();
    expect(component.turns().length).toBe(0);
  });
});
