import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HonchoService } from '../../core/honcho.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import {
  HonchoConclusion,
  HonchoMessage,
  HonchoPeerInspect,
  HonchoPeerSummary,
  HonchoSessionInspect,
  HonchoSessionSummary,
  HonchoWorkspaceInspect,
} from '../../core/models';
import { TimezoneService } from '../../core/timezone.service';
import { formatRelative, formatWallClock, formatWallClockTooltip } from '../../core/datetime';

type TabId = 'workspace' | 'peers' | 'sessions' | 'conclusions' | 'search';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-memory-inspector',
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './memory-inspector.html',
  styleUrl: './memory-inspector.css',
})
export class MemoryInspector implements OnInit {
  readonly honcho = inject(HonchoService);
  private readonly auth = inject(HonchoAuthService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);
  readonly tz = inject(TimezoneService);

  readonly formatRelative = formatRelative;
  readonly formatWallClock = formatWallClock;
  readonly formatWallClockTooltip = formatWallClockTooltip;

  readonly workspaceId = computed(() => this.profileService.activeProfile()?.workspaceId ?? '');
  readonly honchoUserName = computed(
    () => this.profileService.activeProfile()?.honchoUserName ?? '',
  );
  readonly userName = computed(() => this.auth.user()?.username ?? '');

  /**
   * Flatten an arbitrary metadata record into a sortable key/value
   * table. Only LEAF values become rows; intermediate objects are
   * not rows themselves (their existence is encoded in the dotted
   * key path). Nested arrays and objects are recursed into; each
   * leaf gets a row with an indented `key` path ("a.b.c" or
   * "tags[0]") so the tree is visible without expanding/collapsing.
   * Cycles are guarded via a `seen` set; if a cycle is hit the leaf
   * renders the literal "<cycle>". Empty objects / arrays become
   * sentinel rows ("{}" / "[]") so they're visible too. Functions /
   * Symbols / BigInts are rendered via `String(v)`; null/undefined
   * render as "". The `depth` field drives the template indent step.
   */
  metadataEntries(
    obj: Record<string, unknown> | null | undefined,
  ): { key: string; value: string; depth: number }[] {
    const out: { key: string; value: string; depth: number }[] = [];
    const root = obj ?? {};
    // Top-level keys enter the recursion at depth 0; the children
    // of those keys become depth 1, etc.
    if (root && typeof root === 'object' && !Array.isArray(root)) {
      for (const [k, v] of Object.entries(root)) {
        this.flattenInto(out, k, v, new WeakSet(), 0);
      }
    }
    return out;
  }

  private flattenInto(
    out: { key: string; value: string; depth: number }[],
    prefix: string,
    value: unknown,
    seen: WeakSet<object>,
    depth: number,
  ): void {
    // Depth cap prevents pathological data (recursive arrays) from
    // blowing up the table; 16 is deep enough for any real Honcho
    // metadata shape.
    if (depth > 16) {
      out.push({
        key: prefix || '(root)',
        value: '<depth>',
        depth,
      });
      return;
    }
    if (value === null || value === undefined) {
      out.push({ key: prefix, value: '', depth });
      return;
    }
    if (Array.isArray(value)) {
      if (seen.has(value)) {
        out.push({ key: prefix, value: '<cycle>', depth });
        return;
      }
      seen.add(value);
      if (value.length === 0) {
        out.push({ key: prefix, value: '[]', depth });
        return;
      }
      value.forEach((item, i) => {
        const childKey = prefix ? `${prefix}[${i}]` : `[${i}]`;
        this.flattenInto(out, childKey, item, seen, depth + 1);
      });
      return;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      if (seen.has(obj)) {
        out.push({ key: prefix, value: '<cycle>', depth });
        return;
      }
      seen.add(obj);
      const entries = Object.entries(obj);
      if (entries.length === 0) {
        out.push({ key: prefix, value: '{}', depth });
        return;
      }
      // Descend into the object — only the leaves become rows.
      for (const [k, v] of entries) {
        const childKey = prefix ? `${prefix}.${k}` : k;
        this.flattenInto(out, childKey, v, seen, depth + 1);
      }
      return;
    }
    // Primitive leaf row.
    out.push({ key: prefix, value: String(value), depth });
  }

  readonly tabs = signal<readonly Tab[]>([
    { id: 'workspace', label: 'Workspace', icon: '◎' },
    { id: 'peers', label: 'Peers', icon: '◉' },
    { id: 'sessions', label: 'Sessions', icon: '▤' },
    { id: 'conclusions', label: 'Conclusions', icon: '◈' },
    { id: 'search', label: 'Search', icon: '⌕' },
  ]);
  readonly activeTab = signal<TabId>('workspace');

  readonly workspace = signal<HonchoWorkspaceInspect | null>(null);
  readonly peerDetail = signal<HonchoPeerInspect | null>(null);
  readonly sessionDetail = signal<HonchoSessionInspect | null>(null);
  readonly conclusions = signal<HonchoConclusion[]>([]);
  /**
   * Peers with at least one recorded conclusion. Populated lazily
   * when the Conclusions tab is opened — fetches `inspectPeer` for
   * every known peer in parallel and keeps the ones whose
   * conclusionCount > 0. Result is memoized for the lifetime of
   * the page so re-opening the tab doesn't re-probe.
   */
  readonly peersWithConclusions = signal<HonchoPeerSummary[]>([]);
  readonly loadingPeersWithConclusions = signal(false);
  private peersWithConclusionsLoaded = false;
  readonly searchResults = signal<HonchoMessage[]>([]);
  readonly searchInput = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly selectedPeerId = signal<string | null>(null);
  readonly selectedSessionId = signal<string | null>(null);

  setTab(id: TabId): void {
    this.activeTab.set(id);
    this.error.set(null);
    if (id === 'conclusions') {
      void this.loadPeersWithConclusions();
    }
  }

  ngOnInit(): void {
    if (this.workspaceId()) {
      void this.loadWorkspace();
    }
  }

  async loadWorkspace(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const ws = await this.honcho.inspectWorkspace();
      this.workspace.set(ws);
      await this.honcho.refreshQueueStatus();
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async selectPeer(id: string): Promise<void> {
    this.selectedPeerId.set(id);
    this.selectedSessionId.set(null);
    this.peerDetail.set(null);
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.honcho.inspectPeer(id);
      this.peerDetail.set(detail);
      this.conclusions.set(detail.recentConclusions);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async selectSession(id: string): Promise<void> {
    this.selectedSessionId.set(id);
    this.selectedPeerId.set(null);
    this.sessionDetail.set(null);
    this.loading.set(true);
    this.error.set(null);
    try {
      const detail = await this.honcho.inspectSession(id);
      this.sessionDetail.set(detail);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async loadConclusions(peerId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.honcho.listConclusions(peerId, { size: 100 });
      this.conclusions.set(page.items);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Probe every known peer for its conclusion count and keep only
   * the ones with > 0 conclusions. Runs as parallel fan-out so
   * the latency is bounded by the slowest single peer (not the
   * sum). Tolerates per-peer failures — a failing peer is skipped
   * instead of failing the whole load.
   */
  async loadPeersWithConclusions(): Promise<void> {
    if (this.peersWithConclusionsLoaded || this.loadingPeersWithConclusions()) return;
    const peers = this.honcho.peers();
    if (peers.length === 0) return;
    this.loadingPeersWithConclusions.set(true);
    try {
      const results = await Promise.allSettled(
        peers.map((p) => this.honcho.inspectPeer(p.id)),
      );
      const withConclusions: HonchoPeerSummary[] = [];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.conclusionCount > 0) {
          withConclusions.push(peers[i]);
        }
      }
      this.peersWithConclusions.set(withConclusions);
      this.peersWithConclusionsLoaded = true;
    } finally {
      this.loadingPeersWithConclusions.set(false);
    }
  }

  async queryConclusions(peerId: string, query: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const items = await this.honcho.queryConclusions(peerId, query, 25, 0.6);
      this.conclusions.set(items);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async searchWorkspace(query?: string): Promise<void> {
    const q = (query ?? this.searchInput()).trim();
    if (!q) {
      this.searchResults.set([]);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const results = await this.honcho.searchWorkspace(q, { limit: 25 });
      this.searchResults.set(results);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async triggerDream(): Promise<void> {
    const peerId = this.selectedPeerId();
    if (!peerId) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.honcho.scheduleDream(peerId);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    this.honcho.reset();
    await this.auth.logout();
  }

  goToDashboard(): void {
    this.router.navigateByUrl('/');
  }
}
