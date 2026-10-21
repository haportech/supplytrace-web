import path from 'node:path'

import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: './src/worker.ts',
      miniflare: {
        compatibilityDate: '2026-08-06',
        d1Databases: ['DB'],
        bindings: {
          APP_VERSION: 'test',
          GITHUB_TOKEN: 'local-test-token',
          TEST_MIGRATIONS: await readD1Migrations(
            path.resolve(process.cwd(), 'migrations'),
          ),
        },
      },
    })),
  ],
  test: {
    include: ['test/worker/**/*.test.ts'],
    setupFiles: ['./test/worker/setup.ts'],
  },
})
