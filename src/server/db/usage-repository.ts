export class UsageRepository {
  constructor(private readonly database: D1Database) {}

  async consume(
    bucket: string,
    clientKey: string,
    limit: number,
    expiresAt: string,
  ): Promise<{ allowed: boolean; count: number }> {
    const consumed = await this.database
      .prepare(
        `INSERT INTO usage_limits (bucket, client_key, count, expires_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT (bucket, client_key) DO UPDATE SET
           count = usage_limits.count + 1,
           expires_at = excluded.expires_at
         WHERE usage_limits.count < ?
         RETURNING count`,
      )
      .bind(bucket, clientKey, expiresAt, limit)
      .first<{ count: number }>()

    if (consumed) {
      return { allowed: true, count: consumed.count }
    }

    const count = await this.database
      .prepare('SELECT count FROM usage_limits WHERE bucket = ? AND client_key = ?')
      .bind(bucket, clientKey)
      .first<number>('count')

    return { allowed: false, count: count ?? limit }
  }

  async deleteExpired(now: string, limit: number): Promise<number> {
    const result = await this.database
      .prepare(
        `DELETE FROM usage_limits WHERE (bucket, client_key) IN (
          SELECT bucket, client_key FROM usage_limits
          WHERE expires_at < ? ORDER BY expires_at LIMIT ?
        )`,
      )
      .bind(now, limit)
      .run()

    return result.meta.changes
  }
}

