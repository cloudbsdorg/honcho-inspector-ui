import { Injectable, signal } from '@angular/core';

/**
 * Server-driven UI configuration. Pulled once at app start from
 * the public {@code GET /api/health} endpoint. Today this is just
 * the {@code chatEnabled} feature toggle; future toggles (e.g.
 * disable-derivation, disable-dreams) will live here too.
 *
 * <p>The service starts with {@code chatEnabled=false} as a safe
 * default — if the health endpoint is unreachable (backend down,
 * CORS-blocked, etc.) the UI hides the chat rather than flashing
 * a button that 404s. Once the health check resolves, the real
 * value replaces the default. Operators control the flag with the
 * {@code HONCHO_UI_CHAT_ENABLED} env var on the backend.
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly chatEnabled = signal(false);
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
      const body = (await res.json()) as { chatEnabled?: unknown };
      this.chatEnabled.set(body?.chatEnabled === true);
    } catch {
      // Leave chatEnabled at the false default; the operator
      // can still toggle from the admin side if the health
      // endpoint comes back.
    } finally {
      this.loaded.set(true);
    }
  }
}
