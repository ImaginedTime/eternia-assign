import { logger } from '../utils/logger';
import { Order } from '../models/order';
import { getQuotes, selectBestDex, RoutingDecision } from './dexRouter';
import { executeSwap, SwapResult } from './mockDex';
import { executeSwapReal } from './solanaDex';
import { updateOrderStatus } from '../db';

const USE_REAL_DEVNET = process.env.USE_REAL_DEVNET === 'true';

/**
 * Calculate base price for a token pair
 * In a real implementation, this would fetch from an oracle or price feed
 */
function getBasePrice(tokenIn: string, tokenOut: string): number {
  // Mock base prices - in production, fetch from price oracle
  const prices: Record<string, Record<string, number>> = {
    SOL: { USDC: 25.0, USDT: 25.0 },
    USDC: { SOL: 0.04 },
    USDT: { SOL: 0.04 },
  };

  return prices[tokenIn]?.[tokenOut] || 1.0;
}

/**
 * Check if limit order price condition is met
 */
function isLimitPriceMet(
  limitPrice: number,
  bestPrice: number,
  tokenIn: string,
  tokenOut: string
): boolean {
  // For buying tokenOut with tokenIn, we want the price to be <= limitPrice
  // Price = amount of tokenOut per tokenIn
  return bestPrice <= limitPrice;
}

/**
 * Build transaction (mock implementation)
 * In real implementation, this would construct Solana transaction with wrap/unwrap instructions
 */
async function buildTx(
  order: Order,
  routing: RoutingDecision
): Promise<void> {
  logger.info('Building transaction', {
    orderId: order.id,
    dex: routing.dexName,
    tokenIn: order.tokenIn,
    tokenOut: order.tokenOut,
    amount: order.amount,
  });

  // In real implementation:
  // 1. If tokenIn is SOL, create wrap instruction
  // 2. Create swap instruction using DEX SDK
  // 3. If tokenOut is SOL, create unwrap instruction
  // 4. Add slippage protection
  // 5. Sign transaction

  // Mock: just log
  if (order.tokenIn === 'SOL') {
    logger.debug('Would wrap SOL', { orderId: order.id });
  }
  if (order.tokenOut === 'SOL') {
    logger.debug('Would unwrap SOL', { orderId: order.id });
  }

  // Apply slippage tolerance
  const minOut = order.amount * routing.expectedPrice * (1 - order.slippageTolerance);
  logger.debug('Slippage protection', {
    orderId: order.id,
    minOut,
    slippageTolerance: order.slippageTolerance,
  });
}

/**
 * Execute order: route, build, and execute swap
 */
export async function executeOrder(order: Order): Promise<{
  routing: RoutingDecision;
  result: SwapResult;
}> {
  logger.info('Executing order', {
    orderId: order.id,
    userId: order.userId,
    tokenIn: order.tokenIn,
    tokenOut: order.tokenOut,
    amount: order.amount,
    limitPrice: order.limitPrice,
  });

  // Step 1: Get quotes and route
  const basePrice = getBasePrice(order.tokenIn, order.tokenOut);
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

  // Step 2: Check limit price condition
  if (order.orderType === 'limit' && order.limitPrice) {
    if (!isLimitPriceMet(order.limitPrice, routing.expectedPrice, order.tokenIn, order.tokenOut)) {
      throw new Error(
        `Limit price not met: expected ${routing.expectedPrice} <= limit ${order.limitPrice}`
      );
    }
  }

  // Step 3: Build transaction
  await buildTx(order, routing);

  // Step 4: Execute swap
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

  return { routing, result };
}

