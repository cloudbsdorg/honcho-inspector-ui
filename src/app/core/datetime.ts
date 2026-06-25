/**
 * Honcho Inspector wall-clock formatting layer.
 *
 * Contract: STORAGE + TRANSPORT use wallclock UTC / ISO-8601 with a trailing `Z`
 * (Honcho returns whatever shape it likes upstream; the backend normalizes to
 * `Instant.toString()` before sending to us, so the wire shape is stable).
 *
 * DISPLAY uses the user's effective timezone: browser-detected by default, with
 * a user-override via {@link TimezoneService}. The override is per-user
 * persisted (localStorage), so once a user picks "America/Chicago" they see
 * Chicago time everywhere — including in tooltip hover, chart axis labels, and
 * the chat panel turn stamp.
 *
 * This module is pure: it accepts a timezone string and an input value. It does
 * not read from `Intl.DateTimeFormat().resolvedOptions().timeZone` directly.
 * That detection lives in {@link TimezoneService} so the resolution happens once
 * per app boot, not once per render.
 *
 * Honcho may return timestamps in any of:
 *   - ISO-8601 UTC:  `"2026-06-25T18:01:18.216030Z"`
 *   - ISO-8601 + offset: `"2026-06-25T13:01:18.216030-05:00"`
 *   - epoch milliseconds: a number
 *   - undefined / null / "" (sparse data)
 *
 * {@link parseHonchoTimestamp} normalizes all four to epoch milliseconds (or
 * null). All display helpers accept either ISO strings or epoch numbers.
 */

export type DisplayGranularity =
  | 'short' // M/d/yy, h:mm a   e.g. "6/25/26, 1:01 PM"
  | 'shortDate' // M/d/yy         e.g. "6/25/26"
  | 'shortTime' // h:mm a          e.g. "1:01 PM"
  | 'medium' // MMM d, y, h:mm:ss a   e.g. "Jun 25, 2026, 1:01:18 PM"
  | 'mediumDate' // MMM d, y       e.g. "Jun 25, 2026"
  | 'mediumTime' // h:mm:ss a      e.g. "1:01:18 PM"
  | 'long' // MMMM d, y, h:mm:ss a   e.g. "June 25, 2026 at 1:01:18 PM CDT"
  | 'full'; // EEEE, MMMM d, y, h:mm:ss a   e.g. "Thursday, June 25, 2026 at 1:01:18 PM CDT"

export interface FormatOptions {
  /** IANA timezone, e.g. "America/Chicago" or "UTC". */
  timeZone?: string;
  /** BCP-47 locale tag, e.g. "en-US". */
  locale?: string;
  /** Append " UTC" suffix when the user's effective zone is NOT UTC. */
  showUtcSuffix?: boolean;
  /** 12-hour (default) vs 24-hour clock. */
  hour12?: boolean;
}

const DEFAULTS: Required<Pick<FormatOptions, 'locale' | 'hour12'>> = {
  locale: 'en-US',
  hour12: true,
};

const FORMAT_OPTIONS: Record<DisplayGranularity, Intl.DateTimeFormatOptions> = {
  short: {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
  shortDate: { year: 'numeric', month: 'numeric', day: 'numeric' },
  shortTime: { hour: 'numeric', minute: '2-digit' },
  medium: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  },
  mediumDate: { year: 'numeric', month: 'short', day: 'numeric' },
  mediumTime: { hour: 'numeric', minute: '2-digit', second: '2-digit' },
  long: {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  },
  full: {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  },
};

/**
 * Parse a Honcho timestamp into epoch milliseconds.
 *
 * Accepts ISO-8601 strings (with or without `Z`), epoch milliseconds (number),
 * epoch seconds (number <= 10^11), and `Date` objects. Returns `null` for
 * unparseable values (defensive — callers can show "—" instead of NaN).
 */
export function parseHonchoTimestamp(
  value: string | number | Date | null | undefined,
): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'number') {
    // Heuristic: epoch ms are ~1.7e12 today; epoch seconds are ~1.7e9.
    // Anything above 10^11 is treated as ms.
    if (!Number.isFinite(value)) return null;
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // If it's all digits, treat as epoch number
    if (/^-?\d+$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      return n > 1e11 ? n : n * 1000;
    }
    const t = Date.parse(trimmed);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Format a Honcho timestamp for display.
 *
 * Returns the formatted string in the given timezone. If the input is null or
 * unparseable, returns the empty string (so Angular's `@if (x)` guard works).
 *
 * The `timeZone` option defaults to the runtime's resolved local timezone
 * (callers should pass an explicit timezone — see {@link TimezoneService}).
 */
export function formatWallClock(
  value: string | number | Date | null | undefined,
  granularity: DisplayGranularity = 'medium',
  opts: FormatOptions = {},
): string {
  const ms = parseHonchoTimestamp(value);
  if (ms == null) return '';
  const { locale, hour12 } = { ...DEFAULTS, ...opts };
  const timeZone = opts.timeZone ?? defaultRuntimeTimezone();
  try {
    return new Intl.DateTimeFormat(locale, {
      ...FORMAT_OPTIONS[granularity],
      hour12,
      timeZone,
    }).format(new Date(ms));
  } catch {
    // Invalid timezone — fall back to runtime default
    return new Intl.DateTimeFormat(locale, {
      ...FORMAT_OPTIONS[granularity],
      hour12,
    }).format(new Date(ms));
  }
}

/**
 * Format a Honcho timestamp as a tooltip-friendly absolute reference.
 *
 * Example output:
 *   "2026-06-25 18:01:18 UTC"
 *   "2026-06-25 13:01:18 CDT (-05:00)"
 *
 * Always includes the UTC offset in parentheses so the user can disambiguate
 * their local display from the canonical wire value.
 */
export function formatWallClockTooltip(
  value: string | number | Date | null | undefined,
  opts: FormatOptions = {},
): string {
  const ms = parseHonchoTimestamp(value);
  if (ms == null) return '';
  const { locale } = { ...DEFAULTS, ...opts };
  const timeZone = opts.timeZone ?? defaultRuntimeTimezone();
  const utc = new Date(ms).toISOString();
  try {
    const local = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone,
      timeZoneName: 'shortOffset',
      hour12: false,
    }).format(new Date(ms));
    return `${local} (UTC ${utc})`;
  } catch {
    return `UTC ${utc}`;
  }
}

/**
 * Format an instant as a relative-time string ("just now", "30s ago", "5m ago",
 * "2h ago", "3d ago"). Timezone-agnostic by design — relative to `now`.
 *
 * If `now` is omitted, defaults to `Date.now()`.
 */
export function formatRelative(
  value: string | number | Date | null | undefined,
  now: number = Date.now(),
): string {
  const ms = parseHonchoTimestamp(value);
  if (ms == null) return '';
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

/**
 * Detect the browser's resolved timezone (IANA name). Falls back to `UTC` in
 * non-browser contexts (SSR, unit tests without `Intl`).
 */
export function detectBrowserTimezone(): string {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.DateTimeFormat === 'function') {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    }
  } catch {
    // Ignore — fall through to UTC
  }
  return 'UTC';
}

function defaultRuntimeTimezone(): string {
  return detectBrowserTimezone();
}

/**
 * Return the canonical wallclock UTC string for an input, e.g.
 * "2026-06-25T18:01:18.216Z". Always in UTC, regardless of display timezone.
 */
export function toIsoUtc(
  value: string | number | Date | null | undefined,
): string {
  const ms = parseHonchoTimestamp(value);
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

/**
 * Return the short IANA name of the user's effective timezone. Useful for the
 * profile-settings UI to show "Currently: America/Chicago" alongside the
 * override selector.
 */
export function formatTimezoneAbbreviation(
  value: string | number | Date | null | undefined,
  opts: FormatOptions = {},
): string {
  const ms = parseHonchoTimestamp(value);
  if (ms == null) return '';
  const { locale } = { ...DEFAULTS, ...opts };
  const timeZone = opts.timeZone ?? defaultRuntimeTimezone();
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: 'short',
    }).formatToParts(new Date(ms));
    const tz = parts.find((p) => p.type === 'timeZoneName');
    return tz?.value ?? '';
  } catch {
    return '';
  }
}

/**
 * Return a curated list of common timezones for the settings UI. The full
 * `Intl.supportedValuesOf('timeZone')` list is huge (~400 entries); this
 * subset covers ~95% of users.
 */
export const COMMON_TIMEZONES: readonly string[] = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Toronto',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Stockholm',
  'Europe/Athens',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Perth',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;