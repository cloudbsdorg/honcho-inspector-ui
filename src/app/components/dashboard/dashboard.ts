import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
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
import { TimezoneService } from '../../core/timezone.service';
import { formatRelative, formatWallClock, formatWallClockTooltip } from '../../core/datetime';
import { WorkspaceOverview } from './workspace-overview';
import { MetricsService } from '../../core/metrics.service';
import { ChatPanel } from '../chat-panel/chat-panel';
import { MarkdownComponent } from '../markdown/markdown.component';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, FormsModule, WorkspaceOverview, ChatPanel, MarkdownComponent],
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
  private readonly metrics = inject(MetricsService);
  readonly tz = inject(TimezoneService);

  readonly formatRelative = formatRelative;
  readonly formatWallClock = formatWallClock;
  readonly formatWallClockTooltip = formatWallClockTooltip;

  private readonly SELECTED_PEER_KEY = 'honcho-dashboard-selected-peer';

  readonly ready: Promise<void>;

  readonly selectedPeerId = signal<string | null>(null);
  readonly peerCard = signal<string[]>([]);
  readonly peerRepresentation = signal<string>('');
  readonly loadingPeer = signal(false);
  readonly showNewPeerInput = signal(false);
  readonly newPeerId = signal('');

  readonly openInfoLabel = signal<string | null>(null);

  // Pop-out modal state. The Peer Card and Representation bodies
  // can be hundreds of lines long, and even the truncated version
  // of a 7 KB representation overflows the right pane. The ⤴
  // button on each section's header opens this full-viewport
  // overlay with the entire text, a Copy button, and an ESC
  // close. The chat panel uses a separate state because it
  // hosts a full interactive component (input + history +
  // send button), not a static body.
  readonly poppedOut = signal<{ title: string; body: string } | null>(null);
  readonly chatPoppedOut = signal(false);

  openPopOut(title: string, body: string): void {
    this.poppedOut.set({ title, body });
  }

  closePopOut(): void {
    this.poppedOut.set(null);
  }

  openChatPopOut(): void {
    this.chatPoppedOut.set(true);
  }

  closeChatPopOut(): void {
    this.chatPoppedOut.set(false);
  }

  /**
   * ESC closes whichever pop-out is open. The text pop-out wins
   * over the chat pop-out so a nested open/close cycles through
   * the two modals cleanly. Bound at the host level so the
   * keydown fires even if focus is inside the modal's body (the
   * user might be selecting text or typing in the chat input).
   */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.poppedOut()) {
      this.closePopOut();
    } else if (this.chatPoppedOut()) {
      this.closeChatPopOut();
    }
  }

  /**
   * Format a Peer Card `string[]` for the pop-out modal: each
   * fact on its own line as a bulleted item. The Markdown
   * component renders `- ` as a list, so this gives a clean
   * bulleted pop-out rather than a wall of text.
   */
  cardAsString(card: readonly string[]): string {
    return card.map((fact) => '- ' + fact).join('\n');
  }

  /**
   * Copy the pop-out body to the OS clipboard. Uses the async
   * Clipboard API when available (modern browsers) with a
   * graceful fallback to a hidden-textarea + document.execCommand
   * for older browsers and the http:// (insecure) context.
   */
  async copyPoppedOut(): Promise<void> {
    const body = this.poppedOut()?.body ?? '';
    if (!body) return;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(body);
        return;
      }
    } catch {
      // fall through to the legacy path
    }
    // Legacy fallback: stage the text in a temporary textarea and
    // run the deprecated execCommand('copy'). Survives in older
    // Safari, embedded webviews, and the http:// scheme.
    try {
      const ta = document.createElement('textarea');
      ta.value = body;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // give up silently — the modal stays open with the
      // text visible so the user can select + copy manually
    }
  }

  /**
   * Truncate a string to at most `limit` characters, breaking on a
   * word boundary if possible (so we don't slice mid-word), and
   * appending an ellipsis. Used to cap the inline Representation
   * body in the right pane so the layout doesn't grow without
   * bound. Returns the original string if it already fits.
   */
  truncate(text: string | null | undefined, limit = 600): string {
    if (!text) return '';
    if (text.length <= limit) return text;
    // Try to cut at the last whitespace within the window so the
    // ellipsis doesn't fall mid-word. Search the last 40 chars of
    // the window for a space; fall back to a hard cut.
    const window = text.slice(0, limit);
    const lastSpace = window.lastIndexOf(' ');
    if (lastSpace > limit - 40) {
      return window.slice(0, lastSpace) + '…';
    }
    return window + '…';
  }

  toggleInfo(label: string): void {
    this.openInfoLabel.update((current) => (current === label ? null : label));
  }

  closeInfo(): void {
    this.openInfoLabel.set(null);
  }

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
    // The dashboard always lands on the workspace overview.
    // A previously-clicked peer selection is intentionally not
    // restored — reloading `/` is the user's escape hatch back
    // to the overview from a peer card. The localStorage key
    // is still written by `selectPeer` so an explicit
    // "remember this peer" feature can be added later without
    // re-plumbing the write path.
    await Promise.all([
      this.honcho.refreshPeers().catch(() => undefined),
      this.honcho.refreshSessions().catch(() => undefined),
      this.honcho.refreshQueueStatus().catch(() => undefined),
      this.metrics.load().catch(() => undefined),
    ]);
  }

  async refreshAll(): Promise<void> {
    await Promise.all([
      this.honcho.refreshPeers().catch(() => undefined),
      this.honcho.refreshSessions().catch(() => undefined),
      this.honcho.refreshQueueStatus().catch(() => undefined),
      this.metrics.load().catch(() => undefined),
    ]);
  }

  lastRefreshLabel(ts: number): string {
    return formatRelative(ts);
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
}
