import { defineConfig } from 'vitest/config';

/**
 * Vitest base config for Angular's @angular/build:unit-test builder.
 *
 * Picked up by ng test --runner=vitest; runs all *.spec.ts files
 * inside the jsdom environment with globals enabled (so specs can
 * call describe/it/expect without an explicit import).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
  },
});
