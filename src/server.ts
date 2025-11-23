import 'dotenv/config';
import { startApp, stopApp } from './app';
import { logger } from './utils/logger';

async function main() {
  try {
    await startApp();
  } catch (error: any) {
    logger.error('Fatal error', { error: error.message });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await stopApp();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await stopApp();
  process.exit(0);
});

main();

