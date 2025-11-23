import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getQuotes, selectBestDex } from '../services/dexRouter';
import * as mockDex from '../services/mockDex';

vi.mock('../services/mockDex');

describe('DEX Router', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should choose DEX with lower net price (better for buyer)', async () => {
    const mockRaydiumQuote = {
      price: 25.0,
      fee: 0.003,
      liquidity: 100000,
    };
    const mockMeteoraQuote = {
      price: 25.5,
      fee: 0.002,
      liquidity: 80000,
    };

    vi.mocked(mockDex.getRaydiumQuote).mockResolvedValue(mockRaydiumQuote);
    vi.mocked(mockDex.getMeteoraQuote).mockResolvedValue(mockMeteoraQuote);

    const quotes = await getQuotes('SOL', 'USDC', 1.0, 25.0);

    expect(quotes).toHaveLength(2);
    expect(quotes[0].dexName).toBe('Raydium'); // Better net price: 25.0 * 0.997 = 24.925
    expect(quotes[1].dexName).toBe('Meteora'); // Net price: 25.5 * 0.998 = 25.449
  });

  it('selectBestDex should return DEX with highest net price', () => {
    const quotes = [
      {
        dexName: 'Meteora',
        price: 25.5,
        fee: 0.002,
        liquidity: 80000,
        netPrice: 25.449,
      },
      {
        dexName: 'Raydium',
        price: 25.0,
        fee: 0.003,
        liquidity: 100000,
        netPrice: 24.925,
      },
    ];

    const decision = selectBestDex(quotes);

    expect(decision).not.toBeNull();
    expect(decision?.dexName).toBe('Meteora');
    expect(decision?.expectedPrice).toBe(25.449);
  });

  it('selectBestDex should return null for empty quotes', () => {
    const decision = selectBestDex([]);
    expect(decision).toBeNull();
  });

  it('should handle DEX quote failures gracefully', async () => {
    vi.mocked(mockDex.getRaydiumQuote).mockRejectedValue(new Error('DEX error'));
    vi.mocked(mockDex.getMeteoraQuote).mockResolvedValue({
      price: 25.5,
      fee: 0.002,
      liquidity: 80000,
    });

    const quotes = await getQuotes('SOL', 'USDC', 1.0, 25.0);

    expect(quotes).toHaveLength(1);
    expect(quotes[0].dexName).toBe('Meteora');
  });
});

