import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';
import { Order, OrderStatus } from '../models/order';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }

    pool = new Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      // 👇 ADD THIS SSL CONFIGURATION 👇
      ssl: {
        rejectUnauthorized: false, 
      },
    });

    pool.on('error', (err) => {
      logger.error('Unexpected error on idle client', { error: err.message });
    });
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface OrderRow {
  id: string;
  user_id: string;
  order_type: string;
  token_in: string;
  token_out: string;
  amount: string;
  limit_price: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  attempts: number;
  last_error: string | null;
  executed_price: string | null;
  tx_hash: string | null;
  chosen_dex: string | null;
  chosen_quote: any | null;
  slippage_tolerance: string;
}

function rowToOrder(row: OrderRow): Order {
  return {
    id: row.id,
    userId: row.user_id,
    orderType: row.order_type as any,
    tokenIn: row.token_in,
    tokenOut: row.token_out,
    amount: parseFloat(row.amount),
    limitPrice: row.limit_price ? parseFloat(row.limit_price) : null,
    status: row.status as OrderStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attempts: row.attempts,
    lastError: row.last_error,
    executedPrice: row.executed_price ? parseFloat(row.executed_price) : null,
    txHash: row.tx_hash,
    chosenDex: row.chosen_dex,
    chosenQuote: row.chosen_quote,
    slippageTolerance: parseFloat(row.slippage_tolerance),
  };
}

export async function createOrder(
  order: Omit<Order, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'attempts' | 'lastError' | 'executedPrice' | 'txHash' | 'chosenDex' | 'chosenQuote'>
): Promise<Order> {
  const client = await getPool().connect();
  try {
    const result = await client.query<OrderRow>(
      `INSERT INTO orders (
        user_id, order_type, token_in, token_out, amount, limit_price,
        status, slippage_tolerance
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        order.userId,
        order.orderType,
        order.tokenIn,
        order.tokenOut,
        order.amount.toString(),
        order.limitPrice?.toString() || null,
        'pending',
        order.slippageTolerance.toString(),
      ]
    );
    return rowToOrder(result.rows[0]);
  } finally {
    client.release();
  }
}

export async function getOrderById(orderId: string): Promise<Order | null> {
  const client = await getPool().connect();
  try {
    const result = await client.query<OrderRow>(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    return result.rows.length > 0 ? rowToOrder(result.rows[0]) : null;
  } finally {
    client.release();
  }
}

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  updates?: {
    attempts?: number;
    lastError?: string | null;
    executedPrice?: number | null;
    txHash?: string | null;
    chosenDex?: string | null;
    chosenQuote?: any | null;
  }
): Promise<Order> {
  const client = await getPool().connect();
  try {
    const updateFields: string[] = ['status = $2', 'updated_at = now()'];
    const values: any[] = [orderId, status];
    let paramIndex = 3;

    if (updates?.attempts !== undefined) {
      updateFields.push(`attempts = $${paramIndex}`);
      values.push(updates.attempts);
      paramIndex++;
    }

    if (updates?.lastError !== undefined) {
      updateFields.push(`last_error = $${paramIndex}`);
      values.push(updates.lastError);
      paramIndex++;
    }

    if (updates?.executedPrice !== undefined) {
      updateFields.push(`executed_price = $${paramIndex}`);
      values.push(updates.executedPrice?.toString() || null);
      paramIndex++;
    }

    if (updates?.txHash !== undefined) {
      updateFields.push(`tx_hash = $${paramIndex}`);
      values.push(updates.txHash);
      paramIndex++;
    }

    if (updates?.chosenDex !== undefined) {
      updateFields.push(`chosen_dex = $${paramIndex}`);
      values.push(updates.chosenDex);
      paramIndex++;
    }

    if (updates?.chosenQuote !== undefined) {
      updateFields.push(`chosen_quote = $${paramIndex}`);
      values.push(JSON.stringify(updates.chosenQuote));
      paramIndex++;
    }

    const query = `UPDATE orders SET ${updateFields.join(', ')} WHERE id = $1 RETURNING *`;
    const result = await client.query<OrderRow>(query, values);
    return rowToOrder(result.rows[0]);
  } finally {
    client.release();
  }
}

