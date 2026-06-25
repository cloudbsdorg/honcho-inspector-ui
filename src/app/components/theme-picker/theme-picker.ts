import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ThemeService } from '../../core/theme.service';
import { ThemeId } from '../../core/models';

@Component({
  selector: 'app-theme-picker',
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './theme-picker.html',
  styleUrl: './theme-picker.css',
})
export class ThemePicker {
  private readonly themeService = inject(ThemeService);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly themes = this.themeService.availableThemes;
  readonly activeId = computed<ThemeId>(() => this.themeService.theme());
  readonly activeMeta = computed(() => this.themes().find((t) => t.id === this.activeId()));
  readonly isOpen = signal(false);

  toggle(): void {
    this.isOpen.update((v) => !v);
  }

  select(id: ThemeId): void {
    this.themeService.setTheme(id);
    this.isOpen.set(false);
  }

  onEscape(): void {
    this.isOpen.set(false);
  }

  onClickOutside(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.host.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onDocEscape(): void {
    if (this.isOpen()) this.isOpen.set(false);
  }
}
