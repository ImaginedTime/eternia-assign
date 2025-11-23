import { logger } from '../utils/logger';
import {
  getRaydiumQuote,
  getMeteoraQuote,
  Quote,
} from './mockDex';
import {
  getRaydiumQuoteReal,
  getMeteoraQuoteReal,
} from './solanaDex';

export interface DexQuote extends Quote {
  dexName: string;
  netPrice: number; // price after fees
}

export interface RoutingDecision {
  dexName: string;
  expectedPrice: number;
  fee: number;
  quote: Quote;
}

const USE_REAL_DEVNET = process.env.USE_REAL_DEVNET === 'true';

/**
 * Get quotes from both DEXs concurrently
 */
export async function getQuotes(
  tokenIn: string,
  tokenOut: string,
  amount: number,
  basePrice: number
): Promise<DexQuote[]> {
  const quotes: DexQuote[] = [];

  // Fetch quotes concurrently
  const [raydiumQuote, meteoraQuote] = await Promise.allSettled([
    USE_REAL_DEVNET
      ? getRaydiumQuoteReal(basePrice, amount)
      : getRaydiumQuote(basePrice, amount),
    USE_REAL_DEVNET
      ? getMeteoraQuoteReal(basePrice, amount)
      : getMeteoraQuote(basePrice, amount),
  ]);

  if (raydiumQuote.status === 'fulfilled') {
    quotes.push({
      ...raydiumQuote.value,
      dexName: 'Raydium',
      netPrice: raydiumQuote.value.price * (1 - raydiumQuote.value.fee),
    });
  } else {
    logger.error('Failed to get Raydium quote', {
      error: raydiumQuote.reason?.message,
    });
  }

  if (meteoraQuote.status === 'fulfilled') {
    quotes.push({
      ...meteoraQuote.value,
      dexName: 'Meteora',
      netPrice: meteoraQuote.value.price * (1 - meteoraQuote.value.fee),
    });
  } else {
    logger.error('Failed to get Meteora quote', {
      error: meteoraQuote.reason?.message,
    });
  }

  // Sort by best net price (highest)
  quotes.sort((a, b) => b.netPrice - a.netPrice);

  return quotes;
}

/**
 * Select the best DEX based on net price after fees
 */
export function selectBestDex(quotes: DexQuote[]): RoutingDecision | null {
  if (quotes.length === 0) {
    return null;
  }

  const best = quotes[0];
  logger.info('DEX routing decision', {
    chosen: best.dexName,
    netPrice: best.netPrice,
    price: best.price,
    fee: best.fee,
    allQuotes: quotes.map((q) => ({
      dex: q.dexName,
      netPrice: q.netPrice,
      price: q.price,
      fee: q.fee,
    })),
  });

  return {
    dexName: best.dexName,
    expectedPrice: best.netPrice,
    fee: best.fee,
    quote: {
      price: best.price,
      fee: best.fee,
      liquidity: best.liquidity,
    },
  };
}

