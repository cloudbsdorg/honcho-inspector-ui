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
  /**
   * Path prefix prepended to the request path. Defaults to `/api`
   * (the standard backend namespace). Pass `''` to hit endpoints
   * at the root — e.g. `/actuator/health` or `/actuator/metrics/...`,
   * which Spring Boot Actuator serves at the root, not under `/api`.
   */
  pathPrefix?: string;
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
    const url = this.buildPath(opts.path, opts.query, opts.pathPrefix);
    const headers = this.buildHeaders(opts, auth);
    const body = this.encodeBody(opts.body, headers);
    let res: Response;
    try {
      res = await fetch(url, { method: opts.method, headers, body });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new ApiError(msg, 0);
    }
    if (res.status === 204) return undefined as T;
    // Always parse the body as JSON. The backend wraps every controller
    // success in a uniform `{data, error, meta}` envelope; failure
    // bodies are `{error, body}` (HonchoCallException 5xx/4xx) or
    // `{data: {error}}` (ErrorResponse record from the controller's
    // 400/401/404 paths). All three shapes funnel through one unwrap.
    const parsed = (await res.json().catch(() => ({}))) as
      | { data?: unknown; error?: string; body?: string; meta?: unknown }
      | undefined;
    if (!res.ok) {
      const msg =
        (parsed && (parsed as { error?: string }).error) ??
        (parsed && (parsed as { data?: { error?: string } }).data?.error) ??
        `Backend error ${res.status}`;
      throw new ApiError(msg, res.status);
    }
    if (res.headers.get('content-length') === '0') return undefined as T;
    // Success: pull the envelope's `data` field if present, otherwise
    // return the parsed body as-is (so endpoints that live outside the
    // `controller` package — health, auth, admin, profiles — still
    // work without the wrapper).
    const unwrapped = parsed && 'data' in parsed ? parsed.data : parsed;
    return snakeToCamel(unwrapped) as T;
  }

  private buildPath(path: string, query?: RequestOptions['query'], pathPrefix?: string): string {
    const params = new URLSearchParams();
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        params.set(k, String(v));
      }
    }
    const qs = params.toString();
    const prefix = pathPrefix ?? '/api';
    return prefix + path + (qs ? '?' + qs : '');
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

/**
 * Convert snake_case keys to camelCase recursively so services and
 * components read the TS-model names without each endpoint
 * re-implementing the mapping. Arrays map element-wise.
 */
export function snakeToCamel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(snakeToCamel);
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[snakeKey(k)] = snakeToCamel(v);
    }
    return out;
  }
  return value;
}

function snakeKey(k: string): string {
  return k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
