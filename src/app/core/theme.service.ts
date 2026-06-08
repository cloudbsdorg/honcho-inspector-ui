import { Injectable, computed, signal } from '@angular/core';
import { ThemeId, ThemeMeta } from './models';

const STORAGE_KEY = 'honcho-ui-theme';
const ALL_THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: 'miami',
    name: 'Miami Vice',
    description: 'Neon pink and cyan, sun-soaked synthwave',
    preview: 'linear-gradient(135deg,#ff2d95,#00f0ff,#ffe600)',
  },
  {
    id: 'retro',
    name: 'Retro CRT',
    description: 'Amber phosphor, scanlines, 1985 terminal',
    preview: 'linear-gradient(135deg,#ffb000,#ff5e00)',
  },
  {
    id: 'win95',
    name: 'Windows 95',
    description: 'Chiseled grey, bevels, MS Sans',
    preview: 'linear-gradient(135deg,#c0c0c0,#000080)',
  },
  {
    id: 'sun',
    name: 'SunOS',
    description: 'Beige workstation, sun yellow, Open Look',
    preview: 'linear-gradient(135deg,#cc6600,#1e64b0)',
  },
  {
    id: 'cde',
    name: 'CDE',
    description: 'Common Desktop Environment, 90s UNIX',
    preview: 'linear-gradient(135deg,#2c5282,#6b46c1)',
  },
  {
    id: 'modern',
    name: 'Modern Glass',
    description: 'Frosted glass, soft gradients, 2026',
    preview: 'linear-gradient(135deg,#a78bfa,#38bdf8,#f472b6)',
  },
];

const DEFAULT_THEME: ThemeId = 'miami';
const KNOWN_THEMES = new Set<ThemeId>(ALL_THEMES.map((t) => t.id));

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly _theme = signal<ThemeId>(this.loadInitial());

  readonly theme = this._theme.asReadonly();
  readonly availableThemes = signal<ReadonlyArray<ThemeMeta>>(ALL_THEMES);

  readonly currentMeta = computed<ThemeMeta>(
    () => ALL_THEMES.find((t) => t.id === this._theme()) ?? ALL_THEMES[0]!,
  );

  constructor() {
    this.applyTheme(this._theme());
  }

  setTheme(id: ThemeId): void {
    this._theme.set(id);
    this.applyTheme(id);
  }

  cycle(): void {
    const order = ALL_THEMES.map((t) => t.id);
    const idx = order.indexOf(this._theme());
    const next = order[(idx + 1) % order.length]!;
    this.setTheme(next);
  }

  private applyTheme(id: ThemeId): void {
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', id);
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, id);
    }
  }

  private loadInitial(): ThemeId {
    if (typeof localStorage === 'undefined') return DEFAULT_THEME;
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (stored && KNOWN_THEMES.has(stored)) return stored;
    return DEFAULT_THEME;
  }
}
