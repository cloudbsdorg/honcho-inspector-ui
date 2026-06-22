import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { HealthService } from '../core/health.service';
import { HonchoAuthService } from '../core/honcho-auth.service';
import { ProfileService } from '../core/profile.service';

export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(HonchoAuthService);
  const profiles = inject(ProfileService);
  const health = inject(HealthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    const path = route.routeConfig?.path;
    if (path === 'login' || path === 'profiles') return true;
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

  try {
    const h = await health.check();
    if (h.firstRun) return router.parseUrl('/setup');
  } catch {}
  return router.parseUrl('/login');
};
