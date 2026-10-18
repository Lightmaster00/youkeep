import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { defineVitestProject } from '@nuxt/test-utils/config';

export default defineConfig({
  test: {
    // One temporary root per run, removed at the end (see the file).
    globalSetup: ['tests/setup/globalTmp.ts'],
    projects: [
      {
        // Nuxt's #shared alias, so plain-node tests can load app files that use it.
        resolve: { alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
          // Keeps every server test away from the real database and media folders.
          setupFiles: ['tests/setup/server.ts'],
          // Some files seed tens of thousands of rows in beforeAll (big-library
          // perf guards): seconds when several suites share the CPU.
          hookTimeout: 60_000,
        }
      },
      await defineVitestProject({
        test: {
          name: 'component',
          environment: 'nuxt',
          include: ['tests/component/**/*.test.ts'],
          setupFiles: ['tests/setup/component.ts']
        }
      })
    ]
  }
});
