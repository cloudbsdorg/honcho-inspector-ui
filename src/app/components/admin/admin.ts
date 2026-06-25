import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { AdminService, type PageSize } from '../../core/admin.service';
import { formatError } from '../../core/error-message';
import {
  AdminAuditEntry,
  AdminDashboardOverview,
  AdminMaintenanceStatus,
  AdminUser,
} from '../../core/models';
import { ChartComponent } from '../charts/chart.component';

type Tab = 'overview' | 'users' | 'audit' | 'maintenance';
type PageSizeUi = 10 | 20 | 30;

const PAGE_SIZE_LABELS: Record<PageSizeUi, string> = {
  10: '10',
  20: '20',
  30: '30',
};

@Component({
  selector: 'app-admin',
  imports: [ChartComponent, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class AdminPanel implements OnInit {
  private readonly admin = inject(AdminService);

  readonly tab = signal<Tab>('overview');

  ngOnInit(): void {
    // The default tab is `overview` (set above) but setTab() is the
    // only path that triggers the initial fetch. Mirror that here so
    // landing on /admin renders the charts immediately.
    this.setTab(this.tab());
  }
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly overview = signal<AdminDashboardOverview | null>(null);
  readonly overviewCountsChart = computed(() => {
    const o = this.overview();
    if (!o) return null;
    return {
      type: 'bar' as const,
      data: {
        labels: ['Users', 'Admins', 'Profiles', 'Audit rows'],
        datasets: [
          {
            label: 'Total',
            data: [o.usersTotal, o.usersAdmins, o.profilesTotal, o.auditTotal],
            backgroundColor: ['#7c3aed', '#06b6d4', '#10b981', '#f59e0b'],
          },
        ],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    };
  });
  readonly overviewGrowthChart = computed(() => {
    const o = this.overview();
    if (!o) return null;
    return {
      type: 'line' as const,
      data: {
        labels: ['Users 7d', 'Users 30d', 'Audit 30d'],
        datasets: [
          {
            label: 'Growth',
            data: [o.usersLast7d, o.usersLast30d, o.auditLast30d],
            borderColor: '#7c3aed',
            backgroundColor: 'rgba(124, 58, 237, 0.15)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        plugins: { legend: { position: 'top' as const } },
        scales: { y: { beginAtZero: true } },
      },
    };
  });
  readonly auditActionChart = computed(() => {
    const entries = this.audit();
    if (entries.length === 0) return null;
    const counts = new Map<string, number>();
    for (const e of entries) counts.set(e.action, (counts.get(e.action) ?? 0) + 1);
    const labels = Array.from(counts.keys()).sort();
    const data = labels.map((l) => counts.get(l) ?? 0);
    return {
      type: 'doughnut' as const,
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor: [
              '#7c3aed',
              '#06b6d4',
              '#10b981',
              '#f59e0b',
              '#ef4444',
              '#ec4899',
              '#8b5cf6',
              '#14b8a6',
            ],
          },
        ],
      },
      options: {
        plugins: { legend: { position: 'right' as const } },
      },
    };
  });

  readonly users = signal<AdminUser[]>([]);
  readonly usersTotal = signal(0);
  readonly usersPage = signal(1);
  readonly usersPageSize = signal<PageSizeUi>(20);
  readonly usersSearch = signal('');
  readonly usersSearchActive = computed(() => this.usersSearch().trim().length > 0);

  readonly audit = signal<AdminAuditEntry[]>([]);
  readonly auditTotal = signal(0);
  readonly auditPage = signal(1);
  readonly auditPageSize = signal<PageSizeUi>(30);
  readonly auditAction = signal('');
  readonly auditSince = signal('');

  readonly maintenance = signal<AdminMaintenanceStatus | null>(null);
  readonly purgeResult = signal<number | null>(null);

  readonly newUsername = signal('');
  readonly newPassword = signal('');
  readonly newIsAdmin = signal(false);

  readonly pageSizeOptions: PageSizeUi[] = [10, 20, 30];
  readonly pageSizeLabel = (s: PageSizeUi): string => PAGE_SIZE_LABELS[s];
  readonly pageSizeValue = (s: PageSizeUi): PageSize => s;

  readonly auditActions = [
    'user.bootstrap',
    'user.create',
    'user.update',
    'user.delete',
    'user.sessions.revoke',
    'user.password.reset',
    'audit.purge',
    'sessions.purge',
  ];

  setTab(tab: Tab): void {
    this.tab.set(tab);
    this.error.set(null);
    if (tab === 'overview') this.loadOverview();
    if (tab === 'users' && this.users().length === 0) this.loadUsers();
    if (tab === 'audit' && this.audit().length === 0) this.loadAudit();
    if (tab === 'maintenance' && !this.maintenance()) this.loadMaintenance();
  }

  async loadOverview(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.overview.set(await this.admin.overview());
    } catch (e) {
      this.error.set(formatError(e, 'Failed to load overview'));
    } finally {
      this.busy.set(false);
    }
  }

  async loadUsers(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const page = this.usersPage();
      const size = this.usersPageSize();
      const q = this.usersSearch().trim();
      const result = q
        ? await this.admin.searchUsers(q, size)
        : await this.admin.listUsers({ page, pageSize: size });
      this.users.set(result.items);
      this.usersTotal.set(result.total);
    } catch (e) {
      this.error.set(formatError(e, 'Failed to load users'));
    } finally {
      this.busy.set(false);
    }
  }

  async loadAudit(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.admin.listAudit({
        action: this.auditAction() || undefined,
        since: this.auditSince() || undefined,
        page: this.auditPage(),
        pageSize: this.auditPageSize(),
      });
      this.audit.set(result.items);
      this.auditTotal.set(result.total);
    } catch (e) {
      this.error.set(formatError(e, 'Failed to load audit log'));
    } finally {
      this.busy.set(false);
    }
  }

  async loadMaintenance(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.maintenance.set(await this.admin.maintenanceStatus());
    } catch (e) {
      this.error.set(formatError(e, 'Failed to load maintenance status'));
    } finally {
      this.busy.set(false);
    }
  }

  setUsersPageSize(size: PageSizeUi): void {
    this.usersPageSize.set(size);
    this.usersPage.set(1);
    this.loadUsers();
  }

  setAuditPageSize(size: PageSizeUi): void {
    this.auditPageSize.set(size);
    this.auditPage.set(1);
    this.loadAudit();
  }

  async searchUsers(): Promise<void> {
    this.usersPage.set(1);
    await this.loadUsers();
  }

  clearUsersSearch(): void {
    this.usersSearch.set('');
    this.loadUsers();
  }

  async promoteUser(u: AdminUser): Promise<void> {
    if (!confirm(`Promote ${u.username} to admin?`)) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.updateUser(u.id, { isAdmin: !u.isAdmin });
      await this.loadUsers();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to update user'));
    } finally {
      this.busy.set(false);
    }
  }

  async deleteUser(u: AdminUser): Promise<void> {
    if (!confirm(`Delete user ${u.username}? This cascades to profiles and sessions.`)) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.deleteUser(u.id);
      await this.loadUsers();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to delete user'));
    } finally {
      this.busy.set(false);
    }
  }

  async resetPassword(u: AdminUser): Promise<void> {
    const newPassword = prompt(`New password for ${u.username} (8+ chars):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      this.error.set('Password must be at least 8 characters');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.resetPassword(u.id, { newPassword });
      await this.loadAudit();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to reset password'));
    } finally {
      this.busy.set(false);
    }
  }

  async revokeSessions(u: AdminUser): Promise<void> {
    if (!confirm(`Revoke all sessions for ${u.username}? They will be force-logged-out.`)) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.revokeSessions(u.id);
      await this.loadAudit();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to revoke sessions'));
    } finally {
      this.busy.set(false);
    }
  }

  async createUser(): Promise<void> {
    const username = this.newUsername().trim();
    const password = this.newPassword();
    if (!username || password.length < 8) {
      this.error.set('Username and password (8+ chars) required');
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.admin.createUser({
        username,
        password,
        isAdmin: this.newIsAdmin(),
      });
      this.newUsername.set('');
      this.newPassword.set('');
      this.newIsAdmin.set(false);
      await this.loadUsers();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to create user'));
    } finally {
      this.busy.set(false);
    }
  }

  async purgeAudit(): Promise<void> {
    if (!confirm('Run audit retention sweep now? Rows older than the retention window are deleted.')) {
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.admin.purgeAudit();
      this.purgeResult.set(r.deleted);
      await this.loadMaintenance();
      await this.loadAudit();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to run audit purge'));
    } finally {
      this.busy.set(false);
    }
  }

  async purgeExpiredSessions(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const r = await this.admin.purgeExpiredSessions();
      this.purgeResult.set(r.deleted);
      await this.loadMaintenance();
    } catch (e) {
      this.error.set(formatError(e, 'Failed to purge expired sessions'));
    } finally {
      this.busy.set(false);
    }
  }

  formatMetadata(metadata: Record<string, unknown> | undefined | null): string {
    if (!metadata || Object.keys(metadata).length === 0) return '—';
    return JSON.stringify(metadata);
  }
}
