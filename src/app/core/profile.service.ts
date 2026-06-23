import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';
import { Profile, ProfileWithKey } from './models';

const ACTIVE_STORAGE_KEY = 'honcho-active-profile';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly api = inject(ApiClient);

  private readonly _profiles = signal<Profile[]>([]);
  private readonly _activeProfileId = signal<string | null>(null);

  readonly profiles = this._profiles.asReadonly();
  readonly activeProfileId = this._activeProfileId.asReadonly();
  readonly activeProfile = computed(
    () => this._profiles().find((p) => p.id === this._activeProfileId()) ?? null,
  );
  readonly hasProfiles = computed(() => this._profiles().length > 0);

  constructor() {
    this._activeProfileId.set(this.loadActiveProfileId());
  }

  async list(): Promise<Profile[]> {
    const data = await this.api.request<Profile[]>({
      method: 'GET',
      path: '/profiles',
      profileId: null,
    });
    this._profiles.set(data);
    return data;
  }

  async create(input: {
    label: string;
    apiKey: string;
    baseUrl: string;
    workspaceId: string;
    honchoUserName: string;
  }): Promise<Profile> {
    const created = await this.api.request<Profile>({
      method: 'POST',
      path: '/profiles',
      body: input,
      profileId: null,
    });
    this._profiles.update((current) => [created, ...current]);
    return created;
  }

  async update(
    id: string,
    partial: {
      label?: string;
      apiKey?: string;
      baseUrl?: string;
      workspaceId?: string;
      honchoUserName?: string;
    },
  ): Promise<Profile> {
    const updated = await this.api.request<Profile>({
      method: 'PUT',
      path: `/profiles/${encodeURIComponent(id)}`,
      body: partial,
      profileId: null,
    });
    this._profiles.update((current) =>
      current.map((p) => (p.id === updated.id ? updated : p)),
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.api.request<null>({
      method: 'DELETE',
      path: `/profiles/${encodeURIComponent(id)}`,
      profileId: null,
    });
    this._profiles.update((current) => current.filter((p) => p.id !== id));
    if (this._activeProfileId() === id) {
      this.setActive(null);
    }
  }

  async reveal(id: string): Promise<ProfileWithKey> {
    return this.api.request<ProfileWithKey>({
      method: 'GET',
      path: `/profiles/${encodeURIComponent(id)}/reveal`,
      profileId: null,
    });
  }

  async testConnection(
    id: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.api.request<{ ok: boolean; message: string }>({
      method: 'POST',
      path: `/profiles/${encodeURIComponent(id)}/test`,
      profileId: null,
    });
  }

  /**
   * Pre-save connectivity check. The backend hits the upstream Honcho
   * with the supplied credentials and returns whether the request
   * succeeded. Used by the profile form's "Validate" button so the
   * user can confirm a profile works before clicking Save (which would
   * persist the encrypted API key to the DB).
   */
  async validate(input: {
    apiKey: string;
    baseUrl: string;
    workspaceId: string;
    honchoUserName: string;
  }): Promise<{ ok: boolean; message?: string; error?: string }> {
    return this.api.request<{ ok: boolean; message?: string; error?: string }>({
      method: 'POST',
      path: '/profiles/validate',
      body: input,
      profileId: null,
    });
  }

  setActive(id: string | null): void {
    this._activeProfileId.set(id);
    if (typeof localStorage === 'undefined') return;
    if (id === null) localStorage.removeItem(ACTIVE_STORAGE_KEY);
    else localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(id));
  }

  private loadActiveProfileId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(ACTIVE_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim() !== '') return parsed;
      return null;
    } catch {
      return null;
    }
  }
}
