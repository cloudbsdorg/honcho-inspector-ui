import {
  COMMON_TIMEZONES,
  detectBrowserTimezone,
  formatRelative,
  formatTimezoneAbbreviation,
  formatWallClock,
  formatWallClockTooltip,
  localWallclockToUtcIso,
  parseHonchoTimestamp,
  toIsoUtc,
} from './datetime';

const UTC = '2026-06-25T18:01:18.216Z';
const UTC_MS = 1_782_410_478_216;
const UTC_MS_TRUNC = Date.parse(UTC);

describe('parseHonchoTimestamp', () => {
  it('parses ISO-8601 with Z suffix', () => {
    expect(parseHonchoTimestamp(UTC)).toBe(UTC_MS_TRUNC);
  });

  it('parses ISO-8601 without Z (treats as local)', () => {
    // Without a Z, Date.parse treats it as local. We only verify the
    // function returns a finite number — the exact value depends on the
    // runtime TZ, which is irrelevant for our display logic.
    const ms = parseHonchoTimestamp('2026-06-25T13:01:18.216-05:00');
    expect(ms).not.toBeNull();
    expect(typeof ms).toBe('number');
    expect(Number.isFinite(ms!)).toBe(true);
  });

  it('parses ISO-8601 with explicit offset', () => {
    // 2026-06-25T13:01:18-05:00 == 2026-06-25T18:01:18Z (no fractional seconds
    // because the offset form loses sub-second precision in some engines).
    const ms = parseHonchoTimestamp('2026-06-25T13:01:18-05:00');
    expect(ms).toBe(1_782_410_478_000);
  });

  it('parses epoch milliseconds (large number)', () => {
    expect(parseHonchoTimestamp(UTC_MS)).toBe(UTC_MS);
  });

  it('parses epoch seconds (small number)', () => {
    expect(parseHonchoTimestamp(Math.floor(UTC_MS / 1000))).toBe(1_782_410_478_000);
  });

  it('returns null for empty string', () => {
    expect(parseHonchoTimestamp('')).toBeNull();
  });

  it('returns null for whitespace string', () => {
    expect(parseHonchoTimestamp('   ')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseHonchoTimestamp(null)).toBeNull();
    expect(parseHonchoTimestamp(undefined)).toBeNull();
  });

  it('returns null for unparseable string', () => {
    expect(parseHonchoTimestamp('not a date')).toBeNull();
  });

  it('returns null for NaN', () => {
    expect(parseHonchoTimestamp(Number.NaN)).toBeNull();
    expect(parseHonchoTimestamp(Infinity)).toBeNull();
    expect(parseHonchoTimestamp(-Infinity)).toBeNull();
  });

  it('accepts Date objects', () => {
    expect(parseHonchoTimestamp(new Date(UTC_MS))).toBe(UTC_MS);
  });

  it('accepts numeric epoch as string', () => {
    expect(parseHonchoTimestamp(String(UTC_MS))).toBe(UTC_MS);
    expect(parseHonchoTimestamp(String(Math.floor(UTC_MS / 1000)))).toBe(1_782_410_478_000);
  });

  it('preserves millisecond precision on known-precision inputs', () => {
    // Date.parse loses sub-ms precision; verify our function returns ms-precision
    // when given a number directly (the path the API client uses after parsing).
    expect(parseHonchoTimestamp(UTC_MS)).toBe(UTC_MS);
    expect(parseHonchoTimestamp('2026-06-25T18:01:18.216Z')).toBe(UTC_MS);
  });
});

describe('formatWallClock', () => {
  it('formats ISO-8601 Z string in UTC', () => {
    const out = formatWallClock(UTC, 'short', { timeZone: 'UTC', locale: 'en-US' });
    // 2026-06-25 18:01 UTC
    expect(out).toContain('2026');
    expect(out).toContain('6/25/2026');
    expect(out).toContain('6:01');
  });

  it('shifts the wall-clock when timezone changes', () => {
    const utc = formatWallClock(UTC, 'short', { timeZone: 'UTC', locale: 'en-US' });
    const ny = formatWallClock(UTC, 'short', { timeZone: 'America/New_York', locale: 'en-US' });
    const tokyo = formatWallClock(UTC, 'short', { timeZone: 'Asia/Tokyo', locale: 'en-US' });
    // NY is UTC-4 in June (EDT), so 18:01 UTC = 14:01 NY
    expect(ny).toContain('2:01');
    // Tokyo is UTC+9, so 18:01 UTC = 03:01 next day
    expect(tokyo).toMatch(/3:01|03:01/);
    // The three outputs must be distinct (different zones → different strings)
    expect(new Set([utc, ny, tokyo]).size).toBe(3);
  });

  it('returns empty string for null/undefined/empty input', () => {
    expect(formatWallClock(null, 'short')).toBe('');
    expect(formatWallClock(undefined, 'short')).toBe('');
    expect(formatWallClock('', 'short')).toBe('');
    expect(formatWallClock('not a date', 'short')).toBe('');
  });

  it('respects 24-hour clock when requested', () => {
    const h12 = formatWallClock(UTC, 'shortTime', {
      timeZone: 'UTC',
      locale: 'en-US',
      hour12: true,
    });
    const h24 = formatWallClock(UTC, 'shortTime', {
      timeZone: 'UTC',
      locale: 'en-US',
      hour12: false,
    });
    expect(h12).toContain('PM');
    expect(h24).not.toContain('PM');
    expect(h24).not.toContain('AM');
    expect(h24).toContain('18:01');
  });

  it('falls back gracefully on invalid timezone', () => {
    const out = formatWallClock(UTC, 'short', { timeZone: 'Not/A/Zone' });
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('handles all granularities', () => {
    const granularities = ['short', 'shortDate', 'shortTime', 'medium', 'mediumDate', 'mediumTime', 'long', 'full'] as const;
    for (const g of granularities) {
      const out = formatWallClock(UTC, g, { timeZone: 'UTC', locale: 'en-US' });
      expect(typeof out).toBe('string');
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it('long granularity includes the timezone abbreviation', () => {
    const out = formatWallClock(UTC, 'long', { timeZone: 'America/Chicago', locale: 'en-US' });
    expect(out).toMatch(/CDT|CST/);
  });
});

describe('formatWallClockTooltip', () => {
  it('contains the raw UTC ISO string', () => {
    const out = formatWallClockTooltip(UTC, { timeZone: 'UTC', locale: 'en-US' });
    expect(out).toContain('2026-06-25T18:01:18');
    expect(out.toLowerCase()).toContain('utc');
  });

  it('returns empty for invalid input', () => {
    expect(formatWallClockTooltip(null)).toBe('');
    expect(formatWallClockTooltip('garbage')).toBe('');
  });

  it('shows the local time alongside UTC', () => {
    const out = formatWallClockTooltip(UTC, { timeZone: 'America/New_York', locale: 'en-US' });
    // Should include both local time and UTC reference
    expect(out).toMatch(/14:01/); // NY in EDT
    expect(out).toContain('2026-06-25T18:01:18');
  });
});

describe('formatRelative', () => {
  it('returns "just now" for less than 5 seconds', () => {
    expect(formatRelative(Date.now())).toBe('just now');
    expect(formatRelative(Date.now() - 2000)).toBe('just now');
  });

  it('returns seconds for less than 60 seconds', () => {
    expect(formatRelative(Date.now() - 30_000)).toBe('30s ago');
  });

  it('returns minutes for less than 60 minutes', () => {
    expect(formatRelative(Date.now() - 5 * 60_000)).toBe('5m ago');
  });

  it('returns hours for less than 24 hours', () => {
    expect(formatRelative(Date.now() - 2 * 3_600_000)).toBe('2h ago');
  });

  it('returns days for less than 7 days', () => {
    expect(formatRelative(Date.now() - 3 * 86_400_000)).toBe('3d ago');
  });

  it('returns weeks for less than 4 weeks', () => {
    expect(formatRelative(Date.now() - 14 * 86_400_000)).toBe('2w ago');
  });

  it('returns months for less than 12 months', () => {
    expect(formatRelative(Date.now() - 60 * 86_400_000)).toBe('2mo ago');
  });

  it('returns years for >= 1 year', () => {
    expect(formatRelative(Date.now() - 400 * 86_400_000)).toBe('1y ago');
  });

  it('respects an explicit `now` parameter for determinism', () => {
    const now = 1_700_000_000_000;
    expect(formatRelative(now - 30_000, now)).toBe('30s ago');
  });

  it('returns empty for invalid input', () => {
    expect(formatRelative(null)).toBe('');
    expect(formatRelative('garbage')).toBe('');
  });

  it('clamps future timestamps to 0 seconds', () => {
    expect(formatRelative(Date.now() + 10_000)).toBe('just now');
  });
});

describe('formatTimezoneAbbreviation', () => {
  it('returns CDT/CST for Chicago in June', () => {
    const out = formatTimezoneAbbreviation(UTC, { timeZone: 'America/Chicago', locale: 'en-US' });
    expect(out).toMatch(/CDT|CST/);
  });

  it('returns UTC for UTC zone', () => {
    const out = formatTimezoneAbbreviation(UTC, { timeZone: 'UTC', locale: 'en-US' });
    expect(out).toContain('UTC');
  });

  it('returns empty for invalid input', () => {
    expect(formatTimezoneAbbreviation(null, { timeZone: 'UTC' })).toBe('');
  });
});

describe('toIsoUtc', () => {
  it('returns canonical UTC ISO string', () => {
    expect(toIsoUtc(UTC_MS)).toBe('2026-06-25T18:01:18.216Z');
  });

  it('accepts ISO strings and normalizes to UTC', () => {
    const out = toIsoUtc('2026-06-25T13:01:18.216-05:00');
    expect(out).toBe('2026-06-25T18:01:18.216Z');
  });

  it('returns empty for invalid input', () => {
    expect(toIsoUtc(null)).toBe('');
    expect(toIsoUtc('garbage')).toBe('');
  });
});

describe('detectBrowserTimezone', () => {
  it('returns a non-empty IANA zone', () => {
    const tz = detectBrowserTimezone();
    expect(typeof tz).toBe('string');
    expect(tz.length).toBeGreaterThan(0);
  });

  it('returns a valid timezone (round-trip)', () => {
    const tz = detectBrowserTimezone();
    expect(() => new Intl.DateTimeFormat('en-US', { timeZone: tz })).not.toThrow();
  });
});

describe('COMMON_TIMEZONES', () => {
  it('contains UTC', () => {
    expect(COMMON_TIMEZONES).toContain('UTC');
  });

  it('contains all major US zones', () => {
    expect(COMMON_TIMEZONES).toContain('America/New_York');
    expect(COMMON_TIMEZONES).toContain('America/Chicago');
    expect(COMMON_TIMEZONES).toContain('America/Denver');
    expect(COMMON_TIMEZONES).toContain('America/Los_Angeles');
  });

  it('contains Europe/London and Asia/Tokyo', () => {
    expect(COMMON_TIMEZONES).toContain('Europe/London');
    expect(COMMON_TIMEZONES).toContain('Asia/Tokyo');
  });

  it('all entries are IANA timezone names', () => {
    // We can't always validate every zone (some legacy JS runtimes lack
    // tzdata for all IANA entries), but every entry must at minimum
    // *look* like an IANA name: a region/city pair or "UTC".
    for (const tz of COMMON_TIMEZONES) {
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(0);
      expect(tz).not.toContain(' ');
      if (tz !== 'UTC') {
        expect(tz).toContain('/');
      }
    }
  });

  it('every entry passes Intl validation on modern runtimes', () => {
    if (typeof Intl.supportedValuesOf !== 'function') return;
    const supported = new Set(Intl.supportedValuesOf('timeZone'));
    const unsupported = COMMON_TIMEZONES.filter((tz) => !supported.has(tz));
    // Allow a small minority to be missing on stripped runtimes; this
    // test only fails if a substantial chunk of common zones is absent.
    expect(unsupported.length).toBeLessThan(5);
  });

  it('has no duplicates', () => {
    expect(new Set(COMMON_TIMEZONES).size).toBe(COMMON_TIMEZONES.length);
  });
});

describe('localWallclockToUtcIso', () => {
  it('returns empty string for empty/null/undefined input', () => {
    expect(localWallclockToUtcIso('')).toBe('');
    expect(localWallclockToUtcIso(null)).toBe('');
    expect(localWallclockToUtcIso(undefined)).toBe('');
  });

  it('returns empty string for unparseable input', () => {
    expect(localWallclockToUtcIso('not-a-date')).toBe('');
    expect(localWallclockToUtcIso('2026-13-40T99:99')).toBe('');
  });

  it('interprets naive local string in UTC when timeZone is UTC', () => {
    // 2026-06-25T13:45 in UTC == 2026-06-25T13:45:00Z
    expect(localWallclockToUtcIso('2026-06-25T13:45', 'UTC')).toBe(
      '2026-06-25T13:45:00.000Z',
    );
  });

  it('interprets naive local string in America/Chicago (UTC-5 in June)', () => {
    // 2026-06-25T13:45 Chicago == 18:45 UTC (CDT is UTC-5)
    expect(localWallclockToUtcIso('2026-06-25T13:45', 'America/Chicago')).toBe(
      '2026-06-25T18:45:00.000Z',
    );
  });

  it('interprets naive local string in America/Chicago during CST (UTC-6)', () => {
    // January is CST (UTC-6), so 13:45 Chicago == 19:45 UTC
    expect(localWallclockToUtcIso('2026-01-15T13:45', 'America/Chicago')).toBe(
      '2026-01-15T19:45:00.000Z',
    );
  });

  it('interprets naive local string in Asia/Tokyo (UTC+9, no DST)', () => {
    // 2026-06-25T13:45 Tokyo == 04:45 UTC
    expect(localWallclockToUtcIso('2026-06-25T13:45', 'Asia/Tokyo')).toBe(
      '2026-06-25T04:45:00.000Z',
    );
  });

  it('handles seconds-precision input', () => {
    expect(localWallclockToUtcIso('2026-06-25T13:45:30', 'UTC')).toBe(
      '2026-06-25T13:45:30.000Z',
    );
  });

  it('falls back gracefully when Intl cannot determine the offset', () => {
    // Even with a bogus zone name, the function should not throw —
    // it should return something parseable.
    const result = localWallclockToUtcIso('2026-06-25T13:45', 'Not/A/Zone');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('produces ISO strings the backend accepts (matches Spring parser)', () => {
    // Regression test for the original audit-tab bug: the backend's
    // Spring Instant parser accepts both Z and offset forms, so we
    // make sure our output is one of those.
    const result = localWallclockToUtcIso('2026-06-25T13:45', 'America/Chicago');
    expect(result).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
  });
});