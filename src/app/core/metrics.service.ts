import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

/**
 * Per-endpoint request counts derived from the backend's Spring
 * Boot Actuator `/actuator/metrics/http.server.requests` endpoint.
 *
 * Actuator's `http.server.requests` is a Micrometer Timer that
 * records, for every HTTP request:
 *   - count (how many times this tag combination fired)
 *   - totalTime / max (latency stats)
 *   - several percentile estimates (if histogram is enabled)
 *
 * The metric is tagged on the way OUT — `uri`, `method`, `status`,
 * `outcome`, `exception`. We pull the `count` for the URIs we
 * care about (workspace actions that aren't stored in the
 * Honcho DB) so the dashboard can show "how many search queries
 * today" / "how many dreams scheduled" without the backend having
 * to maintain a separate counter.
 *
 * The backend binds to 127.0.0.1 so the metrics endpoint is
 * reachable only from the same host. The dev server's
 * `proxy.conf.json` does NOT proxy `/actuator/*` to the backend
 * (it only proxies `/api/*`), so this service hits the backend
 * directly on its loopback port. The ApiClient's `profileId=null`
 * ensures no profile header is sent (the metrics endpoint is
 * session-gated by the backend, but we use the same session
 * header the user already has).
 */
@Injectable({ providedIn: 'root' })
export class MetricsService {
  private readonly api = inject(ApiClient);

  /**
   * {uri: count} for every URI the backend has recorded since
   * process start. Refreshed by calling `load()`. Used by the
   * dashboard's "queries / dreams / messages sent today" stat.
   */
  readonly countsByUri = signal<Record<string, number>>({});
  readonly lastLoadedAt = signal<number | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * URIs we care about for the dashboard. The /v3/... upstream
   * paths are NOT included — the actuator counter is for the
   * BACKEND's proxy endpoints (/api/...), not Honcho's.
   */
  static readonly TRACKED_URIS: readonly string[] = [
    '/api/search',
    '/api/dream',
    '/api/sessions/{sessionId}/messages',
    '/api/peers',
    '/api/sessions',
    '/api/profiles/{id}/test',
  ];

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const out: Record<string, number> = {};
      await Promise.all(
        MetricsService.TRACKED_URIS.map(async (uri) => {
          const res = await this.api.request<{
            measurements: { statistic: string; value: number }[];
          }>({
            method: 'GET',
            path: '/actuator/metrics/http.server.requests',
            query: { 'tag=uri': uri },
            profileId: null,
            anonymous: true,
            pathPrefix: '',
          });
          const count = res.measurements.find((m) => m.statistic === 'COUNT')?.value;
          if (typeof count === 'number') out[uri] = count;
        }),
      );
      this.countsByUri.set(out);
      this.lastLoadedAt.set(Date.now());
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.loading.set(false);
    }
  }
}
