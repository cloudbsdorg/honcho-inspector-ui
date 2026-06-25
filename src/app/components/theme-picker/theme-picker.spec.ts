import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ThemePicker } from './theme-picker';
import { ThemeService } from '../../core/theme.service';

describe('ThemePicker (dropdown)', () => {
  let fixture: ComponentFixture<ThemePicker>;
  let component: ThemePicker;
  let theme: ThemeService;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    TestBed.configureTestingModule({
      imports: [ThemePicker],
    });
    theme = TestBed.inject(ThemeService);
    fixture = TestBed.createComponent(ThemePicker);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('should be created', () => {
    expect(component).toBeTruthy();
  });

  it('should render a single trigger button (not 6 buttons)', () => {
    const triggers = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="theme-trigger"]',
    );
    expect(triggers.length).toBe(1);
  });

  it('should not render theme options when closed', () => {
    const options = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="theme-option"]',
    );
    expect(options.length).toBe(0);
  });

  it('should open the menu on toggle()', () => {
    component.toggle();
    fixture.detectChanges();
    const options = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[data-testid="theme-option"]',
    );
    expect(options.length).toBe(6);
    expect(component.isOpen()).toBe(true);
  });

  it('should close the menu on second toggle()', () => {
    component.toggle();
    component.toggle();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(false);
  });

  it('should set the theme and close the menu when an option is clicked', () => {
    component.toggle();
    fixture.detectChanges();
    component.select('retro');
    fixture.detectChanges();
    expect(theme.theme()).toBe('retro');
    expect(component.isOpen()).toBe(false);
  });

  it('should close the menu on onEscape()', () => {
    component.toggle();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(true);
    component.onEscape();
    expect(component.isOpen()).toBe(false);
  });

  it('should close the menu on onClickOutside()', () => {
    component.toggle();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(true);
    component.onClickOutside();
    expect(component.isOpen()).toBe(false);
  });

  it('should not be a no-op for onClickOutside() when already closed', () => {
    expect(component.isOpen()).toBe(false);
    component.onClickOutside();
    expect(component.isOpen()).toBe(false);
  });

  it('should expose the current theme name on the trigger', () => {
    theme.setTheme('sun');
    fixture.detectChanges();
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="theme-trigger"]',
    );
    expect(trigger?.textContent).toContain('SunOS');
  });

  it('should mark the active option as checked when menu is open', () => {
    theme.setTheme('win95');
    component.toggle();
    fixture.detectChanges();
    const active = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="theme-option"][aria-checked="true"]',
    );
    expect(active).toBeTruthy();
    expect(active?.getAttribute('data-theme-id')).toBe('win95');
  });

  it('should have correct ARIA attributes on the trigger and menu', () => {
    const trigger = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="theme-trigger"]',
    );
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    component.toggle();
    fixture.detectChanges();
    const menu = (fixture.nativeElement as HTMLElement).querySelector('[role="menu"]');
    expect(menu).toBeTruthy();
    const options = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="menuitemradio"]',
    );
    expect(options.length).toBe(6);
  });
});
