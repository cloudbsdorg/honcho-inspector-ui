import { Injectable, Injector, inject } from '@angular/core';
import { HonchoAuthService } from './honcho-auth.service';

/**
 * Single typed boundary to the backend. Replaces the three
 * near-identical `call<T>()` methods that used to live in
 * `HonchoAuthService`, `ProfileService`, and `HonchoService`.
 *
 * Paths under `/api/auth/*` are anonymous unless a session already
 * exists (e.g. logout). All other paths require a session.
 *
 * Note: the active profile id is NOT read here — callers must pass
 * `profileId` explicitly. This keeps the dependency direction one-way
 * (`ApiClient → HonchoAuthService`) and avoids a circular import.
 */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /**
   * Status-code-based human message. Replaces the brittle
   * `friendlyErrorMessage` substring sniffer that used to live on
   * `HonchoService`. Pass `baseUrl` to localize the "cannot reach"
   * message to the active profile.
   */
  friendlyMessage(ctx: { baseUrl?: string } = {}): string {
    if (this.status === 0) {
      return `Cannot reach Honcho server at ${ctx.baseUrl ?? 'the configured URL'}. Check that the backend is running and the Honcho URL is correct.`;
    }
    if (this.status === 401 || this.status === 403) {
      return 'Authentication failed. Try selecting a different profile or logging in again.';
    }
    if (this.status === 404) {
      return 'Not found. Check the workspace ID and Honcho URL for the active profile.';
    }
    if (this.status === 429) {
      return 'Rate limit hit. Slow down and retry in a moment.';
    }
    if (this.status >= 500) {
      return 'Honcho server error. The backend is having trouble — try again shortly.';
    }
    return this.message;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestOptions {
  method: HttpMethod;
  /** Path with leading slash, e.g. `/peers` or `/peers/alice/card`. */
  path: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  /**
   * Explicit profile id for the `X-Honcho-Profile-Id` header. Pass
   * `null` to omit (for `/api/profiles/*` calls that don't need it).
   * Callers typically pass the active profile id from `ProfileService`.
   */
  profileId?: string | null;
  /**
   * Auth gate. If true, no `X-Session-Id` is attached and a missing
   * session does NOT throw — used by `/api/auth/login`,
   * `/api/auth/register`, `/api/auth/logout`.
   */
  anonymous?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ApiClient {
  /**
   * Resolved lazily. `HonchoAuthService` injects `ApiClient` for its
   * fetch calls, and `ApiClient` reads the session from
   * `HonchoAuthService` to build headers — a true cycle. We break the
   * cycle at construction by using `Injector` and resolving the auth
   * service only when a request is actually made.
   */
  private readonly injector = inject(Injector);

  async request<T>(opts: RequestOptions): Promise<T> {
    const auth = this.injector.get(HonchoAuthService);
    const url = this.buildPath(opts.path, opts.query);
    const headers = this.buildHeaders(opts, auth);
    const body = this.encodeBody(opts.body, headers);
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method, headers, body });
    } catch (e) {
      // Network error: status 0 distinguishes "cannot reach backend"
      // from HTTP 5xx (server reached but errored).
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(msg, 0);
    }
    if (res.status === 204) return undefined as T;
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new ApiError(errBody.error ?? `Backend error ${res.status}`, res.status);
    }
    if (res.headers.get('content-length') === '0') return undefined as T;
    return (await res.json()) as T;
  }

  private buildPath(path: string, query?: RequestOptions['query']): string {
    const params = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    return '/api' + path + (qs ? '?' + qs : '');
  }

  private buildHeaders(opts: RequestOptions, auth: HonchoAuthService): Record<string, string> {
    const headers: Record<string, string> = {};
    const session = auth.credentials();
    if (!opts.anonymous) {
      if (!session) throw new ApiError('Not authenticated', 401);
      headers['X-Session-Id'] = session.sessionId;
    } else if (session) {
      // /api/auth/logout with an active session: still send the id
      headers['X-Session-Id'] = session.sessionId;
    }
    if (opts.profileId) headers['X-Honcho-Profile-Id'] = opts.profileId;
    return headers;
  }

  private encodeBody(
    body: RequestOptions['body'],
    headers: Record<string, string>,
  ): string | undefined {
    if (body === undefined || body === null) return undefined;
    headers['Content-Type'] = 'application/json';
    return JSON.stringify(body);
  }
}

