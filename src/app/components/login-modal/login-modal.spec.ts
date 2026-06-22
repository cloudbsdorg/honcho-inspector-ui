import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LoginModal } from './login-modal';
import { HonchoAuthService } from '../../core/honcho-auth.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const USER = {
  id: 'u-1',
  username: 'alice',
  isAdmin: false,
  createdAt: '2026-01-01T00:00:00Z',
};

describe('LoginModal', () => {
  let fixture: ComponentFixture<LoginModal>;
  let component: LoginModal;
  let auth: HonchoAuthService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [LoginModal],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    fixture = TestBed.createComponent(LoginModal);
    component = fixture.componentInstance;
    component.open = true;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('should not be visible when open is false', () => {
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const overlay = root.querySelector('[data-testid="login-overlay"]');
    expect(overlay).toBeNull();
  });

  it('should be visible when open is true', () => {
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    const overlay = root.querySelector('[data-testid="login-overlay"]');
    expect(overlay).not.toBeNull();
  });

  it('should render login username + password fields', () => {
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="login-username"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="login-password"]')).not.toBeNull();
    expect(root.querySelector('[data-testid="login-submit"]')).not.toBeNull();
  });

  it('should reject empty form and surface an error', async () => {
    await component.submit();
    expect(component.error()).toBeTruthy();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('should reject passwords shorter than 8 characters', async () => {
    component.form.patchValue({ username: 'alice', password: 'short' });
    await component.submit();
    expect(component.error()).toMatch(/at least 8 characters/);
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('should call auth.login on a valid submission and emit loggedIn', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ sessionId: 'sess-1', user: USER }));
    const loggedInSpy = vi.fn();
    component.loggedIn.subscribe(loggedInSpy);
    component.form.patchValue({ username: 'alice', password: 'passw0rd' });
    await component.submit();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('/api/auth/login');
    expect(auth.isAuthenticated()).toBe(true);
    expect(loggedInSpy).toHaveBeenCalled();
    expect(component.error()).toBeNull();
  });

  it('should surface a friendly error from auth.login on the error signal', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error: 'invalid username or password' }, 401),
    );
    component.form.patchValue({ username: 'alice', password: 'passw0rd' });
    await component.submit();
    expect(component.error()).toContain('Authentication');
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('should reset the form when re-opened', () => {
    component.form.patchValue({ username: 'alice', password: 'passw0rd' });
    fixture.componentRef.setInput('open', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(component.form.value.username).toBe('');
    expect(component.form.value.password).toBe('');
  });
});
