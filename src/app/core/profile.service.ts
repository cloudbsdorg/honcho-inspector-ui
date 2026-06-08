import { Injectable, computed, inject, signal } from '@angular/core';
import { HonchoAuthService } from './honcho-auth.service';
import { Profile, ProfileWithKey } from './models';

/**
 * Manages Honcho API key profiles belonging to the current user.
 *
 * The sessionId used to authenticate against the backend is read from
 * `HonchoAuthService.credentials()` (a signal), so this service does
 * not need to be passed a sessionId on every call. It is a no-op when
 * the user is not authenticated (the resulting fetch will 401).
 */
@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly auth = inject(HonchoAuthService);

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
    const data = await this.call<Profile[]>('GET', '/api/profiles');
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
    const created = await this.call<Profile>('POST', '/api/profiles', input);
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
    const updated = await this.call<Profile>(
      'PUT',
      `/api/profiles/${encodeURIComponent(id)}`,
      partial,
    );
    this._profiles.update((current) =>
      current.map((p) => (p.id === updated.id ? updated : p)),
    );
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.call<null>('DELETE', `/api/profiles/${encodeURIComponent(id)}`);
    this._profiles.update((current) => current.filter((p) => p.id !== id));
    if (this._activeProfileId() === id) {
      this.setActive(null);
    }
  }

  async reveal(id: string): Promise<ProfileWithKey> {
    return this.call<ProfileWithKey>(
      'GET',
      `/api/profiles/${encodeURIComponent(id)}/reveal`,
    );
  }

  async testConnection(
    id: string,
  ): Promise<{ ok: boolean; message: string }> {
    return this.call<{ ok: boolean; message: string }>(
      'POST',
      `/api/profiles/${encodeURIComponent(id)}/test`,
    );
  }

  setActive(id: string | null): void {
    this._activeProfileId.set(id);
    if (typeof localStorage !== 'undefined') {
      if (id === null) {
        localStorage.removeItem(this.activeStorageKey());
      } else {
        localStorage.setItem(this.activeStorageKey(), JSON.stringify(id));
      }
    }
  }

  private activeStorageKey(): string {
    return 'honcho-active-profile';
  }

  private loadActiveProfileId(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(this.activeStorageKey());
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === 'string' && parsed.trim() !== '') return parsed;
      return null;
    } catch {
      return null;
    }
  }

  private sessionId(): string {
    const c = this.auth.credentials();
    if (!c) throw new Error('Not authenticated');
    return c.sessionId;
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'X-Session-Id': this.sessionId(),
    };
    let payload: string | undefined;
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const url = new URL(path, this.origin());
    const res = await fetch(url.toString(), {
      method,
      headers,
      body: payload,
    });
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      const msg = errBody.error ?? `Backend error ${res.status}`;
      const err = new Error(msg);
      (err as Error & { backendStatus?: number }).backendStatus = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  private origin(): string {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return window.location.origin;
    }
    return 'http://localhost';
  }
}
