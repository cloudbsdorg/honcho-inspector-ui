import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { computed } from '@angular/core';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { HonchoService } from '../../core/honcho.service';

/**
 * Header user-menu trigger. Replaces the standalone logout button.
 * Opens a popover with the current username, an inline summary of
 * the active profile (if any), a Preferences link, and a Logout
 * action. The trigger button uses the username as its visible label
 * so the header stays compact for power users while remaining
 * self-explanatory for new ones.
 *
 * Closes on outside click or Escape, matching the theme-picker pattern.
 */
@Component({
  selector: 'app-user-menu',
  imports: [CommonModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-menu.html',
  styleUrl: './user-menu.css',
})
export class UserMenu {
  private readonly auth = inject(HonchoAuthService);
  private readonly honcho = inject(HonchoService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly userName = computed(() => this.auth.user()?.username ?? '');
  readonly isAdmin = this.auth.isAdmin;
  readonly isOpen = signal(false);

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  close(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }

  logout(): void {
    this.isOpen.set(false);
    this.honcho.reset();
    this.auth.logout();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onDocEscape(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }
}
