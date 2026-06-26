import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from './api-client';

export interface DiagnosticsHealth {
  status: string;
  groups?: string[];
}

export interface DiagnosticsBuild {
  artifact?: string;
  version?: string;
  buildTime?: string;
  gitCommit?: string;
  gitBranch?: string;
}

export interface DiagnosticsMetric {
  name: string;
  measurements: Array<{ statistic: string; value: number }>;
  baseUnit?: string;
  description?: string;
}

export interface DiagnosticsEnvelope {
  health: DiagnosticsHealth;
  build: DiagnosticsBuild;
  metrics: DiagnosticsMetric[];
}

/**
 * Read-only view of the backend's /api/admin/diagnostics endpoint,
 * which itself polls the backend's internal instrumentation (Spring
 * Boot Actuator by default) and re-shapes the response into a
 * generic envelope. The browser only ever talks to /api/* — actuator
 * stays loopback-only behind the backend, which means reverse
 * proxies (nginx, apache, caddy) don't need to expose /actuator
 * publicly.
 *
 * The envelope shape is generic (health / build / metrics[]), so
 * when we swap the underlying instrumentation library we only have
 * to update the backend relay — the frontend doesn't change.
 */
@Injectable({ providedIn: 'root' })
export class DiagnosticsService {
  private readonly api = inject(ApiClient);

  readonly envelope = signal<DiagnosticsEnvelope | null>(null);
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  async load(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const env = await this.api.request<DiagnosticsEnvelope>({
        method: 'GET',
        path: '/admin/diagnostics',
        anonymous: false,
      });
      this.envelope.set(env);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.busy.set(false);
    }
  }
}
