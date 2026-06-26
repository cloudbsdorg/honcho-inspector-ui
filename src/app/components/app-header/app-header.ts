import { ChangeDetectionStrategy, Component, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { ProfileService } from '../../core/profile.service';
import { HonchoService } from '../../core/honcho.service';
import { UserMenu } from '../user-menu/user-menu';

/**
 * Compact global header. Workspace navigation, theme picker, preferences,
 * admin, and logout all live inside the <app-user-menu> dropdown so the
 * header itself stays minimal: logo + workspace name + active-profile
 * summary + profile switcher + avatar trigger.
 */
@Component({
  selector: 'app-header',
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive, UserMenu],
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
}
