import {
  ApplicationConfig,
  LOCALE_ID,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { registerLocaleData } from '@angular/common';

import { routes } from './app.routes';

const SUPPORTED_LOCALES = [
  'en-US',
  'en-GB',
  'de-DE',
  'fr-FR',
  'es-ES',
  'ja-JP',
  'zh-CN',
] as const;

function resolveLocale(): string {
  const requested = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  if ((SUPPORTED_LOCALES as readonly string[]).includes(requested)) return requested;
  const primary = requested.split('-')[0];
  const match = SUPPORTED_LOCALES.find((l) => l.startsWith(`${primary}-`));
  return match ?? 'en-US';
}

async function loadLocaleData(locale: string): Promise<void> {
  try {
    /* @vite-ignore */
    const mod = (await import(`@angular/common/locales/${locale}.js`)) as {
      default: Parameters<typeof registerLocaleData>[0];
    };
    registerLocaleData(mod.default);
  } catch {
    // Fallback: leave Angular on its default (en-US) locale data
    // already registered by the framework bootstrap.
  }
}

void loadLocaleData(resolveLocale());

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideAnimations(),
    { provide: LOCALE_ID, useFactory: resolveLocale },
  ],
};
