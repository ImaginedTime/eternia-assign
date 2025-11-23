import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { orderQueue, closeQueue } from '../../queue/orderQueue';
import { createOrder, getOrderById } from '../../db';
import { OrderStatus } from '../../models/order';

describe('Queue Integration Tests', () => {
  beforeAll(async () => {
    // Wait for queue to be ready
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await closeQueue();
  });

  beforeEach(async () => {
    // Clean queue
    await orderQueue.obliterate({ force: true });
  });

  it('should process order through queue', async () => {
    const order = await createOrder({
      userId: 'test-queue-1',
      orderType: 'limit',
      tokenIn: 'SOL',
      tokenOut: 'USDC',
      amount: 1.0,
      limitPrice: 25.0, // Set low to ensure execution
      slippageTolerance: 0.01,
    });

    await orderQueue.add('execute-order', { orderId: order.id });

    // Wait for processing (with timeout)
    let finalOrder = null;
    for (let i = 0; i < 30; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      finalOrder = await getOrderById(order.id);
      if (finalOrder && (finalOrder.status === OrderStatus.CONFIRMED || finalOrder.status === OrderStatus.FAILED)) {
        break;
      }
    }

    expect(finalOrder).not.toBeNull();
    expect([OrderStatus.CONFIRMED, OrderStatus.FAILED]).toContain(finalOrder!.status);
  }, 35000);

  it('should handle multiple concurrent orders', async () => {
    const orders = await Promise.all(
      Array.from({ length: 3 }, (_, i) =>
        createOrder({
          userId: `test-concurrent-${i}`,
          orderType: 'limit',
          tokenIn: 'SOL',
          tokenOut: 'USDC',
          amount: 1.0,
          limitPrice: 25.0,
          slippageTolerance: 0.01,
        })
      )
    );

    await Promise.all(
      orders.map((order) => orderQueue.add('execute-order', { orderId: order.id }))
    );

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 10000));

    const finalOrders = await Promise.all(
      orders.map((order) => getOrderById(order.id))
    );

    finalOrders.forEach((order) => {
      expect(order).not.toBeNull();
    });
  }, 20000);
});

