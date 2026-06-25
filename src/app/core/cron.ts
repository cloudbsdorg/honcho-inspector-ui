const DAY_NAMES: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
  '7': 'Sunday',
};

function pad2(n: string | number): string {
  return String(n).padStart(2, '0');
}

function padHour(n: string | number): string {
  return pad2(n);
}

/**
 * Convert a 6-field Quartz-style cron expression (sec min hr dom mon dow) to
 * a short human-readable phrase. Returns the raw expression (or a
 * "(not scheduled)" placeholder for empty input) when it can't be expressed
 * in plain English.
 */
export function describeCron(cron: string | null | undefined): string {
  if (!cron || typeof cron !== 'string' || cron.trim() === '') {
    return '(not scheduled)';
  }
  const raw = cron.trim();
  const parts = raw.split(/\s+/);
  if (parts.length !== 6) return raw;

  const [, minute, hour, dayOfMonth, , dayOfWeek] = parts;

  // Every N minutes: 0 */N * * * *
  if (
    minute.startsWith('*/') &&
    hour === '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    parts[5] === '*'
  ) {
    const n = minute.slice(2);
    return `Every ${n} minutes`;
  }

  // Every hour on the hour: 0 0 * * * *
  if (
    minute === '0' &&
    hour === '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    parts[5] === '*'
  ) {
    return 'Every hour, on the hour';
  }

  // Daily at HH:MM: 0 MM HH * * *
  if (
    minute !== '*' &&
    !minute.startsWith('*/') &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    parts[5] === '*'
  ) {
    return `Every day at ${padHour(hour)}:${pad2(minute)}`;
  }

  // Weekdays at HH:MM: 0 MM HH * * 1-5
  if (
    minute !== '*' &&
    !minute.startsWith('*/') &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    dayOfWeek === '1-5'
  ) {
    return `Every weekday (Mon\u2013Fri) at ${padHour(hour)}:${pad2(minute)}`;
  }

  // Weekend at HH:MM: 0 MM HH * * 6,0 / 0 MM HH * * 0,6
  if (
    minute !== '*' &&
    !minute.startsWith('*/') &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    (dayOfWeek === '6,0' || dayOfWeek === '0,6' || dayOfWeek === '6')
  ) {
    return `Every weekend (Sat\u2013Sun) at ${padHour(hour)}:${pad2(minute)}`;
  }

  // Single day-of-week at HH:MM: 0 MM HH * * D
  if (
    minute !== '*' &&
    !minute.startsWith('*/') &&
    hour !== '*' &&
    dayOfMonth === '*' &&
    parts[4] === '*' &&
    dayOfWeek &&
    /^\d+$/.test(dayOfWeek) &&
    DAY_NAMES[dayOfWeek]
  ) {
    return `Every ${DAY_NAMES[dayOfWeek]} at ${padHour(hour)}:${pad2(minute)}`;
  }

  return raw;
}
