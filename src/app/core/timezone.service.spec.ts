import { TestBed } from '@angular/core/testing';
import { TimezoneService } from './timezone.service';

describe('TimezoneService', () => {
  let svc: TimezoneService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    svc = TestBed.inject(TimezoneService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('is provided in root', () => {
    expect(svc).toBeTruthy();
  });

  it('exposes a non-empty detected timezone', () => {
    expect(svc.detectedTimezone()).toBeTruthy();
    expect(typeof svc.detectedTimezone()).toBe('string');
  });

  it('starts with no override', () => {
    expect(svc.override()).toBeNull();
    expect(svc.hasOverride()).toBe(false);
  });

  it('effectiveTimezone falls back to detected when no override', () => {
    expect(svc.effectiveTimezone()).toBe(svc.detectedTimezone());
  });

  it('setOverride persists to localStorage', () => {
    svc.setOverride('America/Chicago');
    expect(svc.override()).toBe('America/Chicago');
    expect(svc.hasOverride()).toBe(true);
    expect(localStorage.getItem('honcho-inspector.timezoneOverride')).toBe('America/Chicago');
  });

  it('effectiveTimezone uses override when set', () => {
    svc.setOverride('Asia/Tokyo');
    expect(svc.effectiveTimezone()).toBe('Asia/Tokyo');
  });

  it('clearOverride removes the persisted value', () => {
    svc.setOverride('Asia/Tokyo');
    svc.clearOverride();
    expect(svc.override()).toBeNull();
    expect(svc.hasOverride()).toBe(false);
    expect(localStorage.getItem('honcho-inspector.timezoneOverride')).toBeNull();
  });

  it('setOverride rejects invalid timezones', () => {
    svc.setOverride('Not/A/Zone');
    expect(svc.override()).toBeNull();
    expect(svc.hasOverride()).toBe(false);
  });

  it('setOverride(null) clears the override', () => {
    svc.setOverride('America/Chicago');
    svc.setOverride(null);
    expect(svc.override()).toBeNull();
  });

  it('setOverride("") clears the override', () => {
    svc.setOverride('America/Chicago');
    svc.setOverride('');
    expect(svc.override()).toBeNull();
  });

  it('reads existing override from localStorage on construction', () => {
    localStorage.setItem('honcho-inspector.timezoneOverride', 'Europe/London');
    // Re-create service so it reads storage on boot
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc2 = TestBed.inject(TimezoneService);
    expect(svc2.override()).toBe('Europe/London');
    expect(svc2.hasOverride()).toBe(true);
    expect(svc2.effectiveTimezone()).toBe('Europe/London');
  });

  it('ignores garbage in localStorage on boot', () => {
    localStorage.setItem('honcho-inspector.timezoneOverride', 'BOGUS');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const svc2 = TestBed.inject(TimezoneService);
    expect(svc2.override()).toBeNull();
    expect(svc2.hasOverride()).toBe(false);
  });

  it('exposes a non-empty list of common timezones', () => {
    expect(svc.commonTimezones.length).toBeGreaterThan(10);
    expect(svc.commonTimezones).toContain('UTC');
  });

  it('redetect() re-reads the browser timezone', () => {
    const before = svc.detectedTimezone();
    svc.redetect();
    expect(svc.detectedTimezone()).toBe(before);
  });
});