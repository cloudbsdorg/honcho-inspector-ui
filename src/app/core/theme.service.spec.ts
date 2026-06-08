import { TestBed } from '@angular/core/testing';
import { ThemeService } from './theme.service';
import { ThemeId } from './models';

describe('ThemeService', () => {
  let service: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({});
    service = TestBed.inject(ThemeService);
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should expose all 6 themes with id/name/description/preview', () => {
    const themes = service.availableThemes();
    expect(themes.length).toBe(6);
    for (const t of themes) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.preview).toBeTruthy();
    }
    const ids = themes.map((t) => t.id).sort();
    expect(ids).toEqual(['cde', 'miami', 'modern', 'retro', 'sun', 'win95']);
  });

  it('should default to miami theme when no localStorage value', () => {
    expect(service.theme()).toBe<ThemeId>('miami');
    expect(document.documentElement.getAttribute('data-theme')).toBe('miami');
  });

  it('should set the data-theme attribute on documentElement when theme changes', () => {
    service.setTheme('retro');
    expect(document.documentElement.getAttribute('data-theme')).toBe('retro');
    service.setTheme('modern');
    expect(document.documentElement.getAttribute('data-theme')).toBe('modern');
  });

  it('should update the theme signal when setTheme is called', () => {
    service.setTheme('win95');
    expect(service.theme()).toBe<ThemeId>('win95');
    service.setTheme('cde');
    expect(service.theme()).toBe<ThemeId>('cde');
  });

  it('should persist the chosen theme to localStorage', () => {
    service.setTheme('sun');
    expect(localStorage.getItem('honcho-ui-theme')).toBe('sun');
  });

  it('should restore the persisted theme on construction', () => {
    localStorage.setItem('honcho-ui-theme', 'modern');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.theme()).toBe<ThemeId>('modern');
    expect(document.documentElement.getAttribute('data-theme')).toBe('modern');
  });

  it('should fall back to miami if localStorage holds an unknown id', () => {
    localStorage.setItem('honcho-ui-theme', 'nonexistent');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({});
    const fresh = TestBed.inject(ThemeService);
    expect(fresh.theme()).toBe<ThemeId>('miami');
  });

  it('should cycle to next theme', () => {
    service.setTheme('miami');
    const order = ['miami', 'retro', 'win95', 'sun', 'cde', 'modern'];
    for (let i = 0; i < order.length; i++) {
      const expected = order[(i + 1) % order.length] as ThemeId;
      service.cycle();
      expect(service.theme()).toBe(expected);
    }
  });
});
