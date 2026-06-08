import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';
import { ProfileService } from '../../core/profile.service';
import { Profile, ProfileWithKey } from '../../core/models';

interface TestResult {
  ok: boolean;
  message: string;
}

interface EditState {
  open: boolean;
  profile: Profile | null;
}

@Component({
  selector: 'app-profile-selector',
  imports: [CommonModule, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-selector.html',
  styleUrl: './profile-selector.css',
})
export class ProfileSelector {
  private readonly profiles = inject(ProfileService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly list = this.profiles.profiles;
  readonly activeId = this.profiles.activeProfileId;
  readonly activeProfile = this.profiles.activeProfile;
  readonly hasProfiles = this.profiles.hasProfiles;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly showCreate = signal(false);
  readonly reveal = signal<ProfileWithKey | null>(null);
  readonly testResults = signal<Record<string, TestResult>>({});
  readonly edit = signal<EditState>({ open: false, profile: null });

  readonly form: FormGroup = this.fb.group({
    label: ['', [Validators.required, Validators.minLength(1)]],
    apiKey: ['', [Validators.required, Validators.minLength(1)]],
    baseUrl: ['', [Validators.required]],
    workspaceId: ['', [Validators.required]],
    honchoUserName: ['', [Validators.required]],
  });

  readonly count = computed(() => this.list().length);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.profiles.list();
    } catch (e) {
      this.error.set(this.toMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreate(): void {
    this.edit.set({ open: false, profile: null });
    this.showCreate.set(true);
    this.form.reset({
      label: '',
      apiKey: '',
      baseUrl: 'https://mcp.honcho.example',
      workspaceId: 'default',
      honchoUserName: '',
    });
    this.error.set(null);
  }

  openEdit(profile: Profile): void {
    this.showCreate.set(false);
    this.edit.set({ open: true, profile });
    this.form.reset({
      label: profile.label,
      apiKey: '',
      baseUrl: profile.baseUrl,
      workspaceId: profile.workspaceId,
      honchoUserName: profile.honchoUserName,
    });
    this.error.set(null);
  }

  cancelForm(): void {
    this.showCreate.set(false);
    this.edit.set({ open: false, profile: null });
    this.error.set(null);
  }

  async submit(): Promise<void> {
    if (this.form.invalid) {
      this.error.set('All fields are required');
      return;
    }
    this.error.set(null);
    const value = this.form.value as {
      label: string;
      apiKey: string;
      baseUrl: string;
      workspaceId: string;
      honchoUserName: string;
    };
    const editing = this.edit().profile;
    try {
      if (editing) {
        const partial: {
          label?: string;
          apiKey?: string;
          baseUrl?: string;
          workspaceId?: string;
          honchoUserName?: string;
        } = {
          label: value.label,
          baseUrl: value.baseUrl,
          workspaceId: value.workspaceId,
          honchoUserName: value.honchoUserName,
        };
        if (value.apiKey.trim() !== '') partial.apiKey = value.apiKey;
        const updated = await this.profiles.update(editing.id, partial);
        this.profiles.setActive(updated.id);
        this.edit.set({ open: false, profile: null });
      } else {
        const created = await this.profiles.create({
          label: value.label,
          apiKey: value.apiKey,
          baseUrl: value.baseUrl,
          workspaceId: value.workspaceId,
          honchoUserName: value.honchoUserName,
        });
        this.profiles.setActive(created.id);
        this.showCreate.set(false);
      }
    } catch (e) {
      this.error.set(this.toMessage(e));
    }
  }

  async setActive(profile: Profile): Promise<void> {
    this.profiles.setActive(profile.id);
    await this.router.navigateByUrl('/');
  }

  async delete(profile: Profile): Promise<void> {
    if (typeof window === 'undefined') return;
    const ok = window.confirm(
      `Delete profile "${profile.label}"? This cannot be undone.`,
    );
    if (!ok) return;
    try {
      await this.profiles.delete(profile.id);
    } catch (e) {
      this.error.set(this.toMessage(e));
    }
  }

  async test(profile: Profile): Promise<void> {
    this.testResults.update((m) => ({ ...m, [profile.id]: { ok: false, message: '...' } }));
    try {
      const res = await this.profiles.testConnection(profile.id);
      this.testResults.update((m) => ({ ...m, [profile.id]: res }));
    } catch (e) {
      this.testResults.update((m) => ({
        ...m,
        [profile.id]: { ok: false, message: this.toMessage(e) },
      }));
    }
  }

  async showKey(profile: Profile): Promise<void> {
    try {
      const result = await this.profiles.reveal(profile.id);
      this.reveal.set(result);
    } catch (e) {
      this.error.set(this.toMessage(e));
    }
  }

  closeReveal(): void {
    this.reveal.set(null);
  }

  copyKey(): void {
    const r = this.reveal();
    if (!r) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(r.apiKey).catch(() => undefined);
    }
  }

  isEditing(profile: Profile): boolean {
    return this.edit().profile?.id === profile.id;
  }

  isCreateOpen(): boolean {
    return this.showCreate();
  }

  private toMessage(e: unknown): string {
    if (e instanceof Error) return e.message;
    return 'Request failed';
  }
}
