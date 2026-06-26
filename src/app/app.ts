import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppHeader } from './components/app-header/app-header';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AppHeader],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-header />
    <main class="min-h-0 flex-1 overflow-y-auto">
      <router-outlet />
    </main>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
      }
    `,
  ],
})
export class App {}
