import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../../app';
import { getPool } from '../../db';
import { closeQueue } from '../../queue/orderQueue';

describe('API Integration Tests', () => {
  let app: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await closeQueue();
    await app.close();
  });

  beforeEach(async () => {
    await getPool().query('DELETE FROM orders WHERE user_id LIKE $1', ['test-%']);
  });

  it('POST /api/orders/execute should create order', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        userId: 'test-user-api',
        orderType: 'limit',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0,
        limitPrice: 25.5,
        slippageTolerance: 0.01,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.orderId).toBeDefined();
    expect(body.message).toContain('Order accepted');
  });

  it('POST /api/orders/execute should validate request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        userId: '',
        orderType: 'limit',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: -1,
        limitPrice: 25.5,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Validation error');
  });

  it('GET /api/orders/:id should return order', async () => {
    // First create an order
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/orders/execute',
      payload: {
        userId: 'test-user-get',
        orderType: 'limit',
        tokenIn: 'SOL',
        tokenOut: 'USDC',
        amount: 1.0,
        limitPrice: 25.5,
      },
    });

    const { orderId } = JSON.parse(createResponse.body);

    // Then get it
    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/orders/${orderId}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const order = JSON.parse(getResponse.body);
    expect(order.id).toBe(orderId);
    expect(order.userId).toBe('test-user-get');
  });

  it('GET /api/orders/:id should return 404 for non-existent order', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('Order not found');
  });

  it('GET /health should return ok', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('ok');
  });
});

