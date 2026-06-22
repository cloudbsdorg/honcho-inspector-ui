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
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
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

  @Input() open = false;
  @Output() completed = new EventEmitter<void>();
  @Output() dismissed = new EventEmitter<void>();

  readonly step = signal<Step>(1);
  readonly error = signal<string | null>(null);
  readonly submitting = signal(false);

  readonly form: FormGroup = this.fb.group({
    username: ['', [Validators.required, Validators.minLength(2)]],
    password: ['', [Validators.required, Validators.minLength(MIN_PASSWORD_LENGTH)]],
    confirm: ['', [Validators.required]],
    firstname: [''],
    lastname: [''],
    email: ['', [Validators.email]],
  });

  readonly passwordsMatch = computed(() => {
    const password = this.form.controls['password'].value ?? '';
    const confirm = this.form.controls['confirm'].value ?? '';
    return password !== '' && password === confirm;
  });

  readonly canAdvance = computed(() => {
    if (this.step() === 1) return true;
    if (this.step() === 2) {
      const c = this.form.controls;
      const usernameOk = c['username'].valid;
      const passwordOk = c['password'].valid && c['confirm'].valid;
      const emailOk = !c['email'].value || c['email'].valid;
      return usernameOk && passwordOk && emailOk && this.passwordsMatch();
    }
    return true;
  });

  ngOnChanges(): void {
    if (this.open) {
      this.error.set(null);
      this.step.set(1);
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
