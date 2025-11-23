import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool, closePool } from './index';
import { logger } from '../utils/logger';

async function runMigrations() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const sql = readFileSync(join(__dirname, '../../infra/init.sql'), 'utf-8');
    await client.query(sql);
    logger.info('Database migrations completed successfully');
  } catch (error: any) {
    logger.error('Migration failed', { error: error.message });
    throw error;
  } finally {
    client.release();
    await closePool();
  }
}

runMigrations().catch((error) => {
  console.error(error);
  process.exit(1);
});

