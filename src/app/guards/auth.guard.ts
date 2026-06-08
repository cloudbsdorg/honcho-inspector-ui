import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { HonchoAuthService } from '../core/honcho-auth.service';
import { ProfileService } from '../core/profile.service';

export const authGuard: CanActivateFn = async (route) => {
  const auth = inject(HonchoAuthService);
  const profiles = inject(ProfileService);
  const router = inject(Router);
  if (!auth.isAuthenticated()) return router.parseUrl('/login');
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
};
