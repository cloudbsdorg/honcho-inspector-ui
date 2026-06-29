import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  Output,
  ViewChild,
  computed,
  signal,
} from '@angular/core';

/**
 * Two-stage confirmation modal for destructive operations. In-place
 * (parent-controlled); supports typed-confirmation (case-sensitive)
 * for high-blast-radius actions like bulk delete or workspace nuke.
 */
@Component({
  selector: 'app-confirm-destructive-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-destructive-dialog.html',
})
export class ConfirmDestructiveDialog implements OnChanges, AfterViewInit {
  @Input() open = false;
  @Input() title = '';
  @Input() description = '';
  @Input() confirmButtonText: string | null = null;
  /** Visual weight: low=accent, medium=warning, high=danger red. */
  @Input() dangerLevel: 'low' | 'medium' | 'high' = 'medium';
  /** Non-null: user must type this exact string to enable confirm. */
  @Input() typedConfirmation: string | null = null;

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

  readonly typedInput = signal('');

  readonly canConfirm = computed(() => {
    if (this.typedConfirmation == null) return true;
    return this.typedInput() === this.typedConfirmation;
  });

  readonly confirmColor = computed(() => {
    if (this.dangerLevel === 'high') return 'var(--danger)';
    if (this.dangerLevel === 'medium') return 'var(--accent-3)';
    return 'var(--accent)';
  });

  readonly resolvedLabel = computed(() => {
    if (this.confirmButtonText) return this.confirmButtonText;
    if (this.dangerLevel === 'high') return 'Delete forever';
    return 'Confirm';
  });

  @ViewChild('typedInputEl') typedInputEl?: ElementRef<HTMLInputElement>;

  ngOnChanges(): void {
    if (this.open) {
      this.typedInput.set('');
      queueMicrotask(() => this.typedInputEl?.nativeElement.focus());
    }
  }

  ngAfterViewInit(): void {
    if (this.open) {
      queueMicrotask(() => this.typedInputEl?.nativeElement.focus());
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.cancelled.emit();
  }

  onBackdrop(): void {
    this.cancelled.emit();
  }

  onPanelClick(event: MouseEvent): void {
    event.stopPropagation();
  }

  onTypedInput(event: Event): void {
    this.typedInput.set((event.target as HTMLInputElement).value ?? '');
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;
    this.confirmed.emit();
  }
}
