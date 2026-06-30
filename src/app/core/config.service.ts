import { Injectable, signal } from '@angular/core';

/**
 * Server-driven UI configuration. Pulled once at app start from
 * the public {@code GET /api/health} endpoint. Today this is the
 * {@code chatEnabled} feature toggle and the
 * {@code apiKeyVisibleToNonAdmin} presentation-mode toggle; future
 * toggles (e.g. disable-derivation, disable-dreams) will live here too.
 *
 * <p>The service starts with {@code chatEnabled=false} as a safe
 * default — if the health endpoint is unreachable (backend down,
 * CORS-blocked, etc.) the UI hides the chat rather than flashing
 * a button that 404s. Once the health check resolves, the real
 * value replaces the default. Operators control the flag with the
 * {@code HONCHO_UI_CHAT_ENABLED} env var on the backend.
 *
 * <p>{@code apiKeyVisibleToNonAdmin} defaults to {@code false} for the
 * same reason: a missing health response should not unlock
 * presentation-mode-restricted actions (Reveal API Key / edit
 * apiKey / Test connection). Operators set
 * {@code HONCHO_UI_API_KEY_VISIBLE_TO_NON_ADMIN=true} on the backend
 * to flip it on for non-admin users — typically the default for
 * non-demo deployments.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly chatEnabled = signal(false);
  readonly apiKeyVisibleToNonAdmin = signal(false);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    try {
      const res = await fetch('/api/health', {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) {
        return;
      }
      const body = (await res.json()) as {
        chatEnabled?: unknown;
        apiKeyVisibleToNonAdmin?: unknown;
      };
      this.chatEnabled.set(body?.chatEnabled === true);
      this.apiKeyVisibleToNonAdmin.set(body?.apiKeyVisibleToNonAdmin === true);
    } catch {
      // Leave both flags at the false default; the operator
      // can still toggle from the admin side if the health
      // endpoint comes back.
    } finally {
      this.loaded.set(true);
    }
  }
}
