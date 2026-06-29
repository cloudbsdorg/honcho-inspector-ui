import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HonchoService } from '../../core/honcho.service';
import { MarkdownComponent } from '../markdown/markdown.component';
import { formatError } from '../../core/error-message';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

@Component({
  selector: 'app-chat-panel',
  imports: [CommonModule, FormsModule, MarkdownComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel implements OnChanges, OnDestroy, AfterViewChecked {
  private readonly honcho = inject(HonchoService);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);

  @Input() peerId: string = '';

  @ViewChild('inputBox') inputBox?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;
  @ViewChild('bottomSentinel') bottomSentinel?: ElementRef<HTMLElement>;

  readonly inputValue = signal('');
  readonly busy = signal(false);
  readonly turns = signal<ChatTurn[]>([]);
  readonly error = signal<string | null>(null);
  /**
   * Live assistant text while a stream is in flight. Updated
   * incrementally per chunk; the template renders this signal
   * directly inside the in-flight bubble so the operator sees
   * the response assemble token-by-token. Once `streamingDone`
   * flips true we commit the final value into `turns`.
   */
  readonly streamingAssistantTurn = signal('');
  /** True once the backend's `meta.done` envelope is received. */
  readonly streamingDone = signal(false);

  /**
   * Wall-clock timestamp (ms) of when the current `busy` state
   * began, or null when idle. The template uses this to render
   * a "still working…" message after 5 seconds so the operator
   * knows the request hasn't died — important for Honcho chat
   * where a single turn can take 10-30 seconds while the
   * upstream dream/derivation pipeline runs.
   */
  readonly busySince = signal<number | null>(null);
  /**
   * Live counter that increments once per second while `busy` is
   * true. Triggers the template's "still working…" re-render
   * without requiring a full change-detection cycle. Reset to 0
   * when the request finishes.
   */
  readonly busySeconds = signal(0);
  /**
   * True after the current `busy` state has lasted >5s. Flipped
   * back to false when the request finishes.
   */
  readonly longWait = computed(() => this.busySeconds() >= 5);

  readonly canSend = computed(() => this.inputValue().trim().length > 0 && !this.busy());

  /**
   * Set by AfterViewChecked when a new turn has appeared since the
   * last view check. Flipped back to false after the auto-scroll
   * runs. Avoids scrolling on every change-detection tick (which
   * would fight the operator if they were trying to read older
   * messages).
   */
  private pendingScroll = false;
  /**
   * setInterval handle for the once-per-second ticker that
   * increments `busySeconds` while a request is in flight. We
   * use a real timer (not a CSS animation) because the template
   * needs to react to the elapsed count to flip the
   * "still working…" message on at the 5-second mark.
   */
  private busyTicker: ReturnType<typeof setInterval> | null = null;
  /**
   * Active stream's abort handle. Set when `send()` starts a
   * streaming chat so the Cancel button (and `ngOnDestroy`) can
   * interrupt the underlying `fetch()` mid-flight. Cleared once
   * the stream terminates.
   */
  private activeAbort: AbortController | null = null;

  ngOnChanges(_changes?: SimpleChanges): void {
    // Peer swap mid-stream: tear down the in-flight reader so the
    // next turn starts from a clean slate. We don't surface an
    // error here because the operator didn't ask to cancel.
    this.activeAbort?.abort();
    this.activeAbort = null;
    this.streamingAssistantTurn.set('');
    this.streamingDone.set(false);
    // New peer selected: clear conversation + error so the operator
    // starts a fresh thread. We deliberately do NOT clear inputValue
    // here because the input is unbound in this lifecycle (the user
    // never sees it before the new peer turns the panel on).
    this.turns.set([]);
    this.inputValue.set('');
    this.error.set(null);
  }

  ngOnDestroy(): void {
    // Abort any in-flight stream so the underlying fetch() releases
    // its socket; otherwise the reader keeps the panel alive past
    // ngOnDestroy and the OS reclaims it more slowly.
    this.activeAbort?.abort();
    this.activeAbort = null;
    // Make sure no timer keeps firing after the panel is removed
    // (the chat pop-out closing is the main path here). Without
    // this, a stale interval would tick every second forever.
    this.stopBusyTicker();
  }

  /**
   * Start the once-per-second ticker. Run outside Angular's zone
   * so the timer callback doesn't trigger a full change-detection
   * cycle; the only signal that needs to update is `busySeconds`,
   * which is read by a computed in the template and re-evaluates
   * cheaply. Inside the callback, we `run` the signal update so
   * the template re-renders the elapsed-seconds text.
   */
  private startBusyTicker(): void {
    this.stopBusyTicker();
    this.zone.runOutsideAngular(() => {
      this.busyTicker = setInterval(() => {
        this.zone.run(() => this.busySeconds.update((s) => s + 1));
      }, 1000);
    });
  }

  private stopBusyTicker(): void {
    if (this.busyTicker != null) {
      clearInterval(this.busyTicker);
      this.busyTicker = null;
    }
  }

  ngAfterViewChecked(): void {
    if (this.pendingScroll) {
      this.scrollToBottom();
      this.pendingScroll = false;
    }
    // Re-size the textarea to match its content. Without this the
    // textarea would stay at 1 line until the user manually drags
    // the resize handle (which most users never find).
    this.autosize();
  }

  onInput(value: string): void {
    this.inputValue.set(value);
    // Mark a scroll needed on the next view check; textarea height
    // changes can shift the bottom sentinel out of view as the user
    // types a long message.
    this.pendingScroll = true;
  }

  /**
   * Enter sends, Shift+Enter inserts a newline. This is the standard
   * chat-client convention; without it the operator has to click the
   * Send button every time, which is friction.
   */
  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void this.send();
    }
  }

  dismissError(): void {
    this.error.set(null);
  }

  async send(): Promise<void> {
    const text = this.inputValue().trim();
    if (!text) return;
    this.busy.set(true);
    this.busySince.set(Date.now());
    this.busySeconds.set(0);
    this.startBusyTicker();
    this.error.set(null);
    // Pre-allocate the assistant turn as an empty placeholder; the
    // stream will fill it incrementally via streamingAssistantTurn
    // and we commit the final value into the same turn index below.
    this.turns.update((t) => [
      ...t,
      { role: 'user', content: text, ts: Date.now() },
      { role: 'assistant', content: '', ts: Date.now() },
    ]);
    this.inputValue.set('');
    this.pendingScroll = true;
    this.streamingAssistantTurn.set('');
    this.streamingDone.set(false);
    const myAbort = new AbortController();
    this.activeAbort = myAbort;
    try {
      for await (const chunk of this.honcho.chatStream(this.peerId, text, {
        signal: myAbort.signal,
      })) {
        if (myAbort.signal.aborted) break;
        if (chunk.text) {
          this.streamingAssistantTurn.update((s) => s + chunk.text);
        }
        if (chunk.done) {
          this.streamingDone.set(true);
          break;
        }
      }
      const finalText = this.streamingAssistantTurn();
      // Commit the streamed text into the placeholder turn so it
      // survives the next signal reset and renders as a normal
      // (non-streaming) bubble from then on.
      this.turns.update((t) => {
        const next = [...t];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx]!.role === 'assistant') {
          next[lastIdx] = { ...next[lastIdx]!, content: finalText || '(no reply)' };
        }
        return next;
      });
    } catch (e) {
      const msg = formatError(e, 'Chat failed');
      this.error.set(msg);
      // Drop the placeholder assistant turn so the operator doesn't
      // see a stale empty bubble next to the error message.
      this.turns.update((t) => {
        const next = [...t];
        const lastIdx = next.length - 1;
        if (lastIdx >= 0 && next[lastIdx]!.role === 'assistant' && next[lastIdx]!.content === '') {
          next.pop();
        }
        return next;
      });
    } finally {
      this.busy.set(false);
      this.busySince.set(null);
      this.busySeconds.set(0);
      this.streamingAssistantTurn.set('');
      this.streamingDone.set(false);
      this.activeAbort = null;
      this.stopBusyTicker();
      this.pendingScroll = true;
    }
  }

  /**
   * Abort the in-flight stream (if any). Wired to the Cancel
   * button so the operator can stop a long-running reply without
   * closing the panel.
   */
  cancel(): void {
    this.activeAbort?.abort();
  }

  private scrollToBottom(): void {
    const sentinel = this.bottomSentinel?.nativeElement;
    if (!sentinel) return;
    // scrollIntoView is more reliable than setting scrollTop on the
    // container because it handles the inner scroll boundary correctly
    // across browsers and flexbox layout quirks.
    sentinel.scrollIntoView({ block: 'end' });
  }

  /**
   * Resize the textarea to fit its current content. We measure the
   * scrollHeight of a clone (or just use scrollHeight on a
   * height:auto textarea) and clamp to [min-height, max-height].
   * Avoids the operator having to drag the resize handle.
   */
  private autosize(): void {
    const ta = this.inputBox?.nativeElement;
    if (!ta) return;
    // Reset to one line so scrollHeight reflects the natural content height.
    ta.style.height = 'auto';
    const lineHeight = 20; // matches text-sm leading-snug (~1.375 * 14px)
    const max = 12 * lineHeight; // 12rem-ish
    const next = Math.min(max, ta.scrollHeight);
    ta.style.height = next + 'px';
  }
}
