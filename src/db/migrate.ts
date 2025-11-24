import { readFileSync } from 'fs';
import { join } from 'path';
import { getPool } from './index';
import { logger } from '../utils/logger';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runMigrations(): Promise<void> {
  const maxRetries = 10;
  const retryDelay = 2000; // 2 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const pool = getPool();
      const client = await pool.connect();

      try {
        // Check if table already exists (idempotent migration)
        const tableCheck = await client.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'orders'
          );
        `);

        if (tableCheck.rows[0].exists) {
          logger.info('Orders table already exists, skipping migration');
          client.release();
          return;
        }

        // Run migration
        const sql = readFileSync(join(__dirname, '../../infra/init.sql'), 'utf-8');
        await client.query(sql);
        logger.info('Database migrations completed successfully');
        client.release();
        return;
      } catch (error: any) {
        client.release();
        throw error;
      }
    } catch (error: any) {
      if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        if (attempt < maxRetries) {
          logger.warn(
            `Database connection failed (attempt ${attempt}/${maxRetries}), retrying in ${retryDelay}ms...`,
            { error: error.message }
          );
          await sleep(retryDelay);
          continue;
        }
      }
      logger.error('Migration failed', { error: error.message, attempt });
      throw error;
    }
  }
}

// Only run migrations if this file is executed directly (for manual migration)
if (require.main === module) {
  runMigrations()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration error:', error);
      process.exit(1);
    });
}

