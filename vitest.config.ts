import { defineConfig } from 'vitest/config';
import { defineVitestProject } from '@nuxt/test-utils/config';

export default defineConfig({
  test: {
    projects: [
      {
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
