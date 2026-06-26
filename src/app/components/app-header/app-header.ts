import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { HonchoService } from '../../core/honcho.service';
import { ThemePicker } from '../theme-picker/theme-picker';

@Component({
  selector: 'app-header',
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, ThemePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app-header.html',
  styleUrl: './app-header.css',
})
export class AppHeader {
  private readonly auth = inject(HonchoAuthService);
  private readonly profileService = inject(ProfileService);
  private readonly honcho = inject(HonchoService);
  private readonly router = inject(Router);

  readonly userName = computed(() => this.auth.user()?.username ?? '');
  readonly isAdmin = computed(() => this.auth.isAdmin());
  readonly profile = this.profileService.activeProfile;
  readonly profiles = this.profileService.profiles;

  // Hide the global header on the auth/setup routes so they keep their own
  // full-bleed centered layout.
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly visible = computed(() => {
    const u = this.url();
    return !u.startsWith('/setup') && !u.startsWith('/login');
  });

  // The empty/non-active nav links use the dashboard's surface background
  // with the accent text; the active one fills with the accent and flips
  // its color to the bg. RouterLinkActive adds .active automatically.
  readonly navLinks = computed(() => {
    const hasProfile = this.profile() !== null;
    const hasProfiles = this.profiles().length > 0;
    const links: Array<{ path: string; label: string; testid: string }> = [];
    // Overview needs an active profile to render the workspace data.
    if (hasProfile) {
      links.push({ path: '/', label: '◈ Overview', testid: 'open-overview' });
    }
    // Connections is the profile management page itself — always
    // available, including on first boot when no profiles exist.
    links.push({ path: '/profiles', label: '◈ Connections', testid: 'open-profiles' });
    // Inspector needs an active profile.
    if (hasProfile) {
      links.push({ path: '/inspector', label: '◈ Inspector', testid: 'open-inspector' });
    }
    // Preferences is per-user, never needs a profile.
    links.push({ path: '/preferences', label: '◈ Preferences', testid: 'open-preferences' });
    if (this.isAdmin()) {
      links.push({ path: '/admin', label: '⚙ Admin', testid: 'open-admin' });
    }
    return links;
  });

  constructor() {
    // When the header first becomes visible (user just landed on a guarded
    // route), make sure the profile list is populated so the combobox
    // actually has options to choose from. Safe to call repeatedly.
    effect(() => {
      if (this.visible() && this.profiles().length === 0) {
        this.profileService.list().catch(() => undefined);
      }
    });
  }

  switchProfile(id: string): void {
    this.profileService.setActive(id);
    this.honcho.reset();
  }

  logout(): void {
    this.honcho.reset();
    this.auth.logout();
  }
}
