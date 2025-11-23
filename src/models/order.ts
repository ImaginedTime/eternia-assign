import { z } from 'zod';

export const OrderStatus = {
  PENDING: 'pending',
  ROUTING: 'routing',
  BUILDING: 'building',
  SUBMITTED: 'submitted',
  CONFIRMED: 'confirmed',
  FAILED: 'failed',
} as const;

export type OrderStatus = typeof OrderStatus[keyof typeof OrderStatus];

export const OrderType = {
  LIMIT: 'limit',
  MARKET: 'market',
  SNIPER: 'sniper',
} as const;

export type OrderType = typeof OrderType[keyof typeof OrderType];

export const CreateOrderSchema = z.object({
  userId: z.string().min(1),
  orderType: z.literal('limit'),
  tokenIn: z.string().min(1),
  tokenOut: z.string().min(1),
  amount: z.number().positive(),
  limitPrice: z.number().positive(),
  slippageTolerance: z.number().min(0).max(1).optional().default(0.01),
});

export type CreateOrderRequest = z.infer<typeof CreateOrderSchema>;

export interface Order {
  id: string;
  userId: string;
  orderType: OrderType;
  tokenIn: string;
  tokenOut: string;
  amount: number;
  limitPrice: number | null;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  attempts: number;
  lastError: string | null;
  executedPrice: number | null;
  txHash: string | null;
  chosenDex: string | null;
  chosenQuote: any | null;
  slippageTolerance: number;
}

export interface OrderUpdateMessage {
  orderId: string;
  status: OrderStatus;
  timestamp: string;
  details?: {
    quotes?: {
      raydium?: { price: number; liquidity: number; fee: number };
      meteora?: { price: number; liquidity: number; fee: number };
      chosen?: string;
    };
    txHash?: string;
    executedPrice?: number;
    error?: string;
    attempt?: number;
  };
}

