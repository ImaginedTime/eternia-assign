import { describe, it, expect, vi } from 'vitest';
import { getRaydiumQuote, getMeteoraQuote, executeSwap } from '../services/mockDex';

describe('Mock DEX services', () => {
  it('getRaydiumQuote should return price in expected range', async () => {
    const basePrice = 25.0;
    const amount = 1.0;
    const quote = await getRaydiumQuote(basePrice, amount);

    expect(quote.price).toBeGreaterThan(basePrice * 0.98);
    expect(quote.price).toBeLessThan(basePrice * 1.02);
    expect(quote.fee).toBe(0.003);
    expect(quote.liquidity).toBe(100000);
  });

  it('getMeteoraQuote should return price in expected range', async () => {
    const basePrice = 25.0;
    const amount = 1.0;
    const quote = await getMeteoraQuote(basePrice, amount);

    expect(quote.price).toBeGreaterThan(basePrice * 0.97);
    expect(quote.price).toBeLessThan(basePrice * 1.02);
    expect(quote.fee).toBe(0.002);
    expect(quote.liquidity).toBe(80000);
  });

  it('executeSwap should return txHash and executedPrice', async () => {
    const order = {
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.5,
    };

    const result = await executeSwap('Raydium', order);

    expect(result.txHash).toMatch(/^mock-Raydium-/);
    expect(result.executedPrice).toBeGreaterThan(order.limitPrice * 0.995);
    expect(result.executedPrice).toBeLessThan(order.limitPrice * 1.005);
  });
});

