import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { getPool, createOrder, getOrderById, updateOrderStatus } from '../../db';
import { orderQueue, closeQueue } from '../../queue/orderQueue';
import { OrderStatus } from '../../models/order';

describe('Order Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    // Ensure DB is ready
    await getPool().query('SELECT 1');
  });

  afterAll(async () => {
    await closeQueue();
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data
    await getPool().query('DELETE FROM orders WHERE user_id LIKE $1', ['test-%']);
  });

  it('should create order in database', async () => {
    const order = await createOrder({
      userId: 'test-user-1',
      orderType: 'limit',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.5,
      slippageTolerance: 0.01,
    });

    expect(order.id).toBeDefined();
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.userId).toBe('test-user-1');
  });

  it('should update order status', async () => {
    const order = await createOrder({
      userId: 'test-user-2',
      orderType: 'limit',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.5,
      slippageTolerance: 0.01,
    });

    const updated = await updateOrderStatus(order.id, OrderStatus.ROUTING);

    expect(updated.status).toBe(OrderStatus.ROUTING);
    expect(updated.id).toBe(order.id);
  });

  it('should retrieve order by ID', async () => {
    const order = await createOrder({
      userId: 'test-user-3',
      orderType: 'limit',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.5,
      slippageTolerance: 0.01,
    });

    const retrieved = await getOrderById(order.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved?.id).toBe(order.id);
    expect(retrieved?.userId).toBe('test-user-3');
  });

  it('should add order to queue', async () => {
    const order = await createOrder({
      userId: 'test-user-4',
      orderType: 'limit',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.5,
      slippageTolerance: 0.01,
    });

    const job = await orderQueue.add('execute-order', { orderId: order.id });

    expect(job.id).toBeDefined();
    expect(job.data.orderId).toBe(order.id);
  });
});

