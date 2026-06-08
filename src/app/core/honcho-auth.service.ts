import { Injectable, computed, signal } from '@angular/core';
import { HonchoCredentials, User } from './models';

const STORAGE_KEY = 'honcho-credentials';
const MIN_PASSWORD_LENGTH = 8;

export interface RegisterInput {
  username: string;
  password: string;
}

export interface LoginInput {
  username: string;
  password: string;
}

/**
 * Manages the user's session against the backend (`/api/auth/*`).
 *
 * `HonchoCredentials` is just `{ sessionId, user }` — workspaceId /
 * baseUrl / honchoUserName live on `Profile` (see `ProfileService`).
 */
@Injectable({ providedIn: 'root' })
export class HonchoAuthService {
  private readonly _credentials = signal<HonchoCredentials | null>(null);

  readonly credentials = this._credentials.asReadonly();
  readonly isAuthenticated = computed(() => this._credentials() !== null);
  readonly user = computed(() => this._credentials()?.user ?? null);

  constructor() {
    this._credentials.set(this.loadFromStorage());
  }

  /**
   * Register a brand-new user, then immediately log them in.
   * Backend's `/api/auth/register` returns the user (not a session), so
   * we follow up with a real login to obtain a sessionId.
   */
  async register(input: RegisterInput): Promise<HonchoCredentials> {
    const cleaned = this.validate(input);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleaned),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Registration failed (${res.status})`);
    }
    return this.login(input);
  }

  async login(input: LoginInput): Promise<HonchoCredentials> {
    const cleaned = this.validate(input);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cleaned),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Login failed (${res.status})`);
    }
    const result = (await res.json()) as { sessionId: string; user: User };
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
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Session-Id': creds.sessionId },
      }).catch(() => undefined);
    }
    this._credentials.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async me(): Promise<User> {
    const creds = this._credentials();
    if (!creds) throw new Error('Not authenticated');
    const res = await fetch('/api/auth/me', {
      method: 'GET',
      headers: { 'X-Session-Id': creds.sessionId },
    });
    if (res.status === 401) {
      this._credentials.set(null);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(STORAGE_KEY);
      }
      throw new Error('Session expired');
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Backend error ${res.status}`);
    }
    const user = (await res.json()) as User;
    const next: HonchoCredentials = { sessionId: creds.sessionId, user };
    this._credentials.set(next);
    this.persist(next);
    return user;
  }

  localLogout(): void {
    this._credentials.set(null);
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  private validate(input: RegisterInput | LoginInput): RegisterInput {
    const username = input.username?.trim() ?? '';
    const password = input.password ?? '';
    if (username === '') throw new Error('Username is required');
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    return { username, password };
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

  private persist(creds: HonchoCredentials): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
  }
}
