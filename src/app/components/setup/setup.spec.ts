import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SetupWizard } from './setup';
import { HonchoAuthService } from '../../core/honcho-auth.service';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SetupWizard', () => {
  let fixture: ComponentFixture<SetupWizard>;
  let component: SetupWizard;
  let auth: HonchoAuthService;

  beforeEach(async () => {
    localStorage.clear();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [SetupWizard],
      providers: [provideRouter([{ path: 'profiles', redirectTo: '' }])],
    }).compileComponents();
    auth = TestBed.inject(HonchoAuthService);
    fixture = TestBed.createComponent(SetupWizard);
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

  it('should start at step 1', () => {
    expect(component.step()).toBe(1);
    expect(component.canAdvance()).toBe(true);
  });

  it('should advance to step 2 via next()', () => {
    component.next();
    expect(component.step()).toBe(2);
  });

  it('should go back to step 1 from step 2 via back()', () => {
    component.next();
    expect(component.step()).toBe(2);
    component.back();
    expect(component.step()).toBe(1);
  });

  it('should not advance to step 3 from step 2 with an invalid form', () => {
    component.next();
    expect(component.step()).toBe(2);
    expect(component.canAdvance()).toBe(false);
    component.next();
    expect(component.step()).toBe(2);
  });

  it('should validate passwordsMatch and passwords check', () => {
    component.form.patchValue({
      username: 'admin',
      password: 'password123',
      confirm: 'passwordDiff',
    });
    // Trigger the signal updates
    component.form.controls['password'].updateValueAndValidity();
    component.form.controls['confirm'].updateValueAndValidity();
    fixture.detectChanges();

    expect(component.passwordsMatch()).toBe(false);
    expect(component.confirmTouched()).toBe(true);
  });

  it('should allow advancing to step 3 when passwords match and form is valid', () => {
    component.next(); // Go to step 2
    component.form.patchValue({
      username: 'admin',
      password: 'password123',
      confirm: 'password123',
    });
    // Trigger signal updates
    component.form.updateValueAndValidity();
    fixture.detectChanges();

    expect(component.passwordsMatch()).toBe(true);
    expect(component.canAdvance()).toBe(true);

    component.next(); // Go to step 3
    expect(component.step()).toBe(3);
    expect(component.canAdvance()).toBe(true);
  });

  it('should handle submit with missing field/invalid passwords', async () => {
    component.next();
    component.form.patchValue({
      username: 'admin',
      password: 'password123',
      confirm: 'mismatch',
    });
    await component.submit();
    expect(component.error()).toBe('Please complete every field');
  });

  it('should call auth.setupFirstAdmin on submit and emit completed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ sessionId: 'sess-setup', user: { id: 'u-admin', username: 'admin' } }),
      );
    const completedSpy = vi.fn();
    component.completed.subscribe(completedSpy);

    component.next(); // step 2
    component.form.patchValue({
      username: 'admin',
      password: 'password123',
      confirm: 'password123',
    });
    component.next(); // step 3

    await component.submit();

    expect(fetchSpy).toHaveBeenCalled();
    expect(auth.isAuthenticated()).toBe(true);
    expect(completedSpy).toHaveBeenCalled();
    expect(component.error()).toBeNull();
  });

  it('should handle setup failures and surface error messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Username already exists' }, 400),
    );

    component.next();
    component.form.patchValue({
      username: 'admin',
      password: 'password123',
      confirm: 'password123',
    });
    component.next();

    await component.submit();

    expect(auth.isAuthenticated()).toBe(false);
    expect(component.error()).toContain('Username already exists');
  });

  it('should reset wizard state when open input changes to true', () => {
    component.step.set(3);
    component.error.set('some error');
    component.showPassword.set(true);
    component.showConfirm.set(true);
    component.form.patchValue({ username: 'dirty' });

    // Simulate input change
    component.open = false;
    fixture.detectChanges();

    // Changing open back to true triggers ngOnChanges
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(component.step()).toBe(1);
    expect(component.error()).toBeNull();
    expect(component.showPassword()).toBe(false);
    expect(component.showConfirm()).toBe(false);
    expect(component.form.value.username).toBe('');
  });

  it('should emit dismissed on dismiss if not submitting', () => {
    const dismissedSpy = vi.fn();
    component.dismissed.subscribe(dismissedSpy);

    component.submitting.set(false);
    component.dismiss();
    expect(dismissedSpy).toHaveBeenCalled();
  });

  it('should not emit dismissed on dismiss if submitting', () => {
    const dismissedSpy = vi.fn();
    component.dismissed.subscribe(dismissedSpy);

    component.submitting.set(true);
    component.dismiss();
    expect(dismissedSpy).not.toHaveBeenCalled();
  });
});
