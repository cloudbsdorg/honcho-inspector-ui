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

  ngOnChanges(_changes?: SimpleChanges): void {
    // New peer selected: clear conversation + error so the operator
    // starts a fresh thread. We deliberately do NOT clear inputValue
    // here because the input is unbound in this lifecycle (the user
    // never sees it before the new peer turns the panel on).
    this.turns.set([]);
    this.inputValue.set('');
    this.error.set(null);
  }

  ngOnDestroy(): void {
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
    this.turns.update((t) => [...t, { role: 'user', content: text, ts: Date.now() }]);
    this.inputValue.set('');
    this.pendingScroll = true;
    try {
      const reply = await this.honcho.chat(this.peerId, text);
      this.turns.update((t) => [
        ...t,
        { role: 'assistant', content: reply || '(no reply)', ts: Date.now() },
      ]);
    } catch (e) {
      this.error.set(formatError(e, 'Chat failed'));
    } finally {
      this.busy.set(false);
      this.busySince.set(null);
      this.busySeconds.set(0);
      this.stopBusyTicker();
      this.pendingScroll = true;
    }
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
