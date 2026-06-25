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
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { formatError } from '../../core/error-message';

const MIN_PASSWORD_LENGTH = 8;

type Step = 1 | 2 | 3;

@Component({
  selector: 'app-setup-wizard',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './setup.html',
  styleUrl: './setup.css',
})
export class SetupWizard {
  private readonly auth = inject(HonchoAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  @Input() open = true;
  @Output() completed = new EventEmitter<void>();
  @Output() dismissed = new EventEmitter<void>();

  readonly step = signal<Step>(1);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);
  readonly showPassword = signal(false);
  readonly showConfirm = signal(false);

  readonly form: FormGroup = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(2)]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirm: ['', [Validators.required]],
    firstname: [''],
    lastname: [''],
    email: ['', [Validators.email]],
  });

  // Re-emit the form's valueChanges as a signal so canAdvance's
  // computed re-runs whenever the form changes. Using valueChanges
  // (not statusChanges) is critical: statusChanges only fires on
  // VALID <-> INVALID transitions, so once the form is valid
  // subsequent valid value edits would never trigger a re-render.
  // valueChanges fires on every keystroke and is a strict superset
  // of statusChanges for our purposes.
  // (FormControl.value and .valid are plain getters, not signals,
  // so reading them inside computed() does not establish a reactive
  // dependency on its own — the formValue() call below is what
  // ties this computed to the form's lifecycle.)
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.value,
  });

  readonly passwordsMatch = computed(() => {
    // formValue() is read here purely for its reactive-tracking
    // side effect. See the field-level comment for the full
    // rationale — without it, passwordsMatch would be cached at
    // its initial (false) value and the "do not match" warning +
    // Next button would both be stuck even when the two fields
    // genuinely contain the same value.
    this.formValue();
    const password = this.form.controls['password'].value ?? '';
    const confirm = this.form.controls['confirm'].value ?? '';
    return password !== '' && password === confirm;
  });

  // Has the user typed anything in the confirm field? Used by the
  // template to gate the "do not match" warning — showing the warning
  // while confirm is still empty is noisy and unhelpful.
  readonly confirmTouched = computed(() => {
    this.formValue();
    return (this.form.controls['confirm'].value ?? '') !== '';
  });

  readonly canAdvance = computed(() => {
    // formValue() is read here purely for its reactive-tracking
    // side effect — see the field-level comment on formValue
    // for the full rationale. The reads of form.invalid and
    // passwordsMatch() below pick up the now-current values.
    this.formValue();

    if (this.step() === 1) return true;
    if (this.step() === 2) {
      if (this.form.invalid) return false;
      if (!this.passwordsMatch()) return false;
      return true;
    }
    return true;
  });

  ngOnChanges(): void {
    if (this.open) {
      this.error.set(null);
      this.step.set(1);
      this.showPassword.set(false);
      this.showConfirm.set(false);
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
    if (this.step() < 3 && this.canAdvance()) {
      this.step.set((this.step() + 1) as Step);
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
      this.error.set('Please complete every field');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const v = this.form.value;
      await this.auth.setupFirstAdmin({
        username: v.username,
        password: v.password,
        firstname: v.firstname || undefined,
        lastname: v.lastname || undefined,
        email: v.email || undefined,
      });
      this.completed.emit();
      // The wizard sits on /setup, which the setupGuard only allows
      // when the backend reports firstRun. Once we've just created the
      // first admin, the backend is no longer firstRun and the next
      // navigation away from this route would bounce us to /login.
      // Navigate to /profiles explicitly so the new admin lands on
      // the profile selector (authGuard will then pick up the active
      // session and route accordingly).
      await this.router.navigate(['/profiles']);
    } catch (e) {
      this.error.set(formatError(e, 'Setup failed'));
    } finally {
      this.submitting.set(false);
    }
  }

  dismiss(): void {
    if (this.submitting()) return;
    this.dismissed.emit();
  }
}
