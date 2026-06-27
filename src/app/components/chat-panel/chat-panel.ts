import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
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
export class ChatPanel implements OnChanges, AfterViewChecked {
  private readonly honcho = inject(HonchoService);

  @Input() peerId: string = '';

  @ViewChild('inputBox') inputBox?: ElementRef<HTMLTextAreaElement>;
  @ViewChild('scrollContainer') scrollContainer?: ElementRef<HTMLElement>;
  @ViewChild('bottomSentinel') bottomSentinel?: ElementRef<HTMLElement>;

  readonly inputValue = signal('');
  readonly busy = signal(false);
  readonly turns = signal<ChatTurn[]>([]);
  readonly error = signal<string | null>(null);

  readonly canSend = computed(() => this.inputValue().trim().length > 0 && !this.busy());

  /**
   * Set by AfterViewChecked when a new turn has appeared since the
   * last view check. Flipped back to false after the auto-scroll
   * runs. Avoids scrolling on every change-detection tick (which
   * would fight the operator if they were trying to read older
   * messages).
   */
  private pendingScroll = false;

  ngOnChanges(_changes?: SimpleChanges): void {
    // New peer selected: clear conversation + error so the operator
    // starts a fresh thread. We deliberately do NOT clear inputValue
    // here because the input is unbound in this lifecycle (the user
    // never sees it before the new peer turns the panel on).
    this.turns.set([]);
    this.inputValue.set('');
    this.error.set(null);
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
