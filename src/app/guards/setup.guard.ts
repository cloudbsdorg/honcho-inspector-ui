import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { HealthService } from '../core/health.service';
import { HonchoAuthService } from '../core/honcho-auth.service';

export const setupGuard: CanActivateFn = async () => {
  const health = inject(HealthService);
  const auth = inject(HonchoAuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) {
    return router.parseUrl('/');
  }

  try {
    const h = await health.check();
    if (h.firstRun) return true;
  } catch {
    // backend unreachable → fall through to /login
  }

  return router.parseUrl('/login');
};
