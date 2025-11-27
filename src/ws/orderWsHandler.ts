import WebSocket from 'ws';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { OrderUpdateMessage } from '../models/order';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

/**
 * Handle WebSocket connection for order updates
 */
export async function handleOrderWebSocket(
  socket: WebSocket,
  orderId: string
): Promise<void> {

  logger.info('WebSocket connection opened', { orderId });

  // Subscribe to Redis pub/sub for this order
  const subscriber = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: { rejectUnauthorized: false }
  });

  await subscriber.subscribe(`order:${orderId}`);

  subscriber.on('message', (channel, message) => {
    try {
      const update: OrderUpdateMessage = JSON.parse(message);
      socket.send(JSON.stringify(update));
      logger.debug('Sent WebSocket update', { orderId, status: update.status });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to parse WebSocket message', {
        orderId,
        error: errorMessage,
      });
    }
  });

  socket.on('close', () => {
    logger.info('WebSocket connection closed', { orderId });
    subscriber.unsubscribe(`order:${orderId}`);
    subscriber.quit();
  });

  socket.on('error', (error: Error) => {
    logger.error('WebSocket error', { orderId, error: error.message });
    subscriber.unsubscribe(`order:${orderId}`);
    subscriber.quit();
  });

  // Send initial connection message
  socket.send(
    JSON.stringify({
      orderId,
      status: 'connected',
      timestamp: new Date().toISOString(),
      message: 'WebSocket connected. Listening for order updates.',
    })
  );
}

