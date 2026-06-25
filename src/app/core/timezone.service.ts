import { Injectable, computed, signal, Signal } from '@angular/core';
import {
  COMMON_TIMEZONES,
  detectBrowserTimezone,
} from './datetime';

/**
 * Per-user effective timezone with a persisted override.
 *
 * Resolution order:
 *   1. localStorage['honcho-inspector.timezoneOverride'] (user-set)
 *   2. browser-detected IANA timezone (Intl.DateTimeFormat)
 *   3. 'UTC' (SSR / non-browser)
 *
 * The override persists across sessions, browser restarts, and dev-server
 * reloads. It is cleared by the settings UI's "Reset to browser default"
 * button or by clearing site data.
 *
 * Provided in root so any component can `inject(TimezoneService)` and read
 * the resolved timezone via {@link effectiveTimezone} (signal).
 */
@Injectable({ providedIn: 'root' })
export class TimezoneService {
  private static readonly STORAGE_KEY = 'honcho-inspector.timezoneOverride';

  private readonly _override = signal<string | null>(this.readOverride());
  private readonly _detected = signal<string>(detectBrowserTimezone());

  readonly detectedTimezone: Signal<string> = this._detected.asReadonly();
  readonly override: Signal<string | null> = this._override.asReadonly();

  /** The effective timezone (override or detected). Used by all displays. */
  readonly effectiveTimezone: Signal<string> = computed(() => {
    const ov = this._override();
    if (ov && this.isValidTimezone(ov)) return ov;
    return this._detected();
  });

  /** True if the user has an explicit override set. */
  readonly hasOverride: Signal<boolean> = computed(() => {
    const ov = this._override();
    return ov != null && ov !== '' && this.isValidTimezone(ov);
  });

  /** Curated list of common timezones for the settings dropdown. */
  readonly commonTimezones: readonly string[] = COMMON_TIMEZONES;

  /** Set the user's timezone override and persist it. */
  setOverride(tz: string | null): void {
    if (tz == null || tz === '') {
      this.clearOverride();
      return;
    }
    if (!this.isValidTimezone(tz)) return;
    this._override.set(tz);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(TimezoneService.STORAGE_KEY, tz);
      }
    } catch {
      // localStorage may be disabled (private mode); the in-memory override
      // still works for this session.
    }
  }

  /** Clear the override and revert to browser-detected. */
  clearOverride(): void {
    this._override.set(null);
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(TimezoneService.STORAGE_KEY);
      }
    } catch {
      // Ignore
    }
  }

  /** Re-detect the browser timezone (e.g. if user moved regions). */
  redetect(): void {
    this._detected.set(detectBrowserTimezone());
  }

  private readOverride(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      const v = localStorage.getItem(TimezoneService.STORAGE_KEY);
      return v && this.isValidTimezone(v) ? v : null;
    } catch {
      return null;
    }
  }

  private isValidTimezone(tz: string): boolean {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }
}