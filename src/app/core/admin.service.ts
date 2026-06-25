import { Injectable, inject } from '@angular/core';
import { ApiClient } from './api-client';
import {
  AdminAuditPage,
  AdminCreateUserInput,
  AdminDashboardOverview,
  AdminMaintenanceStatus,
  AdminPasswordResetInput,
  AdminUpdateUserInput,
  AdminUserPage,
} from './models';

export type PageSize = 10 | 20 | 30 | number;

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly api = inject(ApiClient);

  listUsers(opts: { page?: number; pageSize?: PageSize | 'ALL' } = {}): Promise<AdminUserPage> {
    return this.api.request<AdminUserPage>({
      method: 'GET',
      path: '/admin/users',
      query: {
        // Backend is zero-indexed; the UI shows 1-indexed page
        // numbers so we subtract 1 here.
        page: Math.max(0, (opts.page ?? 1) - 1),
        pageSize: opts.pageSize ?? 20,
      },
    });
  }

  searchUsers(q: string, pageSize: PageSize | 'ALL' = 20): Promise<AdminUserPage> {
    return this.api.request<AdminUserPage>({
      method: 'GET',
      path: '/admin/users/search',
      query: { q, pageSize },
    });
  }

  getUser(id: string): Promise<AdminUserPage['items'][number]> {
    return this.api.request({
      method: 'GET',
      path: `/admin/users/${encodeURIComponent(id)}`,
    });
  }

  createUser(input: AdminCreateUserInput): Promise<AdminUserPage['items'][number]> {
    return this.api.request({
      method: 'POST',
      path: '/admin/users',
      body: input,
    });
  }

  updateUser(id: string, input: AdminUpdateUserInput): Promise<AdminUserPage['items'][number]> {
    return this.api.request({
      method: 'PUT',
      path: `/admin/users/${encodeURIComponent(id)}`,
      body: input,
    });
  }

  deleteUser(id: string): Promise<void> {
    return this.api.request<void>({
      method: 'DELETE',
      path: `/admin/users/${encodeURIComponent(id)}`,
    });
  }

  resetPassword(id: string, input: AdminPasswordResetInput): Promise<void> {
    return this.api.request<void>({
      method: 'POST',
      path: `/admin/users/${encodeURIComponent(id)}/password`,
      body: input,
    });
  }

  revokeSessions(id: string): Promise<{ revoked: number }> {
    return this.api.request<{ revoked: number }>({
      method: 'POST',
      path: `/admin/users/${encodeURIComponent(id)}/sessions/revoke`,
    });
  }

  listAudit(
    opts: {
      actor?: string;
      target?: string;
      action?: string;
      since?: string;
      page?: number;
      pageSize?: PageSize | 'ALL';
    } = {},
  ): Promise<AdminAuditPage> {
    return this.api.request<AdminAuditPage>({
      method: 'GET',
      path: '/admin/audit',
      query: {
        actor: opts.actor,
        target: opts.target,
        action: opts.action,
        since: opts.since,
        // Backend is zero-indexed; subtract 1 from the UI's
        // 1-indexed page number.
        page: Math.max(0, (opts.page ?? 1) - 1),
        pageSize: opts.pageSize ?? 30,
      },
    });
  }

  overview(): Promise<AdminDashboardOverview> {
    return this.api.request<AdminDashboardOverview>({
      method: 'GET',
      path: '/admin/dashboard/overview',
    });
  }

  maintenanceStatus(): Promise<AdminMaintenanceStatus> {
    return this.api.request<AdminMaintenanceStatus>({
      method: 'GET',
      path: '/admin/maintenance/status',
    });
  }

  purgeAudit(): Promise<{ deleted: number }> {
    return this.api.request<{ deleted: number }>({
      method: 'POST',
      path: '/admin/maintenance/audit/purge',
    });
  }

  purgeExpiredSessions(): Promise<{ deleted: number }> {
    return this.api.request<{ deleted: number }>({
      method: 'POST',
      path: '/admin/maintenance/sessions/purge-expired',
    });
  }
}
