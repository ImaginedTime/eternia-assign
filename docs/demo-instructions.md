# Demo Instructions

This guide provides step-by-step instructions to demonstrate the Order Execution Engine.

## Prerequisites

- Docker and Docker Compose installed
- Terminal/Command prompt
- WebSocket client (wscat, browser devtools, or Postman)

## Step 1: Start the Application

```bash
# Start infrastructure (PostgreSQL and Redis)
docker-compose up -d postgres redis

# Wait a few seconds for services to be ready
sleep 5

# Install dependencies (if not already done)
pnpm install

# Run database migrations
pnpm run migrate

# Start the server
pnpm run dev
```

You should see:
```
INFO Database connection established
INFO Redis connection established
INFO Server listening on port 3000
```

## Step 2: Install WebSocket Client (if needed)

```bash
# Using npm
npm install -g wscat

# Or using pnpm
pnpm add -g wscat
```

## Step 3: Submit Orders

### Order 1: Limit order that will execute (price below limit)

```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-1",
    "orderType": "limit",
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amount": 1.0,
    "limitPrice": 25.5,
    "slippageTolerance": 0.01
  }'
```

Save the `orderId` from the response.

### Order 2: Another order with different parameters

```bash
curl -X POST http://localhost:3000/api/orders/execute \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-2",
    "orderType": "limit",
    "tokenIn": "SOL",
    "tokenOut": "USDC",
    "amount": 2.5,
    "limitPrice": 26.0,
    "slippageTolerance": 0.01
  }'
```

## Step 4: Connect WebSocket for Real-time Updates

### Using wscat:

```bash
# Replace <orderId> with the orderId from step 3
wscat -c "ws://localhost:3000/ws?orderId=<orderId>"
```

You should see messages like:
```json
{"orderId":"...","status":"connected","timestamp":"...","message":"WebSocket connected..."}
{"orderId":"...","status":"routing","timestamp":"...","details":{"quotes":{...}}}
{"orderId":"...","status":"building","timestamp":"..."}
{"orderId":"...","status":"submitted","timestamp":"...","details":{"txHash":"..."}}
{"orderId":"...","status":"confirmed","timestamp":"...","details":{"txHash":"...","executedPrice":...}}
```

### Using Browser DevTools:

1. Open browser console (F12)
2. Run:
```javascript
const ws = new WebSocket('ws://localhost:3000/ws?orderId=<orderId>');
ws.onmessage = (event) => console.log(JSON.parse(event.data));
```

## Step 5: Monitor Server Logs

Watch the server console to see:
- Order creation logs
- DEX routing decisions (Raydium vs Meteora)
- Queue processing
- Status transitions

Example log output:
```
INFO orderId=... step=pending userId=user-1
INFO orderId=... step=routing raydium_price=25.45 meteora_price=25.70 chosen=Raydium
INFO orderId=... step=building actions="wrapSol" estimatedMinOut=...
INFO orderId=... step=submitted txHash=mock-Raydium-abc123
INFO orderId=... step=confirmed txHash=mock-Raydium-abc123 executedPrice=25.34
```

## Step 6: Check Order Status via API

```bash
# Replace <orderId> with actual order ID
curl http://localhost:3000/api/orders/<orderId>
```

## Step 7: View Queue Metrics

```bash
curl http://localhost:3000/metrics
```

Response:
```json
{
  "queue": {
    "waiting": 0,
    "active": 1,
    "completed": 5,
    "failed": 0
  }
}
```

## Step 8: Submit Multiple Orders Simultaneously

```bash
# Submit 5 orders at once
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/orders/execute \
    -H "Content-Type: application/json" \
    -d "{
      \"userId\": \"user-batch-$i\",
      \"orderType\": \"limit\",
      \"tokenIn\": \"SOL\",
      \"tokenOut\": \"USDC\",
      \"amount\": 1.0,
      \"limitPrice\": 25.0,
      \"slippageTolerance\": 0.01
    }" &
done
wait
```

Observe:
- Queue processing concurrency (max 10 concurrent)
- Multiple WebSocket connections receiving updates
- Server logs showing parallel processing

## Step 9: Test Retry Logic (Optional)

To test retry logic, you can temporarily modify the mock DEX to fail on first attempt:

1. Edit `src/services/mockDex.ts`
2. Add a failure condition
3. Restart server
4. Submit an order
5. Observe retry attempts in logs

## Step 10: Check Database

```bash
# Connect to PostgreSQL
docker-compose exec postgres psql -U postgres -d orders

# Query orders
SELECT id, user_id, status, attempts, last_error, tx_hash, executed_price 
FROM orders 
ORDER BY created_at DESC 
LIMIT 10;
```

## Demo Checklist

- [ ] Server starts successfully
- [ ] Database connection established
- [ ] Redis connection established
- [ ] Submit order via POST /api/orders/execute
- [ ] Receive orderId in response
- [ ] Connect WebSocket and receive status updates
- [ ] See status transitions: pending → routing → building → submitted → confirmed
- [ ] View DEX routing decisions in logs (Raydium vs Meteora)
- [ ] Submit multiple orders and observe concurrency
- [ ] Check order status via GET /api/orders/:id
- [ ] View queue metrics
- [ ] Verify orders persisted in database

## Troubleshooting

1. **Port already in use**: Change `PORT` in `.env`
2. **Database connection failed**: Ensure PostgreSQL is running (`docker-compose ps`)
3. **Redis connection failed**: Ensure Redis is running
4. **WebSocket connection failed**: Check server logs for errors
5. **Orders not processing**: Check queue worker logs

## Recording the Demo

When recording:
1. Show terminal with server logs
2. Show terminal with curl commands
3. Show WebSocket client receiving updates
4. Show database query results
5. Highlight DEX routing decisions in logs
6. Show queue metrics

Total demo time: 1-2 minutes

