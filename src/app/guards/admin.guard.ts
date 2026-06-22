import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { HonchoAuthService } from '../core/honcho-auth.service';

export const adminGuard: CanActivateFn = () => {
  const auth = inject(HonchoAuthService);
  const router = inject(Router);
  if (auth.isAdmin()) return true;
  return router.parseUrl('/');
};
