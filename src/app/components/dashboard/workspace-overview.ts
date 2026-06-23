import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ChartComponent } from '../charts/chart.component';
import { HonchoService } from '../../core/honcho.service';
import { MetricsService } from '../../core/metrics.service';
import {
  GRANULARITIES,
  GRANULARITY_LABELS,
  GRANULARITY_MS,
  type Granularity,
  bucketByCreatedAt,
  bucketLabel,
  totalsByWindow,
  topNByCount,
} from '../../core/stats';
import type { ChartConfiguration } from 'chart.js';
import type {
  HonchoPeerSummary,
  HonchoSessionSummary,
  HonchoQueueStatus,
} from '../../core/models';

interface KpiCard {
  label: string;
  value: string;
  sublabel?: string;
  tone: 'accent' | 'accent-2' | 'accent-3' | 'success' | 'danger';
  /**
   * Long-form description shown in the per-card info popover. Plain
   * text (not HTML) — the template wraps it in a <p>. Kept here on
   * the card spec rather than as a separate map so the data is
   * co-located with the label and value it describes.
   */
  info: string;
}

/**
 * Workspace-overview landing panel. Replaces the "SELECT A PEER"
 * empty state with a data-rich summary so the operator can see
 * at a glance:
 *   - the four headline numbers (peers, sessions, conclusions, queue)
 *   - the per-window totals (last 1m / 5m / 15m / ... / 1mo) for
 *     peer additions and session creations
 *   - top-10 peers by total activity
 *   - recent activity (newest 10 peers/sessions side by side)
 *   - two charts: a line chart of additions per the user-chosen
 *     granularity, and a doughnut of queue composition
 *   - the per-endpoint action counts (queries, dreams, messages
 *     sent) sourced from the backend's Actuator metrics
 *
 * Designed for the case where the user has just logged in and
 * wants to "see what's in there" without clicking into any one
 * peer yet. The existing peer-detail view is unchanged — this
 * component just occupies the empty-state slot when no peer is
 * selected.
 */
@Component({
  selector: 'app-workspace-overview',
  imports: [ChartComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-overview.html',
  styleUrl: './workspace-overview.css',
})
export class WorkspaceOverview {
  private readonly honcho = inject(HonchoService);
  protected readonly metrics = inject(MetricsService);

  readonly granularity = signal<Granularity>('1d');
  readonly now = signal<number>(Date.now());

  // Auto-refresh the "now" anchor every minute so the rolling
  // windows stay accurate. Cheap (just a signal write), and
  // Angular's OnPush picks it up via the computed signals below.
  private readonly nowTimer = (() => {
    if (typeof window === 'undefined') return null;
    return window.setInterval(() => this.now.set(Date.now()), 60_000);
  })();

  ngOnDestroy(): void {
    if (this.nowTimer !== null) clearInterval(this.nowTimer);
  }

  // The composite inspect result. Re-derives whenever honcho.peers
  // or honcho.sessions change, and the now anchor rolls forward.
  private readonly inspect = computed<{ peerCount: number; sessionCount: number; queue: HonchoQueueStatus } | null>(() => {
    const peers = this.honcho.peers();
    const sessions = this.honcho.sessions();
    const queue = this.honcho.queueStatus();
    if (!queue) return null;
    return {
      peerCount: peers.length,
      sessionCount: sessions.length,
      queue,
    };
  });

  readonly peerTotals = computed(() =>
    totalsByWindow<HonchoPeerSummary>(this.honcho.peers(), this.now()),
  );

  readonly sessionTotals = computed(() =>
    totalsByWindow<HonchoSessionSummary>(this.honcho.sessions(), this.now()),
  );

  readonly peerBuckets = computed(() => {
    const peers = this.honcho.peers();
    const g = this.granularity();
    // The duration in ms is whichever is LARGER between the user's chosen
    // granularity and the duration the granularity implies. This keeps the
    // chart's x-axis wide enough to be useful (a 1m granularity over 1d
    // would show 1440 ticks; a 1mo granularity over 1d is 1 tick). The
    // wider wins.
    const dur = Math.max(GRANULARITY_MS[this.granularityDuration()], GRANULARITY_MS[g]);
    return bucketByCreatedAt(peers, g, this.now(), dur);
  });

  readonly sessionBuckets = computed(() => {
    const sessions = this.honcho.sessions();
    const g = this.granularity();
    const dur = Math.max(GRANULARITY_MS[this.granularityDuration()], GRANULARITY_MS[g]);
    return bucketByCreatedAt(sessions, g, this.now(), dur);
  });

  // Sensible default duration per granularity. At coarser windows
  // we look back further so the chart has more than one tick.
  readonly granularityDuration = computed<keyof typeof GRANULARITY_MS>(() => {
    switch (this.granularity()) {
      case '1m':
      case '5m':
      case '15m':
        return '1d';
      case '30m':
        return '1d';
      case '1h':
        return '1w';
      case '6h':
        return '1w';
      case '12h':
        return '1w';
      case '1d':
        return '1mo';
      case '1w':
        return '1mo';
      case '1mo':
        return '1mo';
    }
  });

  readonly granularities = GRANULARITIES;
  readonly granularityLabels = GRANULARITY_LABELS;

  readonly granularityBuckets = computed(() => GRANULARITY_MS[this.granularity()]);
  readonly granularityDurations = GRANULARITY_MS;

  // Top-10 peers by sessions-this-peer-is-in, derived from the
  // already-loaded peers + sessions arrays. No extra backend call.
  readonly topPeers = computed(() => {
    const peers = this.honcho.peers();
    const sessions = this.honcho.sessions();
    const sessionToPeers = new Map<HonchoSessionSummary, number>();
    const peerSessionCount = new Map<HonchoPeerSummary, number>();
    for (const s of sessions) {
      sessionToPeers.set(s, s.peerIds?.length ?? 0);
      for (const pid of s.peerIds ?? []) {
        const peer = peers.find((p) => p.id === pid);
        if (peer) peerSessionCount.set(peer, (peerSessionCount.get(peer) ?? 0) + 1);
      }
    }
    return topNByCount(peerSessionCount, peers, 10);
  });

  // Recent activity: last 10 created peers + last 10 created sessions,
  // sorted by createdAt desc and merged. Used to render a single
  // "recent activity" list.
  readonly recentActivity = computed(() => {
    const peers = [...this.honcho.peers()].sort(
      (a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''),
    );
    const sessions = [...this.honcho.sessions()].sort(
      (a, b) => Date.parse(b.createdAt ?? '') - Date.parse(a.createdAt ?? ''),
    );
    const out: Array<{ kind: 'peer' | 'session'; id: string; createdAt: string; detail: string }> = [];
    for (const p of peers) {
      if (!p.createdAt) continue;
      out.push({ kind: 'peer', id: p.id, createdAt: p.createdAt, detail: 'peer created' });
    }
    for (const s of sessions) {
      if (!s.createdAt) continue;
      const peerCount = s.peerIds?.length ?? 0;
      out.push({
        kind: 'session',
        id: s.id,
        createdAt: s.createdAt,
        detail: `session created (${peerCount} peer${peerCount === 1 ? '' : 's'})`,
      });
    }
    out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return out.slice(0, 10);
  });

  // Chart data: line chart of (peer additions, session creations)
  // bucketed at the user-chosen granularity.
  readonly additionsChart = computed<ChartConfiguration>(() => {
    const labels = this.peerBuckets().map((b) => bucketLabel(b.startMs, this.granularity()));
    const peerData = this.peerBuckets().map((b) => b.count);
    const sessionData = this.sessionBuckets().map((b) => b.count);
    return {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Peers added',
            data: peerData,
            borderColor: '#ff2d95',
            backgroundColor: 'rgba(255,45,149,0.15)',
            tension: 0.25,
            fill: true,
          },
          {
            label: 'Sessions created',
            data: sessionData,
            borderColor: '#00f0ff',
            backgroundColor: 'rgba(0,240,255,0.15)',
            tension: 0.25,
            fill: true,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#fff0ff' } },
        },
        scales: {
          x: { ticks: { color: '#c98bff', maxRotation: 0, autoSkip: true }, grid: { color: 'rgba(255,0,255,0.1)' } },
          y: { ticks: { color: '#c98bff', precision: 0 }, grid: { color: 'rgba(255,0,255,0.1)' }, beginAtZero: true },
        },
      },
    };
  });

  // Doughnut: queue composition (completed / in-progress / pending).
  readonly queueChart = computed<ChartConfiguration>(() => {
    const q = this.honcho.queueStatus();
    if (!q) {
      return {
        type: 'doughnut',
        data: { labels: [], datasets: [{ data: [] as number[] }] },
        options: { responsive: true, maintainAspectRatio: false },
      };
    }
    return {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'In progress', 'Pending'],
        datasets: [
          {
            // Cast: chart.js types the doughnut data as a heterogeneous
            // union, but we're feeding plain numbers; the cast is the
            // minimum needed to satisfy TS without an `as any`.
            data: [q.completedWorkUnits, q.inProgressWorkUnits, q.pendingWorkUnits] as number[],
            backgroundColor: ['#00ff9d', '#ffe600', '#ff0040'],
            borderColor: '#0a0014',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#fff0ff' } },
        },
      },
    };
  });

  readonly kpis = computed<KpiCard[]>(() => {
    const ins = this.inspect();
    const pt = this.peerTotals();
    const st = this.sessionTotals();
    const c = this.metrics.countsByUri();
    return [
      {
        label: 'Peers',
        value: String(ins?.peerCount ?? 0),
        sublabel: `+${pt.last1d} today · +${pt.last1w} this week`,
        tone: 'accent',
        info: 'Total number of peers in this Honcho workspace. A peer is a person, agent, or persona that Honcho tracks memory for. The "+today" and "+this week" subline counts peers created in the last 24 hours / 7 days, derived from the peers\' createdAt timestamps.',
      },
      {
        label: 'Sessions',
        value: String(ins?.sessionCount ?? 0),
        sublabel: `+${st.last1d} today · +${st.last1w} this week`,
        tone: 'accent-2',
        info: 'Total number of sessions in this workspace. A session is a conversation thread between two or more peers. Sessions can span many messages and may be reactivated across days. Counts are derived from sessions\' createdAt timestamps.',
      },
      {
        label: 'Searches',
        value: String(c['/api/search'] ?? 0),
        sublabel: 'all-time count',
        tone: 'accent-3',
        info: 'Total number of workspace-wide semantic search calls the backend has handled (POST /api/search). A search returns messages across all peers in the workspace that match a natural-language query. This is the all-time process counter; reset on backend restart.',
      },
      {
        label: 'Dreams scheduled',
        value: String(c['/api/dream'] ?? 0),
        sublabel: 'all-time count',
        tone: 'success',
        info: 'Total number of dream tasks the backend has scheduled (POST /api/dream). A "dream" in Honcho is a background memory-consolidation job — Honcho reads a peer\'s recent messages, extracts insights, and updates their representation and peer card. Like searches, this is a process-lifetime counter.',
      },
      {
        label: 'Messages sent',
        value: String(c['/api/sessions/{sessionId}/messages'] ?? 0),
        sublabel: 'all-time count',
        tone: 'accent',
        info: 'Total number of messages added to sessions via the backend (POST /api/sessions/{id}/messages). One per call. Use the peer detail view to see per-session message contents and inspect the per-peer representation that Honcho derives from them.',
      },
      {
        label: 'Queue (pending)',
        value: String(ins?.queue.pendingWorkUnits ?? 0),
        sublabel: `${ins?.queue.inProgressWorkUnits ?? 0} in progress · ${ins?.queue.completedWorkUnits ?? 0} done`,
        tone: 'danger',
        info: 'Number of pending background work units in the Honcho queue (GET /v3/workspaces/{ws}/queue/status). Honcho enqueues a work unit every time it processes a message, runs a dream, or derives a representation. "In progress" is work currently being processed; "done" is total completed. If pending keeps growing, Honcho is falling behind.',
      },
    ];
  });

  /**
   * Which KPI card\'s info popover is currently open, by label.
   * null = no popover open. Only one popover open at a time.
   */
  readonly openInfoLabel = signal<string | null>(null);

  toggleInfo(label: string): void {
    this.openInfoLabel.update((current) => (current === label ? null : label));
  }

  closeInfo(): void {
    this.openInfoLabel.set(null);
  }

  // Top-N list: each peer's id + count of sessions it's in.
  // Renders below the charts.

  setGranularity(g: Granularity): void {
    this.granularity.set(g);
  }

  reloadMetrics(): void {
    void this.metrics.load();
  }

  // Type-erased view of the additions chart data so the template
  // binding doesn't trip Angular's strict template type-check on
  // chart.js's broad `ChartConfiguration['data']` union.
  readonly additionsChartData = computed(() => this.additionsChart().data as object);
  readonly additionsChartOptions = computed(() => this.additionsChart().options ?? {});
  readonly queueChartData = computed(() => this.queueChart().data as object);
  readonly queueChartOptions = computed(() => this.queueChart().options ?? {});
}
