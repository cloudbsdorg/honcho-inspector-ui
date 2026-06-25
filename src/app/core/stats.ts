import type { HonchoPeerSummary, HonchoSessionSummary } from './models';

/**
 * Granularity for time-bucketed counts. Each value names a millisecond
 * window; bucket boundaries are floor(ts / windowMs) * windowMs.
 *
 * The list is ordered coarse-to-fine so UI controls can render in the
 * natural reading order (year → month → ... → 1m). The operator-facing
 * label is the human-readable "1 month", "5 minutes" string.
 */
export type Granularity = '1mo' | '1w' | '1d' | '12h' | '6h' | '1h' | '30m' | '15m' | '5m' | '1m';

export const GRANULARITIES: readonly Granularity[] = [
  '1mo',
  '1w',
  '1d',
  '12h',
  '6h',
  '1h',
  '30m',
  '15m',
  '5m',
  '1m',
];

export const GRANULARITY_LABELS: Record<Granularity, string> = {
  '1mo': '1 month',
  '1w': '1 week',
  '1d': '1 day',
  '12h': '12 hours',
  '6h': '6 hours',
  '1h': '1 hour',
  '30m': '30 minutes',
  '15m': '15 minutes',
  '5m': '5 minutes',
  '1m': '1 minute',
};

export const GRANULARITY_MS: Record<Granularity, number> = {
  '1mo': 30 * 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '12h': 12 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '5m': 5 * 60 * 1000,
  '1m': 60 * 1000,
};

export interface TimeBucket<T> {
  /** bucket start (epoch ms, floored to the granularity window) */
  startMs: number;
  /** number of items in this bucket */
  count: number;
  /** the items that fell in this bucket, in input order */
  items: T[];
}

/**
 * Pure bucketing utility. Returns one TimeBucket per non-empty window
 * spanning [nowMs - durationMs, nowMs], oldest first. Items without
 * a parseable `createdAt` are dropped. The total returned across all
 * buckets equals the number of items that had a parseable timestamp.
 *
 * Pure: no Date.now() side-effect, so the caller controls the "now"
 * reference and tests are deterministic.
 */
export function bucketByCreatedAt<T extends { createdAt?: string }>(
  items: readonly T[],
  granularity: Granularity,
  nowMs: number,
  durationMs: number,
): TimeBucket<T>[] {
  const windowMs = GRANULARITY_MS[granularity];
  const oldestStartMs = Math.floor((nowMs - durationMs) / windowMs) * windowMs;
  const newestStartMs = Math.floor(nowMs / windowMs) * windowMs;

  const counts = new Map<number, T[]>();
  for (let s = oldestStartMs; s <= newestStartMs; s += windowMs) {
    counts.set(s, []);
  }
  // Enforce a hard cap on bucket count so a 1m granularity over a
  // 30-day window doesn't allocate ~43,000 empty arrays. The cap
  // is intentionally loose (10,000) — 10m over a year is 52,560
  // buckets which we still want to render.
  if (counts.size > 10_000) return [];

  for (const item of items) {
    if (!item.createdAt) continue;
    const t = Date.parse(item.createdAt);
    if (Number.isNaN(t)) continue;
    const bucketStart = Math.floor(t / windowMs) * windowMs;
    if (bucketStart < oldestStartMs || bucketStart > newestStartMs) continue;
    let bucket = counts.get(bucketStart);
    if (!bucket) {
      bucket = [];
      counts.set(bucketStart, bucket);
    }
    bucket.push(item);
  }

  // Emit in chronological order. Each non-empty bucket becomes a
  // TimeBucket; empty buckets are still emitted (count=0) so the
  // chart's x-axis is continuous and the user sees the gaps.
  const out: TimeBucket<T>[] = [];
  for (let s = oldestStartMs; s <= newestStartMs; s += windowMs) {
    const items = counts.get(s) ?? [];
    out.push({ startMs: s, count: items.length, items });
  }
  return out;
}

export interface Totals<T> {
  total: number;
  last1m: number;
  last5m: number;
  last15m: number;
  last30m: number;
  last1h: number;
  last6h: number;
  last12h: number;
  last1d: number;
  last1w: number;
  last1mo: number;
  perItem?: Map<T, number>;
}

/**
 * Counts items across every "last N" window. Returns a flat object
 * keyed by window name (matches the Granularity values, minus
 * week/month overlap with 1d/1mo — week and month totals are also
 * included for direct display).
 *
 * If `keyFn` is provided, also returns a Map from each unique key
 * to its count (used for top-N lists like "peers with the most
 * sessions").
 */
export function totalsByWindow<T extends { createdAt?: string }>(
  items: readonly T[],
  nowMs: number,
  keyFn?: (t: T) => string,
): Totals<T> {
  const result: Totals<T> = {
    total: 0,
    last1m: 0,
    last5m: 0,
    last15m: 0,
    last30m: 0,
    last1h: 0,
    last6h: 0,
    last12h: 0,
    last1d: 0,
    last1w: 0,
    last1mo: 0,
  };
  const windows: Array<[keyof Totals<T>, number]> = [
    ['last1m', GRANULARITY_MS['1m']],
    ['last5m', GRANULARITY_MS['5m']],
    ['last15m', GRANULARITY_MS['15m']],
    ['last30m', GRANULARITY_MS['30m']],
    ['last1h', GRANULARITY_MS['1h']],
    ['last6h', GRANULARITY_MS['6h']],
    ['last12h', GRANULARITY_MS['12h']],
    ['last1d', GRANULARITY_MS['1d']],
    ['last1w', GRANULARITY_MS['1w']],
    ['last1mo', GRANULARITY_MS['1mo']],
  ];
  if (keyFn) result.perItem = new Map<T, number>();

  for (const item of items) {
    if (!item.createdAt) continue;
    const t = Date.parse(item.createdAt);
    if (Number.isNaN(t)) continue;
    result.total++;
    const ageMs = nowMs - t;
    for (const [key, winMs] of windows) {
      if (ageMs <= winMs) {
        // The cast is safe: `key` is one of the literal keys of Totals<T>,
        // all of which are number fields. `result` is keyed by those same
        // keys, so the assignment can't fail at runtime.
        (result as unknown as Record<string, number>)[key as string]++;
      }
    }
    if (keyFn && result.perItem) {
      result.perItem.set(item, (result.perItem.get(item) ?? 0) + 1);
    }
  }
  return result;
}

/**
 * Convenience: top-N items by count of associated child items, e.g.
 * "peers ranked by number of sessions they participate in". Returns
 * the items in descending order of count.
 */
export function topNByCount<T>(
  childToParent: Map<T, number> | undefined,
  parents: readonly T[],
  n: number,
): { item: T; count: number }[] {
  if (!childToParent) return [];
  const sorted = parents
    .map((p) => ({ item: p, count: childToParent.get(p) ?? 0 }))
    .sort((a, b) => b.count - a.count);
  return sorted.slice(0, n);
}

/**
 * Helper: the wall-clock date label for a bucket's start time, e.g.
 * `2026-06-23 14:00` for hourly buckets, `2026-06-23` for daily.
 * Formatting is intentionally compact (no seconds/minutes) so it
 * reads cleanly under a chart axis. Uses the runtime locale via
 * {@link Intl.DateTimeFormat}; in non-browser contexts (e.g. SSR
 * or tests) falls back to `en-US`.
 */
export function bucketLabel(startMs: number, granularity: Granularity): string {
  const locale =
    (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  const minuteFmt = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const hourFmt = new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const dayFmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  if (
    granularity === '1m' ||
    granularity === '5m' ||
    granularity === '15m' ||
    granularity === '30m'
  ) {
    return minuteFmt.format(new Date(startMs));
  }
  if (granularity === '1h' || granularity === '6h' || granularity === '12h') {
    return hourFmt.format(new Date(startMs));
  }
  return dayFmt.format(new Date(startMs));
}
