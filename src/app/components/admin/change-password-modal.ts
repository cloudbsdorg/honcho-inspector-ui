import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminService } from '../../core/admin.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { formatError } from '../../core/error-message';

/**
 * Modal for changing the currently authenticated user's own password.
 * Reachable from the Admin panel as a top-level tab; also wired
 * as the per-user "Reset pwd" action for admins changing other
 * users' passwords (in which case the {@code mode} input flips to
 * {@code 'admin-reset'} and the current-password field is hidden).
 *
 * <h2>Why one modal for both flows</h2>
 * The two flows have the same backend endpoint shape
 * ({@code currentPassword?} + {@code newPassword}) and the same
 * success/revoke behavior on the wire. Keeping them in one component
 * means the validation, error display, and post-submit state all
 * live in one place; a future tightening (e.g. password-strength
 * meter) is a single change rather than two.
 *
 * <h2>Why {@code currentPassword} is required for self, not for admin</h2>
 * Self-service: the only authentication factor we have is the password
 * itself. A stolen session cookie alone cannot lock the real user out.
 * Admin-reset: the caller is already authenticated as an admin; their
 * admin session is the authorization, not the target user's password.
 * The {@code mode} input is what gates which fields are shown.
 */
@Component({
  selector: 'app-change-password-modal',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-password-modal.html',
})
export class ChangePasswordModal {
  private readonly fb = inject(FormBuilder);
  private readonly admin = inject(AdminService);
  private readonly auth = inject(HonchoAuthService);

  /**
   * Open state. Bound from the parent's {@code [open]} so the parent
   * stays the source of truth (the modal is just a view).
   */
  @Input() open = true;
  /**
   * 'self' (default) — current user changes their own password; shows
   * a current-password field. 'admin-reset' — admin changes another
   * user's password; current-password field hidden, targetUserId required.
   */
  @Input() mode: 'self' | 'admin-reset' = 'self';
  /**
   * For {@code mode='admin-reset'}, the user whose password is being
   * reset. Required to dispatch the {@code /api/admin/users/{id}/password}
   * call. Ignored when {@code mode='self'}.
   */
  @Input() targetUserId: string | null = null;
  /**
   * Display name for the target (e.g. "alice"). Used in the header so
   * the admin knows whose password they're resetting. Ignored when
   * {@code mode='self'}.
   */
  @Input() targetUsername: string | null = null;
  /**
   * Title override. Defaults to a mode-appropriate title.
   * Set when the parent wants a custom header (e.g. "Set the bootstrap
   * admin's password on first run").
   */
  @Input() title: string | null = null;

  /**
   * Emitted when the password change succeeds. Parent should close
   * the modal and refresh the user list (for admin-reset) or
   * log the user out (for self).
   */
  @Output() changed = new EventEmitter<{ userId: string; mode: 'self' | 'admin-reset' }>();
  /**
   * Emitted when the user dismisses the modal without saving.
   * Parent should close the modal. Disabled while a submit is in
   * flight (the inline {@code submitting} signal guards this).
   */
  @Output() dismissed = new EventEmitter<void>();

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal(false);
  readonly showCurrent = signal(false);
  readonly showNew = signal(false);
  readonly showConfirm = signal(false);

  readonly form: FormGroup = this.fb.group({
    currentPassword: [''],
    newPassword: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirm: ['', [Validators.required]],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.value,
  });

  readonly isSelf = computed(() => this.mode === 'self');

  readonly titleText = computed(() => {
    if (this.title) return this.title;
    return this.isSelf() ? 'Change your password' : `Reset password for ${this.targetUsername ?? 'user'}`;
  });

  /**
    * Conditionally require the current-password field. The validators
    * are wired when the mode is 'self' and removed when 'admin-reset'
    * so an admin can reset another user's password without knowing
    * the target's current password.
    */
  syncValidators(): void {
    const currentCtrl = this.form.controls['currentPassword'];
    if (this.mode === 'self') {
      currentCtrl.setValidators([Validators.required]);
    } else {
      currentCtrl.clearValidators();
    }
    currentCtrl.updateValueAndValidity({ emitEvent: false });
  }

  readonly newPasswordLength = computed(() => {
    this.formValue();
    return (this.form.controls['newPassword'].value ?? '').length;
  });

  readonly newPasswordValid = computed(() => {
    this.formValue();
    return this.newPasswordLength() >= MIN_PASSWORD_LENGTH;
  });

  readonly passwordsMatch = computed(() => {
    this.formValue();
    const newP = this.form.controls['newPassword'].value ?? '';
    const conf = this.form.controls['confirm'].value ?? '';
    return newP !== '' && newP === conf;
  });

  readonly confirmTouched = computed(() => {
    this.formValue();
    return (this.form.controls['confirm'].value ?? '') !== '';
  });

  readonly canSubmit = computed(() => {
    this.formValue();
    if (this.submitting()) return false;
    if (!this.newPasswordValid()) return false;
    if (!this.passwordsMatch()) return false;
    if (this.isSelf() && (this.form.controls['currentPassword'].value ?? '') === '') return false;
    if (!this.isSelf() && !this.targetUserId) return false;
    return true;
  });

  /**
   * Lifecycle hook: sync the conditional current-password validator
   * (so the form knows whether the current-password field is
   * required) and reset form + clear error when the modal opens.
   * Without the reset, opening the modal for a second user after
   * a first would show the previous form's values.
   */
  ngOnChanges(): void {
    this.syncValidators();
    if (this.open) {
      this.error.set(null);
      this.success.set(false);
      this.showCurrent.set(false);
      this.showNew.set(false);
      this.showConfirm.set(false);
      this.form.reset({
        currentPassword: '',
        newPassword: '',
        confirm: '',
      });
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.passwordsMatch()) {
      this.error.set('Please complete every required field');
      return;
    }
    if (!this.isSelf() && !this.targetUserId) {
      this.error.set('No target user specified');
      return;
    }
    const v = this.form.value as {
      currentPassword: string;
      newPassword: string;
      confirm: string;
    };
    this.submitting.set(true);
    this.error.set(null);
    try {
      if (this.isSelf()) {
        // Self-service path: /api/auth/me/password. The backend
        // re-hashes, records the audit event, and revokes ALL
        // sessions (including the caller's). The parent reacts
        // to the 'changed' event by logging the user out.
        await fetch('/api/auth/me/password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': this.auth.credentials()?.sessionId ?? '',
          },
          body: JSON.stringify({
            currentPassword: v.currentPassword,
            newPassword: v.newPassword,
          }),
        }).then(async (r) => {
          if (r.status === 204) return null;
          const body = await r.json().catch(() => ({}));
          // Use the same generic error the login endpoint uses to
          // avoid leaking whether the username exists vs the
          // password is wrong. Match the backend's own message.
          if (r.status === 401) throw new Error('invalid username or password');
          throw new Error(body.error || `password change failed (${r.status})`);
        });
        this.changed.emit({ userId: this.auth.user()?.id ?? '', mode: 'self' });
      } else {
        // Admin-reset path: /api/admin/users/{id}/password. The
        // backend hashes, records the audit, and revokes all
        // sessions for the target user.
        await this.admin.resetPassword(this.targetUserId!, {
          newPassword: v.newPassword,
        });
        this.changed.emit({ userId: this.targetUserId!, mode: 'admin-reset' });
      }
      this.success.set(true);
      // Close the modal after a short delay so the user sees the
      // success state. The parent will handle the actual close
      // (and re-fetch the user list, or log out, depending on mode).
      setTimeout(() => this.dismissed.emit(), 1200);
    } catch (e) {
      this.error.set(formatError(e, 'Failed to change password'));
    } finally {
      this.submitting.set(false);
    }
  }

  dismiss(): void {
    if (this.submitting()) return;
    this.dismissed.emit();
  }
}

const MIN_PASSWORD_LENGTH = 8;
