import { sleep } from '../utils/sleep';
import { logger } from '../utils/logger';

export interface Quote {
  price: number;
  fee: number;
  liquidity: number;
}

export interface SwapResult {
  txHash: string;
  executedPrice: number;
}

/**
 * Get a mock quote from Raydium
 * Simulates 200-400ms delay and returns price with variance
 */
export async function getRaydiumQuote(
  basePrice: number,
  amount: number
): Promise<Quote> {
  const delay = 200 + Math.random() * 200;
  await sleep(delay);

  const price = basePrice * (0.98 + Math.random() * 0.04);
  const fee = 0.003;
  const liquidity = 100000;

  logger.debug('Raydium quote', { price, fee, liquidity, amount, delay });

  return { price, fee, liquidity };
}

/**
 * Get a mock quote from Meteora
 * Simulates 200-400ms delay and returns price with variance
 */
export async function getMeteoraQuote(
  basePrice: number,
  amount: number
): Promise<Quote> {
  const delay = 200 + Math.random() * 200;
  await sleep(delay);

  const price = basePrice * (0.97 + Math.random() * 0.05);
  const fee = 0.002;
  const liquidity = 80000;

  logger.debug('Meteora quote', { price, fee, liquidity, amount, delay });

  return { price, fee, liquidity };
}

/**
 * Execute a mock swap
 * Simulates 2000-3000ms delay and returns transaction hash
 */
export async function executeSwap(
  dex: string,
  order: {
    tokenIn: string;
    tokenOut: string;
    amount: number;
    limitPrice: number;
  }
): Promise<SwapResult> {
  const delay = 2000 + Math.random() * 1000;
  await sleep(delay);

  const txHash = `mock-${dex}-${Math.random().toString(36).slice(2, 12)}`;
  const executedPrice = order.limitPrice * (0.995 + Math.random() * 0.01);

  logger.debug('Mock swap executed', { dex, txHash, executedPrice, delay });

  return { txHash, executedPrice };
}

