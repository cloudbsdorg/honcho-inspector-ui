import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { computed } from '@angular/core';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { HonchoService } from '../../core/honcho.service';
import { ProfileService } from '../../core/profile.service';
import { ThemeService } from '../../core/theme.service';
import { ThemeId } from '../../core/models';

interface MenuLink {
  path: string;
  label: string;
  testid: string;
  icon: string;
  description: string;
}

/**
 * Single consolidated header menu. Replaces the standalone theme picker,
 * the main-nav link row, and the logout button with one dropdown
 * anchored to the avatar trigger. Sections, top to bottom:
 *   1. Signed-in header (username + admin badge).
 *   2. Workspace nav — Overview, Connections, Inspector (and Admin
 *      for admins). Same gating as the previous navLinks computed
 *      (Overview + Inspector need an active profile; Connections
 *      is always reachable; Admin only for admins).
 *   3. Preferences link (per-user; no profile required).
 *   4. Theme picker — 6 themes in a 2x3 grid with swatches.
 *   5. Logout (destructive — visually distinct).
 *
 * Closes on outside click or Escape, matching the previous pattern.
 */
@Component({
  selector: 'app-user-menu',
  imports: [CommonModule, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './user-menu.html',
  styleUrl: './user-menu.css',
})
export class UserMenu {
  private readonly auth = inject(HonchoAuthService);
  private readonly honcho = inject(HonchoService);
  private readonly profileService = inject(ProfileService);
  private readonly themeService = inject(ThemeService);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly userName = computed(() => this.auth.user()?.username ?? '');
  readonly isAdmin = this.auth.isAdmin;
  readonly isOpen = signal(false);

  readonly themes = this.themeService.availableThemes;
  readonly activeTheme = computed<ThemeId>(() => this.themeService.theme());

  readonly hasProfile = computed(() => this.profileService.activeProfile() !== null);
  readonly hasProfiles = computed(() => this.profileService.profiles().length > 0);

  /**
   * Workspace nav links. Same gating as the previous navLinks computed
   * in app-header: Overview + Inspector need an active profile,
   * Connections is always reachable, Admin only for admins.
   */
  readonly workspaceLinks = computed<readonly MenuLink[]>(() => {
    const links: MenuLink[] = [];
    if (this.hasProfile()) {
      links.push({
        path: '/',
        label: 'Overview',
        testid: 'user-menu-overview',
        icon: '◈',
        description: 'Workspace overview',
      });
    }
    links.push({
      path: '/profiles',
      label: 'Connections',
      testid: 'user-menu-connections',
      icon: '◈',
      description: 'Honcho profile management',
    });
    if (this.hasProfile()) {
      links.push({
        path: '/inspector',
        label: 'Inspector',
        testid: 'user-menu-inspector',
        icon: '◈',
        description: 'Memory, peers, sessions',
      });
    }
    if (this.isAdmin()) {
      links.push({
        path: '/admin',
        label: 'Admin',
        testid: 'user-menu-admin',
        icon: '⚙',
        description: 'Users, audit, maintenance',
      });
    }
    return links;
  });

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  close(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }

  selectTheme(id: ThemeId): void {
    this.themeService.setTheme(id);
    this.isOpen.set(false);
  }

  logout(): void {
    this.isOpen.set(false);
    this.honcho.reset();
    this.auth.logout();
    this.router.navigateByUrl('/login');
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
