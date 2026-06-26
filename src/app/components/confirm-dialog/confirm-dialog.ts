import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  selector: 'app-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (service.current(); as opts) {
      <div
        data-testid="confirm-dialog"
        class="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-md"
        style="background: color-mix(in srgb, var(--bg) 70%, transparent)"
        (click)="onBackdrop()"
      >
        <div
          class="th-surface th-shadow w-full max-w-md th-border border-2 p-6"
          style="border-radius: var(--radius)"
          (click)="$event.stopPropagation()"
          data-testid="confirm-dialog-panel"
          role="alertdialog"
          aria-modal="true"
        >
          <h2
            class="th-display mb-3 text-lg font-bold uppercase tracking-wider"
            style="color: var(--accent)"
            data-testid="confirm-dialog-title"
          >
            {{ opts.title }}
          </h2>
          @if (opts.body) {
            <p
              class="mb-6 text-sm opacity-90"
              data-testid="confirm-dialog-body"
            >
              {{ opts.body }}
            </p>
          }
          <div class="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              data-testid="confirm-dialog-cancel"
              (click)="service.resolve(false)"
              class="th-border border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest"
              style="border-radius: var(--radius); background: var(--surface); color: var(--text-dim)"
            >
              {{ opts.cancelLabel || 'Cancel' }}
            </button>
            <button
              type="button"
              [attr.data-testid]="opts.danger ? 'confirm-dialog-confirm-danger' : 'confirm-dialog-confirm'"
              (click)="service.resolve(true)"
              class="th-border border-2 px-3 py-1.5 text-xs font-bold uppercase tracking-widest"
              style="border-radius: var(--radius); background: var(--accent); color: var(--bg)"
            >
              {{ opts.confirmLabel || 'Confirm' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialog {
  protected readonly service = inject(ConfirmDialogService);

  onBackdrop(): void {
    this.service.resolve(false);
  }
}
