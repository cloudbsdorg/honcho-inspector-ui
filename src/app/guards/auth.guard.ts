import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { HealthService } from '../core/health.service';
import { HonchoAuthService } from '../core/honcho-auth.service';
import { ProfileService } from '../core/profile.service';

/**
 * Routing guard for authenticated routes.
 *
 * The SERVER is the source of truth on whether the system is set up.
 * The browser never decides "is this first run?" on its own. Before any
 * routing decision, we ask the backend:
 *   - If `/api/health` reports `firstRun === true` → route to /setup
 *   - Else if the browser holds a valid session → continue (or redirect to
 *     /profiles if no active Honcho profile is selected)
 *   - Else → route to /login
 *
 * This ensures the wizard appears on every fresh browser visiting a fresh
 * backend, regardless of stale localStorage from a prior session.
 */
export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(HonchoAuthService);
  const profiles = inject(ProfileService);
  const health = inject(HealthService);
  const router = inject(Router);

  // Always ask the server first. If it's first-run, the wizard wins,
  // even if the browser happens to hold a stale session.
  try {
    const h = await health.check();
    if (h.firstRun) return router.parseUrl('/setup');
  } catch {
    // Health check failed (backend unreachable, network blip, etc.)
    // Fall through to session-based routing.
  }

  if (auth.isAuthenticated()) {
    const path = route.routeConfig?.path;
    // Routes that are always reachable for an authenticated user, even
    // without an active Honcho profile: login (handled above via
    // navigation, but defensive), profile management itself, the
    // per-user preferences pane, and the admin surface (its data path
    // is per-backend, not per-profile).
    if (
      path === 'login' ||
      path === 'profiles' ||
      path === 'preferences' ||
      path === 'admin'
    ) {
      return true;
    }
    // Everything else (dashboard / overview, inspector, etc.) needs an
    // active Honcho profile to render anything useful. If we don't have
    // one yet, send the user to /profiles to pick one.
    if (!profiles.activeProfileId()) {
      try {
        await profiles.list();
      } catch {
        return router.parseUrl('/login');
      }
      if (!profiles.activeProfileId()) {
        return router.parseUrl('/profiles');
      }
    }
    return true;
  }

  return router.parseUrl('/login');
};
