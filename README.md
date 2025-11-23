# Order Execution Engine

An Order Execution Engine that accepts orders via HTTP, returns an `orderId`, and streams status updates via WebSocket. Supports DEX routing (Raydium and Meteora), queue processing with concurrency control, and exponential backoff retry logic.

## Features

- **Limit Order Support**: Execute orders only when price reaches target
- **DEX Routing**: Automatically routes to best DEX (Raydium or Meteora) based on net price
- **WebSocket Streaming**: Real-time status updates (`pending → routing → building → submitted → confirmed/failed`)
- **Queue Processing**: BullMQ with configurable concurrency (default: 10 concurrent orders)
- **Rate Limiting**: Supports up to 100 orders/minute
- **Retry Logic**: Exponential backoff with up to 3 retry attempts
- **Persistence**: PostgreSQL for order history, Redis for active orders and queue
- **Mock & Real DEX**: Supports both mock implementations and real Solana devnet (configurable)

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Framework**: Fastify with WebSocket support
- **Queue**: BullMQ
- **Database**: PostgreSQL
- **Cache/Queue**: Redis
- **Testing**: Vitest

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- pnpm (or npm)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <repo-url>
   cd eternia-assign
   ```

2. **Copy environment variables**
   ```bash
   cp .env.example .env
   # Edit .env as needed
   ```

3. **Start infrastructure with Docker Compose**
   ```bash
   docker-compose up -d postgres redis
   ```

4. **Install dependencies**
   ```bash
   pnpm install
   ```

5. **Run database migrations**
   ```bash
   pnpm run migrate
   ```

6. **Start development server**
   ```bash
   pnpm run dev
   ```

The server will be available at `http://localhost:3000`

### Using Docker Compose (Full Stack)

```bash
docker-compose up
```

This will start PostgreSQL, Redis, and the application.

## API Endpoints

### POST /api/orders/execute

Submit a limit order. The connection can be upgraded to WebSocket for live updates.

**Request:**
```json
{
  "userId": "user-123",
  "orderType": "limit",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "limitPrice": 25.5,
  "slippageTolerance": 0.01
}
```

**Response:**
```json
{
  "orderId": "uuid-v4",
  "message": "Order accepted. Connect to WebSocket for live updates."
}
```

### GET /api/orders/:id

Get order status by ID.

**Response:**
```json
{
  "id": "uuid-v4",
  "userId": "user-123",
  "orderType": "limit",
  "status": "confirmed",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "limitPrice": 25.5,
  "executedPrice": 25.34,
  "txHash": "mock-raydium-abc123",
  "chosenDex": "Raydium",
  ...
}
```

### WebSocket: ws://localhost:3000/ws?orderId=<orderId>

Connect to WebSocket to receive real-time order updates.

**Message Format:**
```json
{
  "orderId": "uuid-v4",
  "status": "routing",
  "timestamp": "2025-01-23T12:00:00Z",
  "details": {
    "quotes": {
      "raydium": { "price": 25.45, "liquidity": 100000, "fee": 0.003 },
      "meteora": { "price": 25.70, "liquidity": 80000, "fee": 0.002 },
      "chosen": "Raydium"
    }
  }
}
```

**Status Flow:**
1. `pending` - Order accepted and queued
2. `routing` - Fetching quotes from DEXs (includes quote details)
3. `building` - Building transaction
4. `submitted` - Transaction submitted (includes txHash)
5. `confirmed` - Transaction confirmed (includes executedPrice)
6. `failed` - Order failed (includes error details)

## Testing

Run tests:
```bash
pnpm test
```

Run tests in watch mode:
```bash
pnpm test:watch
```

Run tests with coverage:
```bash
pnpm test:coverage
```

## Environment Variables

See `.env.example` for all available configuration options.

Key variables:
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `BULL_CONCURRENCY` - Max concurrent queue workers (default: 10)
- `ORDER_PROCESSOR_RATE` - Orders per minute (default: 100)
- `MAX_RETRIES` - Max retry attempts (default: 3)
- `USE_REAL_DEVNET` - Enable real Solana devnet (default: false)

## Project Structure

```
.
├── src/
│   ├── server.ts              # Entry point
│   ├── app.ts                 # Fastify app setup
│   ├── routes/orders.ts       # API routes
│   ├── ws/orderWsHandler.ts   # WebSocket handler
│   ├── queue/orderQueue.ts    # BullMQ queue & worker
│   ├── services/
│   │   ├── dexRouter.ts       # DEX routing logic
│   │   ├── mockDex.ts         # Mock DEX implementations
│   │   ├── solanaDex.ts       # Real devnet adapters (stubs)
│   │   └── orderService.ts     # Order execution orchestrator
│   ├── db/                    # Database connection & queries
│   ├── models/order.ts        # Order types & schemas
│   └── utils/                 # Utilities (logger, backoff, sleep)
├── infra/init.sql            # Database schema
├── docker-compose.yml        # Docker setup
└── tests/                    # Test files
```

## Mock vs Real Devnet

By default, the system uses mock DEX implementations with realistic delays and variance. To enable real Solana devnet:

1. Set `USE_REAL_DEVNET=true` in `.env`
2. Install Solana SDKs:
   ```bash
   pnpm add @solana/web3.js @solana/spl-token @raydium-io/raydium-sdk-v2 @meteora-ag/dynamic-amm-sdk
   ```
3. Configure `DEVNET_RPC_URL` and `WALLET_PRIVATE_KEY`
4. Ensure you have devnet SOL via [Solana Faucet](https://faucet.solana.com)

**Note**: Real devnet implementations are stubs and need to be completed.

## Demo

See `docs/demo-instructions.md` for demo setup instructions.

## Postman Collection

See `docs/postman_collection.json` for API testing collection.

## Deployment

See `docs/deployment.md` for deployment instructions.

## License

MIT

