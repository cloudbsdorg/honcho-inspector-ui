import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { AdminService, type PageSize } from '../../core/admin.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import { formatError } from '../../core/error-message';
import {
  AdminAuditEntry,
  AdminDashboardOverview,
  AdminMaintenanceStatus,
  AdminUser,
} from '../../core/models';
import { ChartComponent } from '../charts/chart.component';
import { UserCreateWizard } from './user-create-wizard';
import { ChangePasswordModal } from './change-password-modal';
import { describeCron } from '../../core/cron';
import { TimezoneService } from '../../core/timezone.service';
import {
  formatWallClock,
  formatWallClockTooltip,
  localWallclockToUtcIso,
} from '../../core/datetime';
import { DiagnosticsService } from '../../core/diagnostics.service';

type Tab = 'overview' | 'users' | 'audit' | 'maintenance' | 'diagnostics' | 'password';
type PageSizeUi = 10 | 20 | 30;

const PAGE_SIZE_LABELS: Record<PageSizeUi, string> = {
  10: '10',
  20: '20',
  30: '30',
};

@Component({
  selector: 'app-admin',
  imports: [ChartComponent, DecimalPipe, UserCreateWizard, ChangePasswordModal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.html',
  styleUrl: './admin.css',
})
export class AdminPanel implements OnInit {
  private readonly admin = inject(AdminService);
  private readonly auth = inject(HonchoAuthService);
  protected readonly describeCron = describeCron;
  readonly tz = inject(TimezoneService);
  readonly diagnostics = inject(DiagnosticsService);
  readonly formatWallClock = formatWallClock;
  readonly formatWallClockTooltip = formatWallClockTooltip;

  readonly tab = signal<Tab>('overview');

  // Password-change modal state. The modal lives at the root of
  // the admin template so its fixed-position overlay covers the
  // full viewport. The parent stays the source of truth: open
  // is bound from here, and the modal emits 'changed' or
  // 'dismissed' which we translate to either refreshing the user
  // list (admin-reset) or logging the caller out (self).
  readonly passwordModal = signal<{
    open: boolean;
    mode: 'self' | 'admin-reset';
    targetUserId: string | null;
    targetUsername: string | null;
  } | null>(null);

  ngOnInit(): void {
    // The default tab is `overview` (set above) but setTab() is the
    // only path that triggers the initial fetch. Mirror that here so
    // landing on /admin renders the charts immediately.
    this.setTab(this.tab());
    void this.loadAllUsers();
  }
  readonly error = signal<string | null>(null);
  readonly busy = signal(false);

  readonly overview = signal<AdminDashboardOverview | null>(null);
  readonly overviewAuditEntries = signal<AdminAuditEntry[]>([]);
  readonly openInfoLabel = signal<string | null>(null);
  readonly allUsers = signal<AdminUser[]>([]);

  readonly userMap = computed(() => {
    const map = new Map<string, AdminUser>();
    for (const u of this.allUsers()) {
      map.set(u.id, u);
    }
    return map;
  });

  formatUser(userId: string | null): string {
    if (!userId) return '—';
    const u = this.userMap().get(userId);
    return u ? u.username : userId;
  }

  formatUserTooltip(userId: string | null): string {
    if (!userId) return '';
    const u = this.userMap().get(userId);
    if (!u) return `ID: ${userId}`;
    const name = [u.firstname, u.lastname].filter(Boolean).join(' ');
    const parts = [`ID: ${u.id}`, `Username: ${u.username}`];
    if (name) parts.push(`Name: ${name}`);
    if (u.email) parts.push(`Email: ${u.email}`);
    return parts.join('\n');
  }

  async loadAllUsers(): Promise<void> {
    try {
      const res = await this.admin.listUsers({ pageSize: 'ALL' });
      this.allUsers.set(res.items);
    } catch {
      // ignore
    }
  }
  readonly auditTimeframe = signal<'24h' | '7d' | '30d' | 'all'>('30d');
  readonly auditTimeframeLabel = computed(() => {
    switch (this.auditTimeframe()) {
      case '24h': return 'Last 24 Hours';
      case '7d': return 'Last 7 Days';
      case '30d': return 'Last 30 Days';
      case 'all': return 'All Time';
    }
  });

  toggleInfo(label: string): void {
    this.openInfoLabel.update((current) => (current === label ? null : label));
  }

  closeInfo(): void {
    this.openInfoLabel.set(null);
  }

  setAuditTimeframe(tf: string): void {
    if (tf === '24h' || tf === '7d' || tf === '30d' || tf === 'all') {
      this.auditTimeframe.set(tf);
      void this.reloadOverviewAudit();
    }
  }

  async reloadOverviewAudit(): Promise<void> {
    const tf = this.auditTimeframe();
    let sinceIso: string | undefined;
    if (tf === '24h') {
      sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    } else if (tf === '7d') {
      sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (tf === '30d') {
      sinceIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }

    try {
      const auditPage = await this.admin.listAudit({
        since: sinceIso,
        pageSize: 'ALL',
      });
      this.overviewAuditEntries.set(auditPage.items);
    } catch {
      this.overviewAuditEntries.set([]);
    }
  }
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
        interaction: {
          mode: 'index' as const,
          intersect: false,
        },
        plugins: { legend: { position: 'top' as const } },
        scales: { y: { beginAtZero: true } },
      },
    };
  });
  readonly auditActionChart = computed(() => {
    const entries = this.overviewAuditEntries();
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

  readonly userCreateWizardOpen = signal(false);

  openUserCreateWizard(): void {
    this.userCreateWizardOpen.set(true);
  }

  async onUserCreateCompleted(_payload: {
    username: string;
    isAdmin: boolean;
  }): Promise<void> {
    this.userCreateWizardOpen.set(false);
    await this.loadUsers();
  }

  onUserCreateDismissed(): void {
    this.userCreateWizardOpen.set(false);
  }

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
    this.closeInfo();
    if (tab === 'overview') this.loadOverview();
    if (tab === 'users' && this.users().length === 0) this.loadUsers();
    if (tab === 'audit' && this.audit().length === 0) this.loadAudit();
    if (tab === 'maintenance' && !this.maintenance()) this.loadMaintenance();
    if (tab === 'diagnostics' && !this.diagnostics.envelope() && !this.diagnostics.error()) {
      this.diagnostics.load();
    }
  }

  async loadOverview(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const [ov] = await Promise.all([
        this.admin.overview(),
        this.reloadOverviewAudit(),
      ]);
      this.overview.set(ov);
      this.auditTotal.set(ov.auditTotal); // Update auditTotal so template knows total count
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
      if (!q) {
        void this.loadAllUsers();
      }
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
      // The datetime-local input emits a naive local-time string with
      // no zone ("2026-06-25T13:45"). Backend endpoints require an
      // explicit zone — convert to wallclock-UTC using the user's
      // effective timezone.
      const sinceRaw = this.auditSince();
      const sinceIso = sinceRaw
        ? localWallclockToUtcIso(sinceRaw, this.tz.effectiveTimezone())
        : '';
      const result = await this.admin.listAudit({
        action: this.auditAction() || undefined,
        since: sinceIso || undefined,
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

  /**
   * Open the password-change modal in self-service mode. Reachable
   * from the new "password" tab on the admin nav. The new-password
   * field validation and post-submit session-revoke behavior is
   * enforced server-side; the modal just collects input and
   * dispatches.
   */
  openSelfPasswordChange(): void {
    this.passwordModal.set({
      open: true,
      mode: 'self',
      targetUserId: null,
      targetUsername: null,
    });
  }

  /**
   * Open the password-change modal in admin-reset mode for a
   * specific user. Reachable from the "Reset pwd" button on each
   * row of the users table. Replaces the previous native
   * {@code prompt()} dialog which was a security UX hazard
   * (password visible in plaintext, no validation feedback,
   * no confirmation).
   */
  openAdminResetPassword(u: AdminUser): void {
    this.passwordModal.set({
      open: true,
      mode: 'admin-reset',
      targetUserId: u.id,
      targetUsername: u.username,
    });
  }

  closePasswordModal(): void {
    this.passwordModal.set(null);
  }

  /**
   * Handler for the modal's 'changed' event. Self → log the user
   * out (the backend revoked their session, so the next API call
   * would 401 anyway, but it's cleaner to show the login screen
   * immediately). Admin-reset → refresh the user list + audit log
   * so the operator sees the new state.
   */
  async onPasswordChanged(payload: { userId: string; mode: 'self' | 'admin-reset' }): Promise<void> {
    this.passwordModal.set(null);
    if (payload.mode === 'self') {
      // Force a clean re-auth. The session cookie is already
      // dead on the server, so this is mostly a UX reset (route
      // back to /login so the operator can re-authenticate with
      // their new password).
      try { await this.auth.logout(); } catch { /* already dead */ }
      window.location.assign('/login');
      return;
    }
    // Admin-reset: refresh the user list and audit feed so the
    // operator sees the password-reset event they just performed.
    await Promise.all([this.loadUsers(), this.loadAudit()]);
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
    if (
      !confirm('Run audit retention sweep now? Rows older than the retention window are deleted.')
    ) {
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
    try {
      const json = JSON.stringify(metadata);
      // Truncate at 200 chars so audit log rows stay one line tall.
      return json.length > 200 ? json.slice(0, 197) + '…' : json;
    } catch {
      return '<unserializable>';
    }
  }
}
