import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiClient, ApiError } from './api-client';
import { FirstAdminInput, HonchoCredentials, User } from './models';

const STORAGE_KEY = 'honcho-credentials';
const MIN_PASSWORD_LENGTH = 8;

export interface LoginInput {
  username: string;
  password: string;
}

@Injectable({ providedIn: 'root' })
export class HonchoAuthService {
  private readonly api = inject(ApiClient);

  private readonly _credentials = signal<HonchoCredentials | null>(null);

  readonly credentials = this._credentials.asReadonly();
  readonly isAuthenticated = computed(() => this._credentials() !== null);
  readonly user = computed(() => this._credentials()?.user ?? null);
  readonly isAdmin = computed(() => this._credentials()?.user.isAdmin ?? false);

  constructor() {
    this._credentials.set(this.loadFromStorage());
  }

  async setupFirstAdmin(input: FirstAdminInput): Promise<HonchoCredentials> {
    const cleaned = this.validateFirstAdmin(input);
    const result = await this.api.request<{ sessionId: string; user: User }>({
      method: 'POST',
      path: '/setup/first-admin',
      body: cleaned,
      anonymous: true,
    });
    const stored: HonchoCredentials = {
      sessionId: result.sessionId,
      user: result.user,
    };
    this._credentials.set(stored);
    this.persist(stored);
    return stored;
  }

  async login(input: LoginInput): Promise<HonchoCredentials> {
    const cleaned = this.validateLogin(input);
    const result = await this.api.request<{ sessionId: string; user: User }>({
      method: 'POST',
      path: '/auth/login',
      body: cleaned,
      anonymous: true,
    });
    const stored: HonchoCredentials = {
      sessionId: result.sessionId,
      user: result.user,
    };
    this._credentials.set(stored);
    this.persist(stored);
    return stored;
  }

  async logout(): Promise<void> {
    const creds = this._credentials();
    if (creds) {
      await this.api
        .request<unknown>({ method: 'POST', path: '/auth/logout', anonymous: true })
        .catch(() => undefined);
    }
    this._credentials.set(null);
    this.persist(null);
  }

  async me(): Promise<User> {
    if (!this._credentials()) throw new ApiError('Not authenticated', 401);
    try {
      const user = await this.api.request<User>({ method: 'GET', path: '/auth/me' });
      const next: HonchoCredentials = { sessionId: this._credentials()!.sessionId, user };
      this._credentials.set(next);
      this.persist(next);
      return user;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        this._credentials.set(null);
        this.persist(null);
        throw new ApiError('Session expired', e.status);
      }
      throw e;
    }
  }

  localLogout(): void {
    this._credentials.set(null);
    this.persist(null);
  }

  private validateLogin(input: LoginInput): LoginInput {
    const username = input.username?.trim() ?? '';
    const password = input.password ?? '';
    if (username === '') throw new ApiError('Username is required', 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        400,
      );
    }
    return { username, password };
  }

  private validateFirstAdmin(input: FirstAdminInput): FirstAdminInput {
    const username = input.username?.trim() ?? '';
    const password = input.password ?? '';
    const firstname = input.firstname?.trim() || undefined;
    const lastname = input.lastname?.trim() || undefined;
    const email = input.email?.trim() || undefined;
    if (username === '') throw new ApiError('Username is required', 400);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new ApiError(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
        400,
      );
    }
    return { username, password, firstname, lastname, email };
  }

  private loadFromStorage(): HonchoCredentials | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!this.isComplete(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(creds: HonchoCredentials | null): void {
    if (typeof localStorage === 'undefined') return;
    if (creds) localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
    else localStorage.removeItem(STORAGE_KEY);
  }

  private isComplete(value: unknown): value is HonchoCredentials {
    if (!value || typeof value !== 'object') return false;
    const obj = value as Record<string, unknown>;
    if (typeof obj['sessionId'] !== 'string') return false;
    if ((obj['sessionId'] as string).trim() === '') return false;
    const user = obj['user'];
    if (!user || typeof user !== 'object') return false;
    const u = user as Record<string, unknown>;
    return (
      typeof u['id'] === 'string' &&
      typeof u['username'] === 'string' &&
      typeof u['isAdmin'] === 'boolean' &&
      typeof u['createdAt'] === 'string'
    );
  }
}
