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

  readonly canSend = computed(
    () => this.inputValue().trim().length > 0 && !this.busy(),
  );

  ngOnChanges(): void {
    this.turns.set([]);
    this.inputValue.set('');
  }

  async send(): Promise<void> {
    const text = this.inputValue().trim();
    if (!text) return;
    this.busy.set(true);
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
      const msg = e instanceof Error ? e.message : 'Chat failed';
      this.turns.update((t) => [
        ...t,
        { role: 'assistant', content: `Error: ${msg}`, ts: Date.now() },
      ]);
    } finally {
      this.busy.set(false);
    }
  }
}
