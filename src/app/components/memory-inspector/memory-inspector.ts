import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
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
import { ConfigService } from '../../core/config.service';
import { ChatPanel } from '../chat-panel/chat-panel';
import { MarkdownComponent } from '../markdown/markdown.component';
import { ConfirmDestructiveDialog } from '../shared/confirm-destructive-dialog/confirm-destructive-dialog';

type TabId = 'workspace' | 'peers' | 'sessions' | 'conclusions' | 'search';

interface Tab {
  id: TabId;
  label: string;
  icon: string;
}

@Component({
  selector: 'app-memory-inspector',
  imports: [
    CommonModule,
    FormsModule,
    ChatPanel,
    MarkdownComponent,
    ConfirmDestructiveDialog,
  ],
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
  private readonly config = inject(ConfigService);
  /** Mirrors the server-side HONCHO_UI_CHAT_ENABLED flag. */
  readonly chatEnabled = this.config.chatEnabled;

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

  readonly peerSearchInput = signal('');
  readonly peerPageSize = signal(25);
  readonly peerCurrentPage = signal(1);

  readonly filteredPeers = computed<HonchoPeerSummary[]>(() => {
    const q = this.peerSearchInput().trim().toLowerCase();
    const all = this.honcho.peers();
    if (!q) return all;
    return all.filter((p) => p.id.toLowerCase().includes(q));
  });

  readonly peerTotalPages = computed(() => {
    const total = this.filteredPeers().length;
    return Math.max(1, Math.ceil(total / this.peerPageSize()));
  });

  readonly pagedPeers = computed<HonchoPeerSummary[]>(() => {
    const all = this.filteredPeers();
    const pageSize = this.peerPageSize();
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const currentPage = Math.min(Math.max(1, this.peerCurrentPage()), totalPages);
    if (currentPage !== this.peerCurrentPage()) {
      untracked(() => this.peerCurrentPage.set(currentPage));
    }
    const start = (currentPage - 1) * pageSize;
    return all.slice(start, start + pageSize);
  });

  readonly sessionSearchInput = signal('');
  readonly sessionPageSize = signal(25);
  readonly sessionCurrentPage = signal(1);

  readonly filteredSessions = computed<HonchoSessionSummary[]>(() => {
    const q = this.sessionSearchInput().trim().toLowerCase();
    const all = this.honcho.sessions();
    if (!q) return all;
    return all.filter((s) => s.id.toLowerCase().includes(q));
  });

  readonly sessionTotalPages = computed(() => {
    const total = this.filteredSessions().length;
    return Math.max(1, Math.ceil(total / this.sessionPageSize()));
  });

  readonly pagedSessions = computed<HonchoSessionSummary[]>(() => {
    const all = this.filteredSessions();
    const pageSize = this.sessionPageSize();
    const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
    const currentPage = Math.min(Math.max(1, this.sessionCurrentPage()), totalPages);
    if (currentPage !== this.sessionCurrentPage()) {
      untracked(() => this.sessionCurrentPage.set(currentPage));
    }
    const start = (currentPage - 1) * pageSize;
    return all.slice(start, start + pageSize);
  });

  constructor() {
    effect(() => {
      this.peerSearchInput();
      untracked(() => this.peerCurrentPage.set(1));
    });
    effect(() => {
      this.sessionSearchInput();
      untracked(() => this.sessionCurrentPage.set(1));
    });
  }

  // Pop-out modal state. When set, renders a full-screen overlay
  // with the full text + copy / close controls. The trigger lives
  // in the Peer Card / Representation sections of the right pane;
  // without it, long representation text would push everything
  // off the fold.
  readonly poppedOut = signal<{ title: string; body: string } | null>(null);

  // Chat pop-out: separate from the text pop-out because chat has
  // a much more complex UI (input + history + send button) that
  // needs the full app-chat-panel component, not a static body.
  // Triggered by the "Chat ↗" button on the peer detail header.
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
   * ESC closes the pop-out. Bound at the host level so the keyup
   * is captured even if focus is inside the modal's body (the
   * user might be selecting text). The host listener is the
   * standard Angular pattern for a global key handler that should
   * fire regardless of where focus is.
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
   * fact on its own line as a bulleted item, so the modal can
   * render it as a list (template splits on `\n- ` and renders
   * <li> elements) rather than a wall of text. Facts that don't
   * start with a leading dash get one prepended.
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
    // run the deprecated execCommand('copy'). Survives in
    // older Safari, embedded webviews, and the http:// scheme.
    try {
      const ta = document.createElement('textarea');
      ta.value = body;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch {
      // best-effort; operator can manually select + copy
    }
  }

  /**
   * Truncate a string to at most `limit` characters, breaking on a
   * word boundary if possible (so we don't slice mid-word), and
   * appending an ellipsis. Returns the original string if it
   * already fits. Used to cap the inline Representation body in
   * the right pane so the layout doesn't grow without bound.
   */
  truncate(text: string | null | undefined, limit = 400): string {
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

  setTab(id: TabId): void {
    this.activeTab.set(id);
    this.error.set(null);
    if (id === 'conclusions') {
      void this.loadPeersWithConclusions();
      // Default the empty state to the workspace-wide top-N so the page
      // is never blank when no peer has been chosen yet. The user can
      // then pick a peer to scope down, or come back here to widen
      // back to the default.
      if (!this.workspaceConclusionsLoaded() && this.conclusions().length === 0) {
        void this.loadLatestConclusions();
      }
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

  /**
   * Peer-selector change handler. Empty string means "no peer" (the
   * "— select peer —" option); previously the empty value made its
   * way into {@code inspectPeer("")} which fired a 404 against
   * {@code /api/peers//card} and surfaced that error to the user.
   * Now we clear the peer-scoped state and bail without touching
   * the network.
   */
  async selectPeer(id: string): Promise<void> {
    if (!id) {
      this.selectedPeerId.set(null);
      this.selectedSessionId.set(null);
      this.peerDetail.set(null);
      this.conclusions.set([]);
      this.loading.set(false);
      this.error.set(null);
      return;
    }
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
   * Switch the Conclusions tab to its default workspace-wide view:
   * the most-recent N conclusions across every peer. Sliced client-side
   * from the default page Honcho returns (Honcho v3 has no top-N param
   * on this endpoint, so the page comes back at its capped size and
   * we trim it to {@link workspaceConclusionsLimit}).
   *
   * Sets {@code selectedPeerId} back to null so the UI scope badge flips
   * from "peer: <id>" to "workspace (latest N)". Used both as the auto
   * default-load on opening the tab and as the target of switching
   * back to the empty option from the peer dropdown — the latter was
   * previously left as a stale peer-scoped list with no way to recover.
   */
  readonly workspaceConclusionsLimit = signal(10);
  readonly workspaceConclusionsLoaded = signal(false);
  async loadLatestConclusions(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.selectedPeerId.set(null);
    try {
      const page = await this.honcho.listWorkspaceConclusions(this.workspaceConclusionsLimit());
      this.conclusions.set(page.items);
      this.workspaceConclusionsLoaded.set(true);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Peer-selector change handler. Empty string means "no peer" (the
   * "— latest across workspace —" option); previously the empty value
   * made its way into {@code loadConclusions('')} which fired a 404
   * against {@code /api/peers//conclusions} and left a stale peer-scoped
   * list on screen. Now we route empty values to the workspace-wide
   * loader so the operator always sees a valid result.
   */
  async onConclusionsPeerChange(peerId: string): Promise<void> {
    if (!peerId) {
      await this.loadLatestConclusions();
      return;
    }
    this.selectedPeerId.set(peerId);
    await this.loadConclusions(peerId);
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

  /**
   * Copy a conclusion id to the OS clipboard with a graceful
   * fallback. The id is the only stable identifier for a
   * conclusion (the content can change, the timestamp is unstable
   * across replays); copying it lets the operator paste it into
   * the audit log or share it with a colleague without retyping
   * a 22-character random string from the GUI.
   */
  async copyConclusionId(id: string): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(id);
        return;
      }
    } catch {
        // fall through to the legacy path (e.g. on an insecure
        // http:// origin where the async clipboard API is gated)
    }
    // Legacy fallback: stage the text in a hidden <textarea>
    // and run the deprecated execCommand('copy'). Survives on
    // older browsers and on the dev server's http:// origin.
    const ta = document.createElement('textarea');
    ta.value = id;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      // give up silently — the user can still long-press the
      // monospace id in the UI to select + copy
    } finally {
      document.body.removeChild(ta);
    }
  }

  // ── Edit / delete / bulk operations ──────────────────────────────

  readonly selectedConclusionIds = signal<Set<string>>(new Set());
  readonly selectedSessionIds = signal<Set<string>>(new Set());

  readonly editingMessageId = signal<string | null>(null);
  readonly messageDraft = signal('');

  readonly peerCardDraft = signal<string[] | null>(null);
  readonly peerCardDirty = computed(() => {
    const draft = this.peerCardDraft();
    if (draft == null) return false;
    const server = this.peerDetail()?.card ?? [];
    if (draft.length !== server.length) return true;
    for (let i = 0; i < draft.length; i++) if (draft[i] !== server[i]) return true;
    return false;
  });

  readonly editSessionMetadataOpen = signal(false);
  readonly sessionMetadataDraft = signal<Record<string, string>>({});
  readonly sessionMetadataJson = signal('');
  readonly sessionMetadataJsonError = signal<string | null>(null);

  readonly sessionMenuOpen = signal(false);

  readonly createConclusionOpen = signal(false);
  readonly createConclusionContent = signal('');
  readonly createConclusionObserver = signal('');
  readonly createConclusionObserved = signal('');
  readonly createConclusionSession = signal('');
  readonly createConclusionSubmitting = signal(false);
  readonly createConclusionError = signal<string | null>(null);

  readonly sessionMessages = signal<HonchoMessage[]>([]);
  readonly sessionMessagesLoading = signal(false);

  readonly destructiveDialog = signal<
    | {
        title: string;
        description: string;
        confirmButtonText: string;
        dangerLevel: 'low' | 'medium' | 'high';
        typedConfirmation: string | null;
        onConfirm: () => void | Promise<void>;
      }
    | null
  >(null);

  askDestructive(opts: {
    title: string;
    description: string;
    confirmButtonText: string;
    dangerLevel: 'low' | 'medium' | 'high';
    typedConfirmation: string | null;
    onConfirm: () => void | Promise<void>;
  }): void {
    this.destructiveDialog.set(opts);
  }

  onDestructiveConfirmed(): void {
    const cfg = this.destructiveDialog();
    if (!cfg) return;
    this.destructiveDialog.set(null);
    void cfg.onConfirm();
  }

  onDestructiveCancelled(): void {
    this.destructiveDialog.set(null);
  }

  // Conclusions tab: bulk + create

  isConclusionSelected(id: string): boolean {
    return this.selectedConclusionIds().has(id);
  }

  toggleConclusionSelect(id: string): void {
    const next = new Set(this.selectedConclusionIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedConclusionIds.set(next);
  }

  selectAllConclusions(): void {
    this.selectedConclusionIds.set(new Set(this.conclusions().map((c) => c.id)));
  }

  clearConclusionSelections(): void {
    this.selectedConclusionIds.set(new Set());
  }

  private refreshCurrentConclusions(): Promise<void> {
    const peerId = this.selectedPeerId();
    if (peerId) return this.loadConclusions(peerId);
    return this.loadLatestConclusions();
  }

  deleteOneConclusion(id: string): void {
    this.askDestructive({
      title: 'Delete this conclusion?',
      description: 'The derived fact will be removed from Honcho permanently. This affects the observer view.',
      confirmButtonText: 'Delete conclusion',
      dangerLevel: 'medium',
      typedConfirmation: 'delete conclusion',
      onConfirm: async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          await this.honcho.deleteConclusion(id);
          await this.refreshCurrentConclusions();
          const next = new Set(this.selectedConclusionIds());
          next.delete(id);
          this.selectedConclusionIds.set(next);
        } catch (e) {
          this.error.set(this.honcho.friendlyErrorMessage(e));
        } finally {
          this.loading.set(false);
        }
      },
    });
  }

  bulkDeleteConclusions(): void {
    const ids = [...this.selectedConclusionIds()];
    if (ids.length === 0) return;
    this.askDestructive({
      title: `Delete ${ids.length} conclusion${ids.length === 1 ? '' : 's'}?`,
      description: `Honcho will permanently remove ${ids.length} conclusions. This affects the observer's representation.`,
      confirmButtonText: `Delete ${ids.length} conclusions`,
      dangerLevel: 'high',
      typedConfirmation: `delete ${ids.length} conclusion${ids.length === 1 ? '' : 's'}`,
      onConfirm: async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          for (const id of ids) {
            await this.honcho.deleteConclusion(id).catch((e) => {
              throw new Error(`failed at ${id}: ${this.honcho.friendlyErrorMessage(e)}`);
            });
          }
          this.selectedConclusionIds.set(new Set());
          await this.refreshCurrentConclusions();
        } catch (e) {
          this.error.set(this.honcho.friendlyErrorMessage(e));
        } finally {
          this.loading.set(false);
        }
      },
    });
  }

  openCreateConclusion(): void {
    this.createConclusionContent.set('');
    this.createConclusionObserver.set(this.selectedPeerId() ?? '');
    this.createConclusionObserved.set('');
    this.createConclusionSession.set('');
    this.createConclusionError.set(null);
    this.createConclusionOpen.set(true);
  }

  closeCreateConclusion(): void {
    this.createConclusionOpen.set(false);
  }

  async submitCreateConclusion(): Promise<void> {
    const content = this.createConclusionContent().trim();
    const observer = this.createConclusionObserver().trim();
    const observed = this.createConclusionObserved().trim();
    const session = this.createConclusionSession().trim();
    if (!content || !observer || !observed) {
      this.createConclusionError.set('content, observer, and observed are required');
      return;
    }
    this.createConclusionSubmitting.set(true);
    this.createConclusionError.set(null);
    try {
      await this.honcho.createConclusion(content, observer, observed, session || null);
      this.createConclusionOpen.set(false);
      await this.refreshCurrentConclusions();
    } catch (e) {
      this.createConclusionError.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.createConclusionSubmitting.set(false);
    }
  }

  // Peer card inline edit

  startPeerCardEdit(): void {
    const card = this.peerDetail()?.card ?? [];
    this.peerCardDraft.set([...card]);
  }

  addPeerCardRow(): void {
    const draft = this.peerCardDraft();
    if (draft == null) return;
    this.peerCardDraft.set([...draft, '']);
  }

  removePeerCardRow(i: number): void {
    const draft = this.peerCardDraft();
    if (draft == null) return;
    const next = draft.filter((_, idx) => idx !== i);
    this.peerCardDraft.set(next);
  }

  updatePeerCardRow(i: number, value: string): void {
    const draft = this.peerCardDraft();
    if (draft == null) return;
    const next = draft.slice();
    next[i] = value;
    this.peerCardDraft.set(next);
  }

  cancelPeerCardEdit(): void {
    this.peerCardDraft.set(null);
  }

  async savePeerCard(): Promise<void> {
    const draft = this.peerCardDraft();
    const peerId = this.selectedPeerId();
    if (draft == null || !peerId) return;
    const facts = draft.map((s) => s.trim()).filter((s) => s.length > 0);
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.honcho.updatePeerCard(peerId, facts);
      await this.selectPeer(peerId);
      this.peerCardDraft.set(null);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // Session metadata edit + delete

  toggleSessionMenu(): void {
    this.sessionMenuOpen.set(!this.sessionMenuOpen());
  }

  closeSessionMenu(): void {
    this.sessionMenuOpen.set(false);
  }

  openEditSessionMetadata(): void {
    this.closeSessionMenu();
    const sessionId = this.selectedSessionId();
    if (!sessionId) return;
    this.sessionMetadataDraft.set({});
    this.sessionMetadataJson.set('{}');
    this.sessionMetadataJsonError.set(null);
    this.editSessionMetadataOpen.set(true);
  }

  closeEditSessionMetadata(): void {
    this.editSessionMetadataOpen.set(false);
  }

  addMetadataKey(): void {
    const next = { ...this.sessionMetadataDraft(), '': '' };
    this.sessionMetadataDraft.set(next);
  }

  removeMetadataKey(key: string): void {
    const next = { ...this.sessionMetadataDraft() };
    delete next[key];
    this.sessionMetadataDraft.set(next);
  }

  updateMetadataKey(oldKey: string, newKey: string): void {
    const draft = this.sessionMetadataDraft();
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(draft)) {
      next[k === oldKey ? newKey : k] = v;
    }
    this.sessionMetadataDraft.set(next);
  }

  updateMetadataValue(key: string, value: string): void {
    this.sessionMetadataDraft.set({ ...this.sessionMetadataDraft(), [key]: value });
  }

  onSessionMetadataJsonChange(value: string): void {
    this.sessionMetadataJson.set(value);
    const trimmed = value.trim();
    if (!trimmed) {
      this.sessionMetadataDraft.set({});
      this.sessionMetadataJsonError.set(null);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(parsed)) flat[k] = String(v);
        this.sessionMetadataDraft.set(flat);
        this.sessionMetadataJsonError.set(null);
      } else {
        this.sessionMetadataJsonError.set('Must be a JSON object');
      }
    } catch (e) {
      this.sessionMetadataJsonError.set(`invalid JSON: ${(e as Error).message}`);
    }
  }

  async saveSessionMetadata(): Promise<void> {
    const sessionId = this.selectedSessionId();
    if (!sessionId) return;
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(this.sessionMetadataDraft())) {
      if (k.length === 0) continue;
      metadata[k] = v;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.honcho.updateSession(sessionId, { metadata });
      this.editSessionMetadataOpen.set(false);
      await this.selectSession(sessionId);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  deleteCurrentSession(): void {
    const sessionId = this.selectedSessionId();
    if (!sessionId) return;
    this.closeSessionMenu();
    this.askDestructive({
      title: `Delete session "${sessionId}"?`,
      description:
        'Honcho will permanently remove this session and every message inside it. This cannot be undone.',
      confirmButtonText: 'Delete session',
      dangerLevel: 'high',
      typedConfirmation: `delete session ${sessionId}`,
      onConfirm: async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          await this.honcho.deleteSession(sessionId);
          this.selectedSessionId.set(null);
          this.sessionDetail.set(null);
          this.sessionMessages.set([]);
          await this.honcho.refreshSessions();
        } catch (e) {
          this.error.set(this.honcho.friendlyErrorMessage(e));
        } finally {
          this.loading.set(false);
        }
      },
    });
  }

  // Messages: edit only. Honcho v3 has no message-delete endpoint, so
  // the UI no longer offers a delete affordance on the messages tab
  // (Honcho confirms this in the AdminTestFixtureController Javadoc).
  // Conclusions + sessions are still individually deletable; messages
  // are not.

  startEditMessage(msg: HonchoMessage): void {
    this.editingMessageId.set(msg.id);
    this.messageDraft.set(msg.content);
  }

  cancelEditMessage(): void {
    this.editingMessageId.set(null);
    this.messageDraft.set('');
  }

  async saveEditMessage(): Promise<void> {
    const sessionId = this.selectedSessionId();
    const id = this.editingMessageId();
    const content = this.messageDraft();
    if (!sessionId || !id) return;
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.honcho.updateMessage(sessionId, id, { content });
      this.cancelEditMessage();
      await this.loadSessionMessages();
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  // Sessions list: bulk + per-row delete

  isSessionSelected(id: string): boolean {
    return this.selectedSessionIds().has(id);
  }

  toggleSessionSelect(id: string): void {
    const next = new Set(this.selectedSessionIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedSessionIds.set(next);
  }

  clearSessionSelections(): void {
    this.selectedSessionIds.set(new Set());
  }

  selectAllSessions(): void {
    this.selectedSessionIds.set(new Set(this.honcho.sessions().map((s) => s.id)));
  }

  deleteOneSession(id: string): void {
    this.askDestructive({
      title: `Delete session "${id}"?`,
      description:
        'Honcho will permanently remove this session and every message inside it. This cannot be undone.',
      confirmButtonText: 'Delete session',
      dangerLevel: 'high',
      typedConfirmation: `delete session ${id}`,
      onConfirm: async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          await this.honcho.deleteSession(id);
          if (this.selectedSessionId() === id) {
            this.selectedSessionId.set(null);
            this.sessionDetail.set(null);
            this.sessionMessages.set([]);
          }
          this.selectedSessionIds.update((s) => {
            const next = new Set(s);
            next.delete(id);
            return next;
          });
          await this.honcho.refreshSessions();
        } catch (e) {
          this.error.set(this.honcho.friendlyErrorMessage(e));
        } finally {
          this.loading.set(false);
        }
      },
    });
  }

  bulkDeleteSessions(): void {
    const ids = [...this.selectedSessionIds()];
    if (ids.length === 0) return;
    this.askDestructive({
      title: `Delete ${ids.length} session${ids.length === 1 ? '' : 's'}?`,
      description: `Honcho will permanently remove ${ids.length} sessions. This cannot be undone.`,
      confirmButtonText: `Delete ${ids.length} sessions`,
      dangerLevel: 'high',
      typedConfirmation: `delete ${ids.length} session${ids.length === 1 ? '' : 's'}`,
      onConfirm: async () => {
        this.loading.set(true);
        this.error.set(null);
        try {
          for (const id of ids) {
            await this.honcho.deleteSession(id).catch((e) => {
              throw new Error(`failed at ${id}: ${this.honcho.friendlyErrorMessage(e)}`);
            });
          }
          this.selectedSessionIds.set(new Set());
          if (this.selectedSessionId() && ids.includes(this.selectedSessionId()!)) {
            this.selectedSessionId.set(null);
            this.sessionDetail.set(null);
            this.sessionMessages.set([]);
          }
          await this.honcho.refreshSessions();
        } catch (e) {
          this.error.set(this.honcho.friendlyErrorMessage(e));
        } finally {
          this.loading.set(false);
        }
      },
    });
  }

  // Session messages loader

  async loadSessionMessages(): Promise<void> {
    const sessionId = this.selectedSessionId();
    if (!sessionId) {
      this.sessionMessages.set([]);
      return;
    }
    this.sessionMessagesLoading.set(true);
    try {
      const result = await this.honcho.listSessionMessages(sessionId, { size: 100 });
      this.sessionMessages.set(result.items);
    } catch (e) {
      this.error.set(this.honcho.friendlyErrorMessage(e));
    } finally {
      this.sessionMessagesLoading.set(false);
    }
  }

  /**
   * Session-selector change handler. Empty string means "no session"
   * (the "— select session —" option); previously the empty value
   * made its way through {@code selectSession("")} → 404 against
   * {@code /api/sessions//} and surfaced that error to the user.
   * Now we clear the session-scoped state and bail without touching
   * the network.
   */
  async selectSessionWithMessages(id: string): Promise<void> {
    if (!id) {
      this.selectedSessionId.set(null);
      this.sessionDetail.set(null);
      this.sessionMessages.set([]);
      this.loading.set(false);
      this.error.set(null);
      return;
    }
    await this.selectSession(id);
    await this.loadSessionMessages();
  }

  /** Iterate an object as a list of {key,value} pairs (template @for). */
  objectEntries(obj: Record<string, string>): { key: string; value: string }[] {
    return Object.entries(obj).map(([key, value]) => ({ key, value }));
  }
}
