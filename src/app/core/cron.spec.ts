import { describeCron } from './cron';

describe('describeCron', () => {
  it('describes a daily 3am purge', () => {
    // 0 0 3 * * * = every day at 03:00
    expect(describeCron('0 0 3 * * *')).toBe('Every day at 03:00');
  });

  it('describes an hourly job', () => {
    expect(describeCron('0 0 * * * *')).toBe('Every hour, on the hour');
  });

  it('describes every 5 minutes', () => {
    expect(describeCron('0 */5 * * * *')).toBe('Every 5 minutes');
  });

  it('describes every 15 minutes', () => {
    expect(describeCron('0 */15 * * * *')).toBe('Every 15 minutes');
  });

  it('describes every Monday at 09:30', () => {
    expect(describeCron('0 30 9 * * 1')).toBe('Every Monday at 09:30');
  });

  it('describes weekdays at 08:00', () => {
    expect(describeCron('0 0 8 * * 1-5')).toBe('Every weekday (Mon–Fri) at 08:00');
  });

  it('describes every Sunday at midnight', () => {
    expect(describeCron('0 0 0 * * 0')).toBe('Every Sunday at 00:00');
  });

  it('returns a raw string for unknown patterns', () => {
    // 0 0 0 29 2 * = Feb 29 - too edge-case to expand
    const out = describeCron('0 0 0 29 2 *');
    expect(out).toBe('0 0 0 29 2 *');
  });

  it('returns raw cron for empty string', () => {
    expect(describeCron('')).toBe('(not scheduled)');
  });

  it('returns raw cron for non-string input', () => {
    expect(describeCron(null as unknown as string)).toBe('(not scheduled)');
    expect(describeCron(undefined as unknown as string)).toBe('(not scheduled)');
  });
});
