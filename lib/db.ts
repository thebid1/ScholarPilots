interface PoolClient {
  query: <T>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;
}

let pool: PoolClient | null = null;

async function getPool(): Promise<PoolClient | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  if (pool) return pool;

  try {
    const pg = await import('pg');
    const Pool = pg.Pool;
    const useSsl =
      process.env.DB_SSL === 'true' ||
      process.env.PGSSLMODE === 'require' ||
      process.env.NODE_ENV === 'production' ||
      (connectionString.includes('render.com') && process.env.PGSSLMODE !== 'disable');

    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
    }) as PoolClient;
    return pool;
  } catch (error) {
    console.warn('Postgres client is unavailable:', error);
    return null;
  }
}

export async function queryDb<T>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {

  const client = await getPool();
  if (!client) {
    throw new Error('Database is not configured or pg package is unavailable.');
  }
  return client.query<T>(text, params);
}

