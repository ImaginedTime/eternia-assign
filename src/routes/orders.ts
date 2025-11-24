import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import WebSocket from 'ws';
import { CreateOrderSchema, CreateOrderRequest } from '../models/order';
import { createOrder, getOrderById } from '../db';
import { orderQueue } from '../queue/orderQueue';
import { logger } from '../utils/logger';
import { handleOrderWebSocket } from '../ws/orderWsHandler';

interface OrderExecuteParams {
  Body: CreateOrderRequest;
}

/**
 * POST /api/orders/execute
 * Accepts order and upgrades to WebSocket
 */
export async function executeOrderRoute(
  request: FastifyRequest<OrderExecuteParams>,
  reply: FastifyReply
) {
  try {
    // Validate request body
    const validated = CreateOrderSchema.parse(request.body);

    // Create order in DB
    const order = await createOrder({
      userId: validated.userId,
      orderType: validated.orderType,
      tokenIn: validated.tokenIn,
      tokenOut: validated.tokenOut,
      amount: validated.amount,
      limitPrice: validated.limitPrice,
      slippageTolerance: validated.slippageTolerance || 0.01,
    });

    logger.info('Order created', {
      orderId: order.id,
      userId: order.userId,
      orderType: order.orderType,
    });

    // Add job to queue
    await orderQueue.add('execute-order', { orderId: order.id });

    // Return HTTP response
    // Client should connect to /ws?orderId=<orderId> for WebSocket updates
    return reply.send({
      orderId: order.id,
      message: 'Order accepted. Connect to WebSocket for live updates.',
      wsUrl: `/ws?orderId=${order.id}`,
    });
  } catch (error: any) {
    logger.error('Order execution failed', { error: error.message });
    if (error.name === 'ZodError') {
      return reply.status(400).send({
        error: 'Validation error',
        details: error.errors,
      });
    }
    return reply.status(500).send({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

/**
 * GET /api/orders/:id
 * Get order status
 */
export async function getOrderRoute(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply
) {
  try {
    const { id } = request.params;
    const order = await getOrderById(id);

    if (!order) {
      return reply.status(404).send({
        error: 'Order not found',
      });
    }

    return reply.send(order);
  } catch (error: any) {
    logger.error('Get order failed', { error: error.message });
    return reply.status(500).send({
      error: 'Internal server error',
      message: error.message,
    });
  }
}

/**
 * WebSocket endpoint handler
 */
export async function orderWebSocketHandler(
  socket: WebSocket,
  request: FastifyRequest<{ Querystring: { orderId?: string } }>
) {
  const orderId = request.query?.orderId;

  if (!orderId || typeof orderId !== 'string') {
    socket.close(1008, 'Missing orderId');
    return;
  }

  await handleOrderWebSocket(socket, orderId);
}

