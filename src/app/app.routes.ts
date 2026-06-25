import { Routes } from '@angular/router';
import { adminGuard } from './guards/admin.guard';
import { authGuard } from './guards/auth.guard';
import { setupGuard } from './guards/setup.guard';

export const routes: Routes = [
  {
    path: 'setup',
    canActivate: [setupGuard],
    loadComponent: () => import('./components/setup/setup').then((m) => m.SetupWizard),
  },
  {
    path: 'login',
    loadComponent: () => import('./components/login-modal/login-modal').then((m) => m.LoginModal),
  },
  {
    path: 'profiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/profile-selector/profile-selector').then((m) => m.ProfileSelector),
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./components/admin/admin').then((m) => m.AdminPanel),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./components/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'inspector',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./components/memory-inspector/memory-inspector').then((m) => m.MemoryInspector),
  },
  { path: '**', redirectTo: '' },
];
