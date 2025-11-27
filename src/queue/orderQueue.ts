import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { Order, OrderStatus } from '../models/order';
import { getOrderById, updateOrderStatus } from '../db';
import { OrderUpdateMessage } from '../models/order';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const BACKOFF_BASE_MS = parseInt(process.env.BACKOFF_BASE_MS || '500', 10);
const ORDER_PROCESSOR_RATE = parseInt(process.env.ORDER_PROCESSOR_RATE || '100', 10);

// For rate limiting
const RATE_LIMIT_MS = 60000 / ORDER_PROCESSOR_RATE;
let lastProcessedTime = 0;

// 🔐 secure redis connection (TLS required for Aiven)
function redisTLS() {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: {
      rejectUnauthorized: false,
    },
  });
}

// Main connection (used by queue)
const connection = redisTLS();

// Queue
export const orderQueue = new Queue<{ orderId: string }>('order-execution', {
  connection,
  defaultJobOptions: {
    attempts: MAX_RETRIES,
    backoff: {
      type: 'exponential',
      delay: BACKOFF_BASE_MS,
    },
  },
});

// Publisher for WebSocket messages
const publisher = redisTLS();

// Worker — THIS IS WHERE THE BUG WAS
export const orderWorker = new Worker<{ orderId: string }>(
  'order-execution',
  async (job: Job<{ orderId: string }>) => {
    const { orderId } = job.data;

    logger.info('Processing order', { orderId, attempt: job.attemptsMade + 1 });

    // Rate limiting
    const now = Date.now();
    const delta = now - lastProcessedTime;
    if (delta < RATE_LIMIT_MS) {
      await new Promise((res) => setTimeout(res, RATE_LIMIT_MS - delta));
    }
    lastProcessedTime = Date.now();

    try {
      const order = await getOrderById(orderId);
      if (!order) throw new Error(`Order ${orderId} not found`);

      if (order.status === OrderStatus.PENDING) {
        await updateOrderStatus(orderId, OrderStatus.ROUTING);
        await publishOrderUpdate({
          orderId,
          status: OrderStatus.ROUTING,
          timestamp: new Date().toISOString(),
        });
      }

      const basePrice = 25.0;
      const { getQuotes, selectBestDex } = await import('../services/dexRouter');
      const quotes = await getQuotes(
        order.tokenIn,
        order.tokenOut,
        order.amount,
        basePrice
      );

      if (quotes.length === 0) {
        throw new Error('No quotes available from any DEX');
      }

      const routing = selectBestDex(quotes);
      if (!routing) throw new Error('Failed to select DEX');

      await updateOrderStatus(orderId, OrderStatus.BUILDING, {
        chosenDex: routing.dexName,
        chosenQuote: routing.quote,
      });

      await publishOrderUpdate({
        orderId,
        status: OrderStatus.BUILDING,
        timestamp: new Date().toISOString(),
      });

      const USE_REAL_DEVNET = process.env.USE_REAL_DEVNET === 'true';
      const { executeSwap } = await import('../services/mockDex');
      const { executeSwapReal } = await import('../services/solanaDex');

      const result = USE_REAL_DEVNET
        ? await executeSwapReal(routing.dexName, {
            tokenIn: order.tokenIn,
            tokenOut: order.tokenOut,
            amount: order.amount,
            limitPrice: order.limitPrice || routing.expectedPrice,
          })
        : await executeSwap(routing.dexName, {
            tokenIn: order.tokenIn,
            tokenOut: order.tokenOut,
            amount: order.amount,
            limitPrice: order.limitPrice || routing.expectedPrice,
          });

      await updateOrderStatus(orderId, OrderStatus.SUBMITTED, {
        txHash: result.txHash,
      });

      await publishOrderUpdate({
        orderId,
        status: OrderStatus.SUBMITTED,
        timestamp: new Date().toISOString(),
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
        executedPrice: result.executedPrice,
        txHash: result.txHash,
      });

      await publishOrderUpdate({
        orderId,
        status: OrderStatus.CONFIRMED,
        timestamp: new Date().toISOString(),
      });

      logger.info('Order completed successfully', {
        orderId,
        txHash: result.txHash,
      });

      return { success: true };
    } catch (error: any) {
      const attempts = job.attemptsMade + 1;

      logger.error('Order processing failed', {
        orderId,
        attempt: attempts,
        error: error.message,
      });

      const existing = await getOrderById(orderId);
      const status = existing?.status || OrderStatus.PENDING;

      await updateOrderStatus(orderId, status, {
        attempts,
        lastError: error.message,
      });

      if (attempts >= MAX_RETRIES) {
        await updateOrderStatus(orderId, OrderStatus.FAILED, {
          attempts,
          lastError: error.message,
        });

        await publishOrderUpdate({
          orderId,
          status: OrderStatus.FAILED,
          timestamp: new Date().toISOString(),
        });
      }

      throw error;
    }
  },
  {
    // FIX: Worker MUST use TLS Redis client
    connection: redisTLS(),
    concurrency: parseInt(process.env.BULL_CONCURRENCY || '10', 10),
  }
);

// Events — must ALSO use TLS redis
export const orderEvents = new QueueEvents('order-execution', {
  connection: redisTLS(),
});

export async function publishOrderUpdate(message: OrderUpdateMessage) {
  await publisher.publish(`order:${message.orderId}`, JSON.stringify(message));
}

export async function closeQueue(): Promise<void> {
  await orderWorker.close();
  await orderQueue.close();
  await publisher.quit();
}
