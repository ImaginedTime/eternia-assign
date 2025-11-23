import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeOrder } from '../services/orderService';
import { Order, OrderType, OrderStatus } from '../models/order';
import * as dexRouter from '../services/dexRouter';
import * as mockDex from '../services/mockDex';

vi.mock('../services/dexRouter');
vi.mock('../services/mockDex');
vi.mock('../db', () => ({
  updateOrderStatus: vi.fn(),
}));

describe('Order Service', () => {
  const mockOrder: Order = {
    id: 'test-order-id',
    userId: 'user-123',
    orderType: OrderType.LIMIT,
    tokenIn: 'SOL',
    tokenOut: 'USDC',
    amount: 1.0,
    limitPrice: 25.5,
    status: OrderStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    attempts: 0,
    lastError: null,
    executedPrice: null,
    txHash: null,
    chosenDex: null,
    chosenQuote: null,
    slippageTolerance: 0.01,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should execute order successfully', async () => {
    const mockQuotes = [
      {
        dexName: 'Raydium',
        price: 25.0,
        fee: 0.003,
        liquidity: 100000,
        netPrice: 24.925,
      },
    ];

    const mockRouting = {
      dexName: 'Raydium',
      expectedPrice: 24.925,
      fee: 0.003,
      quote: {
        price: 25.0,
        fee: 0.003,
        liquidity: 100000,
      },
    };

    const mockSwapResult = {
      txHash: 'mock-tx-hash',
      executedPrice: 24.9,
    };

    vi.mocked(dexRouter.getQuotes).mockResolvedValue(mockQuotes);
    vi.mocked(dexRouter.selectBestDex).mockReturnValue(mockRouting);
    vi.mocked(mockDex.executeSwap).mockResolvedValue(mockSwapResult);

    const result = await executeOrder(mockOrder);

    expect(result.routing.dexName).toBe('Raydium');
    expect(result.result.txHash).toBe('mock-tx-hash');
    expect(result.result.executedPrice).toBe(24.9);
  });

  it('should reject order if limit price not met', async () => {
    const mockQuotes = [
      {
        dexName: 'Raydium',
        price: 26.0,
        fee: 0.003,
        liquidity: 100000,
        netPrice: 25.922,
      },
    ];

    const mockRouting = {
      dexName: 'Raydium',
      expectedPrice: 25.922,
      fee: 0.003,
      quote: {
        price: 26.0,
        fee: 0.003,
        liquidity: 100000,
      },
    };

    vi.mocked(dexRouter.getQuotes).mockResolvedValue(mockQuotes);
    vi.mocked(dexRouter.selectBestDex).mockReturnValue(mockRouting);

    await expect(executeOrder(mockOrder)).rejects.toThrow('Limit price not met');
  });
});

