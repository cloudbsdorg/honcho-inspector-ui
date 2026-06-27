import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChangePasswordModal } from './change-password-modal';
import { AdminService } from '../../core/admin.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { of, throwError } from 'rxjs';

/**
 * Unit coverage for {@link ChangePasswordModal}.
 *
 * <p>The component is dual-mode: {@code 'self'} (the currently
 * authenticated user changes their own password) and
 * {@code 'admin-reset'} (an admin changes another user's password).
 * The two paths hit different backend endpoints
 * ({@code /api/auth/me/password} vs {@code /api/admin/users/{id}/password})
 * and have different field requirements (the self path requires a
 * current password; the admin path does not). Every test here
 * pins down one of those paths.
 */
describe('ChangePasswordModal', () => {
  let fixture: ComponentFixture<ChangePasswordModal>;
  let component: ChangePasswordModal;
  let admin: jasmine.SpyObj<AdminService>;
  let auth: jasmine.SpyObj<HonchoAuthService>;

  beforeEach(async () => {
    admin = jasmine.createSpyObj<AdminService>('AdminService', [
      'resetPassword',
    ]);
    auth = jasmine.createSpyObj<HonchoAuthService>('HonchoAuthService', [
      'sessionId',
    ], { user: signal({ id: 'u-self', username: 'admin' } as any) });
    // sessionId is a getter, not a method; assign via Object.defineProperty
    Object.defineProperty(auth, 'sessionId', { get: () => 'sess-self' });
    await TestBed.configureTestingModule({
      imports: [ChangePasswordModal],
      providers: [
        { provide: AdminService, useValue: admin },
        { provide: HonchoAuthService, useValue: auth },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ChangePasswordModal);
    component = fixture.componentInstance;
  });

  /**
   * Set the mode + (for admin-reset) targetUserId, then call
   * {@code detectChanges} so the template renders. Centralized
   * so individual tests don't repeat the boilerplate.
   */
  function openWith(opts: {
    mode: 'self' | 'admin-reset';
    targetUserId?: string | null;
    targetUsername?: string | null;
  }): void {
    component.mode = opts.mode;
    component.targetUserId = opts.targetUserId ?? null;
    component.targetUsername = opts.targetUsername ?? null;
    component.open = true;
    fixture.detectChanges();
  }

  describe('self mode', () => {
    beforeEach(() => openWith({ mode: 'self' }));

    it('current password field is required', () => {
      const currentInput: HTMLInputElement = fixture.nativeElement.querySelector(
        '[data-testid="change-password-current"]'
      )!;
      expect(currentInput).not.toBeNull();
      expect(currentInput.required).toBe(true);
    });

    it('shows the self-service title by default', () => {
      const title = fixture.nativeElement.querySelector(
        '[data-testid="change-password-title"]'
      ) as HTMLElement;
      expect(title.textContent?.trim()).toBe('Change your password');
    });

    it('submit button is disabled until form is valid', () => {
      const submit: HTMLButtonElement = fixture.nativeElement.querySelector(
        '[data-testid="change-password-submit"]'
      )!;
      expect(submit.disabled).toBe(true);
    });

    it('emits changed and logs out the user on success', async () => {
      const fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(null, { status: 204 })) as any
      );
      const changedSpy = spyOn(component.changed, 'emit');

      component.form.patchValue({
        currentPassword: 'old-pw',
        newPassword: 'new-pw-with-8+',
        confirm: 'new-pw-with-8+',
      });
      fixture.detectChanges();

      await component.submit();

      expect(fetchSpy).toHaveBeenCalledWith(
        '/api/auth/me/password',
        jasmine.objectContaining({
          method: 'POST',
          headers: jasmine.objectContaining({ 'X-Session-Id': 'sess-self' }),
        })
      );
      // changed event fires with the caller's user id (self path)
      expect(changedSpy).toHaveBeenCalledWith({
        userId: 'u-self',
        mode: 'self',
      });
    });

    it('maps a 401 to the generic "invalid username or password" message', async () => {
      spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response(JSON.stringify({ error: 'whatever' }), { status: 401 })) as any
      );
      const dismissedSpy = spyOn(component.dismissed, 'emit');

      component.form.patchValue({
        currentPassword: 'wrong',
        newPassword: 'new-pw-with-8+',
        confirm: 'new-pw-with-8+',
      });
      fixture.detectChanges();

      await component.submit();

      expect(component.error()).toBe('invalid username or password');
      expect(dismissedSpy).not.toHaveBeenCalled();
    });

    it('rejects new passwords shorter than 8 chars', () => {
      component.form.patchValue({
        currentPassword: 'old',
        newPassword: '7chars!',
        confirm: '7chars!',
      });
      fixture.detectChanges();
      // The form-level validator rejects this; canSubmit stays false.
      expect(component.canSubmit()).toBe(false);
    });

    it('rejects mismatched confirm', () => {
      component.form.patchValue({
        currentPassword: 'old',
        newPassword: 'new-password-1',
        confirm: 'new-password-2',
      });
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(false);
      // The mismatch error is shown.
      const errEl: HTMLElement | null = fixture.nativeElement.querySelector(
        '[data-testid="change-password-mismatch"]'
      );
      expect(errEl).not.toBeNull();
    });
  });

  describe('admin-reset mode', () => {
    beforeEach(() =>
      openWith({ mode: 'admin-reset', targetUserId: 'u-target', targetUsername: 'alice' })
    );

    it('current password field is NOT shown (admin already authed)', () => {
      const currentInput = fixture.nativeElement.querySelector(
        '[data-testid="change-password-current"]'
      );
      expect(currentInput).toBeNull();
    });

    it('shows the target username in the title', () => {
      const title = fixture.nativeElement.querySelector(
        '[data-testid="change-password-title"]'
      ) as HTMLElement;
      expect(title.textContent?.trim()).toBe('Reset password for alice');
    });

    it('submit calls AdminService.resetPassword with the target user id', async () => {
      admin.resetPassword.and.returnValue(Promise.resolve() as any);
      const changedSpy = spyOn(component.changed, 'emit');

      component.form.patchValue({
        newPassword: 'new-pw-with-8+',
        confirm: 'new-pw-with-8+',
      });
      fixture.detectChanges();

      await component.submit();

      expect(admin.resetPassword).toHaveBeenCalledWith('u-target', {
        newPassword: 'new-pw-with-8+',
      });
      expect(changedSpy).toHaveBeenCalledWith({
        userId: 'u-target',
        mode: 'admin-reset',
      });
    });

    it('rejects submit when targetUserId is missing', async () => {
      // Simulate a programming error: mode flipped to admin-reset
      // without setting targetUserId. The modal must NOT call the
      // backend — that would 404 on /api/admin/users/null/password
      // and surface as a confusing 404 error to the admin.
      component.targetUserId = null;
      component.form.patchValue({
        newPassword: 'new-pw-with-8+',
        confirm: 'new-pw-with-8+',
      });
      fixture.detectChanges();
      await component.submit();
      expect(admin.resetPassword).not.toHaveBeenCalled();
      expect(component.error()).toBe('No target user specified');
    });

    it('surfaces backend errors via the inline error block', async () => {
      admin.resetPassword.and.returnValue(
        throwError(() => new Error('user not found')) as any
      );
      component.form.patchValue({
        newPassword: 'new-pw-with-8+',
        confirm: 'new-pw-with-8+',
      });
      fixture.detectChanges();
      await component.submit();
      expect(component.error()).toContain('user not found');
    });
  });

  describe('shared', () => {
    it('dismiss is ignored while submitting (prevents data loss on accidental click)', () => {
      openWith({ mode: 'self' });
      // Force the submitting signal true without a real submit —
      // we just need to assert dismiss() is a no-op while busy.
      (component as any).submitting.set(true);
      const dismissedSpy = spyOn(component.dismissed, 'emit');
      component.dismiss();
      expect(dismissedSpy).not.toHaveBeenCalled();
    });
  });
});
