import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { formatError } from '../../core/error-message';

const MIN_PASSWORD_LENGTH = 8;

@Component({
  selector: 'app-login-modal',
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login-modal.html',
  styleUrl: './login-modal.css',
})
export class LoginModal {
  private readonly auth = inject(HonchoAuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  @Input() open = true;
  @Output() loggedIn = new EventEmitter<void>();
  @Output() dismissed = new EventEmitter<void>();

  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly form: FormGroup = this.fb.group({
    username: ['', [Validators.required]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
  });

  ngOnChanges(): void {
    if (this.open) {
      this.error.set(null);
      this.form.reset({ username: '', password: '' });
    }
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.error.set(this.firstError() ?? 'Form is invalid');
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const value = this.form.value as { username: string; password: string };
      await this.auth.login(value);
      this.loggedIn.emit();
      // After successful login, push the user to the profile selector
      // so they pick an active Honcho profile before landing on the
      // dashboard. Same rationale as SetupWizard.submit(): the modal
      // is a route component with no parent to listen to loggedIn,
      // so the explicit navigation has to happen here.
      await this.router.navigate(['/profiles']);
    } catch (e) {
      this.error.set(formatError(e, 'Authentication failed'));
    } finally {
      this.submitting.set(false);
    }
  }

  dismiss(): void {
    this.dismissed.emit();
  }

  private firstError(): string | null {
    const c = this.form.controls;
    if (c['username']?.errors) return 'Username is required';
    if (c['password']?.errors?.['required']) return 'Password is required';
    if (c['password']?.errors?.['minlength'])
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    return null;
  }
}
