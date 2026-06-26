import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ConfirmHandle {
  promise: Promise<boolean>;
  resolve: (ok: boolean) => void;
}

/**
 * Themed confirm dialog service. Replaces window.confirm() — the
 * browser-native dialog doesn't match the rest of the UI (uses the OS
 * look instead of our retro/Miami themes) and can't be styled.
 *
 * Usage:
 *
 *   const ok = await this.confirm.ask({
 *     title: 'Delete profile?',
 *     body: 'This cannot be undone.',
 *     danger: true,
 *   });
 *   if (!ok) return;
 *
 * The service keeps a single active handle at a time. While a dialog
 * is open, calling ask() a second time resolves the previous one
 * with `false` (user clicked outside / new dialog replaced it).
 */
@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly current = signal<ConfirmOptions | null>(null);
  private handle: ConfirmHandle | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    if (this.handle) {
      this.handle.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      this.current.set(options);
      this.handle = { promise: Promise.resolve(false), resolve };
    });
  }

  resolve(ok: boolean): void {
    if (!this.handle) return;
    const h = this.handle;
    this.handle = null;
    this.current.set(null);
    h.resolve(ok);
  }
}
