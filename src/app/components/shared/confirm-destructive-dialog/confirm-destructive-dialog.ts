import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  HostListener,
  Input,
  Output,
  computed,
} from '@angular/core';

/**
 * Two-stage confirmation modal for destructive operations. In-place
 * (parent-controlled). Danger is conveyed by the dialog's red framing +
 * the body's `cannot be undone` copy — there is no typed-confirm
 * challenge anymore. (The previous typedConfirmation field was removed
 * because users saw a "Delete" button on the modal and clicked it
 * without realizing they had to type a specific phrase first, which
 * read as "the delete doesn't work".)
 */
@Component({
  selector: 'app-confirm-destructive-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './confirm-destructive-dialog.html',
})
export class ConfirmDestructiveDialog {
  @Input() open = false;
  @Input() title = '';
  @Input() description = '';
  @Input() confirmButtonText: string | null = null;
  /** Visual weight: low=accent, medium=warning, high=danger red. */
  @Input() dangerLevel: 'low' | 'medium' | 'high' = 'medium';

  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();

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

  onConfirm(): void {
    this.confirmed.emit();
  }
}
