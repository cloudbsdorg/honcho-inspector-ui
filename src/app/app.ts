import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { AppHeader } from './components/app-header/app-header';
import { ConfirmDialog } from './components/confirm-dialog/confirm-dialog';
import { HonchoAuthService } from './core/honcho-auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader, ConfirmDialog],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-header />
    <main class="min-h-0 flex-1 overflow-y-auto">
      <router-outlet />
    </main>
    <app-confirm-dialog />
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
      }
    `,
  ],
})
export class App implements OnInit {
  private readonly router = inject(Router);
  private readonly auth = inject(HonchoAuthService);
  private readonly destroyRef = inject(DestroyRef);

  ngOnInit(): void {
    // Subscribe to the auth service's session-expired signal and
    // route the user to /login?reason=expired so the LoginModal can
    // show a clear "your session expired" message. We deduplicate on
    // location.pathname so a single expired session doesn't fire
    // a flood of redirects if multiple API calls fail in parallel.
    const sub = this.auth.sessionExpiredSignal.subscribe(() => {
      if (this.router.url !== '/login' && !this.router.url.startsWith('/login?')) {
        void this.router.navigate(['/login'], { queryParams: { reason: 'expired' } });
      }
    });
    this.destroyRef.onDestroy(() => sub.unsubscribe());
  }
}
