import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
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
import { ThemeService } from '../../core/theme.service';
import { ThemePicker } from '../theme-picker/theme-picker';
import { ChatPanel } from '../chat-panel/chat-panel';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule, ThemePicker, ChatPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class Dashboard implements OnInit {
  readonly honcho = inject(HonchoService);
  private readonly auth = inject(HonchoAuthService);
  private readonly router = inject(Router);
  readonly theme = inject(ThemeService);
  readonly profileService = inject(ProfileService);

  private readonly SELECTED_PEER_KEY = 'honcho-dashboard-selected-peer';

  readonly ready: Promise<void>;
  readonly userName = computed(() => this.auth.user()?.username ?? '');
  readonly profile = this.profileService.activeProfile;
  readonly profiles = this.profileService.profiles;

  readonly selectedPeerId = signal<string | null>(null);
  readonly peerCard = signal<string[]>([]);
  readonly peerRepresentation = signal<string>('');
  readonly loadingPeer = signal(false);
  readonly showNewPeerInput = signal(false);
  readonly newPeerId = signal('');

  readonly currentThemeName = computed(() => this.theme.currentMeta().name);

  constructor() {
    this.ready = this.bootstrap();
  }

  async ngOnInit(): Promise<void> {
    await this.ready;
  }

  private async bootstrap(): Promise<void> {
    try {
      await this.profileService.list();
    } catch {
      // ignore — guard handles redirects
    }
    try {
      await this.honcho.init();
    } catch {
      return;
    }
    const restoredPeer = this.restoreSelectedPeer();
    const refreshes = [
      this.honcho.refreshPeers().catch(() => undefined),
      this.honcho.refreshSessions().catch(() => undefined),
    ];
    if (restoredPeer) {
      refreshes.push(this.selectPeer(restoredPeer));
    }
    await Promise.all(refreshes);
  }

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.honcho.refreshPeers().catch(() => undefined),
      this.honcho.refreshSessions().catch(() => undefined),
    ]);
  }

  lastRefreshLabel(ts: number): string {
    const seconds = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (seconds < 5) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private restoreSelectedPeer(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const id = localStorage.getItem(this.SELECTED_PEER_KEY);
    if (!id) return null;
    this.selectedPeerId.set(id);
    return id;
  }

  async selectPeer(id: string): Promise<void> {
    this.selectedPeerId.set(id);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(this.SELECTED_PEER_KEY, id);
    }
    this.peerCard.set([]);
    this.peerRepresentation.set('');
    this.loadingPeer.set(true);
    try {
      const [card, rep] = await Promise.all([
        this.honcho.getPeerCard(id),
        this.honcho.getPeerRepresentation(id),
      ]);
      this.peerCard.set(card);
      this.peerRepresentation.set(rep);
    } finally {
      this.loadingPeer.set(false);
    }
  }

  toggleNewPeer(): void {
    this.showNewPeerInput.update((v) => !v);
    this.newPeerId.set('');
  }

  async createPeer(): Promise<void> {
    const id = this.newPeerId().trim();
    if (!id) return;
    this.showNewPeerInput.set(false);
    this.newPeerId.set('');
    await this.honcho.refreshPeers();
    await this.selectPeer(id);
  }

  switchProfile(id: string): void {
    this.profileService.setActive(id);
    this.honcho.reset();
    // Force a refresh; reload peers for the new profile
    this.refreshAll();
  }

  goToProfiles(): void {
    this.router.navigateByUrl('/profiles');
  }

  logout(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(this.SELECTED_PEER_KEY);
    }
    this.selectedPeerId.set(null);
    this.peerCard.set([]);
    this.peerRepresentation.set('');
    this.honcho.reset();
    this.auth.logout();
  }

  openInspector(): void {
    this.router.navigateByUrl('/inspector');
  }
}
