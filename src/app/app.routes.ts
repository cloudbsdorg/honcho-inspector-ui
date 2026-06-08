import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login-modal/login-modal').then((m) => m.LoginModal),
  },
  {
    path: 'profiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/profile-selector/profile-selector').then(
        (m) => m.ProfileSelector,
      ),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'inspector',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/memory-inspector/memory-inspector').then(
        (m) => m.MemoryInspector,
      ),
  },
  { path: '**', redirectTo: '' },
];
