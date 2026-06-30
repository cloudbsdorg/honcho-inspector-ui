export interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string; // ISO-8601 from backend Instant.toString()
}

export interface Profile {
  id: string;
  userId: string;
  label: string;
  apiKeyEncrypted: string; // base64; never shown to UI except via /reveal
  baseUrl: string;
  workspaceId: string;
  honchoUserName: string;
  createdAt: string;
  updatedAt: string;
}

export interface HonchoCredentials {
  sessionId: string;
  user: User;
}

/**
 * Response body of `GET /api/health`. The two flags are aliases — both
 * are `true` when `users.count() == 0` (the service is in bootstrap
 * state and the UI should show the first-run wizard). Kept for
 * backward compatibility with UI code written before first-run was
 * formalised; new code should read `firstRun`.
 *
 * <p>{@code chatEnabled} mirrors {@code honcho.ui.chat-enabled}: when
 * {@code false} (the default), the UI hides the chat button + popout.
 * {@code apiKeyVisibleToNonAdmin} mirrors {@code honcho.ui.api-key-visible-to-non-admin}:
 * when {@code false}, non-admin users cannot view the plaintext API key
 * via {@code /reveal}, change the key via {@code PUT}, or call
 * {@code /test} — the UI hides the Reveal API Key button + the API-key
 * edit field on the profile-selector form.
 */
export interface HealthResponse {
  ok: boolean;
  apiKeyVisibleToNonAdmin: boolean;
  chatEnabled: boolean;
  firstRun: boolean;
  needsRegister: boolean;
}

export interface FirstAdminInput {
  username: string;
  password: string;
  firstname?: string;
  lastname?: string;
  email?: string;
}

export interface AdminUser {
  id: string;
  username: string;
  firstname: string | null;
  lastname: string | null;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminUserPage {
  items: AdminUser[];
  total: number;
  page: number;
  size: number;
  pages?: number;
}

export interface AdminCreateUserInput {
  username: string;
  password: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  isAdmin?: boolean;
}

export interface AdminUpdateUserInput {
  username?: string;
  firstname?: string | null;
  lastname?: string | null;
  email?: string | null;
  isAdmin?: boolean;
}

export interface AdminPasswordResetInput {
  newPassword: string;
}

export interface AdminAuditEntry {
  id: number;
  actorUserId: string | null;
  action: string;
  targetUserId: string | null;
  targetResource: string | null;
  ip: string | null;
  sessionId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AdminAuditPage {
  items: AdminAuditEntry[];
  total: number;
  page: number;
  size: number;
  pages?: number;
}

/**
 * `GET /api/admin/dashboard/overview` — local SQL aggregates plus
 * 7-day / 30-day growth deltas. Powers the admin overview charts.
 */
export interface AdminDashboardOverview {
  usersTotal: number;
  usersAdmins: number;
  usersLast7d: number;
  usersLast30d: number;
  profilesTotal: number;
  auditTotal: number;
  auditLast30d: number;
}

export interface AdminMaintenanceStatus {
  auditRows: number;
  auditRetentionDays: number;
  auditMaxRows: number;
  auditPurgeCron: string;
  generatedAt?: string;
}

export interface ProfileWithKey {
  profile: Profile;
  apiKey: string; // plaintext, only from /reveal
}

export interface HonchoPeerSummary {
  id: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface HonchoSessionSummary {
  id: string;
  peerIds: string[];
  createdAt?: string;
}

export interface HonchoMessage {
  id: string;
  sessionId: string;
  peerId: string;
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface HonchoConclusion {
  id: string;
  content: string;
  observerId: string;
  observedId: string;
  sessionId: string | null;
  createdAt: string;
}

export interface HonchoPeerCard {
  peerId: string;
  facts: string[];
  updatedAt?: string;
}

export interface HonchoQueueStatus {
  totalWorkUnits: number;
  completedWorkUnits: number;
  inProgressWorkUnits: number;
  pendingWorkUnits: number;
  sessions?: Record<string, HonchoSessionQueueStatus>;
}

export interface HonchoSessionQueueStatus {
  sessionId: string | null;
  totalWorkUnits: number;
  completedWorkUnits: number;
  inProgressWorkUnits: number;
  pendingWorkUnits: number;
}

export interface HonchoSessionSummaryEntry {
  content: string;
  messageId: string;
  summaryType: 'short' | 'long';
  createdAt: string;
  tokenCount: number;
}

export interface HonchoSessionSummaries {
  id: string;
  shortSummary: HonchoSessionSummaryEntry | null;
  longSummary: HonchoSessionSummaryEntry | null;
}

export interface HonchoWorkspaceConfig {
  reasoning?: { enabled?: boolean | null; customInstructions?: string | null } | null;
  peerCard?: { use?: boolean | null; create?: boolean | null } | null;
  summary?: {
    enabled?: boolean | null;
    messagesPerShortSummary?: number | null;
    messagesPerLongSummary?: number | null;
  } | null;
  dream?: { enabled?: boolean | null } | null;
}

export interface HonchoPeerConfig {
  observeMe?: boolean | null;
}

export interface HonchoWorkspaceInspect {
  workspaceId: string;
  metadata: Record<string, unknown>;
  configuration: HonchoWorkspaceConfig;
  peerCount: number;
  sessionCount: number;
  queue: HonchoQueueStatus;
}

export interface HonchoPeerInspect {
  id: string;
  card: string[] | null;
  representation: string | null;
  configuration: HonchoPeerConfig | null;
  sessionCount: number;
  conclusionCount: number;
  sessions: HonchoSessionSummary[];
  recentConclusions: HonchoConclusion[];
}

export interface HonchoSessionInspect {
  id: string;
  peerIds: string[];
  messageCount: number;
  summaries: HonchoSessionSummaries;
  queue: HonchoQueueStatus;
}

export type ThemeId = 'miami' | 'retro' | 'win95' | 'sun' | 'cde' | 'modern';

export interface ThemeMeta {
  id: ThemeId;
  name: string;
  description: string;
  preview: string;
}

export interface HonchoSessionContext {
  messages: HonchoMessage[];
  summary?: string | null;
}

export interface HonchoSessionMessageList {
  items: HonchoMessage[];
  total: number;
  page: number;
  size: number;
}

export interface HonchoWorkspaceMetadata {
  id: string;
  createdAt: string;
  raw: Record<string, unknown>;
}

/**
 * One server-sent chunk from `POST /api/peers/{peerId}/chat/stream`.
 *
 * <p>The backend forwards Honcho's native SSE wire format: a
 * {@code data: <visible-text>\n\n} line per chunk and a final
 * {@code data: [DONE]\n\n} sentinel that closes the stream. The
 * frontend parses each data line and yields a
 * {@link HonchoChatChunk} to the consumer (the chat popout) which
 * appends {@link text} to the in-flight assistant turn. When
 * {@link done} is {@code true} the consumer stops the loop and
 * commits the accumulated text to the turns signal.
 */
export interface HonchoChatChunk {
  text: string;
  done: boolean;
}
