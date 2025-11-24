import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { logger } from '../utils/logger';
import { Order, OrderStatus } from '../models/order';
import { getOrderById, updateOrderStatus } from '../db';
import { sleepWithBackoff } from '../utils/backoff';
import { OrderUpdateMessage } from '../models/order';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
const BACKOFF_BASE_MS = parseInt(process.env.BACKOFF_BASE_MS || '500', 10);
const ORDER_PROCESSOR_RATE = parseInt(process.env.ORDER_PROCESSOR_RATE || '100', 10);

// Rate limiting: 100 orders per minute = ~1.67 orders per second
// Use token bucket: allow 1 order per 600ms
const RATE_LIMIT_MS = 60000 / ORDER_PROCESSOR_RATE;
let lastProcessedTime = 0;

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
});

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

// WebSocket update publisher (using Redis pub/sub)
const publisher = connection.duplicate();

export async function publishOrderUpdate(message: OrderUpdateMessage): Promise<void> {
  await publisher.publish(`order:${message.orderId}`, JSON.stringify(message));
}

// Worker to process orders
export const orderWorker = new Worker<{ orderId: string }>(
  'order-execution',
  async (job: Job<{ orderId: string }>) => {
    const { orderId } = job.data;
    // wait 20s before processing
    // await new Promise((resolve) => setTimeout(resolve, 20000));
    logger.info('Processing order', { orderId, attempt: job.attemptsMade + 1 });

    // Rate limiting
    const now = Date.now();
    const timeSinceLastProcess = now - lastProcessedTime;
    if (timeSinceLastProcess < RATE_LIMIT_MS) {
      await new Promise((resolve) =>
        setTimeout(resolve, RATE_LIMIT_MS - timeSinceLastProcess)
      );
    }
    lastProcessedTime = Date.now();

    try {
      // Get order from DB
      const order = await getOrderById(orderId);
      if (!order) {
        throw new Error(`Order ${orderId} not found`);
      }

      // Update status: pending -> routing
      if (order.status === OrderStatus.PENDING) {
        await updateOrderStatus(orderId, OrderStatus.ROUTING);
        await publishOrderUpdate({
          orderId,
          status: OrderStatus.ROUTING,
          timestamp: new Date().toISOString(),
        });
      }

      // Get quotes and route
      const basePrice = 25.0; // Mock base price
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
      if (!routing) {
        throw new Error('Failed to select DEX');
      }

      // Publish routing decision
      await publishOrderUpdate({
        orderId,
        status: OrderStatus.ROUTING,
        timestamp: new Date().toISOString(),
        details: {
          quotes: {
            raydium: quotes.find((q) => q.dexName === 'Raydium')
              ? {
                  price: quotes.find((q) => q.dexName === 'Raydium')!.price,
                  liquidity: quotes.find((q) => q.dexName === 'Raydium')!.liquidity,
                  fee: quotes.find((q) => q.dexName === 'Raydium')!.fee,
                }
              : undefined,
            meteora: quotes.find((q) => q.dexName === 'Meteora')
              ? {
                  price: quotes.find((q) => q.dexName === 'Meteora')!.price,
                  liquidity: quotes.find((q) => q.dexName === 'Meteora')!.liquidity,
                  fee: quotes.find((q) => q.dexName === 'Meteora')!.fee,
                }
              : undefined,
            chosen: routing.dexName,
          },
        },
      });

      // Update status: routing -> building
      await updateOrderStatus(orderId, OrderStatus.BUILDING, {
        chosenDex: routing.dexName,
        chosenQuote: {
          price: routing.quote.price,
          fee: routing.fee,
          liquidity: routing.quote.liquidity,
        },
      });
      await publishOrderUpdate({
        orderId,
        status: OrderStatus.BUILDING,
        timestamp: new Date().toISOString(),
      });

      // Check limit price condition
      if (order.orderType === 'limit' && order.limitPrice) {
        if (routing.expectedPrice > order.limitPrice) {
          throw new Error(
            `Limit price not met: expected ${routing.expectedPrice} > limit ${order.limitPrice}`
          );
        }
      }

      // Execute swap
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

      // Update status: building -> submitted
      await updateOrderStatus(orderId, OrderStatus.SUBMITTED, {
        txHash: result.txHash,
      });
      await publishOrderUpdate({
        orderId,
        status: OrderStatus.SUBMITTED,
        timestamp: new Date().toISOString(),
        details: {
          txHash: result.txHash,
        },
      });

      // Simulate confirmation delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Update status: submitted -> confirmed
      await updateOrderStatus(orderId, OrderStatus.CONFIRMED, {
        executedPrice: result.executedPrice,
        txHash: result.txHash,
      });
      await publishOrderUpdate({
        orderId,
        status: OrderStatus.CONFIRMED,
        timestamp: new Date().toISOString(),
        details: {
          txHash: result.txHash,
          executedPrice: result.executedPrice,
        },
      });

      logger.info('Order completed successfully', {
        orderId,
        txHash: result.txHash,
        executedPrice: result.executedPrice,
      });

      return {
        success: true,
        txHash: result.txHash,
        executedPrice: result.executedPrice,
      };
    } catch (error: any) {
      const attempts = job.attemptsMade + 1;
      logger.error('Order processing failed', {
        orderId,
        attempt: attempts,
        error: error.message,
      });

      // Get current order to preserve status
      const currentOrder = await getOrderById(orderId);
      const currentStatus = currentOrder?.status || OrderStatus.PENDING;

      // Update order with error
      await updateOrderStatus(orderId, currentStatus, {
        attempts,
        lastError: error.message,
      });

      // If max retries reached, mark as failed
      if (attempts >= MAX_RETRIES) {
        await updateOrderStatus(orderId, OrderStatus.FAILED, {
          attempts,
          lastError: error.message,
        });
        await publishOrderUpdate({
          orderId,
          status: OrderStatus.FAILED,
          timestamp: new Date().toISOString(),
          details: {
            error: error.message,
            attempt: attempts,
          },
        });
      } else {
        // Publish retry update
        const currentOrder = await getOrderById(orderId);
        await publishOrderUpdate({
          orderId,
          status: currentOrder?.status || OrderStatus.PENDING,
          timestamp: new Date().toISOString(),
          details: {
            error: error.message,
            attempt: attempts,
          },
        });
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: parseInt(process.env.BULL_CONCURRENCY || '10', 10),
  }
);

orderWorker.on('completed', (job) => {
  logger.info('Job completed', { jobId: job.id, orderId: job.data.orderId });
});

orderWorker.on('failed', (job, err) => {
  logger.error('Job failed', {
    jobId: job?.id,
    orderId: job?.data.orderId,
    error: err.message,
  });
});

export async function closeQueue(): Promise<void> {
  await orderWorker.close();
  await orderQueue.close();
  await connection.quit();
  await publisher.quit();
}

