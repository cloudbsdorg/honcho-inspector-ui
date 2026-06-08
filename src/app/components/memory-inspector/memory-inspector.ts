import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { HonchoService } from '../../core/honcho.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { ThemePicker } from '../theme-picker/theme-picker';
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
  imports: [CommonModule, FormsModule, ThemePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './memory-inspector.html',
  styleUrl: './memory-inspector.css',
})
export class MemoryInspector {
  readonly honcho = inject(HonchoService);
  private readonly auth = inject(HonchoAuthService);
  private readonly profileService = inject(ProfileService);
  private readonly router = inject(Router);

  readonly workspaceId = computed(() => this.profileService.activeProfile()?.workspaceId ?? '');
  readonly honchoUserName = computed(
    () => this.profileService.activeProfile()?.honchoUserName ?? '',
  );
  readonly userName = computed(() => this.auth.user()?.username ?? '');

  readonly tabs = signal<readonly Tab[]>([
    { id: 'workspace', label: 'Workspace', icon: '◎' },
    { id: 'peers', label: 'Peers', icon: '◉' },
    { id: 'sessions', label: 'Sessions', icon: '▤' },
    { id: 'conclusions', label: 'Conclusions', icon: '◈' },
    { id: 'search', label: 'Search', icon: '⌕' },
  ]);
  readonly activeTab = signal<TabId>('workspace');

  readonly workspace = signal<HonchoWorkspaceInspect | null>(null);
  readonly peers = signal<HonchoPeerSummary[]>([]);
  readonly sessions = signal<HonchoSessionSummary[]>([]);
  readonly peerDetail = signal<HonchoPeerInspect | null>(null);
  readonly sessionDetail = signal<HonchoSessionInspect | null>(null);
  readonly conclusions = signal<HonchoConclusion[]>([]);
  readonly searchResults = signal<HonchoMessage[]>([]);
  readonly searchInput = signal('');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly selectedPeerId = signal<string | null>(null);
  readonly selectedSessionId = signal<string | null>(null);

  setTab(id: TabId): void {
    this.activeTab.set(id);
    this.error.set(null);
  }

  async loadWorkspace(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const ws = await this.honcho.inspectWorkspace();
      this.workspace.set(ws);
      await this.honcho.refreshPeers();
      await this.honcho.refreshSessions();
      await this.honcho.refreshQueueStatus();
      this.peers.set(this.honcho.peers());
      this.sessions.set(this.honcho.sessions());
    } catch (e) {
      this.error.set(this.toMessage(e));
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
      this.error.set(this.toMessage(e));
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
      this.error.set(this.toMessage(e));
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
      this.error.set(this.toMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async queryConclusions(peerId: string, query: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const items = await this.honcho.queryConclusions(peerId, query, 25, 0.6);
      this.conclusions.set(items);
    } catch (e) {
      this.error.set(this.toMessage(e));
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
      this.error.set(this.toMessage(e));
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
      this.error.set(this.toMessage(e));
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

  toMessage(e: unknown): string {
    return this.honcho.friendlyErrorMessage(e);
  }
}
