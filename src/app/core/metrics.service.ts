import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

/**
 * Per-endpoint request counts for the dashboard's "all-time count"
 * KPI cards.
 *
 * The dashboard reads these via the backend's relay endpoint
 * `GET /api/admin/metrics/counters`, which sources its values
 * directly from the in-memory Spring `MeterRegistry` via
 * `HonchoMetrics`. The browser NEVER reaches Spring Boot Actuator
 * directly — `/actuator/*` is bound to loopback on the backend and
 * is not exposed by the Angular dev-server proxy (see
 * `proxy.conf.json`).
 *
 * Each counter in the relay response corresponds to one workspace
 * action the dashboard cares about:
 *   - `workspace.messageCount`              → `/api/sessions/{sessionId}/messages`
 *     <p style="font-weight:600">Note: this used to key on
 *     `honcho.inspector.messages.sent`, which only tallied POSTs
 *     through this proxy instance — it would show 0 forever if the
 *     user added messages via direct Honcho API or a previous
 *     backend instance. The new `workspace.messageCount` key is
 *     sourced LIVE from Honcho (per-session Page[Message].total
 *     summed across every session in the workspace, cached 60s),
 *     so it reflects actual Honcho state.
 *   - `honcho.inspector.peers.listed`        → `/api/peers`
 *   - `honcho.inspector.sessions.listed`     → `/api/sessions`
 *   - `honcho.inspector.profiles.tested`     → `/api/profiles/{id}/test`
 *
 * The legacy `messages.sent` is a tagged counter (`session` tag);
 * the relay returns it as the SUM across every distinct tag value.
 * The `searches` and `dreams.scheduled` counters are still tracked
 * + relayed on the backend for telemetry / diagnostic use, but no
 * dashboard card reads them anymore — they were removed from the
 * operator KPI strip on 2026-06-30 because the in-process proxy
 * counters were misleading (they only counted this app's POSTs since
 * backend restart, not an operator-visible Honcho state).
 *
 * The relay endpoint is gated by `@RequireAdmin` on the backend;
 * the dashboard and workspace overview are already gated by
 * `adminGuard`, so 403 doesn't happen in practice. If a stale
 * session triggers 401, `ApiClient.request()` routes to the login
 * flow centrally.
 */
@Injectable({ providedIn: 'root' })
export class MetricsService {
  private readonly api = inject(ApiClient);

  /**
   * `{uri: count}` for every URI the backend has recorded since
   * process start. Refreshed by calling `load()`. Used by the
   * dashboard's "messages in workspace" KPI card (and available
   * to any future per-URI card that wants to read a backend
   * counter by proxy URI).
   *
   * <p>The `messages` slot is now backed by
   * {@link HonchoMetrics.WORKSPACE_MESSAGE_COUNT_NAME
   * workspace.messageCount} — a LIVE Honcho-sourced total, NOT the
   * legacy proxy-only counter `honcho.inspector.messages.sent`. See
   * `URI_TO_COUNTER` for the swap.
   */
  readonly countsByUri = signal<Record<string, number>>({});
  readonly lastLoadedAt = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * The URIs the backend exposes counters for. Informational — the
   * relay endpoint returns every counter in a single response, so
   * this list no longer drives one request per URI. It exists so
   * readers can see which backend counters back which dashboard
   * KPI, and so we iterate the response in a stable order to
   * produce `countsByUri` (defensive default 0 if a counter hasn't
   * been registered yet — matches the dashboard's "show 0 if no
   * data" UX).
   *
   * The /v3/... upstream paths are NOT included — those live on
   * Honcho's API, not the backend, so the backend never sees them.
   */
  static readonly TRACKED_URIS: readonly string[] = [
    '/api/sessions/{sessionId}/messages',
    '/api/peers',
    '/api/sessions',
    '/api/profiles/{id}/test',
  ];

  /**
   * Map a tracked URI to the backend counter name that backs it.
   * Kept here (not on the backend) because the URI form is the
   * public contract of `countsByUri` — the dashboard reads by URI.
   *
   * <p><strong>2026-06-30 messages.sent → workspace.messageCount swap.</strong>
   * The previous mapping
   * `'/api/sessions/{sessionId}/messages': 'honcho.inspector.messages.sent'`
   * was backed by a backend-side counter that ONLY tallied POSTs
   * through this proxy. As a result, opening Inspector → Sessions →
   * selecting any session with pre-existing messages still showed
   * `Messages sent: 0` on the dashboard, which the user correctly
   * flagged as misleading. The replacement key
   * `workspace.messageCount` is sourced LIVE from Honcho (per-session
   * Page[Message].total summed across every session in the
   * workspace, with a 60s cache), so messages added by ANY path
   * — this backend, a previous instance, direct Honcho API, another
   * client — are all reflected. The old `honcho.inspector.messages.sent`
   * is still tracked + relayed for backward compatibility with any
   * external scraper, but no dashboard card reads it anymore.
   */
  private static readonly URI_TO_COUNTER: Readonly<Record<string, string>> = {
    '/api/sessions/{sessionId}/messages': 'workspace.messageCount',
    '/api/peers': 'honcho.inspector.peers.listed',
    '/api/sessions': 'honcho.inspector.sessions.listed',
    '/api/profiles/{id}/test': 'honcho.inspector.profiles.tested',
  };

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.request<{
        counters: Record<string, number>;
        capturedAt: string;
      }>({
        method: 'GET',
        path: '/admin/metrics/counters',
      });
      const out: Record<string, number> = {};
      for (const uri of MetricsService.TRACKED_URIS) {
        const counterName = MetricsService.URI_TO_COUNTER[uri];
        // Defensive default: if the backend hasn't registered a
        // counter yet (e.g. startup race), treat as 0 — matches
        // the dashboard's "show 0 if no data" UX.
        out[uri] = counterName ? res.counters[counterName] ?? 0 : 0;
      }
      this.countsByUri.set(out);
      this.lastLoadedAt.set(Date.now());
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }
}