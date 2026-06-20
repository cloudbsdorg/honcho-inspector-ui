import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnChanges,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HonchoService } from '../../core/honcho.service';
import { formatError } from '../../core/error-message';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  ts: number;
}

@Component({
  selector: 'app-chat-panel',
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './chat-panel.html',
  styleUrl: './chat-panel.css',
})
export class ChatPanel implements OnChanges {
  private readonly honcho = inject(HonchoService);

  @Input() peerId: string = '';

  readonly inputValue = signal('');
  readonly busy = signal(false);
  readonly turns = signal<ChatTurn[]>([]);
  readonly error = signal<string | null>(null);

  readonly canSend = computed(
    () => this.inputValue().trim().length > 0 && !this.busy(),
  );

  ngOnChanges(): void {
    this.turns.set([]);
    this.inputValue.set('');
    this.error.set(null);
  }

  async send(): Promise<void> {
    const text = this.inputValue().trim();
    if (!text) return;
    this.busy.set(true);
    this.error.set(null);
    this.turns.update((t) => [
      ...t,
      { role: 'user', content: text, ts: Date.now() },
    ]);
    this.inputValue.set('');
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
    }
  }
}
