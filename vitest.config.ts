import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { defineVitestProject } from '@nuxt/test-utils/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Nuxt's #shared alias, so plain-node tests can load app files that use it.
        resolve: { alias: { '#shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts']
        }
      },
      await defineVitestProject({
        test: {
          name: 'component',
          environment: 'nuxt',
          include: ['tests/component/**/*.test.ts']
        }
      })
    ]
  }
});
