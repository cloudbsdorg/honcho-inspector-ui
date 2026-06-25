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

  readonly workspaceId = computed(() => this.profileService.activeProfile()?.workspaceId ?? '');
  readonly honchoUserName = computed(
    () => this.profileService.activeProfile()?.honchoUserName ?? '',
  );
  readonly userName = computed(() => this.auth.user()?.username ?? '');

  /**
   * Flatten an arbitrary metadata record into a sortable key/value
   * table. Nested objects and arrays are rendered as compact JSON
   * strings so the table never wraps unexpectedly. Used by the
   * "Metadata" section of the Workspace tab.
   */
  metadataEntries(obj: Record<string, unknown> | null | undefined): { key: string; value: string }[] {
    if (!obj) return [];
    return Object.entries(obj).map(([k, v]) => ({
      key: k,
      value: v === null || v === undefined
        ? ''
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v),
    }));
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
