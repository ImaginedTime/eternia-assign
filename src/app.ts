import fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import { logger } from './utils/logger';
import { getPool, closePool } from './db';
import { orderQueue, closeQueue } from './queue/orderQueue';
import { executeOrderRoute, getOrderRoute, orderWebSocketHandler } from './routes/orders';

export async function buildApp() {
  const app = fastify({
    logger: false, // We use our own logger
  });

  // Register WebSocket plugin
  await app.register(fastifyWebsocket);

  // Health check
  app.get('/health', async (request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Metrics endpoint (basic)
  app.get('/metrics', async (request, reply) => {
    const waiting = await orderQueue.getWaitingCount();
    const active = await orderQueue.getActiveCount();
    const completed = await orderQueue.getCompletedCount();
    const failed = await orderQueue.getFailedCount();

    return reply.send({
      queue: {
        waiting,
        active,
        completed,
        failed,
      },
    });
  });

  // API routes
  app.post('/api/orders/execute', executeOrderRoute);
  app.get('/api/orders/:id', getOrderRoute);

  // WebSocket endpoint
  app.register(async function (fastify) {
    fastify.get('/ws', { websocket: true }, orderWebSocketHandler);
  });

  return app;
}

export async function startApp() {
  const app = await buildApp();
  const port = parseInt(process.env.PORT || '3000', 10);

  try {
    // Test database connection
    await getPool().query('SELECT 1');
    logger.info('Database connection established');

    // Test Redis connection (orderQueue uses IORedis internally)
    logger.info('Redis connection will be established when queue is used');

    await app.listen({ port, host: '0.0.0.0' });
    logger.info(`Server listening on port ${port}`);
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    throw error;
  }

  return app;
}

export async function stopApp() {
  await closePool();
  await closeQueue();
  logger.info('Application stopped');
}

