import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) throw new Error('DATABASE_URL not set');

export const sql = neon(url);

let initialized = false;
export async function ensureSchema() {
  if (initialized) return;
  await sql`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL CHECK (source IN ('A','B')),
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      carrier TEXT,
      model TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_apps_created ON applications (created_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_apps_source ON applications (source)`;
  initialized = true;
}
