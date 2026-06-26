import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TimezoneService } from '../../core/timezone.service';
import { ThemeService } from '../../core/theme.service';
import { HonchoAuthService } from '../../core/honcho-auth.service';
import {
  COMMON_TIMEZONES,
  formatWallClock,
  formatWallClockTooltip,
} from '../../core/datetime';

interface TimezoneGroup {
  region: string;
  zones: readonly string[];
}

const TZ_GROUPS: readonly TimezoneGroup[] = [
  {
    region: 'UTC',
    zones: ['UTC'],
  },
  {
    region: 'Americas',
    zones: [
      'America/Anchorage',
      'America/Chicago',
      'America/Denver',
      'America/Honolulu',
      'America/Los_Angeles',
      'America/Mexico_City',
      'America/New_York',
      'America/Sao_Paulo',
      'America/Toronto',
    ],
  },
  {
    region: 'Europe',
    zones: [
      'Europe/Amsterdam',
      'Europe/Athens',
      'Europe/Berlin',
      'Europe/Dublin',
      'Europe/London',
      'Europe/Madrid',
      'Europe/Moscow',
      'Europe/Paris',
      'Europe/Rome',
      'Europe/Stockholm',
    ],
  },
  {
    region: 'Africa',
    zones: ['Africa/Cairo', 'Africa/Johannesburg', 'Africa/Lagos'],
  },
  {
    region: 'Asia',
    zones: [
      'Asia/Bangkok',
      'Asia/Dubai',
      'Asia/Hong_Kong',
      'Asia/Kolkata',
      'Asia/Seoul',
      'Asia/Shanghai',
      'Asia/Singapore',
      'Asia/Tokyo',
    ],
  },
  {
    region: 'Australia & Pacific',
    zones: ['Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland'],
  },
];

@Component({
  selector: 'app-preferences',
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './preferences.html',
  styleUrl: './preferences.css',
})
export class Preferences implements OnInit {
  readonly tz = inject(TimezoneService);
  readonly theme = inject(ThemeService);
  readonly auth = inject(HonchoAuthService);
  private readonly destroyRef = inject(DestroyRef);

  // Live clock for the preview row.
  readonly now = signal<number>(Date.now());

  readonly tzFilter = signal<string>('');

  readonly tzGroups = TZ_GROUPS;

  readonly curatedFallback = COMMON_TIMEZONES;

  readonly filteredGroups = computed<readonly TimezoneGroup[]>(() => {
    const q = this.tzFilter().trim().toLowerCase();
    if (!q) return this.tzGroups;
    return this.tzGroups
      .map((g) => ({
        region: g.region,
        zones: g.zones.filter((z) => z.toLowerCase().includes(q)),
      }))
      .filter((g) => g.zones.length > 0);
  });

  readonly noMatches = computed(() => this.filteredGroups().length === 0);

  readonly previewNow = computed(() =>
    formatWallClock(this.now(), 'mediumTime', {
      timeZone: this.tz.effectiveTimezone(),
    }),
  );

  readonly previewNowTooltip = computed(() =>
    formatWallClockTooltip(this.now(), {
      timeZone: this.tz.effectiveTimezone(),
    }),
  );

  readonly targetZone = signal<string | null>(null);

  readonly targetPreview = computed(() => {
    const tz = this.targetZone();
    if (!tz) return '';
    return formatWallClock(this.now(), 'mediumTime', { timeZone: tz });
  });

  readonly targetPreviewTooltip = computed(() => {
    const tz = this.targetZone();
    if (!tz) return '';
    return formatWallClockTooltip(this.now(), { timeZone: tz });
  });

  readonly username = computed(() => this.auth.user()?.username ?? '');
  readonly isAdmin = computed(() => this.auth.isAdmin());

  ngOnInit(): void {
    const id = setInterval(() => this.now.set(Date.now()), 1000);
    this.destroyRef.onDestroy(() => clearInterval(id));
  }

  setZone(zone: string): void {
    this.tz.setOverride(zone);
    this.tzFilter.set('');
    this.targetZone.set(null);
  }

  resetZone(): void {
    this.tz.clearOverride();
    this.tzFilter.set('');
    this.targetZone.set(null);
  }

  highlightZone(zone: string | null): void {
    this.targetZone.set(zone);
  }

  setTheme(themeId: string): void {
    this.theme.setTheme(themeId as any);
  }

  onFilterInput(value: string): void {
    this.tzFilter.set(value);
  }
}
