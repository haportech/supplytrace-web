declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    DB: D1Database
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers').D1Migration[]
  }
}

