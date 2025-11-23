> Source spec: `/Backend Task 2_ Order Execution Engine.pdf`. Use that file to verify acceptance criteria and deliverables. 

## Quick summary (what to build)

Implement an **Order Execution Engine** that accepts orders via `POST /api/orders/execute`, returns an `orderId`, then upgrades the HTTP connection to a WebSocket to stream status updates (`pending → routing → building → submitted → confirmed / failed`).
Chosen order type: **Limit Order** (details and extension notes below).

Core capabilities:

* DEX quoting from Raydium and Meteora (mock or real devnet)
* Price comparison & automatic routing to best DEX
* Execution flow streamed via WebSocket
* Queue processing supporting up to 10 concurrent orders, throughput 100 orders/minute
* Exponential backoff retry (≤3 attempts), persist failures
* Postgres for order history, Redis for active orders + BullMQ queue
* Node.js + TypeScript, Fastify (with WebSocket), BullMQ, Redis, PostgreSQL

---

## Why I chose **Limit Order**

A **Limit Order** demonstrates routing logic + additional threshold logic (execute only when price reaches target) and requires the system to optionally wait/retry—this showcases queueing, status transitions, and slippage protection.
(Extension: Market and Sniper can be added by swapping the execution condition — Market triggers immediate execution at best quote; Sniper watches token launch events and triggers a high-priority immediate market/snipe execution.)

---

## Project layout (files to create)

```
.
├── README.md                     # <- this file
├── package.json
├── tsconfig.json
├── src/
│   ├── server.ts                 # fastify server + ws upgrade
│   ├── app.ts                    # initialize services
│   ├── routes/orders.ts          # POST /api/orders/execute
│   ├── ws/orderWsHandler.ts      # WebSocket lifecycle for order
│   ├── queue/orderQueue.ts       # BullMQ queue & worker
│   ├── services/dexRouter.ts     # core DEX quoting & routing
│   ├── services/mockDex.ts       # mock implementations
│   ├── services/solanaDex.ts     # real devnet adapters (optional)
│   ├── services/orderService.ts  # orchestrator - build tx, apply slippage
│   ├── db/index.ts               # postgres connection + migrations
│   ├── models/order.ts           # Order type + DB mapping
│   ├── utils/logger.ts
│   ├── utils/backoff.ts
│   └── tests/                    # unit & integration tests
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── infra/
    └── init.sql                  # DB schema
```

---

## Environment variables (`.env.example`)

```
# Server
PORT=3000
NODE_ENV=development

# Database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/orders

# Redis for BullMQ + active orders
REDIS_URL=redis://redis:6379

# BullMQ
BULL_CONCURRENCY=10

# Execution config
USE_REAL_DEVNET=false         # set to true to enable real devnet SDKs
DEVNET_RPC_URL=https://api.devnet.solana.com
WALLET_PRIVATE_KEY=...        # if USE_REAL_DEVNET=true

# DEX configs (only used if USE_REAL_DEVNET=true)
RAYDIUM_SDK_KEY=...
METEORA_SDK_KEY=...

# App-specific
QUEUE_MAX_CONCURRENT=10
ORDER_PROCESSOR_RATE=100      # orders per minute target for throttling
MAX_RETRIES=3
BACKOFF_BASE_MS=500           # exponential backoff base
LOG_LEVEL=debug
```

---

## Database schema (Postgres `infra/init.sql`)

```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,
  order_type TEXT, -- 'limit'
  token_in TEXT,
  token_out TEXT,
  amount NUMERIC,
  limit_price NUMERIC,
  status TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  executed_price NUMERIC,
  tx_hash TEXT
);

CREATE INDEX idx_orders_status ON orders(status);
```

---

## API: `POST /api/orders/execute`

**Description**: Accepts a Limit Order and upgrades the connection to WebSocket.

**Request** (JSON)

```json
{
  "userId": "user-123",
  "orderType": "limit",
  "tokenIn": "SOL",
  "tokenOut": "USDC",
  "amount": 1.5,
  "limitPrice": 25.5,
  "slippageTolerance": 0.01   // optional
}
```

**Response (HTTP 200)**:

```json
{
  "orderId": "uuid-v4",
  "message": "Order accepted. Upgrading to WebSocket for live updates."
}
```

**Connection upgrade**: Immediately upgrade to WebSocket on same connection (Fastify + ws). After WS open, stream updates for this orderId.

---

## WebSocket messages — status lifecycle

Every WS message is JSON with structure:

```json
{
  "orderId": "uuid-v4",
  "status": "pending|routing|building|submitted|confirmed|failed",
  "timestamp": "2025-11-23T12:00:00Z",
  "details": { ... }      // optional e.g. quote details, txHash, error
}
```

**Sequence for a successful limit order**:

1. `pending` — accepted and queued
2. `routing` — quotes fetched and compared (include quotes from both DEXs)

   * details: `{ "raydium": {price, liquidity}, "meteora": {price, liquidity}, "chosen": "Raydium" }`
3. `building` — building transaction, accounting for slippage/wrap SOL
4. `submitted` — tx submitted; details: `{ "txHash": "..." }`
5. `confirmed` — tx confirmed; details: `{ "txHash": "...", "executedPrice": 25.34 }`

**Failed**: Any step may emit `failed` with `details.error` and persist `last_error` & attempts in DB.

---

## DEX Router — behavior & expectations

* Query both Raydium and Meteora for quotes for the requested amount.
* Simulate small random variance if in mock mode.
* Choose the DEX with the best *net* price after fees and expected slippage.
* For native SOL swaps, handle wrapping/unwrapping in `building` stage.
* Log routing decisions to console and to DB (for post-mortem).

**Mock behavior** (must match assignment guide: realistic delays and variance):

* `getRaydiumQuote()` sleep 200–400ms → return price `base*(0.98 + rand*0.04)` and fee 0.003
* `getMeteoraQuote()` sleep 200–400ms → return price `base*(0.97 + rand*0.05)` and fee 0.002
* `executeSwap()` sleep 2000–3000ms → return `txHash` and `executedPrice`

---

## Implementation details (core modules)

### `src/services/dexRouter.ts`

* Exposes `getQuotes(tokenIn, tokenOut, amount)` that concurrently calls both dex adapters and returns sorted quotes.
* Exposes `selectBestDex(quotes)` → returns `{ dexName, expectedPrice, fee }`.

### `src/services/mockDex.ts`

* Implement mock methods per spec with realistic `sleep()` delays.

### `src/services/solanaDex.ts`

* When `USE_REAL_DEVNET=true`, use `@raydium-io/raydium-sdk-v2` & `@meteora-ag/dynamic-amm-sdk` and `@solana/web3.js`.
* Provide `getQuote()` and `executeSwap()` wrappers.
* Add caution around wrapping SOL: create wrap transactions when needed.

### `src/queue/orderQueue.ts`

* Use BullMQ with concurrency from `BULL_CONCURRENCY` (default 10).
* Rate-limiting to meet ~100 orders/minute (implement a token-bucket or simple throttle per worker).
* Each job performs:

  1. Update DB status to `routing`
  2. `getQuotes()` → decide DEX
  3. Update DB status `building`
  4. `buildTx()` and `executeSwap()` (or mock)
  5. `submitted` then `confirmed` on success
* Retry logic: if step fails, increment `attempts`, exponential backoff using base `BACKOFF_BASE_MS`, up to `MAX_RETRIES`. On 3rd failure emit `failed` and persist `last_error`.

---

## HTTP → WebSocket pattern (Fastify)

* Endpoint: `/api/orders/execute` accepts POST
* Implementation pattern:

  1. Validate body, create DB order row with `status='pending'`.
  2. Push job to BullMQ queue.
  3. Respond with `orderId`.
  4. Immediately `upgrade` the connection to WebSocket for that `orderId`. On WS open, subscribe the socket to order updates (use Redis pub/sub or BullMQ events).
* Push updates to client via WS at every status transition and on each retry/error event.

---

## Logging & Observability

* Use structured logs (JSON) with `orderId`, `userId`, `step`, `dex`, `quotes`, `txHash`.
* Persist routing decisions to Postgres in order row (fields: chosen_dex, chosen_quote).
* Expose `/metrics` endpoint if desired (Prometheus format): queue depth, processed/min, success rate, average execution time.

---

## Tests

Create `>=10` tests (unit + integration). Examples:

**Unit tests**

1. `dexRouter` price comparison chooses lower net price (mock both quotes).
2. `mockDex.getRaydiumQuote` returns price in expected range.
3. `backoff` util computes increasing delays.
4. `orderService.buildTx` handles wrap SOL case.

**Integration tests**
5. Submit an order → verify DB status `pending` then `confirmed` via event simulation (mock dex).
6. Submit 5 simultaneous orders → ensure queue concurrency <= `QUEUE_MAX_CONCURRENT`.
7. Simulate dex failure on first attempt → ensure worker retries (attempts increment) then success.
8. Simulate persistent failure → ensure `failed` status and `last_error` saved.
9. WebSocket lifecycle: open WS, submit order, assert received `pending` & `routing` & `confirmed`.
10. Rate limit test: flood 200 orders and ensure throughput ~100 orders/minute (within tolerance).

Testing frameworks: `vitest` or `jest`, `supertest` for HTTP, `ws` for WebSocket. Use in-memory Postgres for CI (or testcontainers).

---

## Postman/Insomnia collection (deliverable)

Provide a JSON export that includes:

* `POST /api/orders/execute` (req body example)
* `GET /orders/:id` (status)
* WebSocket tester (ws://host:port/ws?orderId=...)
* Example environment variables

(Instruction to implementor: generate/export the collection JSON to `docs/postman_collection.json`)

---

## Deployment (free hosting)

* Provide `Dockerfile` and `docker-compose.yml` for local and cloud deploy.
* `docker-compose.yml` should spin up: app, redis, postgres.
* Provide single `heroku` / `fly.io` / `Render` deploy instructions (choose one).
* Include `start` scripts in `package.json` and `Procfile` if needed.

---

## How to run locally (developer commands)

```bash
# 1. clone repo
git clone <repo>
cd repo

# 2. copy env
cp .env.example .env
# edit .env as needed

# 3. start infra with docker-compose
docker-compose up -d

# 4. install deps
pnpm install   # or npm install

# 5. run migrations
pnpm run migrate

# 6. run dev server
pnpm run dev   # uses ts-node or nodemon

# 7. run tests
pnpm test
```

Docker compose sample snippet:

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - '3000:3000'
    env_file:
      - .env
    depends_on:
      - redis
      - postgres
  redis:
    image: redis:6
    ports: ['6379:6379']
  postgres:
    image: postgres:14
    environment:
      - POSTGRES_PASSWORD=postgres
    ports: ['5432:5432']
```

---

## Demo / YouTube instructions (deliverable)

Record a 1-2 minute video showing:

1. Start server & infra (show console logs).
2. Submit 3–5 limit orders (some below current price so they wait; some at/better than current price so they execute).
3. Show WebSocket client receiving progress for multiple orders simultaneously.
4. Show logs where DEX routing decisions are printed for each order.
5. Show queue processing concurrency (console prints worker start/finish).
6. If real devnet used, show Solana Explorer link for tx.

Suggested tool: show `curl` + a simple WebSocket client (e.g., `wscat` or browser devtools).

---

## Deliverables checklist (as required)

* [ ] GitHub repo with clean commits
* [ ] API `/api/orders/execute` + WebSocket streaming
* [ ] DEX routing logic (mock + optional real devnet)
* [ ] Queue (BullMQ) with concurrency & retry logic
* [ ] Postgres DB & Redis integration
* [ ] Postman/Insomnia collection (`docs/postman_collection.json`)
* [ ] ≥10 unit/integration tests (placed in `src/tests`)
* [ ] Public deployment URL (include in README)
* [ ] 1–2 minute public YouTube demo (include link in README)
* [ ] Logging & persisted failure reasons for post-mortem
* [ ] README with setup & design decisions (this file)

---

## How to switch between **Mock** and **Real Devnet**

* Default: `USE_REAL_DEVNET=false` (mock).
* To enable real execution:

  1. Set `USE_REAL_DEVNET=true`
  2. Ensure `DEVNET_RPC_URL` points to devnet + wallet keys available in `WALLET_PRIVATE_KEY`.
  3. Install SDKs:

     ```
     pnpm add @solana/web3.js @solana/spl-token @raydium-io/raydium-sdk-v2 @meteora-ag/dynamic-amm-sdk
     ```
  4. Ensure you have devnet SOL via [https://faucet.solana.com](https://faucet.solana.com)
  5. Run integration tests carefully (they will hit devnet and may be slower)

**Note**: When using real devnet the implementation must:

* Perform `wrap` for native SOL (createSyncNativeInstruction)
* Use `sendAndConfirmTransaction` or SDK wrapper with `sendAndConfirm=true`
* Record the tx link (e.g., `https://explorer.solana.com/tx/{txHash}?cluster=devnet`) in the README deliverable.

---

## Observations, edge-cases & recommended extras

* **Sniper** order support: create a high-priority queue and a watcher on token launch events.
* **Limit order book**: for production, implement a book or time-in-force; for assignment keep single-side limit orders.
* **Idempotence**: each job should be idempotent (use `orderId` as unique key).
* **Security**: never commit `WALLET_PRIVATE_KEY`. Use secrets management.
* **Data retention**: keep `orders` history but rotate logs.

---

## Sample cURL + WS demo

1. Submit order and upgrade to WebSocket (fastify pattern uses same connection — example for the dev: if using separate WS)

```bash
# POST to get orderId
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","orderType":"limit","tokenIn":"SOL","tokenOut":"USDC","amount":1,"limitPrice":25.5}'
```

2. Connect WebSocket (client should use the same session or use `ws://localhost:3000/ws?orderId=<id>`)

```bash
wscat -c "ws://localhost:3000/ws?orderId=<orderId>"
# Expect streaming JSON messages as described
```

---

## Logging examples (what to log)

```
INFO orderId=... step=pending userId=...
INFO orderId=... step=routing raydium_price=25.45 meteora_price=25.70 chosen=raydium
INFO orderId=... step=building actions="wrapSol" estimatedMinOut=...
INFO orderId=... step=submitted txHash=...
INFO orderId=... step=confirmed txHash=... executedPrice=25.34
ERROR orderId=... step=execute attempt=2 error="RPC timeout"
```

---

## Acceptance criteria verification (for reviewer)

* Submit three simultaneous orders and observe WS updates for each (pending → routing → building → submitted → confirmed).
* Show logs with DEX routing decisions for each order.
* Show persistence of orders in Postgres with final statuses.
* Provide Postman collection + test suite outputs.

---

## Implementation notes for Cursor (developer agent)

1. Use the repository layout above and generate TypeScript files with clear function boundaries.
2. Provide unit & integration tests and ensure `pnpm test` runs them.
3. Provide `docs/postman_collection.json` and `docs/deployment.md`.
4. Keep the `mockDex` code as the default path; add `solanaDex` stubs but do not enable them unless `USE_REAL_DEVNET=true`.
5. Use explicit typing in TypeScript; include JSDoc for exported functions.
6. Add helpful git commits (small, descriptive).
7. After finishing implementation, run tests and produce a short `docs/demo-instructions.md` with the console commands to reproduce the recorded demo.

---

## Example of mockDex code (copy/paste ready)

```ts
// src/services/mockDex.ts
import { sleep } from '../utils/sleep';
export async function getRaydiumQuote(basePrice:number, amount:number) {
  await sleep(200 + Math.random()*200);
  const price = basePrice * (0.98 + Math.random()*0.04);
  return { price, fee: 0.003, liquidity: 100000 };
}
export async function getMeteoraQuote(basePrice:number, amount:number) {
  await sleep(200 + Math.random()*200);
  const price = basePrice * (0.97 + Math.random()*0.05);
  return { price, fee: 0.002, liquidity: 80000 };
}
export async function executeSwap(dex:string, order:any) {
  await sleep(2000 + Math.random()*1000);
  const txHash = 'mock-' + Math.random().toString(36).slice(2, 12);
  const executedPrice = order.limitPrice * (0.995 + Math.random()*0.01);
  return { txHash, executedPrice };
}
```

---

## Post-implementation checklist for final submission

* [ ] Attach GitHub repo link in README.
* [ ] Deploy and put public URL in README.
* [ ] Add Postman collection file to repo and link in README.
* [ ] Ensure `>=10` tests with passing results (include test coverage report).
* [ ] Upload public YouTube demo and include link.

---

## Files you may want to include in the repository

* `docs/postman_collection.json`
* `docs/deployment.md`
* `docs/demo-instructions.md`
* `infra/init.sql`
* `src/tests/*` (unit & integration)
* `Dockerfile`, `docker-compose.yml`