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
import { formatError } from '../../core/error-message';

const MIN_PASSWORD_LENGTH = 8;

type Step = 1 | 2 | 3 | 4;

/**
 * Multi-step user-creation wizard rendered as a modal from the Admin →
 * Users tab. Models itself on {@link SetupWizard}: signal-driven step
 * state, Reactive Forms for validation, OnPush change detection.
 *
 * <h2>Steps</h2>
 * <ol>
 *   <li><strong>Welcome</strong> &mdash; explains the user-vs-admin
 *       distinction and the Honcho MCP connection the new user will
 *       sign in with. The Honcho MCP block is the same one
 *       {@code ~/.config/opencode/opencode.json} advertises (the
 *       remote Honcho MCP service the operator already uses); the
 *       wizard surfaces the X-Honcho-User-Name + JWT so the operator
 *       can confirm the new user maps onto a real Honcho identity.</li>
 *   <li><strong>Account</strong> &mdash; username + password (8+
 *       characters) + confirm-password validation.</li>
 *   <li><strong>Identity</strong> &mdash; optional firstname, lastname,
 *       and email. The MCP block follows the same convention: the
 *       Honcho workspace peer identifier is the username, so this
 *       info is for the Honcho Inspector's own records.</li>
 *   <li><strong>Role &amp; Review</strong> &mdash; choose admin or
 *       standard user, then confirm. The Honcho MCP identity is
 *       surfaced one more time so the operator can double-check
 *       before submitting.</li>
 * </ol>
 *
 * <h2>Why a modal instead of an inline form</h2>
 * Operators asked for a guided flow rather than a single 4-field
 * inline form. A modal keeps the context (the existing user list
 * stays visible in the background), and the per-step validation
 * mirrors the first-run {@code SetupWizard} so operators only have
 * to learn one flow.
 */
@Component({
  selector: 'app-user-create-wizard',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-create-wizard.html',
})
export class UserCreateWizard {
  private readonly admin = inject(AdminService);
  private readonly fb = inject(FormBuilder);

  @Input() open = true;
  @Output() completed = new EventEmitter<{ username: string; isAdmin: boolean }>();
  @Output() dismissed = new EventEmitter<void>();

  readonly step = signal<Step>(1);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirm = signal(false);
  readonly isAdmin = signal(false);

  readonly form: FormGroup = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(2)]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirm: ['', [Validators.required]],
    firstname: [''],
    lastname: [''],
    email: ['', [Validators.email]],
  });

  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.value,
  });

  readonly passwordsMatch = computed(() => {
    this.formValue();
    const password = this.form.controls['password'].value ?? '';
    const confirm = this.form.controls['confirm'].value ?? '';
    return password !== '' && password === confirm;
  });

  readonly confirmTouched = computed(() => {
    this.formValue();
    return (this.form.controls['confirm'].value ?? '') !== '';
  });

  readonly username = computed(() => (this.form.controls['username'].value ?? '').trim());
  readonly firstname = computed(() => this.form.controls['firstname'].value ?? '');
  readonly lastname = computed(() => this.form.controls['lastname'].value ?? '');
  readonly email = computed(() => this.form.controls['email'].value ?? '');

  readonly canAdvance = computed(() => {
    this.formValue();
    if (this.step() === 1) return true;
    if (this.step() === 2) {
      if (this.form.controls['username'].invalid) return false;
      if (this.form.controls['password'].invalid) return false;
      if (!this.passwordsMatch()) return false;
      return true;
    }
    if (this.step() === 3) {
      // Email is optional but must be syntactically valid when present.
      const emailCtrl = this.form.controls['email'];
      return !(emailCtrl.touched && emailCtrl.invalid);
    }
    return true;
  });

  ngOnChanges(): void {
    if (this.open) {
      this.error.set(null);
      this.step.set(1);
      this.showPassword.set(false);
      this.showConfirm.set(false);
      this.isAdmin.set(false);
      this.form.reset({
        username: '',
        password: '',
        confirm: '',
        firstname: '',
        lastname: '',
        email: '',
      });
    }
  }

  next(): void {
    if (this.step() < 4 && this.canAdvance()) {
      this.step.set((this.step() + 1) as Step);
      this.error.set(null);
    }
  }

  back(): void {
    if (this.step() > 1) {
      this.step.set((this.step() - 1) as Step);
      this.error.set(null);
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.passwordsMatch()) {
      this.error.set('Please complete every required field');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const v = this.form.value as {
        username: string;
        password: string;
        firstname: string;
        lastname: string;
        email: string;
      };
      const created = await this.admin.createUser({
        username: v.username.trim(),
        password: v.password,
        firstname: v.firstname?.trim() || undefined,
        lastname: v.lastname?.trim() || undefined,
        email: v.email?.trim() || undefined,
        isAdmin: this.isAdmin(),
      });
      this.completed.emit({ username: created.username, isAdmin: created.isAdmin });
    } catch (e) {
      this.error.set(formatError(e, 'Failed to create user'));
    } finally {
      this.submitting.set(false);
    }
  }

  dismiss(): void {
    if (this.submitting()) return;
    this.dismissed.emit();
  }
}
