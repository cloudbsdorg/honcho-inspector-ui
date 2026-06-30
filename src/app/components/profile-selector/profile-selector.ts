import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { ProfileService } from '../../core/profile.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { Profile, ProfileWithKey } from '../../core/models';
import { formatError } from '../../core/error-message';
import { TimezoneService } from '../../core/timezone.service';
import { formatWallClock, formatWallClockTooltip } from '../../core/datetime';
import { ConfirmDialogService } from '../confirm-dialog/confirm-dialog.service';
import { ConfigService } from '../../core/config.service';

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
  imports: [ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './profile-selector.html',
  styleUrl: './profile-selector.css',
})
export class ProfileSelector {
  private readonly profiles = inject(ProfileService);
  private readonly auth = inject(HonchoAuthService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly config = inject(ConfigService);
  readonly tz = inject(TimezoneService);
  readonly formatWallClock = formatWallClock;
  readonly formatWallClockTooltip = formatWallClockTooltip;

  /**
   * Admins always have full access. Non-admins can view / change / test
   * the stored Honcho API key only when the operator has set
   * {@code HONCHO_UI_API_KEY_VISIBLE_TO_NON_ADMIN=true} on the backend
   * (presentation mode off). Gates both the Reveal API Key button and
   * the API-key edit field in the profile form.
   */
  readonly canViewApiKey = computed(() => this.auth.isAdmin() || this.config.apiKeyVisibleToNonAdmin());
  readonly canEditApiKey = computed(() => this.auth.isAdmin() || this.config.apiKeyVisibleToNonAdmin());

  readonly list = this.profiles.profiles;
  readonly activeId = this.profiles.activeProfileId;
  readonly activeProfile = this.profiles.activeProfile;
  readonly hasProfiles = this.profiles.hasProfiles;

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly showCreate = signal(false);
  readonly reveal = signal<ProfileWithKey | null>(null);
  readonly testResults = signal<Record<string, TestResult>>({});
  // Pre-save validate result. null = not yet validated; otherwise
  // {ok: true} or {ok: false, error: ...}. Cleared when the form
  // fields change so the user sees a fresh result after edits.
  readonly validateResult = signal<{ ok: boolean; message?: string; error?: string } | null>(null);
  readonly validating = signal(false);
  readonly edit = signal<EditState>({ open: false, profile: null });
  // Currently-inspected connection in the right-hand details pane.
  // Independent of activeProfileId (which is the one used by the
  // rest of the app); selected is purely a UI focus state.
  readonly selectedId = signal<string | null>(null);

  readonly selectedProfile = computed<Profile | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.list().find((p) => p.id === id) ?? null;
  });

  readonly selectedTestResult = computed<TestResult | null>(() => {
    const id = this.selectedId();
    if (!id) return null;
    return this.testResults()[id] ?? null;
  });

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
      this.error.set(formatError(e));
    } finally {
      this.loading.set(false);
    }
    // Clear the validate-result banner when the operator edits any
    // field. Without this, the stale "Connection failed" message
    // from a prior attempt lingers while the user is typing fixes,
    // which is misleading (the new value hasn't been tested yet).
    this.form.valueChanges.subscribe(() => {
      if (this.validateResult() !== null) {
        this.validateResult.set(null);
      }
    });
  }

  openCreate(): void {
    this.edit.set({ open: false, profile: null });
    this.showCreate.set(true);
    this.selectedId.set(null);
    // Pre-fill fields from the operator's Honcho MCP identity so the
    // form is usable the moment "+ New" is tapped. Only the API key
    // remains blank (it's per-connection, never re-used). The label
    // is derived from the Honcho user name (most operators have one
    // workspace per identity); they can rename before saving.
    const username = this.auth.user()?.username ?? '';
    this.form.reset({
      label: username ? `${username}-workspace` : '',
      apiKey: '',
      baseUrl: 'https://honcho.example',
      workspaceId: 'default',
      honchoUserName: username,
    });
    this.validateResult.set(null);
    this.error.set(null);
  }

  openEdit(profile: Profile): void {
    this.showCreate.set(false);
    this.edit.set({ open: true, profile });
    this.selectedId.set(profile.id);
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

  select(profile: Profile): void {
    this.selectedId.set(profile.id);
  }

  /**
   * Set the active profile to this one and navigate to the dashboard
   * ('/'). Mirrors the setActive() flow but is wired to a per-row
   * button in the list so the operator doesn't have to select a row,
   * then click "Set Active", then click again to go to the dashboard.
   * One click from the list = active + dashboard.
   */
  async openDashboard(profile: Profile): Promise<void> {
    this.profiles.setActive(profile.id);
    this.selectedId.set(profile.id);
    await this.router.navigateByUrl('/');
  }

  /**
   * Clear the inline error banner. The banner sticks until the
   * operator dismisses it (or until the next action that resets
   * the error state), so they can read it at their own pace.
   */
  dismissError(): void {
    this.error.set(null);
  }

  async validate(): Promise<void> {
    this.validateResult.set(null);
    const value = this.form.value as {
      label: string;
      apiKey: string;
      baseUrl: string;
      workspaceId: string;
      honchoUserName: string;
    };
    // Identify every missing field by name so the operator sees
    // exactly what they still need to fill in. The form pre-fills
    // label / honchoUserName / baseUrl / workspaceId from sensible
    // defaults, so in practice the only field that ever shows up
    // in this list is apiKey — but we keep the granular error so a
    // user who manually clears a pre-filled field is told exactly
    // which one.
    const missing: string[] = [];
    if (!value.apiKey?.trim()) missing.push('API key');
    if (!value.baseUrl?.trim()) missing.push('Base URL');
    if (!value.workspaceId?.trim()) missing.push('Workspace ID');
    if (!value.honchoUserName?.trim()) missing.push('Honcho user name');
    if (missing.length > 0) {
      const list = missing.join(', ');
      const verb = missing.length === 1 ? 'is' : 'are';
      this.validateResult.set({
        ok: false,
        error: `${list} ${verb} required to validate`,
      });
      return;
    }
    this.validating.set(true);
    try {
      const res = await this.profiles.validate({
        apiKey: value.apiKey,
        baseUrl: value.baseUrl,
        workspaceId: value.workspaceId,
        honchoUserName: value.honchoUserName,
      });
      this.validateResult.set(res);
    } catch (e) {
      this.validateResult.set({ ok: false, error: formatError(e) });
    } finally {
      this.validating.set(false);
    }
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
        if (value.apiKey.trim() !== '') {
          // Defensive: even if the form field was somehow visible
          // (e.g. stale render before the flag loaded), refuse to
          // submit an apiKey change when the operator has locked it
          // out via HONCHO_UI_API_KEY_VISIBLE_TO_NON_ADMIN=false.
          // The backend would 403 anyway, but failing locally gives
          // the operator a clear "presentation mode" message instead
          // of a generic 403 from the server.
          if (!this.canEditApiKey()) {
            this.error.set('API key cannot be changed in presentation mode');
            return;
          }
          partial.apiKey = value.apiKey;
        }
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
        // Successful create: jump straight to the dashboard for the
        // newly-active profile. The operator just finished a
        // "validate + create" flow; staying on the profiles list
        // would force them to find and click the new row to see
        // its data. Navigating immediately to '/' renders the
        // active profile's dashboard (peers / sessions / queue).
        await this.router.navigateByUrl('/');
      }
    } catch (e) {
      this.error.set(formatError(e));
    }
  }

  async setActive(profile: Profile): Promise<void> {
    this.profiles.setActive(profile.id);
    await this.router.navigateByUrl('/');
  }

  async delete(profile: Profile): Promise<void> {
    if (typeof window === 'undefined') return;
    const ok = await this.confirm.ask({
      title: `Delete profile "${profile.label}"?`,
      body: 'This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await this.profiles.delete(profile.id);
    } catch (e) {
      this.error.set(formatError(e));
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
        [profile.id]: { ok: false, message: formatError(e) },
      }));
    }
  }

  async showKey(profile: Profile): Promise<void> {
    // Defensive guard: the Reveal button is hidden in the template
    // when canViewApiKey() is false, but a stale render or direct
    // handler invocation could still reach here. Bail out before the
    // network round-trip so the operator gets the same UX whether
    // they hit the button or call it programmatically.
    if (!this.canViewApiKey()) {
      return;
    }
    try {
      const result = await this.profiles.reveal(profile.id);
      this.reveal.set(result);
    } catch (e) {
      this.error.set(formatError(e));
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
}
